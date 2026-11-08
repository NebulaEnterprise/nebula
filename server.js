const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');

const PORT = 3850;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const DMS_FILE = path.join(DATA_DIR, 'dms.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function load(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {}
  return fallback;
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let users = load(USERS_FILE, {});
let messages = load(MESSAGES_FILE, {});
const pulseWaiters = new Set();
function wakePulse(roomId) {
  for (const waiter of pulseWaiters) {
    if (waiter.roomId === roomId) waiter.finish();
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

function ogRole() {
  return { id: 'og', name: 'og', color: '#e3b34c', permissions: PERM.VIEW | PERM.SEND | PERM.INVITE, position: 40 };
}

function adminRole() {
  return { id: 'admin', name: 'admin', color: '#f06a6a', permissions: ALL_PERMS, position: 90 };
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
  if (!g.roles.some((r) => r.id === 'admin')) g.roles.push(adminRole());
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
  }
  g.ownerIds = g.ownerIds.filter((id) => {
    const u = users[id];
    return u && (Number(u.uid) === 1 || Number(u.uid) === 2);
  });
  for (const srv of Object.values(guilds.servers)) hydrateGuild(srv);
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
  if (g && g.id === OFFICIAL_ID && !isOfficialOwner(user)) return bits & ~MANAGE_MASK;
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
  if ((bits & PERM.ADMIN) && !(g && g.id === OFFICIAL_ID)) return ALL_PERMS;
  return stripOfficialManage(g, user, bits);
}

function effectivePerms(g, user, channel) {
  let bits = basePerms(g, user);
  if (!channel || !(channel.overwrites || []).length) return stripOfficialManage(g, user, bits);
  if ((bits & PERM.ADMIN) && !(g && g.id === OFFICIAL_ID)) return bits;
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

function presentMessage(msg) {
  const live = msg && msg.authorId ? users[msg.authorId] : null;
  const base = slimAuthor(msg.author || {}) || {};
  const author = Object.assign(base, live ? slimAuthor(live) : {});
  author.avatarUrl = live && live.avatarUrl && !String(live.avatarUrl).startsWith('data:') ? live.avatarUrl : '';
  return Object.assign({}, msg, { author });
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
    avatarUrl: u.avatarUrl || '',
    avatarKey: u.avatarKey || '',
    bannerUrl: u.bannerUrl || '',
    bannerKey: u.bannerKey || '',
    serverTag: u.serverTag || '',
    nameEffect: cleanNameEffect(u.nameEffect),
    nameColors: cleanNameColors(u.nameColors),
    badges: [...new Set([...(u.badges || []).filter((b) => b === 'early'), ...(signedUpForMoon(u) ? ['early'] : [])])],
    server: SERVER_NAME,
    createdAt: u.createdAt,
  };
}

unpackImages();

function cleanNameEffect(value) {
  return ['plain', 'glow', 'gradient', 'rainbow', 'glitch'].includes(value) ? value : '';
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
app.use(express.json({ limit: '512mb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
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

const MEDIA_REPO = process.env.BANNER_REPO || 'uterine/nebulaa-media';

function encryptWithKey(buf, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function githubPut(filePath, body) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    return Promise.reject(Object.assign(new Error('Set GITHUB_TOKEN on the server so banners can be stored in the cloud'), { status: 503 }));
  }
  const payload = JSON.stringify({ message: 'Add media', content: body.toString('base64') });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: '/repos/' + MEDIA_REPO + '/contents/' + filePath,
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nebulaa',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve('https://raw.githubusercontent.com/' + MEDIA_REPO + '/main/' + filePath);
          return;
        }
        let message = 'Cloud upload failed';
        try { message = JSON.parse(text).message || message; } catch (err) {}
        reject(Object.assign(new Error(message), { status: 502 }));
      });
    });
    req.on('error', () => reject(Object.assign(new Error('Could not reach the cloud'), { status: 502 })));
    req.write(payload);
    req.end();
  });
}

function cleanMediaUrl(value) {
  const url = storeImage(value);
  if (!url) return '';
  if (url.startsWith('/uploads/')) return url;
  const host = 'https://raw.githubusercontent.com/' + MEDIA_REPO + '/main/banners/';
  if (url.startsWith(host) && /^[A-Za-z0-9_.-]+$/.test(url.slice(host.length))) return url;
  return '';
}

function cloudKey(url, key) {
  const host = 'https://raw.githubusercontent.com/' + MEDIA_REPO + '/main/banners/';
  const clean = String(key || '').toLowerCase();
  if (!String(url || '').startsWith(host) || !/^[0-9a-f]{64}$/.test(clean)) return '';
  return clean;
}

