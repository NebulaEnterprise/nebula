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
const GMAIL_USER = 'rarerootusernames@gmail.com';
const GMAIL_APP_PASSWORD = 'hcpdfhjpjfgiosxt';
const ADMIN_KEY = 'nebula-admin';

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

const SERVERS = [
  { id: 'nebula-official', name: 'Nebula Official', icon: 'N', color: '#7c5cff' },
];

const CHANNELS = [
  { id: 'general', name: 'general', type: 'text', topic: 'Welcome to Nebula Official' },
  { id: 'announcements', name: 'announcements', type: 'text', topic: 'Official news' },
  { id: 'rules', name: 'rules', type: 'text', topic: 'Server rules' },
  { id: 'showcase', name: 'showcase', type: 'text', topic: 'Show off your stuff' },
  { id: 'random', name: 'random', type: 'text', topic: 'Off-topic' },
  { id: 'voice-lobby', name: 'Lobby', type: 'voice', topic: '' },
  { id: 'voice-gaming', name: 'Gaming', type: 'voice', topic: '' },
  { id: 'voice-afk', name: 'AFK', type: 'voice', topic: '' },
];

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
    res.status(500).json({ error: 'Failed to send email' });
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
  const list = Object.values(users).map(publicUser);
  res.json({ ok: true, members: list, badges: BADGE_DEFS, server: SERVER_NAME });
});

app.get('/api/servers', auth, (req, res) => {
  res.json({ ok: true, servers: SERVERS, active: SERVERS[0]?.id });
});

app.get('/api/channels', auth, (req, res) => {
  res.json({ ok: true, channels: CHANNELS, server: SERVER_NAME, servers: SERVERS });
});

app.get('/api/channels/:id/messages', auth, (req, res) => {
  const list = messages[req.params.id] || [];
  res.json({ ok: true, messages: list.slice(-100) });
});

app.post('/api/channels/:id/messages', auth, (req, res) => {
  const channel = CHANNELS.find((c) => c.id === req.params.id && c.type === 'text');
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: 'Empty message' });

  if (!messages[channel.id]) messages[channel.id] = [];
  const msg = {
    id: uuidv4(),
    channelId: channel.id,
    authorId: req.user.id,
    author: publicUser(req.user),
    content,
    createdAt: new Date().toISOString(),
  };
  messages[channel.id].push(msg);
  if (messages[channel.id].length > 500) messages[channel.id] = messages[channel.id].slice(-500);
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
  console.log(`\n  Nebula backend → http://localhost:${PORT}`);
  console.log(`  Frontend folder: ${FRONTEND_DIR}`);
  console.log(`  Users: ${Object.keys(users).length}`);
  console.log(`  Admin: http://localhost:${PORT}/api/admin/users?key=${ADMIN_KEY}`);
  console.log(`  Email: ${GMAIL_USER}\n`);
});