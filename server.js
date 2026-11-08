const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const PORT = 3850;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const FILES_DIR = path.join(DATA_DIR, 'files');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const DMS_FILE = path.join(DATA_DIR, 'dms.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

function load(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {}
  return fallback;
}
const dirtyFiles = new Map();
let saveSoon = false;
function save(file, data) {
  dirtyFiles.set(file, data);
  if (saveSoon) return;
  saveSoon = true;
  setImmediate(flushSaves);
}
async function flushSaves() {
  const batch = [...dirtyFiles.entries()];
  dirtyFiles.clear();
  saveSoon = false;
  for (const [file, payload] of batch) {
    const tmp = file + '.tmp';
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(payload));
      await fs.promises.rename(tmp, file);
    } catch (_) {}
  }
  if (dirtyFiles.size) {
    saveSoon = true;
    setImmediate(flushSaves);
  }
}

let users = load(USERS_FILE, {});
let messages = load(MESSAGES_FILE, {});
const pulseWaiters = new Set();
let profileRev = 1;
let alertRev = 1;
function touchProfiles() {
  profileRev += 1;
  for (const waiter of [...pulseWaiters]) waiter.finish();
}
function touchAlerts() {
  alertRev += 1;
  for (const waiter of [...pulseWaiters]) {
    if (waiter.alert) waiter.finish();
  }
}
function wakePulse(roomId) {
  for (const waiter of pulseWaiters) {
    if (waiter.roomId === roomId) waiter.finish();
  }
}
function memberStamp(g) {
  const rows = Object.keys((g && g.members) || {}).sort().map((id) => {
    const u = users[id] || {};
    const m = (g.members && g.members[id]) || {};
    return [
      id,
      u.username || '',
      u.displayName || '',
      m.nick || '',
      u.avatarUrl || '',
      u.nameEffect || '',
      Array.isArray(u.nameColors) ? u.nameColors.join(',') : '',
      u.status || '',
    ].join('\t');
  });
  return crypto.createHash('sha1').update(rows.join('\n')).digest('hex').slice(0, 16);
}
function wakeGuild(g) {
  if (!g) return;
  const rooms = new Set((g.channels || []).map((c) => c.id));
  for (const waiter of [...pulseWaiters]) {
    if (rooms.has(waiter.roomId)) waiter.finish();
  }
}
let codes = load(CODES_FILE, {});
let friendGraph = load(FRIENDS_FILE, {});
let dmThreads = load(DMS_FILE, {});

let strippedSecrets = false;
for (const u of Object.values(users)) {
  if (u && Object.prototype.hasOwnProperty.call(u, 'passwordPlain')) {
    delete u.passwordPlain;
    strippedSecrets = true;
  }
}
if (strippedSecrets) save(USERS_FILE, users);
for (const entry of Object.values(codes)) {
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'passwordPlain')) delete entry.passwordPlain;
}
save(CODES_FILE, codes);

const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

function ensureFriendNode(userId) {
  if (!friendGraph[userId]) {
    friendGraph[userId] = { friends: [], incoming: [], outgoing: [] };
  }
  return friendGraph[userId];
}

function dmKey(a, b) {
  return [a, b].sort().join(':');
}

function nextUid() {
  let max = 0;
  for (const u of Object.values(users)) {
    const n = Number(u.uid) || 0;
    if (n > max) max = n;
  }
  return max + 1;
}

const SERVER_NAME = 'Nebula Official';
const OFFICIAL_ID = 'nebula-official';
const GUILDS_FILE = path.join(DATA_DIR, 'guilds.json');

const PERM = {
  VIEW: 1,
  SEND: 2,
  MANAGE_CHANNELS: 4,
  MANAGE_ROLES: 8,
  INVITE: 16,
  MANAGE_SERVER: 32,
  ADMIN: 128,
};
const ALL_PERMS = Object.values(PERM).reduce((a, b) => a | b, 0);

let guilds = load(GUILDS_FILE, { servers: {} });

function officialChannels() {
  return [
    { id: 'general', name: 'general', type: 'text', topic: 'Welcome to Nebula Official', overwrites: [] },
    { id: 'announcements', name: 'announcements', type: 'text', topic: 'Official news', overwrites: [] },
    { id: 'rules', name: 'rules', type: 'text', topic: 'Server rules', overwrites: [] },
    { id: 'showcase', name: 'showcase', type: 'text', topic: 'Show off your stuff', overwrites: [] },
    { id: 'random', name: 'random', type: 'text', topic: 'Off-topic', overwrites: [] },
    { id: 'voice-lobby', name: 'Lobby', type: 'voice', topic: '', overwrites: [] },
    { id: 'voice-gaming', name: 'Gaming', type: 'voice', topic: '', overwrites: [] },
    { id: 'voice-afk', name: 'AFK', type: 'voice', topic: '', overwrites: [] },
  ];
}

function everyoneRole() {
  return { id: 'everyone', name: '@everyone', color: '#99aab5', permissions: PERM.VIEW | PERM.SEND | PERM.INVITE, position: 0 };
}

function ownerRole() {
  return { id: 'owner', name: 'Owner', color: '#7c5cff', permissions: ALL_PERMS, position: 100 };
}

function hereRole() {
  return { id: 'here', name: '@here', color: '#99aab5', permissions: 0, position: 1, mentionBy: ['og', 'admin'] };
}

function ogRole() {
  return { id: 'og', name: 'og', color: '#e3b34c', permissions: PERM.VIEW | PERM.SEND | PERM.INVITE, position: 40 };
}

function adminRole() {
  return { id: 'admin', name: 'Admin', color: '#f06a6a', permissions: ALL_PERMS, position: 90 };
}

function managerRole() {
  return {
    id: 'manager',
    name: 'Manager',
    color: '#f0b429',
    permissions: PERM.VIEW | PERM.SEND | PERM.INVITE | PERM.MANAGE_CHANNELS | PERM.MANAGE_ROLES | PERM.MANAGE_SERVER,
    position: 70,
  };
}

function moderatorRole() {
  return { id: 'moderator', name: 'Moderator', color: '#3ecf8e', permissions: PERM.VIEW | PERM.SEND | PERM.INVITE, position: 50 };
}

function developerRole() {
  return { id: 'developer', name: 'Developer', color: '#5ce1ff', permissions: ALL_PERMS, position: 85 };
}

const STAFF_RANK = { admin: 3, manager: 2, moderator: 1 };

function staffRank(g, user) {
  if (!g || !user || !g.members || !g.members[user.id]) return 0;
  const ids = g.members[user.id].roles || [];
  let rank = 0;
  for (const id of ids) rank = Math.max(rank, STAFF_RANK[id] || 0);
  return rank;
}

function staffKey(g, user) {
  if (!g || g.id !== OFFICIAL_ID) return '';
  const rank = staffRank(g, user);
  if (rank >= 3) return 'admin';
  if (rank === 2) return 'manager';
  if (rank === 1) return 'moderator';
  return '';
}

function hasDeveloper(g, user) {
  if (!g || g.id !== OFFICIAL_ID || !user || !g.members || !g.members[user.id]) return false;
  return (g.members[user.id].roles || []).includes('developer');
}

function powerRank(g, user) {
  return Math.max(staffRank(g, user), hasDeveloper(g, user) ? 3 : 0);
}

function canStaffTouch(g, actor, targetId) {
  const target = users[targetId];
  if (!actor || !target) return false;
  if (isOwner(g, target) && actor.id !== target.id) return false;
  if (isOwner(g, actor)) return true;
  return powerRank(g, actor) > powerRank(g, target);
}

function ensureGuilds() {
  if (!guilds.servers) guilds.servers = {};
  if (!guilds.servers[OFFICIAL_ID]) {
    guilds.servers[OFFICIAL_ID] = {
      id: OFFICIAL_ID,
      name: 'Nebula Official',
      icon: 'N',
      color: '#7c5cff',
      ownerIds: [],
      roles: [everyoneRole(), ownerRole()],
      channels: officialChannels(),
      members: {},
      invites: {},
    };
  }
  const g = guilds.servers[OFFICIAL_ID];
  g.ownerIds = Array.isArray(g.ownerIds) ? g.ownerIds : [];
  g.roles = Array.isArray(g.roles) ? g.roles : [];
  g.channels = Array.isArray(g.channels) && g.channels.length ? g.channels : officialChannels();
  g.members = g.members || {};
  g.invites = g.invites || {};
  if (!g.roles.some((r) => r.id === 'everyone')) g.roles.unshift(everyoneRole());
  if (!g.roles.some((r) => r.id === 'owner')) g.roles.push(ownerRole());
  if (!g.roles.some((r) => r.id === 'og')) g.roles.push(ogRole());
  for (const fresh of [adminRole(), managerRole(), moderatorRole(), developerRole()]) {
    const role = g.roles.find((r) => r.id === fresh.id);
    if (!role) {
      g.roles.push(fresh);
      continue;
    }
    role.name = fresh.name;
    role.permissions = fresh.permissions;
    role.position = fresh.position;
    if (!role.color) role.color = fresh.color;
  }
  for (const u of Object.values(users)) {
    if (!g.members[u.id]) {
      g.members[u.id] = { roles: ['everyone'], joinedAt: u.createdAt || new Date().toISOString() };
    }
    if (!g.members[u.id].roles.includes('everyone')) g.members[u.id].roles.push('everyone');
    if (Number(u.uid) === 1 || Number(u.uid) === 2) {
      if (!g.ownerIds.includes(u.id)) g.ownerIds.push(u.id);
      if (!g.members[u.id].roles.includes('owner')) g.members[u.id].roles.push('owner');
      if (!g.members[u.id].roles.includes('og')) g.members[u.id].roles.push('og');
      if (!g.members[u.id].roles.includes('admin')) g.members[u.id].roles.push('admin');
    } else if (g.members[u.id].roles.includes('owner')) {
      g.members[u.id].roles = g.members[u.id].roles.filter((id) => id !== 'owner');
    }
    if (Number(u.uid) === 1 && !g.members[u.id].roles.includes('developer')) g.members[u.id].roles.push('developer');
  }
  g.ownerIds = g.ownerIds.filter((id) => {
    const u = users[id];
    return u && (Number(u.uid) === 1 || Number(u.uid) === 2);
  });
  for (const srv of Object.values(guilds.servers)) hydrateGuild(srv);
  for (const role of g.roles) {
    if (role.id !== 'everyone' && role.id !== 'here') continue;
    role.mentionBy = Array.isArray(role.mentionBy) ? role.mentionBy : [];
    for (const id of ['og', 'admin', 'manager', 'moderator', 'developer']) {
      if (!role.mentionBy.includes(id)) role.mentionBy.push(id);
    }
  }
  save(GUILDS_FILE, guilds);
}

function hydrateGuild(g) {
  if (!g.categories) g.categories = [];
  if (!g.emoji) g.emoji = [];
  if (!g.stickers) g.stickers = [];
  if (!g.events) g.events = [];
  if (!g.bans) g.bans = {};
  if (!g.audit) g.audit = [];
  if (!g.reports) g.reports = [];
  if (!g.requests) g.requests = [];
  if (!g.joinQuestions) g.joinQuestions = [];
  if (!g.pingRoleIds) g.pingRoleIds = [];
  if (!g.theme) g.theme = { accent: g.color || '#7c5cff', tint: '' };
  if (!g.onboarding) g.onboarding = { enabled: false, mustFinish: false, questions: [] };
  if (!g.raid) g.raid = { on: false, joinHours: 1, accountDays: 3, durationHours: 6 };
  if (!g.verification) g.verification = 'none';
  if (!g.joinMode) g.joinMode = 'open';
  if (g.about == null) g.about = '';
  if (g.tag == null) g.tag = '';
  if (g.iconUrl == null) g.iconUrl = '';
  if (g.bannerUrl == null) g.bannerUrl = '';
  if (!g.lockedUntil) g.lockedUntil = 0;
  if (g.showLobby == null) g.showLobby = false;
  (g.channels || []).forEach((c) => { if (c.categoryId == null) c.categoryId = ''; });
  if (!Array.isArray(g.roles)) g.roles = [];
  if (!g.roles.some((r) => r.id === 'here')) g.roles.push(hereRole());
  const mentionDefault = g.id === OFFICIAL_ID ? ['og', 'admin', 'manager', 'moderator'] : ['everyone'];
  for (const role of g.roles) {
    if (!Array.isArray(role.mentionBy)) {
      role.mentionBy = (role.id === 'everyone' || role.id === 'here') ? mentionDefault.slice() : ['everyone'];
    }
  }
}

function audit(g, user, text) {
  g.audit = g.audit || [];
  g.audit.unshift({
    at: new Date().toISOString(),
    userId: user && user.id,
    name: user ? (user.displayName || user.username) : 'Someone',
    text: String(text).slice(0, 180),
  });
  g.audit = g.audit.slice(0, 80);
}

function saveGuilds() {
  save(GUILDS_FILE, guilds);
}

function slugChannel(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 32);
}

function inviteCode() {
  return crypto.randomBytes(4).toString('hex');
}

const MANAGE_MASK = PERM.MANAGE_CHANNELS | PERM.MANAGE_ROLES | PERM.MANAGE_SERVER | PERM.ADMIN;

function isOfficialOwner(user) {
  return !!user && (Number(user.uid) === 1 || Number(user.uid) === 2);
}

function isOwner(g, user) {
  if (!g || !user) return false;
  if (g.id === OFFICIAL_ID) return isOfficialOwner(user);
  return (g.ownerIds || []).includes(user.id);
}

function stripOfficialManage(g, user, bits) {
  if (g && g.id === OFFICIAL_ID && !isOfficialOwner(user) && powerRank(g, user) < 1) return bits & ~MANAGE_MASK;
  return bits;
}

function memberRoles(g, user) {
  const mem = g.members && g.members[user.id];
  const ids = new Set((mem && mem.roles) || []);
  ids.add('everyone');
  return (g.roles || []).filter((r) => ids.has(r.id));
}

function basePerms(g, user) {
  if (isOwner(g, user)) return ALL_PERMS;
  let bits = 0;
  for (const role of memberRoles(g, user)) bits |= Number(role.permissions) || 0;
  if ((bits & PERM.ADMIN) && (!g || g.id !== OFFICIAL_ID || powerRank(g, user) >= 3)) return ALL_PERMS;
  return stripOfficialManage(g, user, bits);
}

function effectivePerms(g, user, channel) {
  let bits = basePerms(g, user);
  if (!channel || !(channel.overwrites || []).length) return stripOfficialManage(g, user, bits);
  if ((bits & PERM.ADMIN) && (!g || g.id !== OFFICIAL_ID || powerRank(g, user) >= 3 || isOwner(g, user))) return bits;
  const ids = new Set(memberRoles(g, user).map((r) => r.id));
  for (const ow of channel.overwrites) {
    if (!ids.has(ow.roleId)) continue;
    bits = (bits & ~(Number(ow.deny) || 0)) | (Number(ow.allow) || 0);
  }
  if (isOwner(g, user)) return ALL_PERMS;
  return stripOfficialManage(g, user, bits);
}

function can(g, user, perm, channel) {
  if (!g || !user || !g.members || !g.members[user.id]) return false;
  return (effectivePerms(g, user, channel) & perm) === perm;
}

function visibleChannels(g, user) {
  return (g.channels || []).filter((c) => can(g, user, PERM.VIEW, c));
}

function publicServer(g, user) {
  return {
    id: g.id,
    name: g.name,
    icon: g.icon || (g.name || 'S').charAt(0).toUpperCase(),
    color: g.color || '#7c5cff',
    owner: isOwner(g, user),
    permissions: basePerms(g, user),
  };
}