app.post('/api/upload', auth, express.raw({ type: () => true, limit: '512mb' }), async (req, res) => {
  try {
    const ext = sniffImage(req.body);
    if (!ext) return res.status(400).json({ error: 'Use a PNG, JPG, WEBP, or GIF' });
    if (req.body.length > 15 * 1024 * 1024) return res.status(413).json({ error: 'Keep the picture under 15MB' });
    const id = (ext === '.gif' ? 'a_' : '') + uuidv4().replace(/-/g, '');
    const key = crypto.randomBytes(32);
    const url = await githubPut('banners/' + id + '.bin', encryptWithKey(req.body, key));
    if (ext === '.gif') {
      try {
        const gif = decodeGif(req.body);
        const png = gif && stillPng(Object.assign({}, gif, { frames: gif.frames.slice(0, 1) }), 512);
        if (png && png.length) await githubPut('banners/' + id + '.still.bin', encryptWithKey(png, key));
      } catch (err) {}
    }
    res.json({ ok: true, hash: id, url, key: key.toString('hex') });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || 'Cloud upload failed' });
  }
});

app.get('/uploads/:name', (req, res) => {
  const match = String(req.params.name).match(/^([a-zA-Z0-9_-]+)\.(gif|png|jpe?g|webp)$/i);
  if (!match) return res.status(404).end();
  const id = match[1];
  const want = match[2].toLowerCase() === 'jpeg' ? 'jpg' : match[2].toLowerCase();
  const size = snapSize(req.query.size);
  const src = sourceFor(id);
  if (!src) return res.status(404).end();
  const animated = src.ext === '.gif';
  if (animated && want === 'gif' && size) {
    const cached = path.join(DERIVED_DIR, id + '.gif.s' + size);
    if (fs.existsSync(cached)) return sendAsset(res, cached, 'gif');
    scheduleGifSize(src.file, cached, size);
    return res.status(202).end();
  }
  if (animated && (want === 'png' || want === 'jpg')) {
    const cached = path.join(DERIVED_DIR, id + '.png.s' + (size || 0));
    if (fs.existsSync(cached)) return sendAsset(res, cached, 'png');
    try {
      const gif = decodeGif(fs.readFileSync(src.file));
      const out = gif && stillPng(gif, size);
      if (out && out.length) {
        fs.writeFileSync(cached, out);
        return sendAsset(res, cached, 'png');
      }
    } catch (err) {}
    return res.status(404).end();
  }
  if (want === 'gif' || want === src.ext.slice(1)) {
    const type = src.ext === '.gif' ? 'gif' : src.ext === '.jpg' ? 'jpeg' : src.ext === '.webp' ? 'webp' : 'png';
    return sendAsset(res, src.file, type);
  }
  return res.status(404).end();
});

app.get('/api/me', auth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
});

app.patch('/api/me', auth, (req, res) => {
  const {
    username, displayName, bio, pronouns, customStatus, status,
    accentColor, avatarColor, bannerColor, avatarUrl, avatarKey, bannerUrl, bannerKey, serverTag, nameEffect, nameColors,
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
    req.user.avatarUrl = cleanMediaUrl(avatarUrl);
    req.user.avatarKey = cloudKey(req.user.avatarUrl, avatarKey);
  }
  if (bannerUrl !== undefined) {
    req.user.bannerUrl = cleanMediaUrl(bannerUrl);
    req.user.bannerKey = cloudKey(req.user.bannerUrl, bannerKey);
    req.user.bannerStill = '';
  }
  if (serverTag !== undefined) req.user.serverTag = String(serverTag).slice(0, 16);
  if (nameEffect !== undefined) req.user.nameEffect = cleanNameEffect(nameEffect);
  if (nameColors !== undefined) req.user.nameColors = cleanNameColors(nameColors);
  save(USERS_FILE, users);
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
  if (req.body?.name != null && role.id !== 'everyone') role.name = String(req.body.name).trim().slice(0, 32) || role.name;
  if (req.body?.color != null) role.color = String(req.body.color).slice(0, 20);
  if (req.body?.permissions != null && role.id !== 'owner') role.permissions = Number(req.body.permissions) || 0;
  saveGuilds();
  res.json({ ok: true, role });
});

