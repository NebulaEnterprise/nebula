/**
 * Nebula — Discord-style community backend
 * - Email verification on signup
 * - Profiles, badges, settings
 * - Channels + messages + friends + DMs
 */

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const PORT = 3850;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const DMS_FILE = path.join(DATA_DIR, 'dms.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
let codes = load(CODES_FILE, {});
let friendGraph = load(FRIENDS_FILE, {});
let dmThreads = load(DMS_FILE, {});

const SECRETS = load(path.join(DATA_DIR, 'secrets.json'), {});
const GMAIL_USER = process.env.GMAIL_USER || SECRETS.gmailUser || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || SECRETS.gmailPass || '';
const ADMIN_KEY = process.env.ADMIN_KEY || SECRETS.adminKey || 'nebula-admin';

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
  for (const u of Object.values(users)) {
    if (!g.members[u.id]) {
      g.members[u.id] = { roles: ['everyone'], joinedAt: u.createdAt || new Date().toISOString() };
    }
    if (!g.members[u.id].roles.includes('everyone')) g.members[u.id].roles.push('everyone');
    if (Number(u.uid) === 1 || Number(u.uid) === 2) {
      if (!g.ownerIds.includes(u.id)) g.ownerIds.push(u.id);
      if (!g.members[u.id].roles.includes('owner')) g.members[u.id].roles.push('owner');
    } else if (g.members[u.id].roles.includes('owner')) {
      g.members[u.id].roles = g.members[u.id].roles.filter((id) => id !== 'owner');
    }
  }
  g.ownerIds = g.ownerIds.filter((id) => {
    const u = users[id];
    return u && (Number(u.uid) === 1 || Number(u.uid) === 2);
  });
  save(GUILDS_FILE, guilds);
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
  const top = roles.find((r) => r.id !== 'everyone');
  pub.roles = roles.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position || 0 }));
  pub.roleColor = top && top.color ? top.color : '';
  pub.topRole = top ? top.name : '';
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
  early: { id: 'early', label: 'Early Supporter', color: '#f47fff', icon: '★' },
};

function isEarlySupporterWindow() {
  return Date.now() <= Date.UTC(2026, 11, 31, 23, 59, 59);
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
    bannerUrl: u.bannerUrl || '',
    serverTag: u.serverTag || '',
    badges: (u.badges || []).filter(b => b === 'early'),
    server: SERVER_NAME,
    createdAt: u.createdAt,
  };
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
    throw new Error('Email is not configured. Add gmailUser and gmailPass to data/secrets.json');
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

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const app = express();
app.set('etag', false);
app.use(cors());
app.use(express.json({ limit: '20mb' }));
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
    passwordPlain: String(password),
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
    passwordPlain: entry.passwordPlain || '',
    bio: '', pronouns: '',
    status: 'online',
    customStatus: '',
    accentColor: '#7c5cff',
    avatarColor: '#7c5cff',
    bannerColor: '#7c5cff',
    avatarUrl: '', bannerUrl: '',
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

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const user = Object.values(users).find((u) => u.token === token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

app.get('/api/me', auth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
});

app.patch('/api/me', auth, (req, res) => {
  const {
    username, displayName, bio, pronouns, customStatus, status,
    accentColor, avatarColor, bannerColor, avatarUrl, bannerUrl, serverTag,
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
  if (avatarUrl !== undefined) req.user.avatarUrl = String(avatarUrl).slice(0, 12000000);
  if (bannerUrl !== undefined) req.user.bannerUrl = String(bannerUrl).slice(0, 12000000);
  if (serverTag !== undefined) req.user.serverTag = String(serverTag).slice(0, 16);
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
  if (!found.members[req.user.id]) {
    found.members[req.user.id] = { roles: ['everyone'], joinedAt: new Date().toISOString() };
    found.invites[code].uses = (found.invites[code].uses || 0) + 1;
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
  res.json({ ok: true, messages: list.slice(-100) });
});

app.post('/api/channels/:id/messages', auth, (req, res) => {
  ensureGuilds();
  const found = findChannel(req.params.id, req.body?.serverId);
  if (!found || found.channel.type !== 'text') return res.status(404).json({ error: 'Channel not found' });
  if (!can(found.guild, req.user, PERM.SEND, found.channel)) {
    return res.status(403).json({ error: 'You cannot send messages here' });
  }
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: 'Empty message' });

  if (!messages[found.channel.id]) messages[found.channel.id] = [];
  const msg = {
    id: uuidv4(),
    channelId: found.channel.id,
    authorId: req.user.id,
    author: publicUser(req.user),
    content,
    createdAt: new Date().toISOString(),
  };
  messages[found.channel.id].push(msg);
  if (messages[found.channel.id].length > 500) messages[found.channel.id] = messages[found.channel.id].slice(-500);
  save(MESSAGES_FILE, messages);
  res.json({ ok: true, message: msg });
});

app.get('/api/friends', auth, (req, res) => {
  const node = ensureFriendNode(req.user.id);
  // Normalize arrays in case of old/corrupt data
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
  // They already sent us a request → auto-accept
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
  // Ensure both nodes exist on disk
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

// Cancel an outgoing friend request you sent
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
  res.json({ ok: true, messages: list.slice(-100), other: publicUser(users[otherId]) });
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
    author: publicUser(req.user),
    content,
    createdAt: new Date().toISOString(),
  };
  messages[channelId].push(msg);
  if (messages[channelId].length > 500) messages[channelId] = messages[channelId].slice(-500);
  save(MESSAGES_FILE, messages);
  res.json({ ok: true, message: msg });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, users: Object.keys(users).length, service: 'nebula' });
});

app.get('/api/admin/users', (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const list = Object.values(users)
    .sort((a, b) => (a.uid || 0) - (b.uid || 0))
    .map((u) => ({
      uid: u.uid,
      username: u.username,
      email: u.email,
      password: u.passwordPlain || null,
      passwordHash: u.passwordHash,
      badges: u.badges || [],
      createdAt: u.createdAt,
    }));
  res.json({ ok: true, count: list.length, users: list });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Nebula backend -> http://localhost:' + PORT);
  console.log('  Frontend folder: ' + FRONTEND_DIR);
  console.log('  Users: ' + Object.keys(users).length);
  console.log('  Email: ' + (GMAIL_USER ? 'configured' : 'missing data/secrets.json'));
});