function findChannel(channelId, serverId) {
  if (serverId && guilds.servers[serverId]) {
    const g = guilds.servers[serverId];
    const c = (g.channels || []).find((ch) => ch.id === channelId);
    if (c) return { guild: g, channel: c };
  }
  for (const g of Object.values(guilds.servers)) {
    const c = (g.channels || []).find((ch) => ch.id === channelId);
    if (c) return { guild: g, channel: c };
  }
  return null;
}

function memberView(g, u) {
  const pub = publicUser(u);
  const roles = memberRoles(g, u).slice().sort((a, b) => (b.position || 0) - (a.position || 0));
  const top = roles.find((r) => r.id !== 'everyone' && r.id !== 'owner');
  const mem = (g.members && g.members[u.id]) || {};
  pub.roles = roles.filter((r) => r.id !== 'owner').map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position || 0 }));
  pub.staff = staffKey(g, u);
  pub.roleColor = top && top.color ? top.color : '';
  pub.nick = mem.nick || '';
  pub.serverOwner = isOwner(g, u);
  return pub;
}

function requireGuild(req, res, perm, channel) {
  ensureGuilds();
  const g = guilds.servers[req.params.id];
  if (!g) {
    res.status(404).json({ error: 'Server not found' });
    return null;
  }
  if (!g.members[req.user.id]) {
    res.status(403).json({ error: 'You are not in this server' });
    return null;
  }
  if (perm && !can(g, req.user, perm, channel)) {
    res.status(403).json({ error: 'You do not have permission' });
    return null;
  }
  return g;
}

ensureGuilds();

const BADGE_DEFS = {
  early: { id: 'early', label: 'Early Supporter', color: '#d7c6ff', icon: 'moon' },
};

const MOON_CUTOFF = Date.UTC(2026, 11, 31, 23, 59, 59);

function signedUpForMoon(u) {
  const created = u && u.createdAt ? Date.parse(u.createdAt) : NaN;
  return Number.isFinite(created) && created <= MOON_CUTOFF;
}

function isEarlySupporterWindow() {
  return Date.now() <= MOON_CUTOFF;
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + 'discord-salt-v1').digest('hex');
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function storeImage(value) {
  const url = String(value || '');
  if (!url.startsWith('data:image/')) return url.length > 2000 ? '' : url;
  const head = url.slice(5, 40).split(';')[0].toLowerCase();
  const ext = head === 'image/gif' ? '.gif' : head === 'image/png' ? '.png' : head === 'image/webp' ? '.webp' : (head === 'image/jpeg' || head === 'image/jpg') ? '.jpg' : '';
  const comma = url.indexOf(',');
  if (!ext || comma < 0) return '';
  const buf = Buffer.from(url.slice(comma + 1), url.slice(0, comma).includes(';base64') ? 'base64' : 'utf8');
  if (!buf.length) return '';
  const name = uuidv4() + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}

function slimAuthor(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatarColor: u.avatarColor || '#7c5cff',
    nameEffect: cleanNameEffect(u.nameEffect),
    nameColors: cleanNameColors(u.nameColors),
  };
}

function readFiles(body) {
  const rows = body && Array.isArray(body.files) ? body.files.slice(0, 10) : [];
  const files = [];
  for (const row of rows) {
    const url = String(row && row.url || '');
    if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(url)) continue;
    const name = String(row && row.name || 'file').replace(/[^\w.\- ()]+/g, '').slice(0, 80) || 'file';
    const image = /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(url);
    const video = /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(url);
    const file = { url, name, kind: image ? 'image' : video ? 'video' : 'file' };
    const poster = String(row && row.poster || '');
    if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(poster)) file.poster = poster;
    files.push(file);
  }
  return files;
}

function readPoll(body) {
  const poll = body && body.poll;
  if (!poll || typeof poll !== 'object') return null;
  const question = String(poll.question || '').trim().slice(0, 300);
  const options = (Array.isArray(poll.options) ? poll.options : [])
    .map((text) => String(text || '').trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 10);
  if (!question || options.length < 2) return null;
  const allowed = [1, 4, 24, 72, 168];
  const hours = allowed.includes(Number(poll.hours)) ? Number(poll.hours) : 24;
  return {
    question,
    options: options.map((text, index) => ({ id: String(index + 1), text })),
    multi: !!poll.multi,
    endsAt: Date.now() + hours * 3600000,
    votes: {},
  };
}

function publicPoll(poll, viewerId) {
  if (!poll) return null;
  const counts = (poll.options || []).map((opt) => ((poll.votes && poll.votes[opt.id]) || []).length);
  const mine = [];
  for (const [id, voters] of Object.entries(poll.votes || {})) {
    if ((voters || []).includes(viewerId)) mine.push(id);
  }
  return {
    question: poll.question,
    options: poll.options || [],
    multi: !!poll.multi,
    endsAt: poll.endsAt,
    counts,
    total: counts.reduce((sum, n) => sum + n, 0),
    mine,
    closed: Date.now() >= Number(poll.endsAt || 0),
  };
}

function pollStamp(list) {
  return (list || []).map((msg) => {
    if (!msg || !msg.poll) return '';
    const counts = (msg.poll.options || []).map((opt) => ((msg.poll.votes && msg.poll.votes[opt.id]) || []).length).join('.');
    return msg.id + ':' + counts;
  }).filter(Boolean).join('|');
}

function messageStamp(list) {
  return (list || []).map((msg) => {
    if (!msg) return '';
    const reacts = (msg.reactions || []).map((row) => row.emoji + ':' + ((row.users || []).length)).join(',');
    const replyIds = (Array.isArray(msg.replies) && msg.replies.length ? msg.replies : (msg.reply ? [msg.reply] : []))
      .map((row) => row && row.id)
      .filter(Boolean)
      .join(',');
    return [msg.id, msg.editedAt || '', reacts, replyIds, msg.forward && msg.forward.name || ''].join('~');
  }).join('|');
}

function publicReactions(msg, viewerId) {
  return (msg && Array.isArray(msg.reactions) ? msg.reactions : [])
    .filter((row) => row && row.emoji && row.users && row.users.length)
    .map((row) => ({
      emoji: row.emoji,
      count: row.users.length,
      me: row.users.map(String).includes(String(viewerId)),
    }));
}

function locateMessage(id) {
  for (const [roomId, list] of Object.entries(messages)) {
    if (!Array.isArray(list)) continue;
    const index = list.findIndex((msg) => msg && msg.id === id);
    if (index >= 0) return { roomId, list, index, msg: list[index] };
  }
  return null;
}

function canSeeRoom(user, roomId) {
  if (!user || !roomId) return false;
  if (String(roomId).startsWith('dm:')) {
    const ids = String(roomId).slice(3).split(':');
    return ids.map(String).includes(String(user.id));
  }
  const found = findChannel(roomId, '');
  return !!(found && can(found.guild, user, PERM.VIEW, found.channel));
}

function readReply(body, roomId) {
  const replies = readReplies(body, roomId);
  return replies[0] || null;
}

function readReplies(body, roomId) {
  const raw = body && Array.isArray(body.replies) ? body.replies : (body && body.reply ? [body.reply] : []);
  const list = messages[roomId] || [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (out.length >= 5) break;
    const id = item && String(item.id || '');
    if (!id || seen.has(id)) continue;
    const src = list.find((msg) => msg && msg.id === id);
    if (!src) continue;
    seen.add(id);
    const live = src.authorId ? users[src.authorId] : null;
    const author = slimAuthor(live || src.author) || { displayName: 'Someone' };
    if (live) author.avatarUrl = publishedMedia(live, 'avatar');
    const name = author.displayName || author.username || 'Someone';
    const text = String(src.content || '').replace(/\[\[(?:gif|sticker):[^\]]+\]\]/g, '').trim();
    const preview = text.slice(0, 140) || ((src.files && src.files.length) ? 'Attachment' : (src.poll ? 'Poll' : 'Message'));
    out.push({ id: src.id, name, preview, authorId: author.id || src.authorId || '', author });
  }
  return out;
}

function presentReply(reply) {
  if (!reply) return null;
  const replyId = reply.authorId || (reply.author && reply.author.id);
  const replyLive = replyId ? users[replyId] : null;
  const replyAuthor = Object.assign({}, reply.author || {}, replyLive ? slimAuthor(replyLive) : {});
  if (!replyAuthor.displayName) replyAuthor.displayName = reply.name || 'Someone';
  if (replyLive) replyAuthor.avatarUrl = publishedMedia(replyLive, 'avatar');
  return Object.assign({}, reply, { author: replyAuthor });
}

function cleanReactionEmoji(user, emoji) {
  const text = String(emoji || '').trim();
  if (!text || text.length > 64 || /[<>]/.test(text)) return '';
  const custom = text.match(/^:([a-z0-9_]{1,32}):$/i);
  if (custom) {
    const name = custom[1].toLowerCase();
    for (const g of Object.values(guilds.servers)) {
      if (!g || !g.members || !g.members[user.id]) continue;
      if ((g.emoji || []).some((item) => String(item.name || '').toLowerCase() === name)) return ':' + name + ':';
    }
    return '';
  }
  return [...text].slice(0, 8).join('');
}

function messageExtras(body) {
  const content = String(body && body.content || '').trim().slice(0, 2000);
  const files = readFiles(body);
  let poll = null;
  if (body && body.poll) {
    poll = readPoll(body);
    if (!poll) return { error: 'Add a question and at least two answers' };
  }
  if (!content && !files.length && !poll) return { error: 'Empty message' };
  return { content, files, poll };
}

function presentMessage(msg, viewerId) {
  const live = msg && msg.authorId ? users[msg.authorId] : null;
  const base = slimAuthor(msg.author || {}) || {};
  const author = Object.assign(base, live ? slimAuthor(live) : {});
  author.avatarUrl = live && live.avatarUrl && !String(live.avatarUrl).startsWith('data:') ? live.avatarUrl : '';
  const out = Object.assign({}, msg, { author });
  if (out.channelId && !String(out.channelId).startsWith('dm:')) {
    const room = findChannel(out.channelId, '');
    if (room && live) author.staff = staffKey(room.guild, live);
  }
  if (live) author.developer = hasDeveloper(guilds.servers && guilds.servers[OFFICIAL_ID], live);
  const storedReplies = Array.isArray(out.replies) && out.replies.length ? out.replies : (out.reply ? [out.reply] : []);
  const replies = storedReplies.map(presentReply).filter(Boolean).slice(0, 5);
  out.replies = replies;
  out.reply = replies[0] || null;
  if (msg && msg.poll) out.poll = publicPoll(msg.poll, viewerId);
  out.reactions = publicReactions(msg, viewerId);
  return out;
}

function unpackImages() {
  let userChanged = false;
  for (const u of Object.values(users)) {
    if (!u) continue;
    for (const key of ['avatarUrl', 'bannerUrl']) {
      if (String(u[key] || '').startsWith('data:')) {
        u[key] = storeImage(u[key]);
        userChanged = true;
      }
    }
  }
  if (userChanged) save(USERS_FILE, users);
  let msgChanged = false;
  for (const list of Object.values(messages)) {
    if (!Array.isArray(list)) continue;
    for (const msg of list) {
      if (!msg || !msg.author) continue;
      if (msg.author.avatarUrl || msg.author.bannerUrl || msg.author.email || msg.author.bio) {
        msg.author = slimAuthor(msg.author);
        msgChanged = true;
      }
    }
  }
  if (msgChanged) save(MESSAGES_FILE, messages);
}

function publishedMedia(u, slot) {
  const pathKey = slot === 'avatar' ? 'avatarPath' : 'bannerPath';
  const urlKey = slot === 'avatar' ? 'avatarUrl' : 'bannerUrl';
  const stored = String((u && u[pathKey]) || '').replace(/^\/+/, '');
  if (/^(avatars|banners)\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(stored)) return '/files/' + stored;
  const url = String((u && u[urlKey]) || '');
  if (url.startsWith('/files/') || url.startsWith('/uploads/')) return url;
  if (url.startsWith('data:') || url.includes('githubusercontent.com')) return '';
  return url.length > 500 ? '' : url;
}

function saveProfileFile(user, slot, buf, ext) {
  const bucket = slot === 'avatar' ? 'avatars' : 'banners';
  const folder = path.join(FILES_DIR, bucket, user.id);
  fs.mkdirSync(folder, { recursive: true });
  const name = 'r2-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + ext;
  fs.writeFileSync(path.join(folder, name), buf);
  const rel = bucket + '/' + user.id + '/' + name;
  const urlKey = slot === 'avatar' ? 'avatarUrl' : 'bannerUrl';
  const pathKey = slot === 'avatar' ? 'avatarPath' : 'bannerPath';
  user[pathKey] = rel;
  user[urlKey] = '/files/' + rel;
  return { path: rel, url: '/files/' + rel };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    uid: u.uid || null,
    username: u.username,
    displayName: u.displayName || u.username,
    email: u.email,
    bio: u.bio || '',
    pronouns: u.pronouns || '',
    status: u.status || 'online',
    customStatus: u.customStatus || '',
    accentColor: u.accentColor || '#7c5cff',
    avatarColor: u.avatarColor || '#7c5cff',
    bannerColor: u.bannerColor || u.accentColor || '#7c5cff',
    avatarPath: u.avatarPath || '',
    avatarUrl: publishedMedia(u, 'avatar'),
    bannerPath: u.bannerPath || '',
    bannerUrl: publishedMedia(u, 'banner'),
    serverTag: u.serverTag || '',
    nameEffect: cleanNameEffect(u.nameEffect),
    nameColors: cleanNameColors(u.nameColors),
    badges: [...new Set([...(u.badges || []).filter((b) => b === 'early'), ...(signedUpForMoon(u) ? ['early'] : [])])],
    staff: staffKey(guilds.servers && guilds.servers[OFFICIAL_ID], u),
    developer: hasDeveloper(guilds.servers && guilds.servers[OFFICIAL_ID], u),
    server: SERVER_NAME,
    createdAt: u.createdAt,
  };
}

unpackImages();

function cleanNameEffect(value) {
  return ['plain', 'glow', 'gradient', 'rainbow', 'glitch', 'sparkle'].includes(value) ? value : '';
}

function cleanNameColors(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  for (const c of list) {
    const hex = String(c || '').trim().slice(0, 9);
    if (/^#[0-9a-fA-F]{3,8}$/.test(hex)) out.push(hex);
    if (out.length === 2) break;
  }
  return out;
}

function normalizeUsername(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 32);
}

async function sendVerificationCode(email, code) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error('Email is not configured');
  }
  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#1a1a24;color:#fff;padding:32px;border-radius:12px;border:1px solid #333;">
  <div style="font-size:20px;font-weight:700;margin-bottom:8px;color:#7c5cff;">Verify your email</div>
  <p style="color:#a1a1b5;font-size:14px;margin:0 0 24px;">Enter this code to finish signing up:</p>
  <div style="background:#0f0f15;border-radius:8px;padding:20px;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#fff;margin-bottom:24px;">
    ${code}
  </div>
  <p style="color:#6b6b82;font-size:12px;margin:0;">This code expires in 15 minutes.</p>