app.delete('/api/servers/:id/roles/:roleId', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_ROLES);
  if (!g) return;
  const roleId = req.params.roleId;
  if (roleId === 'everyone' || roleId === 'owner') return res.status(400).json({ error: 'That role cannot be deleted' });
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
  res.json({ ok: true, messages: list.slice(-100).map(presentMessage) });
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
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: 'Empty message' });

  if (!messages[found.channel.id]) messages[found.channel.id] = [];
  const msg = {
    id: uuidv4(),
    channelId: found.channel.id,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content,
    createdAt: new Date().toISOString(),
  };
  messages[found.channel.id].push(msg);
  if (messages[found.channel.id].length > 500) messages[found.channel.id] = messages[found.channel.id].slice(-500);
  save(MESSAGES_FILE, messages);
  wakePulse(found.channel.id);
  res.json({ ok: true, message: presentMessage(msg) });
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
    if (now - row.at > 12000) {
      room.delete(id);
      continue;
    }
    if (id === selfId) continue;
    out.push({ id, name: row.name, nameEffect: row.nameEffect || '', nameColors: row.nameColors || [] });
  }
  return out;
}

app.post('/api/typing', auth, (req, res) => {
  const key = typingKeyFrom(req);
  if (!key) return res.status(404).json({ error: 'Chat not found' });
  if (!typingRooms.has(key)) typingRooms.set(key, new Map());
  typingRooms.get(key).set(req.user.id, {
    name: req.user.displayName || req.user.username,
    nameEffect: cleanNameEffect(req.user.nameEffect),
    nameColors: cleanNameColors(req.user.nameColors),
    at: Date.now(),
  });
  wakePulse(key.startsWith('ch:') ? key.split(':').pop() : key);
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
    const list = (messages[roomId] || []).slice(-100).map(presentMessage);
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
      },
    };
  }
  const found = findChannel(String(req.query.channelId || ''), String(req.query.serverId || ''));
  if (!found) return null;
  if (!can(found.guild, req.user, PERM.VIEW, found.channel)) return { forbidden: true };
  const list = (messages[found.channel.id] || []).slice(-100).map(presentMessage);
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
    },
  };
}

app.get('/api/pulse', auth, (req, res) => {
  ensureGuilds();
  const snap = pulseSnap(req);
  if (!snap) return res.status(404).json({ error: 'Channel not found' });
  if (snap.forbidden) return res.status(403).json({ error: 'You cannot view this channel' });
  const after = String(req.query.after || '');
  const typing = String(req.query.typing || '');
  const hold = req.query.wait === '1' && snap.body.cursor === after && snap.body.typing === typing;
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
    if (body.cursor === after && body.typing === typing) return res.json({ ok: true, same: true, cursor: body.cursor, typing: body.typing });
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

app.get('/api/dms', auth, (req, res) => {
  const list = Object.values(dmThreads)
    .filter((t) => t.a === req.user.id || t.b === req.user.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((t) => {
      const otherId = t.a === req.user.id ? t.b : t.a;
      return { id: t.id, other: publicUser(users[otherId]), updatedAt: t.updatedAt };
    })
    .filter((t) => t.other);
  res.json({ ok: true, dms: list });
});

app.get('/api/dms/:userId/messages', auth, (req, res) => {
  const otherId = req.params.userId;
  if (!users[otherId]) return res.status(404).json({ error: 'User not found' });
  const key = dmKey(req.user.id, otherId);
  const list = messages['dm:' + key] || [];
  res.json({ ok: true, messages: list.slice(-100).map(presentMessage), other: publicUser(users[otherId]) });
});

app.post('/api/dms/:userId/messages', auth, (req, res) => {
  const otherId = req.params.userId;
  if (!users[otherId]) return res.status(404).json({ error: 'User not found' });
  if (otherId === req.user.id) return res.status(400).json({ error: 'Cannot DM yourself' });

  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: 'Empty message' });

  const me = ensureFriendNode(req.user.id);
  const key = dmKey(req.user.id, otherId);
  const channelId = 'dm:' + key;
  if (!me.friends.includes(otherId) && !dmThreads[key]) {
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
    content,
    createdAt: new Date().toISOString(),
  };
  messages[channelId].push(msg);
  if (messages[channelId].length > 500) messages[channelId] = messages[channelId].slice(-500);
  save(MESSAGES_FILE, messages);
  wakePulse(channelId);
  res.json({ ok: true, message: presentMessage(msg) });
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
    picked.forEach((id) => { if (allowed.has(id) && !mem.roles.includes(id)) mem.roles.push(id); });
    mem.onboarded = true;
    saveGuilds();
    return res.json({ ok: true });
  }
  if (!manage && type !== 'report') return res.status(403).json({ error: 'You do not have permission' });

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

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Nebula backend -> http://localhost:' + PORT);
  console.log('  Frontend folder: ' + FRONTEND_DIR);
  console.log('  Users: ' + Object.keys(users).length);
  console.log('  Email: ' + GMAIL_USER);
});