</div>`;

  await transporter.sendMail({
    from: `"Nebula" <${GMAIL_USER}>`,
    to: email,
    subject: `${code} is your verification code`,
    text: `Your verification code is: ${code}\n\nIt expires in 15 minutes.`,
    html,
  });
}

function resolveFrontendDir() {
  const bundled = path.join(__dirname, 'dist');
  const sibling = path.join(__dirname, '..', 'frontend');
  if (fs.existsSync(path.join(bundled, 'index.html'))) return bundled;
  return sibling;
}
const FRONTEND_DIR = resolveFrontendDir();

const app = express();
app.set('etag', false);
app.use(cors({ maxAge: 7200 }));
app.use((req, res, next) => {
  if (req.path === '/api/upload' || req.path === '/api/upload/part') return next();
  return express.json({ limit: '512mb' })(req, res, next);
});
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
});
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(FRONTEND_DIR));

app.post('/api/auth/request-code', async (req, res) => {
  const { email, username, password } = req.body || {};
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'email, username, and password required' });
  }
  const cleanUser = String(username).trim().toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 32);
  const cleanEmail = String(email).trim().toLowerCase();
  if (cleanUser.length < 1) return res.status(400).json({ error: 'Username required' });
  if (!cleanEmail.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  if (Object.values(users).some((u) => u.email === cleanEmail)) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  if (Object.values(users).some((u) => u.username === cleanUser)) {
    return res.status(409).json({ error: 'Username taken' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  codes[cleanEmail] = {
    code,
    username: cleanUser,
    passwordHash: hashPassword(password),
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  save(CODES_FILE, codes);

  try {
    await sendVerificationCode(cleanEmail, code);
    res.json({ ok: true, message: 'Verification code sent' });
  } catch (err) {
    const msg = (err && err.message) || '';
    res.status(500).json({ error: msg.includes('not configured') ? msg : 'Failed to send email' });
  }
});

app.post('/api/auth/verify', (req, res) => {
  const { email, code } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const entry = codes[cleanEmail];
  if (!entry) return res.status(400).json({ error: 'No pending verification' });
  if (Date.now() > entry.expiresAt) {
    delete codes[cleanEmail];
    save(CODES_FILE, codes);
    return res.status(400).json({ error: 'Code expired' });
  }
  if (String(code).trim() !== entry.code) {
    return res.status(400).json({ error: 'Invalid code' });
  }

  const id = uuidv4();
  const uid = nextUid();
  const token = makeToken();
  const isFirst = Object.keys(users).length === 0;
  const badges = [];
  if (isEarlySupporterWindow()) badges.push('early');

  users[id] = {
    id, uid,
    username: entry.username,
    displayName: entry.username,
    email: cleanEmail,
    passwordHash: entry.passwordHash,
    bio: '', pronouns: '',
    status: 'online',
    customStatus: '',
    accentColor: '#7c5cff',
    avatarColor: '#7c5cff',
    bannerColor: '#7c5cff',
    avatarUrl: '', avatarKey: '', bannerUrl: '', bannerKey: '',
    serverTag: '',
    server: SERVER_NAME,
    badges: [...new Set(badges)],
    token,
    createdAt: new Date().toISOString(),
  };
  delete codes[cleanEmail];
  save(USERS_FILE, users);
  save(CODES_FILE, codes);
  ensureFriendNode(id);
  save(FRIENDS_FILE, friendGraph);
  ensureGuilds();

  res.json({ ok: true, token, user: publicUser(users[id]), server: SERVER_NAME });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = Object.values(users).find((u) => u.email === cleanEmail);
  if (!user || user.passwordHash !== hashPassword(password || '')) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  user.token = makeToken();
  user.status = 'online';
  save(USERS_FILE, users);
  res.json({ ok: true, token: user.token, user: publicUser(user) });
});

const POW2 = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

function snapSize(value) {
  const n = Number(value);
  if (!n || n < 16) return 0;
  let best = POW2[0];
  for (const size of POW2) {
    if (Math.abs(size - n) < Math.abs(best - n)) best = size;
  }
  return best;
}

function readU16(buf, o) {
  return buf[o] | (buf[o + 1] << 8);
}

function lzwDecode(minCodeSize, data, pixelCount) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const dict = new Array(4096);
  for (let i = 0; i < clear; i++) dict[i] = [i];
  const out = [];
  let bitBuf = 0;
  let bitCount = 0;
  let pos = 0;
  let prev = null;
  function read() {
    while (bitCount < codeSize) {
      if (pos >= data.length) return -1;
      bitBuf |= data[pos++] << bitCount;
      bitCount += 8;
    }
    const mask = (1 << codeSize) - 1;
    const code = bitBuf & mask;
    bitBuf >>= codeSize;
    bitCount -= codeSize;
    return code;
  }
  while (out.length < pixelCount) {
    const code = read();
    if (code < 0 || code === eoi) break;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = eoi + 1;
      prev = null;
      continue;
    }
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (prev && code === next) entry = prev.concat(prev[0]);
    else break;
    for (let i = 0; i < entry.length && out.length < pixelCount; i++) out.push(entry[i]);
    if (prev && next < 4096) {
      dict[next++] = prev.concat(entry[0]);
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

function lzwEncode(minCodeSize, indices) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const dict = new Map();
  const bits = [];
  function emit(code, size) { bits.push([code, size]); }
  function reset() {
    dict.clear();
    codeSize = minCodeSize + 1;
    next = eoi + 1;
  }
  emit(clear, codeSize);
  reset();
  if (!indices.length) {
    emit(eoi, codeSize);
  } else {
    let prefix = String(indices[0]);
    for (let i = 1; i < indices.length; i++) {
      const key = prefix + ',' + indices[i];
      if (dict.has(key)) prefix = String(dict.get(key));
      else {
        emit(Number(prefix), codeSize);
        if (next < 4096) {
          dict.set(key, next++);
          if (next === (1 << codeSize) && codeSize < 12) codeSize++;
        } else {
          emit(clear, codeSize);
          reset();
        }
        prefix = String(indices[i]);
      }
    }
    emit(Number(prefix), codeSize);
    emit(eoi, codeSize);
  }
  let bitBuf = 0;
  let bitCount = 0;
  const bytes = [];
  for (const [code, size] of bits) {
    bitBuf |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bitBuf & 255);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  }
  if (bitCount) bytes.push(bitBuf & 255);
  const parts = [Buffer.from([minCodeSize])];
  for (let i = 0; i < bytes.length; i += 255) {
    const slice = bytes.slice(i, i + 255);
    parts.push(Buffer.from([slice.length, ...slice]));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function deinterlace(indexes, width, height) {
  const out = new Array(indexes.length);
  const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];
  let src = 0;
  for (const [start, step] of passes) {
    for (let y = start; y < height; y += step) {
      for (let x = 0; x < width; x++) out[y * width + x] = indexes[src++];
    }
  }
  return out;
}

function decodeGif(buf) {
  if (buf.length < 13 || buf.toString('ascii', 0, 3) !== 'GIF') return null;
  const width = readU16(buf, 6);
  const height = readU16(buf, 8);
  const packed = buf[10];
  const gctFlag = packed & 128;
  const gctSize = 1 << ((packed & 7) + 1);
  let offset = 13;
  let gct = null;
  if (gctFlag) {
    gct = buf.subarray(offset, offset + gctSize * 3);
    offset += gctSize * 3;
  }
  const frames = [];
  let delay = 10;
  let transparent = -1;
  let dispose = 0;
  while (offset < buf.length) {
    const block = buf[offset++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = buf[offset++];
      if (label === 0xf9) {
        offset++;
        const p = buf[offset++];
        delay = readU16(buf, offset) || 10;
        offset += 2;
        transparent = (p & 1) ? buf[offset] : -1;
        dispose = (p >> 2) & 7;
        offset += 2;
        continue;
      }
      while (offset < buf.length) {
        const n = buf[offset++];
        if (!n) break;
        offset += n;
      }
      continue;
    }
    if (block !== 0x2c) break;
    const left = readU16(buf, offset);
    const top = readU16(buf, offset + 2);
    const fw = readU16(buf, offset + 4);
    const fh = readU16(buf, offset + 6);
    const ip = buf[offset + 8];
    offset += 9;
    let palette = gct;
    if (ip & 128) {
      const n = 1 << ((ip & 7) + 1);
      palette = buf.subarray(offset, offset + n * 3);
      offset += n * 3;
    }
    const minCode = buf[offset++];
    const chunks = [];
    while (offset < buf.length) {
      const n = buf[offset++];
      if (!n) break;
      chunks.push(buf.subarray(offset, offset + n));
      offset += n;
    }
    let indexes = lzwDecode(minCode, Buffer.concat(chunks), fw * fh);
    if (ip & 64) indexes = deinterlace(indexes, fw, fh);
    frames.push({ left, top, width: fw, height: fh, palette, indexes, delay, transparent, dispose });
    if (frames.length > 240) break;
    delay = 10;
    transparent = -1;
    dispose = 0;
  }
  if (!frames.length || width * height > 8e6) return null;
  return { width, height, frames };
}

function composite(gif) {
  const { width, height, frames } = gif;
  const canvas = Buffer.alloc(width * height * 4);
  let previous = null;
  const out = [];
  for (const frame of frames) {
    if (frame.dispose === 3) previous = Buffer.from(canvas);
    for (let y = 0; y < frame.height; y++) {
      const dy = frame.top + y;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < frame.width; x++) {
        const dx = frame.left + x;
        if (dx < 0 || dx >= width) continue;
        const idx = frame.indexes[y * frame.width + x];
        if (idx === frame.transparent) continue;
        const p = idx * 3;
        const o = (dy * width + dx) * 4;
        canvas[o] = frame.palette ? frame.palette[p] : 0;
        canvas[o + 1] = frame.palette ? frame.palette[p + 1] : 0;
        canvas[o + 2] = frame.palette ? frame.palette[p + 2] : 0;
        canvas[o + 3] = 255;
      }
    }
    out.push({ rgba: Buffer.from(canvas), delay: frame.delay });
    if (frame.dispose === 2) {
      for (let y = 0; y < frame.height; y++) {
        const dy = frame.top + y;
        if (dy < 0 || dy >= height) continue;
        canvas.fill(0, (dy * width + frame.left) * 4, (dy * width + frame.left + frame.width) * 4);
      }
    } else if (frame.dispose === 3 && previous) {
      previous.copy(canvas);
      previous = null;
    }
  }
  return out;
}

function fitBox(w, h, max) {
  if (!max || (w <= max && h <= max)) return { w, h };
  const scale = max / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function scaleRGBA(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const dst = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
      src.copy(dst, (y * dw + x) * 4, (sy * sw + sx) * 4, (sy * sw + sx) * 4 + 4);
    }
  }
  return dst;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paletteOf(rgba, w, h) {
  const colors = new Map();
  const step = Math.max(1, Math.floor((w * h) / 4000));
  for (let i = 0; i < w * h; i += step) {
    const o = i * 4;
    if (rgba[o + 3] < 16) continue;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    colors.set(key, (colors.get(key) || 0) + 1);
  }
  const ranked = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 255);
  if (!ranked.length) ranked.push([0, 1]);
  const pal = Buffer.alloc(ranked.length * 3);
  ranked.forEach(([key], i) => {
    pal[i * 3] = (key >> 16) & 255;
    pal[i * 3 + 1] = (key >> 8) & 255;
    pal[i * 3 + 2] = key & 255;
  });
  return pal;
}

function nearest(pal, r, g, b) {
  let best = 0;
  let score = Infinity;
  for (let i = 0; i < pal.length; i += 3) {
    const dr = pal[i] - r;
    const dg = pal[i + 1] - g;
    const db = pal[i + 2] - b;
    const s = dr * dr + dg * dg + db * db;
    if (s < score) {
      score = s;
      best = i / 3;
      if (!s) break;
    }
  }
  return best;
}

function encodeGif(width, height, frames) {
  const parts = [Buffer.from('GIF89a')];
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  parts.push(lsd);
  parts.push(Buffer.from([0x21, 0xff, 11]), Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]));
  for (const frame of frames) {
    const pal = paletteOf(frame.rgba, width, height);
    const count = pal.length / 3;
    let sizeBits = 0;
    while ((1 << (sizeBits + 1)) < count) sizeBits++;
    const tableLen = 1 << (sizeBits + 1);
    const padded = Buffer.alloc(tableLen * 3);
    pal.copy(padded);
    const indexes = Buffer.alloc(width * height);
    const transparent = tableLen - 1;
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      indexes[i] = frame.rgba[o + 3] < 16 ? transparent : nearest(padded, frame.rgba[o], frame.rgba[o + 1], frame.rgba[o + 2]);
    }
    const gce = Buffer.alloc(8);
    gce[0] = 0x21;
    gce[1] = 0xf9;
    gce[2] = 4;
    gce[3] = 9;
    gce.writeUInt16LE(Math.max(1, frame.delay || 10), 4);
    gce[6] = transparent;
    parts.push(gce);
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(width, 5);
    desc.writeUInt16LE(height, 7);
    desc[9] = 128 | sizeBits;
    parts.push(desc, padded, lzwEncode(Math.max(2, sizeBits + 1), indexes));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

function stillPng(gif, max) {
  const frames = composite(gif);
  if (!frames.length) return null;
  const box = fitBox(gif.width, gif.height, max);
  const rgba = scaleRGBA(frames[0].rgba, gif.width, gif.height, box.w, box.h);
  return encodePNG(box.w, box.h, rgba);
}

function sizedGif(gif, max) {
  const box = fitBox(gif.width, gif.height, max);
  if (box.w === gif.width && box.h === gif.height) return null;
  const frames = composite(gif).map((frame) => ({
    rgba: scaleRGBA(frame.rgba, gif.width, gif.height, box.w, box.h),
    delay: frame.delay,
  }));
  return encodeGif(box.w, box.h, frames);
}


function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return '';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return '.gif';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return '';
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const user = Object.values(users).find((u) => u.token === token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

const DERIVED_DIR = path.join(UPLOAD_DIR, '.derived');
if (!fs.existsSync(DERIVED_DIR)) fs.mkdirSync(DERIVED_DIR, { recursive: true });

function sourceFor(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  for (const ext of ['.gif', '.png', '.jpg', '.jpeg', '.webp']) {
    const file = path.join(UPLOAD_DIR, id + ext);
    if (fs.existsSync(file)) return { file, ext: ext === '.jpeg' ? '.jpg' : ext };
  }
  return null;
}

const sizing = new Set();

function scheduleGifSize(file, cached, size) {
  if (sizing.has(cached) || fs.existsSync(cached)) return;
  sizing.add(cached);
  setImmediate(() => {
    try {
      if (!fs.existsSync(cached)) {
        const gif = decodeGif(fs.readFileSync(file));
        const out = gif && sizedGif(gif, size);
        const originalSize = fs.statSync(file).size;
        if (out && out.length && out.length < originalSize) fs.writeFileSync(cached, out);
      }
    } catch (err) {}
    sizing.delete(cached);
  });
}

function sendAsset(res, file, type) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.type(type);
  res.sendFile(file);
}

const PART_DIR = path.join(DATA_DIR, 'parts');

app.post('/api/upload/part', auth, express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
  const id = String(req.query.id || '').replace(/[^a-zA-Z0-9-]/g, '');
  const index = Number(req.query.index);
  if (!id || id.length > 80 || !Number.isInteger(index) || index < 0 || index > 60) {
    return res.status(400).json({ error: 'Bad upload part' });
  }
  if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length > 1024 * 1024) {
    return res.status(400).json({ error: 'Empty upload part' });
  }
  const dir = path.join(PART_DIR, String(req.user.id).replace(/[^a-zA-Z0-9-]/g, ''), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, String(index).padStart(4, '0')), req.body);
  res.json({ ok: true });
});

app.post('/api/upload/finish', auth, (req, res) => {
  const id = String((req.body && req.body.id) || '').replace(/[^a-zA-Z0-9-]/g, '');
  const count = Number(req.body && req.body.count);
  const dir = path.join(PART_DIR, String(req.user.id).replace(/[^a-zA-Z0-9-]/g, ''), id);
  if (!id || !Number.isInteger(count) || count < 1 || count > 60 || !fs.existsSync(dir)) {
    return res.status(400).json({ error: 'Upload expired. Try the GIF again.' });
  }
  const chunks = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, String(i).padStart(4, '0'));
    if (!fs.existsSync(file)) return res.status(400).json({ error: 'Upload was incomplete. Try the GIF again.' });
    const buf = fs.readFileSync(file);
    total += buf.length;
    if (total > 25 * 1024 * 1024) {
      fs.rmSync(dir, { recursive: true, force: true });
      return res.status(413).json({ error: 'GIFs can be up to 25 MB' });
    }
    chunks.push(buf);
  }
  const body = Buffer.concat(chunks, total);
  fs.rmSync(dir, { recursive: true, force: true });
  if (sniffImage(body) !== '.gif') return res.status(400).json({ error: 'That file is not a GIF' });
  const stored = uuidv4() + '.gif';
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), body);
  res.json({ ok: true, url: '/uploads/' + stored, name: 'animation.gif' });
});

app.post('/api/upload', auth, express.raw({ type: () => true, limit: '512mb' }), (req, res) => {
  const slot = String(req.query.slot || '');
  if (slot === 'file') {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'Choose a file' });
    if (body.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Files can be up to 25 MB' });
    const safe = String(req.query.name || 'file').replace(/[^\w.\- ()]+/g, '').slice(0, 80) || 'file';
    let ext = (path.extname(safe).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
    if (!ext) {
      const type = String(req.headers['content-type'] || '').toLowerCase();
      if (type.includes('png')) ext = '.png';
      else if (type.includes('jpeg') || type.includes('jpg')) ext = '.jpg';
      else if (type.includes('gif')) ext = '.gif';
      else if (type.includes('webp')) ext = '.webp';
      else if (type.includes('mp4')) ext = '.mp4';
      else if (type.includes('webm')) ext = '.webm';
      else if (type.includes('quicktime')) ext = '.mov';
    }
    const blocked = new Set(['.exe', '.bat', '.cmd', '.js', '.mjs', '.html', '.htm', '.svg', '.sh', '.msi']);
    if (blocked.has(ext)) return res.status(400).json({ error: 'That file type is blocked' });
    const stored = uuidv4() + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), body);
    return res.json({ ok: true, url: '/uploads/' + stored, name: safe });
  }
  const ext = sniffImage(req.body);
  if (!ext) return res.status(400).json({ error: 'Use a PNG, JPG, WEBP, or GIF' });
  if (slot === 'avatar' || slot === 'banner') {
    const saved = saveProfileFile(req.user, slot, req.body, ext);
    save(USERS_FILE, users);
    return res.json({ ok: true, path: saved.path, url: saved.url, user: publicUser(req.user) });
  }
  const name = uuidv4() + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
  res.json({ ok: true, url: '/uploads/' + name });
});

function allowMedia(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'ngrok-skip-browser-warning, bypass-tunnel-reminder, range, Range');
  res.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length, Content-Type');
  res.set('Access-Control-Max-Age', '86400');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Accept-Ranges', 'bytes');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

app.use('/files', allowMedia, (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  next();
}, express.static(FILES_DIR, { maxAge: '365d', immutable: true, acceptRanges: true }));

app.use('/uploads', allowMedia, (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  next();
}, express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true, acceptRanges: true }));

app.get('/api/me', auth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
});

app.patch('/api/me', auth, (req, res) => {
  const {
    username, displayName, bio, pronouns, customStatus, status,
    accentColor, avatarColor, bannerColor, avatarUrl, bannerUrl, serverTag, nameEffect, nameColors,
  } = req.body || {};

  if (username !== undefined) {
    const clean = normalizeUsername(username);
    if (clean.length < 1) return res.status(400).json({ error: 'Username required' });
    if (clean !== req.user.username) {
      const taken = Object.values(users).some((u) => u.id !== req.user.id && u.username === clean);
      if (taken) return res.status(409).json({ error: 'Username taken' });
      req.user.username = clean;
    }
  }

  if (displayName !== undefined) req.user.displayName = String(displayName).slice(0, 32);
  if (bio !== undefined) req.user.bio = String(bio).slice(0, 190);
  if (pronouns !== undefined) req.user.pronouns = String(pronouns).slice(0, 40);
  if (customStatus !== undefined) req.user.customStatus = String(customStatus).slice(0, 128);
  if (status && ['online', 'idle', 'dnd', 'offline'].includes(status)) req.user.status = status;
  if (accentColor) req.user.accentColor = String(accentColor).slice(0, 20);
  if (avatarColor) req.user.avatarColor = String(avatarColor).slice(0, 20);
  if (bannerColor) req.user.bannerColor = String(bannerColor).slice(0, 20);
  if (avatarUrl !== undefined) {
    req.user.avatarUrl = storeImage(avatarUrl);
    if (!req.user.avatarUrl) req.user.avatarPath = '';
  }
  if (bannerUrl !== undefined) {
    req.user.bannerUrl = storeImage(bannerUrl);
    if (!req.user.bannerUrl) req.user.bannerPath = '';
  }
  if (serverTag !== undefined) req.user.serverTag = String(serverTag).slice(0, 16);
  if (nameEffect !== undefined) req.user.nameEffect = cleanNameEffect(nameEffect);
  if (nameColors !== undefined) req.user.nameColors = cleanNameColors(nameColors);
  save(USERS_FILE, users);
  touchProfiles();
  res.json({ ok: true, user: publicUser(req.user) });
});

app.get('/api/members', auth, (req, res) => {
  ensureGuilds();
  if (!req.query.serverId) {
    const list = Object.values(users).map(publicUser);
    return res.json({ ok: true, members: list, badges: BADGE_DEFS, server: SERVER_NAME });
  }
  const serverId = String(req.query.serverId);
  const g = guilds.servers[serverId];
  if (!g) return res.status(404).json({ error: 'Server not found' });
  if (!g.members[req.user.id]) return res.status(403).json({ error: 'You are not in this server' });
  const list = Object.keys(g.members)
    .map((id) => users[id])
    .filter(Boolean)
    .map((u) => memberView(g, u));
  res.json({ ok: true, members: list, badges: BADGE_DEFS, server: g.name, roles: g.roles });
});

app.get('/api/servers', auth, (req, res) => {
  ensureGuilds();
  const list = Object.values(guilds.servers)
    .filter((g) => g.members && g.members[req.user.id])
    .map((g) => publicServer(g, req.user));
  res.json({ ok: true, servers: list, active: OFFICIAL_ID });
});

app.post('/api/servers', auth, (req, res) => {
  ensureGuilds();
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Server name must be at least 2 characters' });
  const id = uuidv4();
  const g = {
    id,
    name,
    icon: name.charAt(0).toUpperCase(),
    color: '#7c5cff',
    ownerIds: [req.user.id],
    roles: [everyoneRole(), ownerRole()],
    channels: [{ id: uuidv4(), name: 'general', type: 'text', topic: 'Welcome to ' + name, overwrites: [] }],
    members: { [req.user.id]: { roles: ['everyone', 'owner'], joinedAt: new Date().toISOString() } },
    invites: {},
  };
  const code = inviteCode();
  g.invites[code] = { code, inviterId: req.user.id, createdAt: new Date().toISOString(), uses: 0 };
  guilds.servers[id] = g;
  saveGuilds();
  res.json({ ok: true, server: publicServer(g, req.user), invite: code });
});

app.patch('/api/servers/:id', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_SERVER);
  if (!g) return;
  if (req.body?.name != null) {
    const name = String(req.body.name).trim().slice(0, 40);
    if (name.length < 2) return res.status(400).json({ error: 'Server name must be at least 2 characters' });
    g.name = name;
  }
  if (req.body?.icon != null) g.icon = String(req.body.icon).trim().slice(0, 2) || g.icon;
  if (req.body?.color != null) g.color = String(req.body.color).trim().slice(0, 20) || g.color;
  saveGuilds();
  res.json({ ok: true, server: publicServer(g, req.user) });
});

app.get('/api/channels', auth, (req, res) => {
  ensureGuilds();
  const serverId = String(req.query.serverId || OFFICIAL_ID);
  const g = guilds.servers[serverId];
  if (!g) return res.status(404).json({ error: 'Server not found' });
  if (!g.members[req.user.id]) return res.status(403).json({ error: 'You are not in this server' });
  const mine = Object.values(guilds.servers)
    .filter((s) => s.members && s.members[req.user.id])
    .map((s) => publicServer(s, req.user));
  res.json({
    ok: true,
    channels: visibleChannels(g, req.user),
    server: publicServer(g, req.user),
    serverName: g.name,
    servers: mine,
    roles: g.roles,
    permissions: basePerms(g, req.user),
    categories: g.categories || [],
    theme: g.theme || null,
    bannerUrl: g.bannerUrl || '',
    iconUrl: g.iconUrl || '',
    tag: g.tag || '',
    onboarding: (g.onboarding && g.onboarding.enabled && g.members[req.user.id] && g.members[req.user.id].onboarded === false) ? g.onboarding : null,
    showLobby: !!g.showLobby,
    about: g.about || '',
    events: (g.events || []).slice(0, 12),
    emoji: (g.emoji || []).map((e) => ({ id: e.id, name: e.name, url: e.url })),
    stickers: (g.stickers || []).map((e) => ({ id: e.id, name: e.name, url: e.url })),
  });
});

app.get('/api/media', auth, (req, res) => {
  ensureGuilds();
  const packs = Object.values(guilds.servers)
    .filter((g) => g.members && g.members[req.user.id])
    .map((g) => ({
      id: g.id,
      name: g.name,
      emoji: (g.emoji || []).map((e) => ({ id: e.id, name: e.name, url: e.url })),
      stickers: (g.stickers || []).map((e) => ({ id: e.id, name: e.name, url: e.url })),
    }));
  res.json({ ok: true, packs });
});

app.post('/api/activity', auth, (req, res) => {
  ensureGuilds();
  const seen = req.body && req.body.seen && typeof req.body.seen === 'object' ? req.body.seen : {};
  const seeded = !!(req.body && req.body.seeded);
  const servers = {};
  const channels = {};
  const heads = {};
  const speakers = {};
  for (const g of Object.values(guilds.servers)) {
    if (!g || !g.members || !g.members[req.user.id]) continue;
    let unread = 0;
    let mentions = 0;
    for (const channel of g.channels || []) {
      if (channel.type && channel.type !== 'text') continue;
      const list = messages[channel.id] || [];
      const cursor = String(seen[channel.id] || '');
      let start = list.length;
      if (cursor) {
        const idx = list.findIndex((msg) => msg.id === cursor);
        start = idx === -1 ? Math.max(0, list.length - 40) : idx + 1;
      }
      let channelUnread = 0;
      let channelMentions = 0;
      for (let i = start; i < list.length; i++) {
        const msg = list[i];
        if (!msg || msg.authorId === req.user.id) continue;
        channelUnread++;
        if (messageMentions(msg, req.user, g)) channelMentions++;
      }
      if (channelUnread) {
        channels[channel.id] = { unread: channelUnread, mentions: channelMentions, serverId: g.id };
        unread += channelUnread;
        mentions += channelMentions;
      }
      const last = list[list.length - 1];
      if (last) {
        heads[channel.id] = last.id;
        speakers[channel.id] = last.authorId;
      }
    }
    if (unread || mentions) servers[g.id] = { unread, mentions };
  }
  const dmNotes = dmInbox(req.user.id, seen, seeded);
  Object.assign(heads, dmNotes.heads);
  res.json({ ok: true, servers, channels, dms: dmNotes.counts, heads, speakers });
});

const gifCache = new Map();
let gifReactions = ['wave', 'hug', 'dance', 'laugh', 'cry', 'love', 'happy', 'sad', 'blush', 'pat', 'kiss', 'celebrate', 'clap', 'shy', 'peek', 'run', 'sleep', 'smile', 'thumbsup', 'wink'];

function klipyKey() {
  try {
    const file = fs.readFileSync(path.join(DATA_DIR, 'klipy.key'), 'utf8').trim();
    if (file) return file;
  } catch (_) {}
  return String(process.env.KLIPY_KEY || 'rqqVf83mum5Wy17KcCw9k5zbiq7XKiEHInFx7UTIAuzniEIyJZfmVWqHFCpNvdKo').trim();
}

function klipyGifUrl(file, size) {
  const box = file && file[size] && file[size].gif;
  return box && typeof box.url === 'string' ? box.url : '';
}

function klipyList(data) {
  if (!data || typeof data !== 'object') return [];
  const page = data.data;
  if (page && Array.isArray(page.data)) return page.data;
  if (Array.isArray(page)) return page;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

async function klipyGifs(query) {
  const key = klipyKey();
  if (!key) return null;
  const route = query
    ? '/gifs/search?q=' + encodeURIComponent(query) + '&per_page=24&page=1'
    : '/gifs/trending?per_page=24&page=1';
  const response = await fetch('https://api.klipy.com/api/v1/' + encodeURIComponent(key) + route);
  if (!response.ok) return [];
  const data = await response.json();
  const rows = [];
  const seen = new Set();
  for (const item of klipyList(data)) {
    const file = item && item.file;
    const url = klipyGifUrl(file, 'sm') || klipyGifUrl(file, 'md') || klipyGifUrl(file, 'hd') || klipyGifUrl(file, 'xs');
    const preview = klipyGifUrl(file, 'xs') || klipyGifUrl(file, 'sm') || url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    rows.push({
      id: String(item.id || item.slug || url),
      preview,
      url,
      title: String(item.title || ''),
    });
  }
  return rows.slice(0, 24);
}

let reactionCatalogReady = false;
async function reactionGifs(query) {
  if (!reactionCatalogReady) {
    reactionCatalogReady = true;
    try {
      const response = await fetch('https://api.otakugifs.xyz/gif/allreactions');
      const data = await response.json();
      if (Array.isArray(data.reactions) && data.reactions.length) gifReactions = data.reactions;
    } catch (_) {
      reactionCatalogReady = false;
    }
  }
  const q = String(query || '').toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  const hints = {
    hi: ['wave'], hello: ['wave'], hey: ['wave'], bye: ['wave'],
    happy: ['happy', 'celebrate', 'dance', 'laugh'], birthday: ['celebrate', 'happy'],
    love: ['love', 'kiss', 'hug', 'blush'], hug: ['hug'], kiss: ['kiss'],
    sad: ['sad', 'cry'], cry: ['cry'], lol: ['laugh'], funny: ['laugh'],
    angry: ['mad'], mad: ['mad'], sleep: ['sleep'], party: ['celebrate', 'dance'],
    cat: ['nyah'], shy: ['shy'], scared: ['scared'], cool: ['cool'],
  };
  const wanted = new Set();
  for (const word of words) (hints[word] || []).forEach((name) => wanted.add(name));
  const hits = gifReactions.filter((name) => !q || wanted.has(name) || name.includes(q) || q.includes(name));
  const picks = (hits.length ? hits : gifReactions).slice(0, 8);
  const found = [];
  await Promise.all(picks.map(async (name) => {
    for (let i = 0; i < 2; i++) {
      try {
        const response = await fetch('https://api.otakugifs.xyz/gif?reaction=' + encodeURIComponent(name));
        const data = await response.json();
        if (data.url && !found.some((row) => row.url === data.url)) found.push({ id: data.url, preview: data.url, url: data.url, title: name });
      } catch (_) {}
    }
  }));
  return found;
}

app.get('/api/gifs', auth, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40).toLowerCase();
  const cached = gifCache.get(q);
  if (cached && Date.now() - cached.at < 60000) return res.json({ ok: true, gifs: cached.gifs });
  try {
    const remote = await klipyGifs(q);
    const gifs = remote && remote.length ? remote : await reactionGifs(q);
    gifCache.set(q, { at: Date.now(), gifs });
    res.json({ ok: true, gifs, klipy: !!(remote && remote.length) });
  } catch (err) {
    res.status(502).json({ error: 'GIF search is unavailable' });
  }
});

app.post('/api/servers/:id/channels', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_CHANNELS);
  if (!g) return;
  const type = req.body?.type === 'voice' ? 'voice' : 'text';
  const name = slugChannel(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Channel name required' });
  if ((g.channels || []).some((c) => c.name === name && c.type === type)) {
    return res.status(409).json({ error: 'A channel with that name already exists' });
  }
  const channel = {
    id: uuidv4(),
    name,
    type,
    topic: String(req.body?.topic || '').slice(0, 200),
    overwrites: [],
  };
  g.channels.push(channel);
  saveGuilds();
  res.json({ ok: true, channel });
});

app.patch('/api/servers/:id/channels/:channelId', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_CHANNELS);
  if (!g) return;
  const channel = (g.channels || []).find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (req.body?.name != null) {
    const name = slugChannel(req.body.name);
    if (!name) return res.status(400).json({ error: 'Channel name required' });
    channel.name = name;
  }
  if (req.body?.topic != null) channel.topic = String(req.body.topic).slice(0, 200);
  if (Array.isArray(req.body?.overwrites)) {
    const roleIds = new Set((g.roles || []).map((r) => r.id));
    channel.overwrites = req.body.overwrites
      .filter((ow) => ow && roleIds.has(ow.roleId))
      .map((ow) => ({
        roleId: ow.roleId,
        allow: Number(ow.allow) || 0,
        deny: Number(ow.deny) || 0,
      }));
  }
  saveGuilds();
  res.json({ ok: true, channel });
});

app.delete('/api/servers/:id/channels/:channelId', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_CHANNELS);
  if (!g) return;
  const channel = (g.channels || []).find((c) => c.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const textLeft = g.channels.filter((c) => c.type === 'text' && c.id !== channel.id);
  if (channel.type === 'text' && !textLeft.length) {
    return res.status(400).json({ error: 'A server needs at least one text channel' });
  }
  g.channels = g.channels.filter((c) => c.id !== channel.id);
  saveGuilds();
  res.json({ ok: true });
});

app.post('/api/servers/:id/roles', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_ROLES);
  if (!g) return;
  const name = String(req.body?.name || '').trim().slice(0, 32);
  if (!name) return res.status(400).json({ error: 'Role name required' });
  const role = {
    id: uuidv4(),
    name,
    color: String(req.body?.color || '#7c5cff').slice(0, 20),
    permissions: Number(req.body?.permissions) || (PERM.VIEW | PERM.SEND),
    position: (g.roles || []).reduce((m, r) => Math.max(m, r.position || 0), 0) + 1,
  };
  g.roles.push(role);
  saveGuilds();
  res.json({ ok: true, role });
});

app.patch('/api/servers/:id/roles/:roleId', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_ROLES);
  if (!g) return;
  const role = (g.roles || []).find((r) => r.id === req.params.roleId);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.id === 'everyone' && req.body?.name) return res.status(400).json({ error: 'Cannot rename @everyone' });
  if (g.id === OFFICIAL_ID && (STAFF_RANK[role.id] || role.id === 'developer') && !isOwner(g, req.user) && powerRank(g, req.user) <= (STAFF_RANK[role.id] || 4)) {
    return res.status(403).json({ error: 'That role is above you' });
  }
  if (req.body?.name != null && role.id !== 'everyone') role.name = String(req.body.name).trim().slice(0, 32) || role.name;
  if (req.body?.color != null) role.color = String(req.body.color).slice(0, 20);
  if (req.body?.permissions != null && role.id !== 'owner') role.permissions = Number(req.body.permissions) || 0;
  if (Array.isArray(req.body?.mentionBy)) {
    const ids = new Set((g.roles || []).map((r) => r.id));
    role.mentionBy = [...new Set(req.body.mentionBy.map((id) => String(id || '')).filter((id) => ids.has(id) && id !== role.id))].slice(0, 40);
  }
  saveGuilds();
  res.json({ ok: true, role });
});

app.delete('/api/servers/:id/roles/:roleId', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_ROLES);
  if (!g) return;
  const roleId = req.params.roleId;
  if (roleId === 'everyone' || roleId === 'owner' || roleId === 'here') return res.status(400).json({ error: 'That role cannot be deleted' });
  if (g.id === OFFICIAL_ID && (STAFF_RANK[roleId] || roleId === 'developer')) return res.status(400).json({ error: 'That staff role stays on Nebula' });
  if (!(g.roles || []).some((r) => r.id === roleId)) return res.status(404).json({ error: 'Role not found' });
  g.roles = g.roles.filter((r) => r.id !== roleId);
  for (const mem of Object.values(g.members)) {
    mem.roles = (mem.roles || []).filter((id) => id !== roleId);
  }
  saveGuilds();
  res.json({ ok: true });
});

app.post('/api/servers/:id/members/:userId/roles', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_ROLES);
  if (!g) return;
  const mem = g.members[req.params.userId];
  if (!mem) return res.status(404).json({ error: 'Member not found' });
  const roleId = String(req.body?.roleId || '');
  const role = (g.roles || []).find((r) => r.id === roleId);
  if (!role || role.id === 'everyone') return res.status(400).json({ error: 'Pick a role' });
  if (role.id === 'owner' && !isOwner(g, req.user)) return res.status(403).json({ error: 'Only an owner can assign Owner' });
  if (role.id === 'developer' && !isOwner(g, req.user)) return res.status(403).json({ error: 'Only an owner can assign Developer' });
  if (!isOwner(g, req.user)) {
    const mine = staffRank(g, req.user);
    const target = users[req.params.userId];
    const roleRank = STAFF_RANK[role.id] || 0;
    if ((roleRank && roleRank >= mine) || (target && staffRank(g, target) >= mine && mine > 0) || (target && staffRank(g, target) > 0 && mine < 1)) {
      return res.status(403).json({ error: 'That role is above you' });
    }
  }
  mem.roles = mem.roles || ['everyone'];
  const action = req.body?.action === 'remove' ? 'remove' : 'add';
  if (action === 'remove') mem.roles = mem.roles.filter((id) => id !== roleId);
  else if (!mem.roles.includes(roleId)) mem.roles.push(roleId);
  saveGuilds();
  res.json({ ok: true, roles: mem.roles });
});

app.get('/api/servers/:id/invites', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.INVITE);
  if (!g) return;
  const list = Object.values(g.invites || {}).map((inv) => ({
    code: inv.code,
    uses: inv.uses || 0,
    createdAt: inv.createdAt,
  }));
  res.json({ ok: true, invites: list });
});

app.post('/api/servers/:id/invites', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.INVITE);
  if (!g) return;
  const code = inviteCode();
  g.invites[code] = { code, inviterId: req.user.id, createdAt: new Date().toISOString(), uses: 0 };
  saveGuilds();
  res.json({ ok: true, code });
});

app.post('/api/invites/:code/join', auth, (req, res) => {
  ensureGuilds();
  const code = String(req.params.code || '').trim().toLowerCase();
  let found = null;
  for (const g of Object.values(guilds.servers)) {
    if (g.invites && g.invites[code]) { found = g; break; }
  }
  if (!found) return res.status(404).json({ error: 'Invite not found' });
  hydrateGuild(found);
  if (found.bans && found.bans[req.user.id]) return res.status(403).json({ error: 'You are banned from this server' });
  if (!found.members[req.user.id] && found.lockedUntil && Date.now() < found.lockedUntil && !isOwner(found, req.user)) {
    return res.status(403).json({ error: 'This server is locked' });
  }
  if (!found.members[req.user.id]) {
    if (found.joinMode === 'apply') {
      if (!(found.requests || []).some((r) => r.userId === req.user.id)) {
        found.requests.push({
          id: uuidv4(),
          userId: req.user.id,
          message: String(req.body?.message || '').slice(0, 300),
          createdAt: new Date().toISOString(),
        });
        audit(found, req.user, 'asked to join');
        saveGuilds();
      }
      return res.json({ ok: true, pending: true, server: publicServer(found, req.user) });
    }
    found.members[req.user.id] = { roles: ['everyone'], joinedAt: new Date().toISOString(), onboarded: !found.onboarding.enabled };
    found.invites[code].uses = (found.invites[code].uses || 0) + 1;
    audit(found, req.user, 'joined the server');
    saveGuilds();
    wakeGuild(found);
  }
  res.json({ ok: true, server: publicServer(found, req.user) });
});

app.get('/api/channels/:id/messages', auth, (req, res) => {
  ensureGuilds();
  const found = findChannel(req.params.id, req.query.serverId);
  if (!found) return res.status(404).json({ error: 'Channel not found' });
  if (!can(found.guild, req.user, PERM.VIEW, found.channel)) {
    return res.status(403).json({ error: 'You cannot view this channel' });
  }
  const list = messages[found.channel.id] || [];
  res.json({ ok: true, messages: list.slice(-100).map((msg) => presentMessage(msg, req.user.id)) });
});

app.post('/api/channels/:id/messages', auth, (req, res) => {
  ensureGuilds();
  const found = findChannel(req.params.id, req.body?.serverId);
  if (!found || found.channel.type !== 'text') return res.status(404).json({ error: 'Channel not found' });
  if (!can(found.guild, req.user, PERM.SEND, found.channel)) {
    return res.status(403).json({ error: 'You cannot send messages here' });
  }
  hydrateGuild(found.guild);
  const sender = found.guild.members[req.user.id] || {};
  if (sender.timeoutUntil && Date.now() < sender.timeoutUntil) {
    return res.status(403).json({ error: 'You are timed out' });
  }
  if (found.guild.lockedUntil && Date.now() < found.guild.lockedUntil && !can(found.guild, req.user, PERM.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'This server is locked' });
  }
  if (found.guild.onboarding && found.guild.onboarding.enabled && found.guild.onboarding.mustFinish && sender.onboarded === false && !isOwner(found.guild, req.user)) {
    return res.status(403).json({ error: 'Finish onboarding before you chat' });
  }
  const created = req.user.createdAt ? new Date(req.user.createdAt).getTime() : 0;
  const ageDays = created ? (Date.now() - created) / 86400000 : 999;
  const raidOn = found.guild.raid && found.guild.raid.on && (!found.guild.raid.until || Date.now() < found.guild.raid.until);
  if (raidOn && ageDays < (Number(found.guild.raid.accountDays) || 0) && !can(found.guild, req.user, PERM.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'New accounts cannot post while raid mode is on' });
  }
  const level = found.guild.verification || 'none';
  const waitMin = level === 'high' ? 10 : (level === 'low' || level === 'medium' ? 5 : 0);
  if (waitMin && created && Date.now() - created < waitMin * 60000 && !can(found.guild, req.user, PERM.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'Your account is too new to talk in this server' });
  }
  if ((level === 'medium' || level === 'high') && sender.joinedAt && Date.now() - new Date(sender.joinedAt).getTime() < waitMin * 60000 && !can(found.guild, req.user, PERM.MANAGE_CHANNELS)) {
    return res.status(403).json({ error: 'Stay in the server a little longer before you talk' });
  }
  const extra = messageExtras(req.body);
  if (extra.error) return res.status(400).json({ error: extra.error });

  if (!messages[found.channel.id]) messages[found.channel.id] = [];
  const msg = {
    id: uuidv4(),
    channelId: found.channel.id,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: extra.content,
    files: extra.files,
    poll: extra.poll,
    mentions: parseMentions(found.guild, req.user, extra.content),
    replies: readReplies(req.body, found.channel.id),
    reply: readReply(req.body, found.channel.id),
    createdAt: new Date().toISOString(),
  };
  messages[found.channel.id].push(msg);
  if (messages[found.channel.id].length > 500) messages[found.channel.id] = messages[found.channel.id].slice(-500);
  save(MESSAGES_FILE, messages);
  silenceTyping('ch:' + found.guild.id + ':' + found.channel.id, req.user.id, req.body && req.body.typingToken);
  wakePulse(found.channel.id);
  touchAlerts();
  res.json({ ok: true, message: presentMessage(msg, req.user.id) });
});

const typingRooms = new Map();

function typingKeyFrom(req) {
  const dmUserId = String((req.body && req.body.dmUserId) || req.query.dmUserId || '');
  if (dmUserId) {
    if (!users[dmUserId]) return null;
    return 'dm:' + [req.user.id, dmUserId].sort().join(':');
  }
  const channelId = String((req.body && req.body.channelId) || req.query.channelId || '');
  const serverId = String((req.body && req.body.serverId) || req.query.serverId || '');
  const found = findChannel(channelId, serverId);
  if (!found || !found.guild.members || !found.guild.members[req.user.id]) return null;
  return 'ch:' + found.guild.id + ':' + found.channel.id;
}

function listTypers(key, selfId) {
  const room = typingRooms.get(key);
  if (!room) return [];
  const now = Date.now();
  const out = [];
  for (const [id, row] of room) {
    if (now - row.at > 500) {
      if (row.timer) clearTimeout(row.timer);
      room.delete(id);
      continue;
    }
    if (id === selfId) continue;
    out.push({ id, name: row.name, nameEffect: row.nameEffect || '', nameColors: row.nameColors || [], tick: Math.floor(row.at / 250) });
  }
  return out;
}

const typingEpoch = new Map();

function wakeTyping(key) {
  wakePulse(key.startsWith('ch:') ? key.split(':').pop() : key);
}

function noteEpoch(key, userId, token) {
  const next = Number(token) || 0;
  if (!next) return true;
  if (!typingEpoch.has(key)) typingEpoch.set(key, new Map());
  const book = typingEpoch.get(key);
  const prev = book.get(userId) || 0;
  if (next < prev) return false;
  book.set(userId, next);
  return true;
}

function clearTyping(key, userId) {
  const room = typingRooms.get(key);
  const row = room && room.get(userId);
  if (row && row.timer) clearTimeout(row.timer);
  if (room) room.delete(userId);
}

function silenceTyping(key, userId, token) {
  const prev = typingEpoch.get(key)?.get(userId) || 0;
  const floor = Math.max(prev + 1, Number(token) || 0);
  noteEpoch(key, userId, floor);
  clearTyping(key, userId);
}

function armTyping(key, userId, row) {
  if (!typingRooms.has(key)) typingRooms.set(key, new Map());
  const room = typingRooms.get(key);
  const prev = room.get(userId);
  if (prev && prev.timer) clearTimeout(prev.timer);
  row.timer = setTimeout(() => {
    const current = room.get(userId);
    if (!current || current.at !== row.at) return;
    room.delete(userId);
    wakeTyping(key);
  }, 420);
  room.set(userId, row);
}

app.post('/api/typing', auth, (req, res) => {
  const key = typingKeyFrom(req);
  if (!key) return res.status(404).json({ error: 'Chat not found' });
  const token = Number(req.body && req.body.token) || 0;
  if (req.body && req.body.stop) {
    if (!noteEpoch(key, req.user.id, token)) return res.json({ ok: true });
    clearTyping(key, req.user.id);
    wakeTyping(key);
    return res.json({ ok: true });
  }
  if (!noteEpoch(key, req.user.id, token)) return res.json({ ok: true });
  armTyping(key, req.user.id, {
    name: req.user.displayName || req.user.username,
    nameEffect: cleanNameEffect(req.user.nameEffect),
    nameColors: cleanNameColors(req.user.nameColors),
    at: Date.now(),
    token,
  });
  wakeTyping(key);
  res.json({ ok: true });
});

app.get('/api/typing', auth, (req, res) => {
  const key = typingKeyFrom(req);
  if (!key) return res.json({ ok: true, typers: [] });
  res.json({ ok: true, typers: listTypers(key, req.user.id) });
});

function pulseSnap(req) {
  const dmUserId = String(req.query.dmUserId || '');
  if (dmUserId) {
    if (!users[dmUserId]) return null;
    const key = dmKey(req.user.id, dmUserId);
    const roomId = 'dm:' + key;
    const raw = messages[roomId] || [];
    const list = raw.slice(-100).map((msg) => presentMessage(msg, req.user.id));
    const typers = listTypers(roomId, req.user.id);
    const last = list[list.length - 1];
    return {
      roomId,
      body: {
        ok: true,
        messages: list,
        typers,
        cursor: last ? last.id : '',
        typing: typers.map((row) => row.id).sort().join(','),
        profiles: String(profileRev),
        polls: pollStamp(raw.slice(-100)),
        edits: messageStamp(raw.slice(-100)),
      },
    };
  }
  const found = findChannel(String(req.query.channelId || ''), String(req.query.serverId || ''));
  if (!found) return null;
  if (!can(found.guild, req.user, PERM.VIEW, found.channel)) return { forbidden: true };
  const raw = messages[found.channel.id] || [];
  const list = raw.slice(-100).map((msg) => presentMessage(msg, req.user.id));
  const typers = listTypers('ch:' + found.guild.id + ':' + found.channel.id, req.user.id);
  const last = list[list.length - 1];
  return {
    roomId: found.channel.id,
    body: {
      ok: true,
      messages: list,
      typers,
      cursor: last ? last.id : '',
      typing: typers.map((row) => row.id).sort().join(','),
      members: memberStamp(found.guild),
      profiles: String(profileRev),
      polls: pollStamp(raw.slice(-100)),
      edits: messageStamp(raw.slice(-100)),
    },
  };
}

app.get('/api/alert', auth, (req, res) => {
  const cursor = String(req.query.cursor || '');
  const current = String(alertRev);
  if (req.query.wait === '1' && cursor === current) {
    let settled = false;
    const waiter = { alert: true, finish };
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pulseWaiters.delete(waiter);
      if (!res.writableEnded) res.json({ ok: true, cursor: String(alertRev) });
    }
    const timer = setTimeout(finish, 25000);
    pulseWaiters.add(waiter);
    req.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pulseWaiters.delete(waiter);
    });
    return;
  }
  res.json({ ok: true, cursor: current });
});

app.get('/api/pulse', auth, (req, res) => {
  ensureGuilds();
  const snap = pulseSnap(req);
  if (!snap) return res.status(404).json({ error: 'Channel not found' });
  if (snap.forbidden) return res.status(403).json({ error: 'You cannot view this channel' });
  const after = String(req.query.after || '');
  const typing = String(req.query.typing || '');
  const members = String(req.query.members || '');
  const profiles = String(req.query.profiles || '');
  const polls = String(req.query.polls || '');
  const edits = String(req.query.edits || '');
  const hold = req.query.wait === '1' && snap.body.cursor === after && snap.body.typing === typing && (snap.body.members || '') === members && (snap.body.profiles || '') === profiles && (snap.body.polls || '') === polls && (snap.body.edits || '') === edits;
  if (!hold) return res.json(snap.body);
  let settled = false;
  const waiter = { roomId: snap.roomId, finish };
  function finish() {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    pulseWaiters.delete(waiter);
    if (res.writableEnded) return;
    const next = pulseSnap(req);
    const body = next && next.body ? next.body : snap.body;
    if (body.cursor === after && body.typing === typing && (body.members || '') === members && (body.profiles || '') === profiles && (body.polls || '') === polls && (body.edits || '') === edits) {
      return res.json({ ok: true, same: true, cursor: body.cursor, typing: body.typing, members: body.members || '', profiles: body.profiles || '', polls: body.polls || '', edits: body.edits || '' });
    }
    res.json(body);
  }
  const timer = setTimeout(finish, 25000);
  pulseWaiters.add(waiter);
  req.on('close', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    pulseWaiters.delete(waiter);
  });
});

app.get('/api/friends', auth, (req, res) => {
  const node = ensureFriendNode(req.user.id);
  node.friends = Array.isArray(node.friends) ? node.friends : [];
  node.incoming = Array.isArray(node.incoming) ? node.incoming : [];
  node.outgoing = Array.isArray(node.outgoing) ? node.outgoing : [];
  const mapUser = (id) => {
    const u = users[id];
    if (!u) return null;
    return publicUser(u);
  };
  res.json({
    ok: true,
    friends: node.friends.map(mapUser).filter(Boolean),
    incoming: node.incoming.map(mapUser).filter(Boolean),
    outgoing: node.outgoing.map(mapUser).filter(Boolean),
  });
});

app.post('/api/friends/request', auth, (req, res) => {
  const { username, uid } = req.body || {};
  let target = null;
  if (uid != null && String(uid).trim() !== '') {
    target = Object.values(users).find((u) => String(u.uid) === String(uid).trim());
  } else if (username) {
    const clean = normalizeUsername(username);
    if (!clean) return res.status(400).json({ error: 'Invalid username' });
    target = Object.values(users).find((u) => u.username === clean);
  } else {
    return res.status(400).json({ error: 'Provide username or uid' });
  }
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });

  const me = ensureFriendNode(req.user.id);
  const them = ensureFriendNode(target.id);

  if ((me.friends || []).includes(target.id)) {
    return res.status(400).json({ error: 'Already friends' });
  }
  if ((me.outgoing || []).includes(target.id)) {
    return res.status(400).json({ error: 'Request already sent' });
  }
  if ((me.incoming || []).includes(target.id)) {
    me.incoming = me.incoming.filter((id) => id !== target.id);
    them.outgoing = (them.outgoing || []).filter((id) => id !== req.user.id);
    if (!me.friends.includes(target.id)) me.friends.push(target.id);
    if (!them.friends.includes(req.user.id)) them.friends.push(req.user.id);
    save(FRIENDS_FILE, friendGraph);
    return res.json({ ok: true, status: 'accepted', user: publicUser(target) });
  }

  const tid = String(target.id);
  const mid = String(req.user.id);
  me.outgoing = (me.outgoing || []).map(String);
  them.incoming = (them.incoming || []).map(String);
  if (!me.outgoing.includes(tid)) me.outgoing.push(tid);
  if (!them.incoming.includes(mid)) them.incoming.push(mid);
  friendGraph[mid] = me;
  friendGraph[tid] = them;
  save(FRIENDS_FILE, friendGraph);
  res.json({ ok: true, status: 'pending', user: publicUser(target) });
});

app.post('/api/friends/accept', auth, (req, res) => {
  const fromId = String(req.body?.userId || '');
  const me = ensureFriendNode(req.user.id);
  me.incoming = (me.incoming || []).map(String);
  if (!fromId || !me.incoming.includes(fromId)) {
    return res.status(400).json({ error: 'No request from that user', incoming: me.incoming });
  }
  const them = ensureFriendNode(fromId);
  them.outgoing = (them.outgoing || []).map(String);
  me.incoming = me.incoming.filter((id) => id !== fromId);
  them.outgoing = them.outgoing.filter((id) => id !== String(req.user.id));
  if (!me.friends.map(String).includes(fromId)) me.friends.push(fromId);
  if (!them.friends.map(String).includes(String(req.user.id))) them.friends.push(req.user.id);
  save(FRIENDS_FILE, friendGraph);
  res.json({ ok: true, user: publicUser(users[fromId]) });
});

app.post('/api/friends/decline', auth, (req, res) => {
  const fromId = String(req.body?.userId || '');
  const me = ensureFriendNode(req.user.id);
  me.incoming = (me.incoming || []).map(String);
  if (!fromId || !me.incoming.includes(fromId)) {
    return res.status(400).json({ error: 'No request from that user' });
  }
  const them = ensureFriendNode(fromId);
  me.incoming = me.incoming.filter((id) => id !== fromId);
  them.outgoing = (them.outgoing || []).map(String).filter((id) => id !== String(req.user.id));
  save(FRIENDS_FILE, friendGraph);
  res.json({ ok: true });
});

app.post('/api/friends/cancel', auth, (req, res) => {
  const otherId = String(req.body?.userId || '');
  if (!otherId) return res.status(400).json({ error: 'userId required' });
  const me = ensureFriendNode(req.user.id);
  const them = ensureFriendNode(otherId);
  me.outgoing = (me.outgoing || []).map(String).filter((id) => id !== otherId);
  them.incoming = (them.incoming || []).map(String).filter((id) => id !== String(req.user.id));
  save(FRIENDS_FILE, friendGraph);
  res.json({ ok: true });
});

app.post('/api/friends/remove', auth, (req, res) => {
  const otherId = req.body?.userId;
  if (!otherId) return res.status(400).json({ error: 'userId required' });
  const me = ensureFriendNode(req.user.id);
  const them = ensureFriendNode(otherId);
  me.friends = me.friends.filter((id) => id !== otherId);
  them.friends = them.friends.filter((id) => id !== req.user.id);
  me.outgoing = me.outgoing.filter((id) => id !== otherId);
  me.incoming = me.incoming.filter((id) => id !== otherId);
  them.outgoing = them.outgoing.filter((id) => id !== req.user.id);
  them.incoming = them.incoming.filter((id) => id !== req.user.id);
  save(FRIENDS_FILE, friendGraph);
  res.json({ ok: true });
});

function mentionsUser(text, user) {
  const body = String(text || '');
  if (/(^|\s)@(everyone|here)(?![\w.])/i.test(body)) return true;
  const names = [user && user.username, user && user.displayName].filter((name) => name && String(name).trim());
  return names.some((name) => {
    const safe = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|\\s)@' + safe + '(?![\\w.])', 'i').test(body);
  });
}

function mentionPattern(name) {
  const safe = String(name || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!safe) return null;
  return new RegExp('(^|\\s)@' + safe + '(?![\\w.])', 'i');
}

function canMentionRole(g, user, role) {
  if (!g || !user || !role) return false;
  if (isOwner(g, user)) return true;
  const list = Array.isArray(role.mentionBy) ? role.mentionBy : ['everyone'];
  if (!list.length) return false;
  const mine = new Set(memberRoles(g, user).map((r) => r.id));
  return list.some((id) => mine.has(id));
}

function parseMentions(g, user, content) {
  const text = String(content || '');
  const mentions = { users: [], roles: [], everyone: false, here: false };
  if (!g || !user) return mentions;
  const everyone = (g.roles || []).find((r) => r.id === 'everyone');
  const here = (g.roles || []).find((r) => r.id === 'here');
  if (mentionPattern('everyone') && mentionPattern('everyone').test(text) && canMentionRole(g, user, everyone)) mentions.everyone = true;
  if (mentionPattern('here') && mentionPattern('here').test(text) && canMentionRole(g, user, here)) mentions.here = true;
  for (const role of g.roles || []) {
    if (!role || role.id === 'everyone' || role.id === 'here' || role.id === 'owner') continue;
    const pattern = mentionPattern(String(role.name || '').replace(/^@/, ''));
    if (pattern && pattern.test(text) && canMentionRole(g, user, role)) mentions.roles.push(role.id);
  }
  for (const id of Object.keys(g.members || {})) {
    if (String(id) === String(user.id)) continue;
    const member = users[id];
    if (!member) continue;
    const nick = g.members[id] && g.members[id].nick;
    const names = [member.username, member.displayName, nick].filter((name) => name && String(name).trim());
    if (names.some((name) => {
      const pattern = mentionPattern(name);
      return pattern && pattern.test(text);
    })) mentions.users.push(String(id));
  }
  return mentions;
}

function isHere(user) {
  const status = user && user.status;
  return status !== 'offline' && status !== 'dnd';
}

function messageMentions(msg, user, g) {
  const mentions = msg && msg.mentions;
  if (!mentions || typeof mentions !== 'object') return mentionsUser(msg && msg.content, user);
  if (mentions.everyone) return true;
  if (mentions.here && isHere(user)) return true;
  if ((mentions.users || []).some((id) => String(id) === String(user.id))) return true;
  const mem = g && g.members && g.members[user.id];
  const roles = new Set((mem && mem.roles) || []);
  roles.add('everyone');
  return (mentions.roles || []).some((id) => roles.has(id));
}

function sharesServer(a, b) {
  return Object.values(guilds.servers).some((g) => g && g.members && g.members[a] && g.members[b]);
}

function dmInbox(userId, seen, seeded) {
  const others = new Set();
  for (const thread of Object.values(dmThreads)) {
    if (!thread || (String(thread.a) !== String(userId) && String(thread.b) !== String(userId))) continue;
    others.add(String(String(thread.a) === String(userId) ? thread.b : thread.a));
  }
  for (const roomId of Object.keys(messages)) {
    if (!String(roomId).startsWith('dm:')) continue;
    const ids = roomId.slice(3).split(':');
    if (!ids.map(String).includes(String(userId))) continue;
    const other = ids.find((id) => String(id) !== String(userId));
    if (other) others.add(String(other));
  }
  const counts = {};
  const heads = {};
  for (const other of others) {
    const list = messages['dm:' + dmKey(userId, other)] || [];
    const cursor = String((seen && seen['dm:' + other]) || '');
    let start = list.length;
    if (cursor) {
      const idx = list.findIndex((msg) => msg && msg.id === cursor);
      start = idx === -1 ? 0 : idx + 1;
    } else if (seeded) {
      start = 0;
    }
    let unread = 0;
    for (let i = start; i < list.length; i++) {
      if (list[i] && String(list[i].authorId) !== String(userId)) unread++;
    }
    if (unread) counts[other] = { unread };
    const last = list[list.length - 1];
    if (last) heads['dm:' + other] = last.id;
  }
  return { counts, heads };
}

function dmPreview(content) {
  return String(content || '')
    .replace(/\[\[gif:[^\]]+\]\]/g, 'GIF')
    .replace(/\[\[sticker:([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function sendDmList(req, res) {
  const seen = req.body && req.body.seen && typeof req.body.seen === 'object' ? req.body.seen : {};
  const seeded = !!(req.body && req.body.seeded);
  const notes = dmInbox(req.user.id, seen, seeded).counts;
  for (const roomId of Object.keys(messages)) {
    if (!String(roomId).startsWith('dm:')) continue;
    const ids = roomId.slice(3).split(':');
    if (!ids.map(String).includes(String(req.user.id))) continue;
    const otherId = ids.find((id) => String(id) !== String(req.user.id));
    const key = ids.join(':');
    if (otherId && !dmThreads[key]) {
      const pair = [String(req.user.id), String(otherId)].sort();
      dmThreads[key] = { id: key, a: pair[0], b: pair[1], updatedAt: Date.now() };
    }
  }
  const list = Object.values(dmThreads)
    .filter((t) => t && (String(t.a) === String(req.user.id) || String(t.b) === String(req.user.id)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((t) => {
      const otherId = String(t.a) === String(req.user.id) ? t.b : t.a;
      const room = messages['dm:' + t.id] || [];
      const last = room[room.length - 1];
      const note = notes[String(otherId)];
      return {
        id: t.id,
        other: publicUser(users[otherId]),
        updatedAt: t.updatedAt,
        preview: last ? dmPreview(last.content || (last.poll && last.poll.question) || (last.files && last.files[0] && last.files[0].name) || '') : '',
        lastId: last ? last.id : '',
        lastFrom: last ? last.authorId : '',
        unread: note ? note.unread : 0,
      };
    })
    .filter((t) => t.other);
  res.json({ ok: true, dms: list });
}

app.get('/api/dms', auth, sendDmList);
app.post('/api/dms', auth, sendDmList);

app.get('/api/dms/:userId/messages', auth, (req, res) => {
  const otherId = req.params.userId;
  if (!users[otherId]) return res.status(404).json({ error: 'User not found' });
  const key = dmKey(req.user.id, otherId);
  const list = messages['dm:' + key] || [];
  res.json({ ok: true, messages: list.slice(-100).map((msg) => presentMessage(msg, req.user.id)), other: publicUser(users[otherId]) });
});

app.post('/api/dms/:userId/messages', auth, (req, res) => {
  const otherId = req.params.userId;
  if (!users[otherId]) return res.status(404).json({ error: 'User not found' });
  if (otherId === req.user.id) return res.status(400).json({ error: 'Cannot DM yourself' });

  const extra = messageExtras(req.body);
  if (extra.error) return res.status(400).json({ error: extra.error });

  const me = ensureFriendNode(req.user.id);
  const key = dmKey(req.user.id, otherId);
  const channelId = 'dm:' + key;
  if (!me.friends.map(String).includes(String(otherId)) && !dmThreads[key] && !sharesServer(req.user.id, otherId)) {
    return res.status(403).json({ error: 'Add them as a friend first' });
  }

  if (!dmThreads[key]) {
    dmThreads[key] = {
      id: key,
      a: [req.user.id, otherId].sort()[0],
      b: [req.user.id, otherId].sort()[1],
      updatedAt: Date.now(),
    };
  } else {
    dmThreads[key].updatedAt = Date.now();
  }
  save(DMS_FILE, dmThreads);

  if (!messages[channelId]) messages[channelId] = [];
  const msg = {
    id: uuidv4(),
    channelId,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: extra.content,
    files: extra.files,
    poll: extra.poll,
    replies: readReplies(req.body, channelId),
    reply: readReply(req.body, channelId),
    createdAt: new Date().toISOString(),
  };
  messages[channelId].push(msg);
  if (messages[channelId].length > 500) messages[channelId] = messages[channelId].slice(-500);
  save(MESSAGES_FILE, messages);
  silenceTyping(channelId, req.user.id, req.body && req.body.typingToken);
  wakePulse(channelId);
  touchAlerts();
  res.json({ ok: true, message: presentMessage(msg, req.user.id) });
});

app.get('/api/forward-targets', auth, (req, res) => {
  ensureGuilds();
  const channels = [];
  for (const g of Object.values(guilds.servers)) {
    if (!g || !g.members || !g.members[req.user.id]) continue;
    for (const channel of g.channels || []) {
      if (channel.type && channel.type !== 'text') continue;
      if (!can(g, req.user, PERM.SEND, channel)) continue;
      channels.push({ serverId: g.id, serverName: g.name, channelId: channel.id, name: channel.name });
    }
  }
  const seen = new Set();
  const dms = [];
  const addDm = (id) => {
    const other = users[id];
    if (!other || seen.has(String(id)) || String(id) === String(req.user.id)) return;
    seen.add(String(id));
    dms.push({ id: other.id, name: other.displayName || other.username });
  };
  for (const thread of Object.values(dmThreads)) {
    if (!thread || (String(thread.a) !== String(req.user.id) && String(thread.b) !== String(req.user.id))) continue;
    addDm(String(thread.a) === String(req.user.id) ? thread.b : thread.a);
  }
  const node = ensureFriendNode(req.user.id);
  for (const id of node.friends || []) addDm(id);
  res.json({ ok: true, channels, dms });
});

app.post('/api/messages/:id/reactions', auth, (req, res) => {
  const found = locateMessage(req.params.id);
  if (!found || !canSeeRoom(req.user, found.roomId)) return res.status(404).json({ error: 'Message not found' });
  const emoji = cleanReactionEmoji(req.user, req.body && req.body.emoji);
  if (!emoji) return res.status(400).json({ error: 'Pick an emoji' });
  const msg = found.msg;
  msg.reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
  let row = msg.reactions.find((item) => item && item.emoji === emoji);
  if (!row) {
    row = { emoji, users: [] };
    msg.reactions.push(row);
  }
  row.users = Array.isArray(row.users) ? row.users : [];
  const mine = row.users.findIndex((id) => String(id) === String(req.user.id));
  if (mine >= 0) row.users.splice(mine, 1);
  else row.users.push(String(req.user.id));
  msg.reactions = msg.reactions.filter((item) => item && item.users && item.users.length);
  save(MESSAGES_FILE, messages);
  wakePulse(found.roomId);
  res.json({ ok: true, message: presentMessage(msg, req.user.id) });
});

app.patch('/api/messages/:id', auth, (req, res) => {
  const found = locateMessage(req.params.id);
  if (!found || !canSeeRoom(req.user, found.roomId)) return res.status(404).json({ error: 'Message not found' });
  if (String(found.msg.authorId) !== String(req.user.id)) return res.status(403).json({ error: 'You can only edit your own messages' });
  const content = String(req.body && req.body.content || '').trim().slice(0, 2000);
  if (!content && !(found.msg.files || []).length && !found.msg.poll) return res.status(400).json({ error: 'Message is empty' });
  found.msg.content = content;
  found.msg.editedAt = new Date().toISOString();
  if (!String(found.roomId).startsWith('dm:')) {
    const channel = findChannel(found.roomId, '');
    if (channel) found.msg.mentions = parseMentions(channel.guild, req.user, content);
  }
  save(MESSAGES_FILE, messages);
  wakePulse(found.roomId);
  res.json({ ok: true, message: presentMessage(found.msg, req.user.id) });
});

app.delete('/api/messages/:id', auth, (req, res) => {
  const found = locateMessage(req.params.id);
  if (!found || !canSeeRoom(req.user, found.roomId)) return res.status(404).json({ error: 'Message not found' });
  const channel = String(found.roomId).startsWith('dm:') ? null : findChannel(found.roomId, '');
  const manage = channel && (isOwner(channel.guild, req.user) || can(channel.guild, req.user, PERM.MANAGE_CHANNELS));
  if (String(found.msg.authorId) !== String(req.user.id) && !manage) return res.status(403).json({ error: 'You can only delete your own messages' });
  found.list.splice(found.index, 1);
  save(MESSAGES_FILE, messages);
  wakePulse(found.roomId);
  res.json({ ok: true });
});

app.post('/api/messages/:id/forward', auth, (req, res) => {
  const found = locateMessage(req.params.id);
  if (!found || !canSeeRoom(req.user, found.roomId)) return res.status(404).json({ error: 'Message not found' });
  const src = found.msg;
  const name = (src.author && (src.author.displayName || src.author.username)) || 'Someone';
  const text = String(src.content || '').trim().slice(0, 2000);
  const preview = text.replace(/\[\[(?:gif|sticker):[^\]]+\]\]/g, '').trim().slice(0, 140) || ((src.files && src.files.length) ? 'Attachment' : 'Message');
  const copiedFiles = readFiles({ files: src.files || [] });
  if (!text && !copiedFiles.length) return res.status(400).json({ error: 'Nothing to forward' });
  const userId = String(req.body && req.body.userId || '');
  const channelId = String(req.body && req.body.channelId || '');
  let roomId = '';
  let mentions = null;
  if (userId) {
    if (!users[userId] || userId === req.user.id) return res.status(400).json({ error: 'Pick someone to message' });
    const me = ensureFriendNode(req.user.id);
    const key = dmKey(req.user.id, userId);
    if (!me.friends.map(String).includes(String(userId)) && !dmThreads[key] && !sharesServer(req.user.id, userId)) {
      return res.status(403).json({ error: 'Add them as a friend first' });
    }
    if (!dmThreads[key]) {
      dmThreads[key] = { id: key, a: [req.user.id, userId].sort()[0], b: [req.user.id, userId].sort()[1], updatedAt: Date.now() };
      save(DMS_FILE, dmThreads);
    } else {
      dmThreads[key].updatedAt = Date.now();
      save(DMS_FILE, dmThreads);
    }
    roomId = 'dm:' + key;
  } else if (channelId) {
    const channel = findChannel(channelId, String(req.body && req.body.serverId || ''));
    if (!channel || channel.channel.type === 'voice') return res.status(404).json({ error: 'Channel not found' });
    if (!can(channel.guild, req.user, PERM.SEND, channel.channel)) return res.status(403).json({ error: 'You cannot send messages there' });
    roomId = channel.channel.id;
    mentions = parseMentions(channel.guild, req.user, text);
  } else {
    return res.status(400).json({ error: 'Pick a channel or a direct message' });
  }
  if (!messages[roomId]) messages[roomId] = [];
  const msg = {
    id: uuidv4(),
    channelId: roomId,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: text,
    files: copiedFiles,
    forward: { name, preview },
    mentions,
    createdAt: new Date().toISOString(),
  };
  messages[roomId].push(msg);
  if (messages[roomId].length > 500) messages[roomId] = messages[roomId].slice(-500);
  save(MESSAGES_FILE, messages);
  wakePulse(roomId);
  touchAlerts();
  res.json({ ok: true, message: presentMessage(msg, req.user.id) });
});

app.post('/api/polls/:messageId/vote', auth, (req, res) => {
  const messageId = String(req.params.messageId || '');
  const wanted = (Array.isArray(req.body && req.body.options) ? req.body.options : [req.body && req.body.option])
    .map((id) => String(id || ''))
    .filter(Boolean);
  for (const list of Object.values(messages)) {
    if (!Array.isArray(list)) continue;
    const msg = list.find((row) => row && row.id === messageId && row.poll);
    if (!msg) continue;
    if (Date.now() >= Number(msg.poll.endsAt || 0)) return res.status(400).json({ error: 'This poll has ended' });
    const allowed = new Set((msg.poll.options || []).map((opt) => opt.id));
    const picked = (msg.poll.multi ? wanted : wanted.slice(0, 1)).filter((id) => allowed.has(id));
    msg.poll.votes = msg.poll.votes || {};
    for (const id of Object.keys(msg.poll.votes)) {
      msg.poll.votes[id] = (msg.poll.votes[id] || []).filter((userId) => userId !== req.user.id);
    }
    for (const id of picked) {
      if (!msg.poll.votes[id]) msg.poll.votes[id] = [];
      msg.poll.votes[id].push(req.user.id);
    }
    save(MESSAGES_FILE, messages);
    wakePulse(msg.channelId);
    return res.json({ ok: true, poll: publicPoll(msg.poll, req.user.id) });
  }
  res.status(404).json({ error: 'Poll not found' });
});

function settingsView(g, user) {
  hydrateGuild(g);
  const manage = can(g, user, PERM.MANAGE_SERVER);
  const base = {
    id: g.id,
    name: g.name,
    icon: g.icon,
    iconUrl: g.iconUrl || '',
    bannerUrl: g.bannerUrl || '',
    tag: g.tag || '',
    about: g.about || '',
    showLobby: !!g.showLobby,
    color: g.color,
    theme: g.theme,
    categories: g.categories,
    channels: g.channels,
    roles: g.roles,
    emoji: g.emoji,
    stickers: g.stickers,
    events: g.events,
    pingRoleIds: g.pingRoleIds,
    onboarding: g.onboarding,
    lockedUntil: g.lockedUntil || 0,
    official: g.id === OFFICIAL_ID,
    myNick: (g.members[user.id] && g.members[user.id].nick) || '',
  };
  if (!manage) return base;
  return Object.assign(base, {
    raid: g.raid,
    verification: g.verification,
    joinMode: g.joinMode,
    joinQuestions: g.joinQuestions,
    requests: (g.requests || []).map((r) => Object.assign({}, r, { user: users[r.userId] ? publicUser(users[r.userId]) : null })),
    reports: g.reports,
    audit: g.audit,
    bans: Object.keys(g.bans).map((id) => ({ userId: id, reason: g.bans[id].reason, at: g.bans[id].at, user: users[id] ? publicUser(users[id]) : null })),
    members: Object.keys(g.members).map((id) => users[id] ? memberView(g, users[id]) : null).filter(Boolean),
  });
}

app.get('/api/servers/:id/settings', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  res.json({ ok: true, settings: settingsView(g, req.user) });
});

app.post('/api/servers/:id/action', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  hydrateGuild(g);
  const type = String(req.body?.type || '');
  const manage = can(g, req.user, PERM.MANAGE_SERVER);
  const staff = staffRank(g, req.user);
  const moderate = staff >= 2
    ? ['kick', 'ban', 'unban', 'timeout', 'nick-other', 'report-handle']
    : (staff >= 1 ? ['kick', 'timeout', 'nick-other'] : []);
  const clip = (v, n) => String(v || '').slice(0, n);

  if (type === 'nick') {
    const nick = clip(req.body.nick, 32);
    g.members[req.user.id].nick = nick;
    audit(g, req.user, nick ? 'set their nickname to ' + nick : 'cleared their nickname');
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'ping-toggle') {
    const roleId = String(req.body.roleId || '');
    const pingRole = (g.roles || []).find((r) => r.id === roleId);
    if (!(g.pingRoleIds || []).includes(roleId) || !pingRole || (pingRole.permissions & MANAGE_MASK)) {
      return res.status(400).json({ error: 'That role cannot be picked' });
    }
    const mem = g.members[req.user.id];
    mem.roles = mem.roles || ['everyone'];
    if (mem.roles.includes(roleId)) mem.roles = mem.roles.filter((id) => id !== roleId);
    else mem.roles.push(roleId);
    saveGuilds();
    return res.json({ ok: true, roles: mem.roles });
  }
  if (type === 'onboard') {
    const mem = g.members[req.user.id];
    const picked = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
    const allowed = new Set((g.onboarding.questions || []).map((q) => q.roleId).filter(Boolean));
    mem.roles = mem.roles || ['everyone'];
    picked.forEach((id) => {
      if (allowed.has(id) && !STAFF_RANK[id] && id !== 'owner' && id !== 'developer' && !mem.roles.includes(id)) mem.roles.push(id);
    });
    mem.onboarded = true;
    saveGuilds();
    return res.json({ ok: true });
  }
  if (!manage && !moderate.includes(type) && type !== 'report') return res.status(403).json({ error: 'You do not have permission' });
  if (['kick', 'ban', 'timeout', 'nick-other'].includes(type)) {
    const targetId = String(req.body.userId || '');
    if (!canStaffTouch(g, req.user, targetId)) return res.status(403).json({ error: 'That member is above you' });
  }

  if (type === 'settings') {
    const b = req.body || {};
    if (b.name != null) {
      const name = clip(b.name, 40).trim();
      if (name.length < 2) return res.status(400).json({ error: 'Server name must be at least 2 characters' });
      g.name = name;
    }
    if (b.icon != null) g.icon = clip(b.icon, 2) || g.icon;
    if (b.iconUrl != null) g.iconUrl = clip(b.iconUrl, 2000000);
    if (b.bannerUrl != null) g.bannerUrl = clip(b.bannerUrl, 2000000);
    if (b.tag != null) g.tag = clip(b.tag, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (b.about != null) g.about = clip(b.about, 2000);
    if (b.showLobby != null) g.showLobby = !!b.showLobby;
    if (b.color != null) g.color = clip(b.color, 20);
    if (b.theme && typeof b.theme === 'object') {
      g.theme = { accent: clip(b.theme.accent, 20) || g.theme.accent, tint: clip(b.theme.tint, 20) };
    }
    if (b.verification != null) g.verification = ['none', 'low', 'medium', 'high'].includes(b.verification) ? b.verification : g.verification;
    if (b.joinMode != null) g.joinMode = b.joinMode === 'apply' ? 'apply' : 'open';
    if (Array.isArray(b.joinQuestions)) g.joinQuestions = b.joinQuestions.map((q) => clip(q, 120)).slice(0, 3);
    if (b.raid && typeof b.raid === 'object') {
      g.raid = {
        on: !!b.raid.on,
        joinHours: Number(b.raid.joinHours) || 1,
        accountDays: Number(b.raid.accountDays) || 3,
        durationHours: Number(b.raid.durationHours) || 6,
      };
    }
    if (b.onboarding && typeof b.onboarding === 'object') {
      g.onboarding = {
        enabled: !!b.onboarding.enabled,
        mustFinish: !!b.onboarding.mustFinish,
        questions: Array.isArray(b.onboarding.questions) ? b.onboarding.questions.slice(0, 8).map((q) => ({
          q: clip(q.q, 160),
          roleId: clip(q.roleId, 80),
        })) : g.onboarding.questions,
      };
    }
    if (Array.isArray(b.pingRoleIds)) {
      const safe = new Set((g.roles || []).filter((r) => r.id !== 'everyone' && r.id !== 'owner' && !(r.permissions & MANAGE_MASK)).map((r) => r.id));
      g.pingRoleIds = b.pingRoleIds.filter((id) => safe.has(id)).slice(0, 20);
    }
    if (b.raid && b.raid.on) g.raid.until = Date.now() + (Number(b.raid.durationHours) || 6) * 3600000;
    else if (b.raid) g.raid.until = 0;
    audit(g, req.user, 'changed the server settings');
    saveGuilds();
    return res.json({ ok: true, settings: settingsView(g, req.user) });
  }
  if (type === 'lock') {
    const minutes = Math.max(0, Number(req.body.minutes) || 0);
    g.lockedUntil = minutes ? Date.now() + minutes * 60000 : 0;
    audit(g, req.user, minutes ? 'locked the server for ' + minutes + ' minutes' : 'unlocked the server');
    saveGuilds();
    return res.json({ ok: true, lockedUntil: g.lockedUntil });
  }
  if (type === 'category') {
    const name = clip(req.body.name, 40).trim();
    if (!name) return res.status(400).json({ error: 'Category name required' });
    const cat = { id: uuidv4(), name };
    g.categories.push(cat);
    audit(g, req.user, 'created the category ' + name);
    saveGuilds();
    return res.json({ ok: true, category: cat });
  }
  if (type === 'category-delete') {
    g.categories = g.categories.filter((c) => c.id !== req.body.categoryId);
    (g.channels || []).forEach((c) => { if (c.categoryId === req.body.categoryId) c.categoryId = ''; });
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'set-category') {
    const ch = (g.channels || []).find((c) => c.id === req.body.channelId);
    if (!ch) return res.status(404).json({ error: 'Channel not found' });
    const categoryId = String(req.body.categoryId || '');
    if (categoryId && !(g.categories || []).some((c) => c.id === categoryId)) return res.status(400).json({ error: 'Category not found' });
    ch.categoryId = categoryId;
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'move-channel') {
    const idx = g.channels.findIndex((c) => c.id === req.body.channelId);
    if (idx < 0) return res.status(404).json({ error: 'Channel not found' });
    const next = idx + (req.body.dir === 'up' ? -1 : 1);
    if (next < 0 || next >= g.channels.length) return res.json({ ok: true });
    const tmp = g.channels[idx];
    g.channels[idx] = g.channels[next];
    g.channels[next] = tmp;
    if (req.body.categoryId != null) g.channels[next].categoryId = String(req.body.categoryId);
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'emoji' || type === 'sticker') {
    const list = type === 'emoji' ? g.emoji : g.stickers;
    const cap = type === 'emoji' ? 50 : 30;
    if (req.body.remove) {
      if (type === 'emoji') g.emoji = g.emoji.filter((e) => e.id !== req.body.id);
      else g.stickers = g.stickers.filter((e) => e.id !== req.body.id);
      saveGuilds();
      return res.json({ ok: true });
    }
    if (list.length >= cap) return res.status(400).json({ error: 'Limit reached' });
    const name = clip(req.body.name, 32).toLowerCase().replace(/[^a-z0-9_]/g, '');
    const url = clip(req.body.url, 400000);
    if (!name || !url) return res.status(400).json({ error: 'Name and image required' });
    list.push({ id: uuidv4(), name, url });
    audit(g, req.user, 'uploaded a ' + type + ' :' + name + ':');
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'event') {
    if (req.body.remove) {
      g.events = g.events.filter((e) => e.id !== req.body.id);
      saveGuilds();
      return res.json({ ok: true });
    }
    const title = clip(req.body.title, 80).trim();
    if (!title) return res.status(400).json({ error: 'Event name required' });
    g.events.unshift({ id: uuidv4(), title, when: clip(req.body.when, 40), description: clip(req.body.description, 400), at: new Date().toISOString() });
    g.events = g.events.slice(0, 30);
    audit(g, req.user, 'created the event ' + title);
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'kick' || type === 'ban') {
    const userId = String(req.body.userId || '');
    if (!g.members[userId]) return res.status(404).json({ error: 'Member not found' });
    if (isOwner(g, users[userId])) return res.status(400).json({ error: 'You cannot remove an owner' });
    const name = users[userId] ? users[userId].username : userId;
    if (type === 'ban') g.bans[userId] = { reason: clip(req.body.reason, 200), at: new Date().toISOString() };
    delete g.members[userId];
    audit(g, req.user, (type === 'ban' ? 'banned ' : 'kicked ') + name);
    saveGuilds();
    wakeGuild(g);
    return res.json({ ok: true });
  }
  if (type === 'unban') {
    delete g.bans[String(req.body.userId || '')];
    audit(g, req.user, 'removed a ban');
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'timeout') {
    const mem = g.members[String(req.body.userId || '')];
    if (!mem) return res.status(404).json({ error: 'Member not found' });
    const minutes = Math.max(0, Number(req.body.minutes) || 0);
    mem.timeoutUntil = minutes ? Date.now() + minutes * 60000 : 0;
    audit(g, req.user, minutes ? 'timed out a member' : 'cleared a timeout');
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'nick-other') {
    const mem = g.members[String(req.body.userId || '')];
    if (!mem) return res.status(404).json({ error: 'Member not found' });
    mem.nick = clip(req.body.nick, 32);
    audit(g, req.user, 'changed a nickname');
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'report') {
    g.reports.unshift({
      id: uuidv4(),
      status: 'open',
      text: clip(req.body.text, 400),
      targetId: String(req.body.userId || ''),
      by: req.user.id,
      at: new Date().toISOString(),
    });
    g.reports = g.reports.slice(0, 100);
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'report-handle') {
    const report = (g.reports || []).find((r) => r.id === req.body.reportId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    report.status = 'handled';
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'request') {
    const reqItem = (g.requests || []).find((r) => r.id === req.body.requestId);
    if (!reqItem) return res.status(404).json({ error: 'Request not found' });
    g.requests = g.requests.filter((r) => r.id !== reqItem.id);
    if (req.body.accept && !g.members[reqItem.userId] && !(g.bans && g.bans[reqItem.userId])) {
      g.members[reqItem.userId] = { roles: ['everyone'], joinedAt: new Date().toISOString(), onboarded: !(g.onboarding && g.onboarding.enabled) };
      audit(g, req.user, 'accepted a join request');
    } else audit(g, req.user, 'declined a join request');
    saveGuilds();
    wakeGuild(g);
    return res.json({ ok: true });
  }
  if (type === 'delete') {
    if (g.id === OFFICIAL_ID) return res.status(400).json({ error: 'Nebula Official cannot be deleted' });
    if (!isOwner(g, req.user)) return res.status(403).json({ error: 'Only the owner can delete this server' });
    delete guilds.servers[g.id];
    saveGuilds();
    return res.json({ ok: true, deleted: true });
  }
  return res.status(400).json({ error: 'Unknown action' });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, users: Object.keys(users).length, service: 'nebula' });
});

(function (app, ctx) {
  const { auth, guilds, users, findChannel, can, PERM, publicUser } = ctx;
  const rooms = new Map();

  function key(serverId, channelId) {
    return String(serverId) + '\n' + String(channelId);
  }

  function roomFor(serverId, channelId) {
    const id = key(serverId, channelId);
    if (!rooms.has(id)) rooms.set(id, { members: new Map(), signals: [] });
    return rooms.get(id);
  }

  function prune(room) {
    const now = Date.now();
    for (const [id, member] of room.members) {
      if (now - member.seen > 20000) room.members.delete(id);
    }
    room.signals = room.signals.filter((signal) => now - signal.at < 20000);
  }

  function present(member) {
    const user = publicUser(users[member.userId]) || {
      id: member.userId,
      username: 'Someone',
      displayName: 'Someone',
    };
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      avatarUrl: user.avatarUrl || '',
      avatarColor: user.avatarColor || '#7c5cff',
      muted: !!member.muted,
      deafened: !!member.deafened,
      speaking: !!member.speaking && !member.muted && !member.deafened,
    };
  }

  function locate(req, res) {
    const serverId = String((req.body && req.body.serverId) || req.query.serverId || '');
    const found = findChannel(String(req.params.channelId || ''), serverId);
    if (!found || found.channel.type !== 'voice') {
      res.status(404).json({ error: 'Voice channel not found' });
      return null;
    }
    if (!found.guild.members || !found.guild.members[req.user.id]) {
      res.status(403).json({ error: 'You are not in this server' });
      return null;
    }
    if (!can(found.guild, req.user, PERM.VIEW, found.channel)) {
      res.status(403).json({ error: 'You cannot join this channel' });
      return null;
    }
    return found;
  }

  function dropUser(userId, exceptKey) {
    for (const [id, room] of rooms) {
      if (id === exceptKey) continue;
      room.members.delete(userId);
    }
  }

  app.get('/api/voice/overview', auth, (req, res) => {
    const serverId = String(req.query.serverId || '');
    const guild = guilds.servers[serverId];
    if (!guild || !guild.members || !guild.members[req.user.id]) {
      return res.status(403).json({ error: 'You are not in this server' });
    }
    const out = {};
    for (const channel of guild.channels || []) {
      if (channel.type !== 'voice') continue;
      const room = rooms.get(key(serverId, channel.id));
      if (!room) continue;
      prune(room);
      if (!room.members.size) continue;
      out[channel.id] = [...room.members.values()].map(present);
    }
    res.json({ ok: true, rooms: out });
  });

  app.post('/api/voice/:channelId/join', auth, (req, res) => {
    const found = locate(req, res);
    if (!found) return;
    const id = key(found.guild.id, found.channel.id);
    dropUser(req.user.id, id);
    const room = roomFor(found.guild.id, found.channel.id);
    const prev = room.members.get(req.user.id);
    room.members.set(req.user.id, {
      userId: req.user.id,
      muted: prev ? prev.muted : false,
      deafened: prev ? prev.deafened : false,
      speaking: false,
      seen: Date.now(),
    });
    res.json({ ok: true, members: [...room.members.values()].map(present) });
  });

  app.post('/api/voice/:channelId/leave', auth, (req, res) => {
    const serverId = String((req.body && req.body.serverId) || '');
    const room = rooms.get(key(serverId, req.params.channelId));
    if (room) room.members.delete(req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/voice/:channelId/state', auth, (req, res) => {
    const serverId = String((req.body && req.body.serverId) || '');
    const room = rooms.get(key(serverId, req.params.channelId));
    const member = room && room.members.get(req.user.id);
    if (!member) return res.status(404).json({ error: 'You are not in this call' });
    if (req.body.muted != null) member.muted = !!req.body.muted;
    if (req.body.deafened != null) member.deafened = !!req.body.deafened;
    if (req.body.speaking != null) member.speaking = !!req.body.speaking;
    member.seen = Date.now();
    res.json({ ok: true });
  });

  app.post('/api/voice/:channelId/signal', auth, (req, res) => {
    const serverId = String((req.body && req.body.serverId) || '');
    const room = rooms.get(key(serverId, req.params.channelId));
    if (!room || !room.members.has(req.user.id)) {
      return res.status(404).json({ error: 'You are not in this call' });
    }
    const to = String(req.body.to || '');
    if (!room.members.has(to)) return res.status(404).json({ error: 'That person left the call' });
    room.signals.push({
      from: req.user.id,
      to,
      kind: String(req.body.kind || ''),
      payload: req.body.payload || null,
      at: Date.now(),
    });
    if (room.signals.length > 500) room.signals.splice(0, room.signals.length - 500);
    room.members.get(req.user.id).seen = Date.now();
    res.json({ ok: true });
  });

  app.get('/api/voice/:channelId/sync', auth, (req, res) => {
    const found = locate(req, res);
    if (!found) return;
    const room = roomFor(found.guild.id, found.channel.id);
    prune(room);
    const member = room.members.get(req.user.id);
    if (member) member.seen = Date.now();
    const mine = room.signals.filter((signal) => signal.to === req.user.id);
    room.signals = room.signals.filter((signal) => signal.to !== req.user.id);
    res.json({
      ok: true,
      joined: !!member,
      members: [...room.members.values()].map(present),
      signals: mine.map((signal) => ({ from: signal.from, kind: signal.kind, payload: signal.payload })),
    });
  });
})(app, { auth, guilds, users, findChannel, can, PERM, publicUser });

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((req, res) => {
  const index = path.join(FRONTEND_DIR, 'index.html');
  if (!fs.existsSync(index)) {
    res.status(500).type('html').send(
      '<p>Frontend not found.</p><p>Copy the site into <b>dist</b> next to server.js, or into the <b>frontend</b> folder next to the backend folder.</p><p>' +
      index + '</p>'
    );
    return;
  }
  res.sendFile(index);
});

let httpServer = null;
let listenTries = 0;

function git(args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: __dirname, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout) => {
      resolve(err ? null : String(stdout || '').trim());
    });
  });
}

let pulling = false;
async function pullUpdates() {
  if (pulling || !fs.existsSync(path.join(__dirname, '.git'))) return;
  pulling = true;
  try {
    const before = await git(['rev-parse', 'HEAD']);
    if (!before || (await git(['fetch', 'origin', 'main'])) === null) return;
    const remote = await git(['rev-parse', 'origin/main']);
    if (!remote || remote === before) return;
    if ((await git(['pull', '--ff-only', 'origin', 'main'])) === null) {
      console.log('  GitHub has a newer Nebula, but this folder has local changes so it was left as-is.');
      return;
    }
    const changed = await git(['diff', '--name-only', before, 'HEAD']);
    const files = String(changed || '').split('\n').map((file) => file.trim()).filter(Boolean);
    const siteFile = (file) => /^(client\/|dist\/|assets\/)/.test(file) || file === 'index.html' || file === 'favicon.svg' || file.endsWith('.md');
    const serverChanged = files.some((file) => !siteFile(file));
    if (!serverChanged) {
      console.log('  Site files updated from GitHub. Open pages will refresh themselves.');
      return;
    }
    if (files.some((file) => file === 'package.json' || file === 'package-lock.json')) {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      await new Promise((resolve) => execFile(npm, ['install', '--omit=dev'], { cwd: __dirname, timeout: 120000 }, () => resolve()));
    }
    console.log('  Server updated from GitHub. Restarting.');
    const child = spawn(process.execPath, process.argv.slice(1), {
      cwd: __dirname,
      detached: true,
      stdio: 'inherit',
      env: { ...process.env, NEBULA_RESTART_DELAY: '800' },
    });
    child.unref();
    process.exit(0);
  } finally {
    pulling = false;
  }
}

function listen() {
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n  Nebula backend -> http://localhost:' + PORT);
    console.log('  Frontend folder: ' + FRONTEND_DIR);
    console.log('  Users: ' + Object.keys(users).length);
    console.log('  Email: ' + GMAIL_USER);
    console.log('  Checking GitHub for updates every 30s.');
    setInterval(() => { pullUpdates().catch(() => {}); }, 30000);
  });
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && process.env.NEBULA_RESTART_DELAY && listenTries < 10) {
      listenTries += 1;
      setTimeout(listen, 400);
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

setTimeout(listen, Number(process.env.NEBULA_RESTART_DELAY || 0));
