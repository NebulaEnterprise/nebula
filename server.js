const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { attachGateway } = require('./gateway');
const security = (() => {
const qrApi = (() => {
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// Version 1–10, error correction M.
// [ec per block, group1 blocks, group1 data, group2 blocks, group2 data]
const TABLE = [
  null,
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

const ALIGN = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function rsGenerator(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= mul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse();
}

function rsRemainder(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = msg[i];
    if (!factor) continue;
    for (let j = 0; j < gen.length; j++) msg[i + j] ^= mul(gen[j], factor);
  }
  return msg.slice(data.length);
}

function dataBytes(version, bytes) {
  const [ec, b1, d1, b2, d2] = TABLE[version];
  const capacity = b1 * d1 + b2 * d2;
  const ccBits = version <= 9 ? 8 : 16;
  const out = [];
  let acc = 0;
  let bits = 0;
  function put(value, width) {
    acc = (acc << width) | (value & ((1 << width) - 1));
    bits += width;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  put(0b0100, 4);
  put(bytes.length, ccBits);
  for (const byte of bytes) put(byte, 8);
  const totalBits = capacity * 8;
  const used = 4 + ccBits + bytes.length * 8;
  put(0, Math.min(4, totalBits - used));
  if (bits) put(0, 8 - bits);
  const pads = [0xec, 0x11];
  let p = 0;
  while (out.length < capacity) out.push(pads[p++ % 2]);
  return out.slice(0, capacity);
}

function interleave(version, codewords) {
  const [ec, b1, d1, b2, d2] = TABLE[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < b1; i++) {
    const data = codewords.slice(offset, offset + d1);
    offset += d1;
    blocks.push({ data, ec: rsRemainder(data, ec) });
  }
  for (let i = 0; i < b2; i++) {
    const data = codewords.slice(offset, offset + d2);
    offset += d2;
    blocks.push({ data, ec: rsRemainder(data, ec) });
  }
  const out = [];
  const maxData = Math.max(d1, d2 || 0);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return out;
}

function formatBits(mask) {
  const data = mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | rem;
}

function paint(version, codewords) {
  const size = 21 + (version - 1) * 4;
  const dark = Array.from({ length: size }, () => Array(size).fill(false));
  const hold = Array.from({ length: size }, () => Array(size).fill(false));
  function set(y, x, on, reserved) {
    if (y < 0 || x < 0 || y >= size || x >= size) return;
    dark[y][x] = !!on;
    if (reserved) hold[y][x] = true;
  }
  function finder(x, y) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const yy = y + dy;
        const xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= size || xx >= size) continue;
        const inside = dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6;
        const border = dy === 0 || dy === 6 || dx === 0 || dx === 6;
        const core = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
        set(yy, xx, inside && (border || core), true);
      }
    }
  }
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 0; i < size; i++) {
    if (!hold[6][i]) set(6, i, i % 2 === 0, true);
    if (!hold[i][6]) set(i, 6, i % 2 === 0, true);
  }
  const spots = ALIGN[version] || [];
  for (const y of spots) {
    for (const x of spots) {
      if ((x < 9 && y < 9) || (x > size - 10 && y < 9) || (x < 9 && y > size - 10)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(y + dy, x + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1, true);
        }
      }
    }
  }
  set(size - 8, 8, true, true);
  for (let i = 0; i < 9; i++) {
    hold[8][i] = true;
    hold[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    hold[8][size - 1 - i] = true;
    hold[size - 1 - i][8] = true;
  }
  if (version >= 7) {
    const bits = versionBits(version);
    let i = 0;
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 3; x++) {
        const on = ((bits >> i) & 1) === 1;
        set(y, size - 11 + x, on, true);
        set(size - 11 + x, y, on, true);
        i++;
      }
    }
  }

  const bits = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  let cursor = 0;
  let upward = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x -= 1;
    for (let i = 0; i < size; i++) {
      const y = upward ? size - 1 - i : i;
      for (const xx of [x, x - 1]) {
        if (hold[y][xx]) continue;
        dark[y][xx] = cursor < bits.length ? bits[cursor++] === 1 : false;
      }
    }
    upward = !upward;
  }
  return { dark, hold, size };
}

function maskOf(mask, y, x) {
  if (mask === 0) return (y + x) % 2 === 0;
  if (mask === 1) return y % 2 === 0;
  if (mask === 2) return x % 3 === 0;
  if (mask === 3) return (y + x) % 3 === 0;
  if (mask === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
  if (mask === 5) return ((y * x) % 2 + (y * x) % 3) === 0;
  if (mask === 6) return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0;
  return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0;
}

function drawFormat(modules, size, mask) {
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const on = ((bits >>> i) & 1) === 1;
    if (i < 6) modules[i][8] = on;
    else if (i < 8) modules[i + 1][8] = on;
    else modules[size - 15 + i][8] = on;
    if (i < 8) modules[8][size - i - 1] = on;
    else if (i < 9) modules[8][7] = on;
    else modules[8][15 - i - 1] = on;
  }
  modules[size - 8][8] = true;
}

function penalty(modules) {
  const n = modules.length;
  let score = 0;
  for (let y = 0; y < n; y++) {
    let run = 1;
    for (let x = 1; x < n; x++) {
      if (modules[y][x] === modules[y][x - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + run - 5;
        run = 1;
      }
    }
    if (run >= 5) score += 3 + run - 5;
  }
  for (let x = 0; x < n; x++) {
    let run = 1;
    for (let y = 1; y < n; y++) {
      if (modules[y][x] === modules[y - 1][x]) run += 1;
      else {
        if (run >= 5) score += 3 + run - 5;
        run = 1;
      }
    }
    if (run >= 5) score += 3 + run - 5;
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
    }
  }
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  function finderScore(row) {
    let add = 0;
    for (let i = 0; i <= row.length - 7; i++) {
      let ok = true;
      for (let k = 0; k < 7; k++) if (row[i + k] !== !!pattern[k]) ok = false;
      if (!ok) continue;
      const left = i >= 4 && row.slice(i - 4, i).every((v) => !v);
      const right = i + 11 <= row.length && row.slice(i + 7, i + 11).every((v) => !v);
      if (left || right) add += 40;
    }
    return add;
  }
  for (let y = 0; y < n; y++) score += finderScore(modules[y]);
  for (let x = 0; x < n; x++) score += finderScore(modules.map((row) => row[x]));
  let darks = 0;
  for (const row of modules) for (const cell of row) if (cell) darks += 1;
  score += 10 * Math.floor(Math.abs(darks / (n * n) * 100 - 50) / 5);
  return score;
}

function chooseVersion(length) {
  for (let version = 1; version <= 10; version++) {
    const [ec, b1, d1, b2, d2] = TABLE[version];
    const capacity = b1 * d1 + b2 * d2;
    const ccBits = version <= 9 ? 8 : 16;
    if (4 + ccBits + length * 8 <= capacity * 8) return version;
  }
  return 0;
}

function qrMatrix(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  const version = chooseVersion(bytes.length);
  if (!version) throw new Error('That code is too long to draw');
  const packed = interleave(version, dataBytes(version, bytes));
  const base = paint(version, packed);
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const modules = base.dark.map((row) => row.slice());
    for (let y = 0; y < base.size; y++) {
      for (let x = 0; x < base.size; x++) {
        if (!base.hold[y][x] && maskOf(mask, y, x)) modules[y][x] = !modules[y][x];
      }
    }
    drawFormat(modules, base.size, mask);
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      best = modules;
    }
  }
  return best;
}

function qrSvg(text) {
  const matrix = qrMatrix(text);
  const n = matrix.length;
  const quiet = 4;
  const span = n + quiet * 2;
  let body = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!matrix[y][x]) {
        x += 1;
        continue;
      }
      let w = 1;
      while (x + w < n && matrix[y][x + w]) w += 1;
      body += `<rect x="${x + quiet}" y="${y + quiet}" width="${w}" height="1"/>`;
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges"><rect width="${span}" height="${span}" fill="#fff"/><g fill="#111">${body}</g></svg>`;
}

return { qrMatrix, qrSvg };
})();
const { qrSvg } = qrApi;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const challenges = new Map();
const challengeFile = path.join(__dirname, 'data', 'challenges.json');
function loadChallenges() {
  try {
    const raw = JSON.parse(fs.readFileSync(challengeFile, 'utf8'));
    const now = Date.now();
    for (const [id, row] of Object.entries(raw || {})) {
      if (row && row.exp > now) challenges.set(id, row);
    }
  } catch (_) {}
}
function storeChallenges() {
  const obj = {};
  const now = Date.now();
  for (const [id, row] of challenges) {
    if (row && row.exp > now) obj[id] = row;
  }
  try {
    fs.mkdirSync(path.dirname(challengeFile), { recursive: true });
    fs.writeFileSync(challengeFile, JSON.stringify(obj));
  } catch (_) {}
}
loadChallenges();

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1000000).padStart(6, '0');
}

function matchTotp(secret, code, lastCounter = 0) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return 0;
  const now = Math.floor(Date.now() / 30000);
  for (let offset = -1; offset <= 1; offset++) {
    const counter = now + offset;
    if (counter <= lastCounter) continue;
    if (hotp(secret, counter) === clean) return counter;
  }
  return 0;
}

function sealToken(token) {
  const text = String(token || '');
  if (!text || text.startsWith('sha256$')) return text;
  return 'sha256$' + crypto.createHash('sha256').update(text).digest('hex');
}

function deviceLabel(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  let os = 'Unknown';
  if (/Windows/i.test(s)) os = 'Windows';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/iPhone/i.test(s)) os = 'iPhone';
  else if (/iPad/i.test(s)) os = 'iPad';
  else if (/Mac OS|Macintosh/i.test(s)) os = 'Mac';
  else if (/CrOS/i.test(s)) os = 'ChromeOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  let browser = 'Browser';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Safari\//.test(s)) browser = 'Safari';
  return os + ' · ' + browser;
}

function ensureSessions(user) {
  if (!user) return [];
  if (!Array.isArray(user.sessions)) user.sessions = [];
  if (user.token) user.token = sealToken(user.token);
  for (const row of user.sessions) {
    if (row && row.token) row.token = sealToken(row.token);
  }
  if (user.token && !user.sessions.some((row) => row.token === user.token)) {
    user.sessions.unshift({
      id: 'legacy-' + String(user.id || '').slice(0, 8),
      token: user.token,
      createdAt: user.createdAt || new Date().toISOString(),
      lastSeen: Number(user.lastSeen) || Date.now(),
    });
  }
  return user.sessions;
}

function sessionCount(user) {
  const list = Array.isArray(user && user.sessions) ? user.sessions : [];
  const extra = user && user.token && !list.some((row) => row.token === user.token) ? 1 : 0;
  return list.length + extra;
}

function openSession(user, req) {
  ensureSessions(user);
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    id: crypto.randomBytes(8).toString('hex'),
    token: sealToken(token),
    createdAt: new Date().toISOString(),
    lastSeen: Date.now(),
  };
  user.sessions.push(session);
  if (user.sessions.length > 24) user.sessions.splice(0, user.sessions.length - 24);
  user.token = session.token;
  user.status = 'online';
  user.lastSeen = Date.now();
  return { id: session.id, token, createdAt: session.createdAt, lastSeen: session.lastSeen };
}

function findSession(users, token) {
  if (!token) return null;
  const sealed = sealToken(token);
  for (const user of Object.values(users || {})) {
    ensureSessions(user);
    const session = user.sessions.find((row) => row.token === sealed);
    if (session) return { user, session };
  }
  return null;
}

function removeSession(user, id) {
  ensureSessions(user);
  const index = user.sessions.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const [removed] = user.sessions.splice(index, 1);
  if (user.token === removed.token) user.token = (user.sessions[user.sessions.length - 1] || {}).token || '';
  return removed;
}

function summary(user, currentId) {
  ensureSessions(user);
  const sessions = user.sessions.map((row) => ({
    id: row.id,
    label: 'Signed-in session',
    createdAt: row.createdAt,
    lastSeen: Number(row.lastSeen) || null,
    current: row.id === currentId,
  }));
  const passkeys = (Array.isArray(user.passkeys) ? user.passkeys : []).map((row) => ({
    id: row.id,
    name: row.name || 'Passkey',
    createdAt: row.createdAt,
    lastUsed: Number(row.lastUsed) || null,
  }));
  return {
    mfa: !!(user.totp && user.totp.enabled),
    passkeyCount: passkeys.length,
    sessionCount: sessions.length,
    sessions,
    passkeys,
  };
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function groupSecret(secret) {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

function otpauthUrl(user, secret) {
  const label = encodeURIComponent('Nebula:' + (user.username || 'account'));
  const issuer = encodeURIComponent('Nebula');
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

function beginTotp(user) {
  if (user.totp && user.totp.enabled) throw httpError('Authenticator is already on');
  const secret = base32Encode(crypto.randomBytes(20));
  user.totp = { secret, enabled: false, lastCounter: 0 };
  const url = otpauthUrl(user, secret);
  return { secret: groupSecret(secret), otpauth: url, qr: qrSvg(url) };
}

function confirmTotp(user, code) {
  if (!user.totp || !user.totp.secret) throw httpError('Start authenticator setup first');
  const counter = matchTotp(user.totp.secret, code, user.totp.lastCounter || 0);
  if (!counter) throw httpError('That code is wrong');
  user.totp.enabled = true;
  user.totp.lastCounter = counter;
  return true;
}

function disableTotp(user, code) {
  if (!user.totp || !user.totp.enabled) throw httpError('Authenticator is already off');
  const counter = matchTotp(user.totp.secret, code, user.totp.lastCounter || 0);
  if (!counter) throw httpError('That code is wrong');
  user.totp = null;
  return true;
}

function checkTotp(user, code) {
  if (!user.totp || !user.totp.enabled) return false;
  const counter = matchTotp(user.totp.secret, code, user.totp.lastCounter || 0);
  if (!counter) return false;
  user.totp.lastCounter = counter;
  return true;
}

function putChallenge(kind, data) {
  const id = crypto.randomBytes(16).toString('hex');
  challenges.set(id, { kind, ...data, tries: 0, exp: Date.now() + 5 * 60 * 1000 });
  storeChallenges();
  return id;
}

function readChallenge(id, kind) {
  const row = challenges.get(String(id || ''));
  if (!row || row.kind !== kind || row.exp < Date.now()) {
    challenges.delete(String(id || ''));
    return null;
  }
  return row;
}

function dropChallenge(id) {
  challenges.delete(String(id || ''));
  storeChallenges();
}

function mfaTicket(userId) {
  return putChallenge('mfa', { userId });
}

function mfaUserId(ticket) {
  const row = readChallenge(ticket, 'mfa');
  return row ? row.userId : '';
}

function takeMfa(ticket) {
  const row = readChallenge(ticket, 'mfa');
  if (!row) return null;
  row.tries += 1;
  if (row.tries > 6) {
    dropChallenge(ticket);
    return null;
  }
  storeChallenges();
  return row;
}

function originOf(req) {
  const origin = String((req && req.headers && req.headers.origin) || '').trim();
  if (/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) return origin;
  const host = String((req && req.headers && req.headers.host) || 'localhost').split(',')[0].trim();
  const proto = /^localhost|127\.0\.0\.1/.test(host) ? 'http' : 'https';
  return proto + '://' + host;
}

function cborDecode(buf, offset = 0) {
  const major = buf[offset] >> 5;
  const info = buf[offset] & 31;
  let pos = offset + 1;
  let length = info;
  if (info === 24) {
    length = buf[pos];
    pos += 1;
  } else if (info === 25) {
    length = buf.readUInt16BE(pos);
    pos += 2;
  } else if (info === 26) {
    length = buf.readUInt32BE(pos);
    pos += 4;
  } else if (info === 27) {
    length = Number(buf.readBigUInt64BE(pos));
    pos += 8;
  } else if (info > 27) {
    throw httpError('Passkey data is not supported');
  }
  if (major === 0) return { value: length, pos };
  if (major === 1) return { value: -1 - length, pos };
  if (major === 2) return { value: Buffer.from(buf.subarray(pos, pos + length)), pos: pos + length };
  if (major === 3) return { value: buf.toString('utf8', pos, pos + length), pos: pos + length };
  if (major === 4) {
    const list = [];
    for (let i = 0; i < length; i++) {
      const item = cborDecode(buf, pos);
      list.push(item.value);
      pos = item.pos;
    }
    return { value: list, pos };
  }
  if (major === 5) {
    const map = new Map();
    for (let i = 0; i < length; i++) {
      const key = cborDecode(buf, pos);
      pos = key.pos;
      const val = cborDecode(buf, pos);
      pos = val.pos;
      map.set(key.value, val.value);
    }
    return { value: map, pos };
  }
  if (major === 6) return cborDecode(buf, pos);
  if (major === 7) {
    if (info === 20) return { value: false, pos };
    if (info === 21) return { value: true, pos };
    if (info === 22) return { value: null, pos };
    return { value: null, pos };
  }
  throw httpError('Passkey data is not supported');
}

function coseKey(map) {
  const kty = Number(map.get(1));
  const alg = Number(map.get(3));
  if (kty === 2) {
    const x = Buffer.from(map.get(-2));
    const y = Buffer.from(map.get(-3));
    if (x.length !== 32 || y.length !== 32) throw httpError('Unsupported passkey');
    const spki = Buffer.concat([
      Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
      Buffer.from([0x04]),
      x,
      y,
    ]);
    return { alg: 'es256', key: crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }), spki };
  }
  if (kty === 3 || alg === -257) {
    const n = Buffer.from(map.get(-1));
    const e = Buffer.from(map.get(-2));
    const spki = rsaSpki(n, e);
    return { alg: 'rs256', key: crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }), spki };
  }
  throw httpError('Unsupported passkey');
}

function derLen(len) {
  if (len < 128) return Buffer.from([len]);
  if (len < 256) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 255, len & 255]);
}

function derInt(buf) {
  let body = Buffer.from(buf);
  if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0x00]), body]);
  return Buffer.concat([Buffer.from([0x02]), derLen(body.length), body]);
}

function rsaSpki(n, e) {
  const seq = Buffer.concat([derInt(n), derInt(e)]);
  const bit = Buffer.concat([Buffer.from([0x03]), derLen(seq.length + 1), Buffer.from([0x00]), seq]);
  const alg = Buffer.from('300d06092a864886f70d0101010500', 'hex');
  return Buffer.concat([Buffer.from([0x30]), derLen(alg.length + bit.length), alg, bit]);
}

function clientDataOk(buf, type, challenge, origin) {
  let json;
  try { json = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { throw httpError('Passkey response is invalid'); }
  if (json.type !== type) throw httpError('Passkey response is invalid');
  if (String(json.origin || '') !== origin) throw httpError('Passkey site does not match');
  const got = String(json.challenge || '').replace(/=+$/g, '');
  const expected = String(challenge || '').replace(/=+$/g, '');
  if (got !== expected) throw httpError('Passkey challenge expired');
  return json;
}

function parseAuthData(buf) {
  if (!buf || buf.length < 37) throw httpError('Passkey data is incomplete');
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32];
  const signCount = buf.readUInt32BE(33);
  let pos = 37;
  let credentialId = null;
  let publicKey = null;
  if (flags & 0x40) {
    if (buf.length < pos + 18) throw httpError('Passkey data is incomplete');
    pos += 16;
    const credLen = buf.readUInt16BE(pos);
    pos += 2;
    credentialId = Buffer.from(buf.subarray(pos, pos + credLen));
    pos += credLen;
    const decoded = cborDecode(buf, pos);
    publicKey = decoded.value;
    pos = decoded.pos;
  }
  return { rpIdHash, flags, signCount, credentialId, publicKey, pos };
}

function verifySig(alg, key, authData, clientData, signature) {
  const hash = crypto.createHash('sha256').update(clientData).digest();
  const signed = Buffer.concat([authData, hash]);
  if (alg === 'es256') {
    if (signature.length === 64) {
      return crypto.verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, signature);
    }
    return crypto.verify('sha256', signed, key, signature);
  }
  return crypto.verify('sha256', signed, key, signature);
}

function registrationOptions(user, req) {
  const origin = originOf(req);
  const rpId = new URL(origin).hostname;
  const challenge = crypto.randomBytes(32);
  const id = putChallenge('register', { userId: user.id, origin, rpId, challenge: b64url(challenge) });
  return {
    challengeId: id,
    publicKey: {
      challenge: b64url(challenge),
      rp: { name: 'Nebula', id: rpId },
      user: {
        id: b64url(Buffer.from(user.id)),
        name: user.username,
        displayName: user.displayName || user.username,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      timeout: 60000,
      attestation: 'none',
    },
  };
}

function registerPasskey(user, body, req) {
  const row = readChallenge(body && body.challengeId, 'register');
  if (!row || row.userId !== user.id) throw httpError('Passkey setup expired. Try again.');
  const credential = body.credential || {};
  const clientData = fromB64url(credential.clientDataJSON);
  const attestation = fromB64url(credential.attestationObject);
  clientDataOk(clientData, 'webauthn.create', row.challenge, row.origin);
  const decoded = cborDecode(attestation);
  const authData = Buffer.from(decoded.value.get('authData'));
  const parsed = parseAuthData(authData);
  const expected = crypto.createHash('sha256').update(row.rpId).digest();
  if (!parsed.rpIdHash.equals(expected)) throw httpError('Passkey site does not match');
  if ((parsed.flags & 0x01) === 0 || (parsed.flags & 0x40) === 0) throw httpError('Passkey was not verified');
  const cose = coseKey(parsed.publicKey);
  const id = b64url(parsed.credentialId);
  if (!Array.isArray(user.passkeys)) user.passkeys = [];
  if (user.passkeys.some((item) => item.id === id)) throw httpError('That passkey is already saved');
  if (user.passkeys.length >= 8) throw httpError('You can save 8 passkeys');
  user.passkeys.push({
    id,
    publicKey: b64url(cose.spki),
    alg: cose.alg,
    signCount: parsed.signCount,
    name: 'Passkey',
    createdAt: new Date().toISOString(),
    lastUsed: Date.now(),
  });
  dropChallenge(body.challengeId);
  return user.passkeys[user.passkeys.length - 1];
}

function removePasskey(user, id) {
  if (!Array.isArray(user.passkeys)) return false;
  const before = user.passkeys.length;
  user.passkeys = user.passkeys.filter((item) => item.id !== id);
  return user.passkeys.length !== before;
}

function loginOptions(req, user) {
  const origin = originOf(req);
  const rpId = new URL(origin).hostname;
  const challenge = crypto.randomBytes(32);
  const id = putChallenge('login', {
    userId: user ? user.id : '',
    origin,
    rpId,
    challenge: b64url(challenge),
  });
  const publicKey = {
    challenge: b64url(challenge),
    timeout: 60000,
    rpId,
    userVerification: 'preferred',
  };
  if (user && Array.isArray(user.passkeys) && user.passkeys.length) {
    publicKey.allowCredentials = user.passkeys.map((item) => ({
      type: 'public-key',
      id: item.id,
    }));
  }
  return { challengeId: id, publicKey };
}

function loginPasskey(users, body) {
  const row = readChallenge(body && body.challengeId, 'login');
  if (!row) throw httpError('Passkey sign-in expired. Try again.');
  const credential = body.credential || {};
  const id = String(credential.id || '');
  let owner = null;
  let passkey = null;
  const pool = row.userId
    ? [users[row.userId]].filter(Boolean)
    : Object.values(users);
  for (const user of pool) {
    const found = (user.passkeys || []).find((item) => item.id === id);
    if (found) {
      owner = user;
      passkey = found;
      break;
    }
  }
  if (!owner || !passkey) throw httpError('No passkey matches this account');
  const clientData = fromB64url(credential.clientDataJSON);
  const authData = fromB64url(credential.authenticatorData);
  const signature = fromB64url(credential.signature);
  clientDataOk(clientData, 'webauthn.get', row.challenge, row.origin);
  const parsed = parseAuthData(authData);
  const expected = crypto.createHash('sha256').update(row.rpId).digest();
  if (!parsed.rpIdHash.equals(expected)) throw httpError('Passkey site does not match');
  if ((parsed.flags & 0x01) === 0) throw httpError('Passkey was not verified');
  const key = crypto.createPublicKey({ key: fromB64url(passkey.publicKey), format: 'der', type: 'spki' });
  if (!verifySig(passkey.alg, key, authData, clientData, signature)) throw httpError('Passkey was rejected');
  if (passkey.signCount && parsed.signCount && parsed.signCount <= passkey.signCount) {
    throw httpError('Passkey was rejected');
  }
  passkey.signCount = parsed.signCount;
  passkey.lastUsed = Date.now();
  dropChallenge(body.challengeId);
  return owner;
}

return {
  hotp,
  matchTotp,
  deviceLabel,
  sealToken,
  ensureSessions,
  sessionCount,
  openSession,
  findSession,
  removeSession,
  summary,
  beginTotp,
  confirmTotp,
  disableTotp,
  checkTotp,
  mfaTicket,
  mfaUserId,
  takeMfa,
  dropChallenge,
  registrationOptions,
  registerPasskey,
  removePasskey,
  loginOptions,
  loginPasskey,
};
})();

const PORT = 3850;

function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

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

const sealedFiles = new Set([USERS_FILE, DMS_FILE, FRIENDS_FILE, MESSAGES_FILE]);
const reseal = new Set();
let dataKeyCache = null;
function dataKey() {
  if (dataKeyCache) return dataKeyCache;
  const keyFile = path.join(__dirname, '.data-key');
  try {
    if (fs.existsSync(keyFile)) {
      const buf = Buffer.from(String(fs.readFileSync(keyFile, 'utf8')).trim(), 'base64');
      if (buf.length === 32) {
        dataKeyCache = buf;
        return buf;
      }
    }
  } catch (_) {}
  const created = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, created.toString('base64') + '\n', { mode: 0o600 });
  dataKeyCache = created;
  return created;
}
function isSealedFile(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 32 && buf.subarray(0, 4).toString('utf8') === 'NEB1';
}
function sealBytes(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([Buffer.from('NEB1'), iv, cipher.getAuthTag(), enc]);
}
function openSealedBytes(buf) {
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(16, 32);
  const enc = buf.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
function sealJson(data) {
  return sealBytes(Buffer.from(JSON.stringify(data), 'utf8'));
}
function openSealed(buf) {
  return JSON.parse(openSealedBytes(buf).toString('utf8'));
}
function fileBody(file, data) {
  return sealedFiles.has(file) ? sealJson(data) : JSON.stringify(data);
}
function load(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const buf = fs.readFileSync(file);
    if (sealedFiles.has(file)) {
      if (isSealedFile(buf)) return openSealed(buf);
      const text = buf.toString('utf8').trim();
      if (text.startsWith('{') || text.startsWith('[')) {
        reseal.add(file);
        return JSON.parse(text);
      }
    } else {
      return JSON.parse(buf.toString('utf8'));
    }
  } catch (err) {
    if (sealedFiles.has(file) && fs.existsSync(file)) {
      console.log('Could not open ' + path.basename(file) + '. Keep .data-key next to server.js. The file was not replaced.');
      process.exit(1);
    }
  }
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
function saveNow(file, data) {
  dirtyFiles.set(file, data);
  const tmp = file + '.tmp';
  const body = fileBody(file, data);
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
  dirtyFiles.delete(file);
  if (file === MESSAGES_FILE) shipMessages(body);
}
async function flushSaves() {
  const batch = [...dirtyFiles.entries()];
  dirtyFiles.clear();
  saveSoon = false;
  for (const [file, payload] of batch) {
    const tmp = file + '.tmp';
    try {
      const body = fileBody(file, payload);
      await fs.promises.writeFile(tmp, body);
      await fs.promises.rename(tmp, file);
      if (file === MESSAGES_FILE) shipMessages(body);
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
let hub = null;
function touchProfiles() {
  profileRev += 1;
  for (const waiter of [...pulseWaiters]) waiter.finish();
  if (hub) hub.all('PROFILES', { profiles: String(profileRev) });
}
function touchAlerts() {
  alertRev += 1;
  for (const waiter of [...pulseWaiters]) {
    if (waiter.alert) waiter.finish();
  }
  if (hub) hub.all('ALERT', { cursor: String(alertRev) });
}
function pushVoice() {
  if (!hub || typeof app.locals.voiceSnapshot !== 'function') return;
  hub.all('VOICE', (user) => {
    try { return app.locals.voiceSnapshot(user); } catch (_) { return null; }
  });
}
function wakePulse(roomId) {
  for (const waiter of pulseWaiters) {
    if (waiter.roomId === roomId) waiter.finish();
  }
}
function publishCreate(roomId, msg) {
  wakePulse(roomId);
  if (hub) hub.room(roomId, 'MESSAGE_CREATE', (user) => ({ roomId, message: presentMessage(msg, user.id) }));
  noteBotMessage(msg);
}
function publishUpdate(roomId, msg) {
  wakePulse(roomId);
  if (hub) hub.room(roomId, 'MESSAGE_UPDATE', (user) => ({ roomId, message: presentMessage(msg, user.id) }));
}
function publishDelete(roomId, id) {
  wakePulse(roomId);
  if (hub) hub.room(roomId, 'MESSAGE_DELETE', () => ({ roomId, id }));
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
      u.nameFont || '',
      u.profileStyle || '',
      Array.isArray(u.nameColors) ? u.nameColors.join(',') : '',
      Array.isArray(u.profileColors) ? u.profileColors.join(',') : '',
      u.songUrl || '',
      String(u.songStart || 0),
      u.songAutoplay ? '1' : '',
      u.songFile || '',
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
  if (hub) hub.guild(g.id, 'MEMBERS', { serverId: g.id });
}
let codes = load(CODES_FILE, {});
let friendGraph = load(FRIENDS_FILE, {});
let dmThreads = load(DMS_FILE, {});
if (reseal.has(USERS_FILE)) saveNow(USERS_FILE, users);
if (reseal.has(DMS_FILE)) saveNow(DMS_FILE, dmThreads);
if (reseal.has(FRIENDS_FILE)) saveNow(FRIENDS_FILE, friendGraph);
if (reseal.has(MESSAGES_FILE)) saveNow(MESSAGES_FILE, messages);
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const CALLS_FILE = path.join(DATA_DIR, 'calls.json');
const THREADS_FILE = path.join(DATA_DIR, 'threads.json');
const READS_FILE = path.join(DATA_DIR, 'reads.json');
let groups = load(GROUPS_FILE, {});
let threads = load(THREADS_FILE, {});
let reads = load(READS_FILE, {});

let accountsChanged = false;
for (const u of Object.values(users)) {
  if (!u) continue;
  if (Object.prototype.hasOwnProperty.call(u, 'passwordPlain')) {
    delete u.passwordPlain;
    accountsChanged = true;
  }
  if (u.email && String(u.email).includes('@')) {
    const clean = String(u.email).trim().toLowerCase();
    if (u.email !== clean) {
      u.email = clean;
      accountsChanged = true;
    }
    if (!emailMatches(clean, u.emailSalt, u.emailHash)) {
      const sealed = emailRecord(clean);
      u.emailSalt = sealed.emailSalt;
      u.emailHash = sealed.emailHash;
      accountsChanged = true;
    }
  }
  if (u.token && !String(u.token).startsWith('sha256$')) {
    u.token = security.sealToken(u.token);
    accountsChanged = true;
  }
  for (const row of u.sessions || []) {
    if (!row) continue;
    if ('label' in row || 'ua' in row) {
      delete row.label;
      delete row.ua;
      accountsChanged = true;
    }
    if (row.token && !String(row.token).startsWith('sha256$')) {
      row.token = security.sealToken(row.token);
      accountsChanged = true;
    }
  }
  for (const row of u.passkeys || []) {
    if (!row || !row.name || row.name === 'Passkey') continue;
    row.name = 'Passkey';
    accountsChanged = true;
  }
}
if (accountsChanged) saveNow(USERS_FILE, users);
let codesChanged = false;
for (const entry of Object.values(codes)) {
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'passwordPlain')) {
    delete entry.passwordPlain;
    codesChanged = true;
  }
}
for (const key of Object.keys(codes)) {
  if (String(key).includes('@')) {
    delete codes[key];
    codesChanged = true;
  }
}
if (codesChanged) saveNow(CODES_FILE, codes);

const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

function ensureFriendNode(userId) {
  const key = String(userId);
  if (!friendGraph[key]) {
    friendGraph[key] = { friends: [], incoming: [], outgoing: [], blocked: [] };
  }
  const node = friendGraph[key];
  node.friends = Array.isArray(node.friends) ? node.friends.map(String) : [];
  node.incoming = Array.isArray(node.incoming) ? node.incoming.map(String) : [];
  node.outgoing = Array.isArray(node.outgoing) ? node.outgoing.map(String) : [];
  node.blocked = Array.isArray(node.blocked) ? node.blocked.map(String) : [];
  return node;
}

function isBlocked(a, b) {
  if (!a || !b) return false;
  const left = ensureFriendNode(a);
  const right = ensureFriendNode(b);
  return left.blocked.includes(String(b)) || right.blocked.includes(String(a));
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

sealedFiles.add(GUILDS_FILE);
let guilds = load(GUILDS_FILE, { servers: {} });
if (reseal.has(GUILDS_FILE)) saveNow(GUILDS_FILE, guilds);

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
  return { id: 'og', name: 'OG', color: '#e3b34c', permissions: PERM.VIEW | PERM.SEND | PERM.INVITE, position: 40 };
}

function grantOfficialPerks(user, member) {
  if (!user || user.bot || !member) return false;
  let changed = false;
  member.roles = Array.isArray(member.roles) ? member.roles : ['everyone'];
  if (!member.roles.includes('everyone')) member.roles.push('everyone');
  if (!member.roles.includes('og')) {
    member.roles.push('og');
    changed = true;
  }
  if (!Array.isArray(user.badges)) user.badges = [];
  if (!user.badges.includes('early')) {
    user.badges.push('early');
    changed = true;
  }
  if (Array.isArray(user.shownBadges) && !user.shownBadges.includes('early')) {
    user.shownBadges.push('early');
    changed = true;
  }
  return changed;
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
  if (isRootAccount(target) && actor.id !== target.id) return false;
  if (isOwner(g, target) && actor.id !== target.id) return false;
  if (isOwner(g, actor)) return true;
  return powerRank(g, actor) > powerRank(g, target);
}

var botJoinReady = false;

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
  if (!g.iconUrl) g.iconUrl = './logo.webp';
  g.members = g.members || {};
  g.invites = g.invites || {};
  if (!g.roles.some((r) => r.id === 'everyone')) g.roles.unshift(everyoneRole());
  if (!g.roles.some((r) => r.id === 'owner')) g.roles.push(ownerRole());
  if (!g.roles.some((r) => r.id === 'og')) g.roles.push(ogRole());
  const og = g.roles.find((r) => r.id === 'og');
  if (og) og.name = 'OG';
  for (const fresh of [adminRole(), managerRole(), moderatorRole(), developerRole()]) {
    const role = g.roles.find((r) => r.id === fresh.id);
    if (!role) {
      g.roles.push(fresh);
      continue;
    }
    role.name = fresh.name;
    role.permissions = fresh.permissions;
    if (role.position == null) role.position = fresh.position;
    if (!role.color) role.color = fresh.color;
  }
  let perksChanged = false;
  for (const u of Object.values(users)) {
    if (!u) continue;
    if (!g.members[u.id]) {
      if ((g.bans && g.bans[u.id]) || (g.kicked && g.kicked[u.id])) continue;
      g.members[u.id] = { roles: ['everyone'], joinedAt: u.createdAt || new Date().toISOString() };
      if (botJoinReady && !u.bot) noteBotJoin(g, u);
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
    if (g.members[u.id] && grantOfficialPerks(u, g.members[u.id])) perksChanged = true;
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
  if (perksChanged) save(USERS_FILE, users);
}

function hydrateGuild(g) {
  if (!g.categories) g.categories = [];
  if (!g.emoji) g.emoji = [];
  if (!g.stickers) g.stickers = [];
  if (!g.events) g.events = [];
  if (!Array.isArray(g.links)) g.links = [];
  if (g.hideMembers == null) g.hideMembers = false;
  if (!g.tagColor) g.tagColor = '';
  if (!g.rulesChannelId) g.rulesChannelId = '';
  if (!g.lobby || typeof g.lobby !== 'object') g.lobby = defaultLobby();
  if (!g.bans) g.bans = {};
  if (!g.kicked) g.kicked = {};
  if (!g.voiceBans) g.voiceBans = {};
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
  if (g.tagIcon == null) g.tagIcon = '';
  if (g.vanity == null) g.vanity = '';
  if (g.id === OFFICIAL_ID) g.vanity = 'nebula';
  if (g.iconUrl == null) g.iconUrl = '';
  if (g.bannerUrl == null) g.bannerUrl = '';
  if (!g.lockedUntil) g.lockedUntil = 0;
  if (!Array.isArray(g.webhooks)) g.webhooks = [];
  if (g.showLobby == null) g.showLobby = false;
  if (g.discover == null) g.discover = true;
  if (g.discover && !g.roomKey) g.roomKey = crypto.randomBytes(32).toString('base64');
  if (g.discover === false) g.roomKey = '';
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

const TAG_ICONS = ['⚡', '💜', '💎', '🔥', '🌸', '💧', '💙', '🍃', '❤️', '💖', '⭐', '👑', '💀', '👻', '🌙', '☀️', '✨', '🍄', '🐾', '🎵', '🎮', '⚔️', '🛡️', '🐱', '🐰', '☁️', '🌈', '❄️', '🎃', '🦋', '🐟', '🪐', '🍀', '♥', '★', '☆', '♡', '✦'];
const RESERVED_LINKS = new Set(['api', 'invite', 'assets', 'files', 'uploads', 'index', 'nebula', 'sw']);

function memberCount(g) {
  return Object.keys((g && g.members) || {}).length;
}

function canCustomize(g) {
  return !!g && (g.id === OFFICIAL_ID || memberCount(g) >= 5);
}

function cleanTag(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

const LOBBY_IDS = ['top', 'about', 'channels', 'live', 'giveaways', 'feed', 'faq', 'leaderboard', 'roles', 'rules', 'staff', 'links'];
const LOBBY_SIDE = new Set(['leaderboard', 'roles', 'rules', 'staff', 'links']);

function defaultLobby() {
  return {
    tagline: '',
    buttons: [],
    channelIds: [],
    faqs: [],
    boards: ['week'],
    showBots: false,
    hiddenIds: [],
    feedName: '',
    feedId: '',
    feedToken: '',
    posts: [],
    sections: LOBBY_IDS.map((id) => ({ id, on: true, place: LOBBY_SIDE.has(id) ? 'side' : 'main' })),
  };
}

function sanitizeLobby(raw, prev) {
  const base = defaultLobby();
  const src = raw && typeof raw === 'object' ? raw : {};
  const old = prev && typeof prev === 'object' ? prev : {};
  const clip = (v, n) => String(v || '').slice(0, n);
  base.tagline = clip(src.tagline != null ? src.tagline : old.tagline, 120);
  base.buttons = (Array.isArray(src.buttons) ? src.buttons : []).slice(0, 4).map((button) => ({
    label: clip(button.label, 32).trim(),
    kind: button.kind === 'channel' ? 'channel' : 'url',
    url: clip(button.url, 200).trim(),
    channelId: clip(button.channelId, 80),
  })).filter((button) => button.label && (button.kind === 'channel' ? button.channelId : /^https:\/\//i.test(button.url)));
  base.channelIds = (Array.isArray(src.channelIds) ? src.channelIds : []).map((id) => clip(id, 80)).filter(Boolean).slice(0, 6);
  base.faqs = (Array.isArray(src.faqs) ? src.faqs : []).slice(0, 10).map((item) => ({
    q: clip(item.q, 160).trim(),
    a: clip(item.a, 600).trim(),
  })).filter((item) => item.q);
  const boards = (Array.isArray(src.boards) ? src.boards : []).filter((id) => ['levels', 'week', 'invites'].includes(id));
  base.boards = boards.length ? boards : ['week'];
  base.showBots = !!src.showBots;
  base.hiddenIds = (Array.isArray(src.hiddenIds) ? src.hiddenIds : []).map((id) => clip(id, 80)).filter(Boolean).slice(0, 40);
  base.feedName = clip(src.feedName != null ? src.feedName : old.feedName, 60);
  base.feedId = old.feedId || '';
  base.feedToken = old.feedToken || '';
  base.posts = Array.isArray(old.posts) ? old.posts.slice(0, 20) : [];
  const seen = new Set();
  const sections = [];
  for (const row of Array.isArray(src.sections) ? src.sections : []) {
    if (!LOBBY_IDS.includes(row.id) || seen.has(row.id) || row.id === 'top') continue;
    seen.add(row.id);
    sections.push({ id: row.id, on: row.on !== false, place: row.place === 'side' ? 'side' : 'main' });
  }
  for (const id of LOBBY_IDS) {
    if (id === 'top' || seen.has(id)) continue;
    sections.push({ id, on: true, place: LOBBY_SIDE.has(id) ? 'side' : 'main' });
  }
  base.sections = [{ id: 'top', on: true, place: 'main' }, ...sections];
  return base;
}

function publicLobby(g) {
  const lobby = g.lobby && typeof g.lobby === 'object' ? g.lobby : defaultLobby();
  return {
    tagline: lobby.tagline || '',
    buttons: lobby.buttons || [],
    channelIds: lobby.channelIds || [],
    faqs: lobby.faqs || [],
    boards: lobby.boards || ['week'],
    showBots: !!lobby.showBots,
    feedName: lobby.feedName || '',
    posts: (lobby.posts || []).slice(0, 12).map((post) => ({
      title: post.title || '',
      text: post.text || '',
      url: post.url || '',
      image: post.image || '',
    })),
    sections: lobby.sections || defaultLobby().sections,
  };
}

const FEED_HOSTS = ['youtube.com', 'youtu.be', 'ytimg.com', 'twitch.tv', 'jtvnw.net', 'imgur.com', 'discordapp.com', 'discordapp.net', 'nebulaapp.space'];

function hostOk(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return FEED_HOSTS.some((item) => host === item || host.endsWith('.' + item));
  } catch (_) {
    return false;
  }
}

function cleanSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
}

function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (let i = 0; i < 8; i += 1) {
    const bytes = crypto.randomBytes(9);
    let code = '';
    for (let n = 0; n < bytes.length; n += 1) code += alphabet[bytes[n] % alphabet.length];
    const want = code.toLowerCase();
    if (RESERVED_LINKS.has(want)) continue;
    const taken = Object.values(guilds.servers || {}).some((g) =>
      (g.vanity && String(g.vanity).toLowerCase() === want) ||
      (g.invites && Object.keys(g.invites).some((item) => String(item).toLowerCase() === want)));
    if (!taken) return code;
  }
  return crypto.randomBytes(6).toString('hex');
}

function inviteRecordKey(g, key) {
  if (!g || !g.invites || !key) return '';
  if (g.invites[key]) return key;
  const want = String(key).toLowerCase();
  return Object.keys(g.invites).find((code) => String(code).toLowerCase() === want) || '';
}

function findByInvite(slug) {
  const key = cleanSlug(slug);
  if (!key) return null;
  for (const g of Object.values(guilds.servers || {})) {
    if (g.vanity && String(g.vanity).toLowerCase() === key) return g;
  }
  for (const g of Object.values(guilds.servers || {})) {
    if (inviteRecordKey(g, key)) return g;
  }
  return null;
}

function showcaseOf(u) {
  if (!u || !u.showcaseServerId || !guilds.servers) return null;
  const g = guilds.servers[u.showcaseServerId];
  if (!g || !g.tag || !g.members || !g.members[u.id] || !canCustomize(g)) return null;
  return { serverId: g.id, name: g.name || '', tag: g.tag, icon: g.tagIcon || '', color: g.tagColor || '' };
}

function tagChoices(u) {
  if (!u || !guilds.servers) return [];
  const out = [];
  for (const g of Object.values(guilds.servers)) {
    if (!g || !g.tag || !g.members || !g.members[u.id] || !canCustomize(g)) continue;
    out.push({ serverId: g.id, name: g.name || '', tag: g.tag, icon: g.tagIcon || '', color: g.tagColor || '' });
  }
  return out;
}

const MANAGE_MASK = PERM.MANAGE_CHANNELS | PERM.MANAGE_ROLES | PERM.MANAGE_SERVER | PERM.ADMIN;

function isOfficialOwner(user) {
  return !!user && (Number(user.uid) === 1 || Number(user.uid) === 2);
}

function isRootAccount(user) {
  return !!user && Number(user.uid) === 1;
}

function accountHold(user) {
  if (!user || isRootAccount(user)) return '';
  if (user.deleted) return 'This account is deleted';
  if (user.disabled) return 'This account is disabled';
  if (user.globalBan) return 'This account is banned from Nebula';
  if (Number(user.suspendedUntil) > Date.now()) return 'This account is suspended';
  return '';
}

function isOwner(g, user) {
  if (!g || !user) return false;
  if (g.id === OFFICIAL_ID) return isOfficialOwner(user);
  return (g.ownerIds || []).includes(user.id);
}

function isNebulaStaff(user) {
  if (!user) return false;
  const g = guilds && guilds.servers && guilds.servers[OFFICIAL_ID];
  if (!g) return isOfficialOwner(user);
  return isOwner(g, user) || staffRank(g, user) > 0;
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
  if (isRootAccount(user) || isOwner(g, user)) return ALL_PERMS;
  let bits = 0;
  for (const role of memberRoles(g, user)) bits |= Number(role.permissions) || 0;
  if ((bits & PERM.ADMIN) && (!g || g.id !== OFFICIAL_ID || powerRank(g, user) >= 3)) return ALL_PERMS;
  return stripOfficialManage(g, user, bits);
}

function effectivePerms(g, user, channel) {
  if (isRootAccount(user)) return ALL_PERMS;
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

const SEE_MEMBERS = 2 ** 33;

function permHas(bits, flag) {
  let n = Number(bits) || 0;
  const b = Number(flag) || 0;
  if (!(b > 0) || !Number.isFinite(n)) return false;
  if (n < 0) n = n >>> 0;
  return Math.floor(n / b) % 2 === 1;
}

function canSeeMemberList(g, user) {
  if (!g || !g.hideMembers) return true;
  if (isRootAccount(user)) return true;
  if (!user || !g.members || !g.members[user.id]) return false;
  if (isOwner(g, user)) return true;
  for (const role of memberRoles(g, user)) {
    const bits = Number(role.permissions) || 0;
    if (permHas(bits, PERM.ADMIN) || permHas(bits, SEE_MEMBERS)) return true;
  }
  return false;
}

function can(g, user, perm, channel) {
  if (!g || !user || !g.members || !g.members[user.id]) return false;
  if (isRootAccount(user)) return true;
  if ((effectivePerms(g, user, channel) & perm) === perm) return true;
  if (!channel) return false;
  const manage = (basePerms(g, user) & PERM.MANAGE_CHANNELS) === PERM.MANAGE_CHANNELS;
  if (perm === PERM.VIEW && channel.private && manage) return true;
  if (perm === PERM.SEND && channel.readOnly && manage) return true;
  return false;
}

function visibleChannels(g, user) {
  return (g.channels || []).filter((c) => can(g, user, PERM.VIEW, c));
}

function serverSlug(g) {
  if (!g) return '';
  if (g.id === OFFICIAL_ID) return 'nebula';
  if (g.vanity) return String(g.vanity);
  const code = g.invites && Object.keys(g.invites)[0];
  return code || '';
}

function publicServer(g, user) {
  const listed = g.discover !== false;
  return {
    id: g.id,
    name: g.name,
    icon: g.icon || (g.name || 'S').charAt(0).toUpperCase(),
    color: (g.theme && g.theme.accent) || g.color || '#7c5cff',
    iconUrl: g.iconUrl || '',
    about: g.about || '',
    owner: user ? isOwner(g, user) : false,
    permissions: user ? basePerms(g, user) : 0,
    discover: listed,
    slug: serverSlug(g),
    roomKey: listed ? (g.roomKey || '') : '',
    memberCount: memberCount(g),
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

function memberView(g, u, viewer) {
  const pub = publicUser(u, viewer);
  const roles = memberRoles(g, u).slice().sort((a, b) => (b.position || 0) - (a.position || 0));
  const top = roles.find((r) => r.id !== 'everyone' && r.id !== 'owner');
  const mem = (g.members && g.members[u.id]) || {};
  pub.roles = roles.filter((r) => r.id !== 'owner').map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position || 0, icon: r.icon || '', hoist: !!r.hoist }));
  const iconRole = roles.find((r) => r.icon && r.id !== 'everyone' && r.id !== 'here' && r.id !== 'owner');
  pub.roleIcon = iconRole ? iconRole.icon : '';
  pub.staff = staffKey(g, u);
  pub.roleColor = top && top.color ? top.color : '';
  pub.nick = mem.nick || '';
  pub.joinedAt = mem.joinedAt || '';
  pub.serverOwner = isOwner(g, u);
  return clearBotMarks(pub, u);
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

function uploadName(url) {
  const match = String(url || '').match(/\/uploads\/([A-Za-z0-9._-]+)$/);
  return match ? match[1] : '';
}

function sealChatUploads() {
  const visible = new Set();
  const keep = (url) => {
    const name = uploadName(url);
    if (name) visible.add(name);
  };
  for (const user of Object.values(users)) {
    if (!user) continue;
    keep(user.avatarUrl);
    keep(user.bannerUrl);
    keep(user.songFile);
    for (const row of [...(user.gallery || []), ...(user.stories || [])]) keep(row && row.url);
  }
  for (const server of Object.values((guilds && guilds.servers) || {})) keep(server && server.iconUrl);
  for (const group of Object.values(groups || {})) keep(group && group.iconUrl);
  const chat = new Set();
  for (const list of Object.values(messages)) {
    if (!Array.isArray(list)) continue;
    for (const msg of list) {
      for (const file of (msg && msg.files) || []) {
        const name = uploadName(file && file.url) || uploadName(file && file.poster);
        if (name && !visible.has(name) && !name.startsWith('song-')) chat.add(name);
      }
    }
  }
  for (const name of chat) {
    const full = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(full)) continue;
    const buf = fs.readFileSync(full);
    if (!buf.length || isSealedFile(buf)) continue;
    fs.writeFileSync(full, sealBytes(buf));
  }
}

ensureGuilds();
sealChatUploads();

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
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}

function checkPassword(pw, stored) {
  const text = String(stored || '');
  if (text.startsWith('scrypt$')) {
    const parts = text.split('$');
    try {
      const salt = Buffer.from(parts[1], 'base64');
      const expected = Buffer.from(parts[2], 'base64');
      const hash = crypto.scryptSync(String(pw), salt, expected.length, { N: 16384, r: 8, p: 1 });
      return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
    } catch (_) {
      return false;
    }
  }
  const old = crypto.createHash('sha256').update(String(pw) + 'discord-salt-v1').digest('hex');
  return text.length === old.length && crypto.timingSafeEqual(Buffer.from(text), Buffer.from(old));
}

function hashEmail(email, salt) {
  return crypto.scryptSync(String(email).trim().toLowerCase(), salt, 32, { N: 4096, r: 8, p: 1 }).toString('base64');
}

function emailRecord(email) {
  const salt = crypto.randomBytes(16);
  return { emailSalt: salt.toString('base64'), emailHash: hashEmail(email, salt) };
}

function emailMatches(email, saltB64, hashB64) {
  try {
    const salt = Buffer.from(String(saltB64 || ''), 'base64');
    const expected = Buffer.from(String(hashB64 || ''), 'base64');
    if (!salt.length || expected.length !== 32) return false;
    const hash = crypto.scryptSync(String(email).trim().toLowerCase(), salt, 32, { N: 4096, r: 8, p: 1 });
    return crypto.timingSafeEqual(hash, expected);
  } catch (_) {
    return false;
  }
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
  const row = {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatarColor: u.avatarColor || '#7c5cff',
    nameEffect: cleanNameEffect(u.nameEffect),
    nameFont: cleanNameFont(u.nameFont),
    nameColors: cleanNameColors(u.nameColors),
    showcase: showcaseOf(u),
    showcaseBadge: userOwnsBadge(u, u.showcaseBadge) ? u.showcaseBadge : '',
    badges: [...new Set([...(u.badges || []).filter((b) => b === 'early'), ...(signedUpForMoon(u) ? ['early'] : [])])],
    staff: staffKey(guilds.servers && guilds.servers[OFFICIAL_ID], u),
    developer: hasDeveloper(guilds.servers && guilds.servers[OFFICIAL_ID], u),
    bot: !!u.bot,
  };
  return clearBotMarks(row, u);
}

function cleanLock(lock) {
  if (!lock || lock.v !== 1 || !lock.for || typeof lock.for !== 'object') return null;
  const iv = String(lock.iv || '');
  const metaIv = String(lock.metaIv || '');
  const meta = String(lock.meta || '');
  if (iv.length < 8 || iv.length > 40 || metaIv.length < 8 || metaIv.length > 40 || meta.length < 16 || meta.length > 4000) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(iv) || !/^[A-Za-z0-9+/]+={0,2}$/.test(metaIv) || !/^[A-Za-z0-9+/]+={0,2}$/.test(meta)) return null;
  const wrap = {};
  for (const id of Object.keys(lock.for).slice(0, 400)) {
    const slot = lock.for[id] || {};
    const eph = String(slot.eph || '');
    const siv = String(slot.iv || '');
    const ct = String(slot.ct || '');
    if (eph.length < 80 || eph.length > 220 || siv.length < 8 || siv.length > 40 || ct.length < 16 || ct.length > 200) continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(eph) || !/^[A-Za-z0-9+/]+={0,2}$/.test(siv) || !/^[A-Za-z0-9+/]+={0,2}$/.test(ct)) continue;
    wrap[String(id).slice(0, 80)] = { eph, iv: siv, ct };
  }
  if (!Object.keys(wrap).length) return null;
  return { v: 1, iv, metaIv, meta, for: wrap };
}

function readFiles(body) {
  const rows = body && Array.isArray(body.files) ? body.files.slice(0, 10) : [];
  const files = [];
  for (const row of rows) {
    const url = String(row && row.url || '');
    if (!allowedFileUrl(url)) continue;
    const lock = cleanLock(row && row.lock);
    if (lock) {
      const file = { url, name: 'Encrypted file', kind: 'locked', lock };
      if (row && row.spoiler) file.spoiler = true;
      files.push(file);
      continue;
    }
    if (row && row.enc) {
      const voice = !!row.voice || row.kind === 'audio';
      const kind = voice ? 'audio' : (row.kind === 'image' || row.kind === 'video' ? row.kind : 'file');
      const name = voice ? 'Voice message' : (String(row.name || 'file').replace(/[^\w.\- ()]+/g, '').slice(0, 80) || 'file');
      const file = { url, name, kind, enc: 1 };
      if (voice) file.voice = 1;
      if (row.spoiler) file.spoiler = true;
      files.push(file);
      continue;
    }
    const name = String(row && row.name || 'file').replace(/[^\w.\- ()]+/g, '').slice(0, 80) || 'file';
    const image = /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(url);
    const video = /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(url);
    const file = { url, name, kind: image ? 'image' : video ? 'video' : 'file' };
    const poster = String(row && row.poster || '');
    if (allowedFileUrl(poster)) file.poster = poster;
    if (row && row.spoiler) file.spoiler = true;
    const alt = String(row && row.alt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (alt) file.alt = alt;
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
    const reacts = (msg.reactions || []).map((row) => row.emoji + ':' + (row.users || []).join('.')).join(',');
    const replyIds = (Array.isArray(msg.replies) && msg.replies.length ? msg.replies : (msg.reply ? [msg.reply] : []))
      .map((row) => row && row.id)
      .filter(Boolean)
      .join(',');
    return [msg.id, msg.editedAt || '', reacts, replyIds, msg.forward && msg.forward.name || '', msg.pinned ? '1' : ''].join('~');
  }).join('|');
}

function publicReactions(msg, viewerId) {
  return (msg && Array.isArray(msg.reactions) ? msg.reactions : [])
    .filter((row) => row && row.emoji && row.users && row.users.length)
    .map((row) => ({
      emoji: row.emoji,
      count: row.users.length,
      me: row.users.map(String).includes(String(viewerId)),
      users: row.users.map((id) => {
        const person = users[String(id)];
        if (!person) return { id: String(id), username: 'Someone', displayName: 'Someone', avatarUrl: '', avatarColor: '#7c5cff' };
        return {
          id: person.id,
          username: person.username,
          displayName: person.displayName || person.username,
          avatarUrl: publishedMedia(person, 'avatar') || '',
          avatarColor: person.avatarColor || '#7c5cff',
        };
      }),
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
  const id = String(roomId);
  if (id.startsWith('dm:')) {
    const ids = id.slice(3).split(':');
    return ids.map(String).includes(String(user.id));
  }
  if (id.startsWith('group:')) {
    const group = groups[id.slice(6)];
    return !!(group && (group.memberIds || []).map(String).includes(String(user.id)));
  }
  if (id.startsWith('thread:')) {
    const thread = threads[id.slice(7)];
    if (!thread) return false;
    const found = findChannel(thread.channelId, thread.serverId);
    return !!(found && can(found.guild, user, PERM.VIEW, found.channel));
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
    const rawText = String(src.content || '');
    const sealed = !!src.seal || rawText.startsWith('NEB2.');
    const text = sealed ? '' : rawText.replace(/\[\[(?:gif|sticker):[^\]]+\]\]/g, '').trim();
    const voice = (src.files || []).some((file) => file && file.kind === 'audio');
    const preview = text.slice(0, 140) || (voice ? 'Voice message' : ((src.files && src.files.length) ? 'Attachment' : (src.poll ? 'Poll' : 'Message')));
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

function readSeal(body) {
  const seal = body && body.seal;
  if (!seal || Number(seal.v) !== 1) return null;
  const iv = String(seal.iv || '');
  const data = String(seal.data || '');
  const wrap = seal.for && typeof seal.for === 'object' ? seal.for : null;
  if (!/^[A-Za-z0-9+/]{16,40}={0,2}$/.test(iv) || !/^[A-Za-z0-9+/]{16,20000}={0,2}$/.test(data) || !wrap) return { error: 'Bad message' };
  const ids = Object.keys(wrap);
  if (!ids.length || ids.length > 400) return { error: 'Bad message' };
  const clean = {};
  for (const id of ids) {
    const row = wrap[id];
    if (!row || typeof row !== 'object') return { error: 'Bad message' };
    const eph = String(row.eph || '');
    const rowIv = String(row.iv || '');
    const ct = String(row.ct || '');
    if (!cleanBoxKey(eph) || !/^[A-Za-z0-9+/]{16,40}={0,2}$/.test(rowIv) || !/^[A-Za-z0-9+/]{16,200}={0,2}$/.test(ct)) return { error: 'Bad message' };
    clean[String(id).slice(0, 80)] = { eph, iv: rowIv, ct };
  }
  return { v: 1, iv, data, for: clean };
}

function messageExtras(body) {
  let content = String(body && body.content || '').trim();
  content = content.startsWith('NEB2.') ? content.slice(0, 16000) : content.slice(0, 2000);
  const files = readFiles(body);
  let poll = null;
  if (body && body.poll) {
    poll = readPoll(body);
    if (!poll) return { error: 'Add a question and at least two answers' };
  }
  if (!content && !files.length && !poll) return { error: 'Empty message' };
  return { content, files, poll, seal: null };
}

function readWraps(body) {
  const src = body && body.wraps;
  if (!src || typeof src !== 'object') return null;
  const out = {};
  for (const [id, row] of Object.entries(src)) {
    if (!row || typeof row !== 'object') continue;
    const eph = String(row.eph || '');
    const iv = String(row.iv || '');
    const ct = String(row.ct || '');
    if (eph.length < 40 || eph.length > 400 || iv.length < 8 || iv.length > 80 || ct.length < 16 || ct.length > 800) continue;
    out[String(id).slice(0, 80)] = { eph, iv, ct };
  }
  return Object.keys(out).length ? out : null;
}

function presentMessage(msg, viewerId) {
  if (msg && msg.webhook) {
    const name = String((msg.author && (msg.author.displayName || msg.author.username)) || 'Webhook').slice(0, 80);
    const avatar = String((msg.author && msg.author.avatarUrl) || '');
    const safeAvatar = /^https?:\/\//i.test(avatar) || avatar.startsWith('/uploads/') || avatar.startsWith('/files/') ? avatar : '';
    const author = {
      id: 'wh:' + String(msg.webhookId || msg.id || 'hook'),
      username: 'webhook',
      displayName: name,
      avatarUrl: safeAvatar,
      avatarColor: '#5865f2',
      webhook: true,
    };
    const out = Object.assign({}, msg, { author, webhook: true });
    delete out.seal;
    const storedReplies = Array.isArray(out.replies) && out.replies.length ? out.replies : (out.reply ? [out.reply] : []);
    const replies = storedReplies.map(presentReply).filter(Boolean).slice(0, 5);
    out.replies = replies;
    out.reply = replies[0] || null;
    out.reactions = publicReactions(msg, viewerId);
    if (msg.poll) out.poll = publicPoll(msg.poll, viewerId);
    return out;
  }
  const live = msg && msg.authorId ? users[msg.authorId] : null;
  const base = slimAuthor(msg.author || {}) || {};
  const author = Object.assign(base, live ? slimAuthor(live) : {});
  const liveAvatar = live ? publishedMedia(live, 'avatar') : '';
  const storedAvatar = String(base.avatarUrl || '');
  author.avatarUrl = liveAvatar || (storedAvatar.startsWith('data:') ? '' : storedAvatar);
  const out = Object.assign({}, msg, { author });
  if (live && live.bot) out.bot = true;
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
  delete out.seal;
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

function isR2Url(url) {
  const cfg = r2Config();
  const value = String(url || '');
  if (cfg && value.startsWith(cfg.publicBase + '/')) return true;
  return /^https:\/\/(?:pub-[a-z0-9]+\.r2\.dev|[a-z0-9]+\.r2\.cloudflarestorage\.com)\//i.test(value);
}

function publishedMedia(u, slot) {
  const pathKey = slot === 'avatar' ? 'avatarPath' : 'bannerPath';
  const urlKey = slot === 'avatar' ? 'avatarUrl' : 'bannerUrl';
  const url = String((u && u[urlKey]) || '');
  if (isR2Url(url)) return url;
  let stored = String((u && u[pathKey]) || '').replace(/^\/+/, '');
  if (slot === 'banner') {
    const original = stored.replace(/\.(?:s)?(?:32|128|512)\.gif$/i, '.gif');
    if (original !== stored && fs.existsSync(path.join(FILES_DIR, original))) stored = original;
  }
  if (/^(avatars|banners)\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(stored)) return '/files/' + stored;
  if (url.startsWith('/files/') || url.startsWith('/uploads/')) return url;
  if (url.startsWith('data:') || url.includes('githubusercontent.com')) return '';
  return url.length > 500 ? '' : url;
}

function r2Config() {
  const accessKey = process.env.R2_ACCESS_KEY_ID || '';
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || '';
  let endpoint = String(process.env.R2_ENDPOINT || '').replace(/\/$/, '');
  let bucket = process.env.R2_BUCKET || 'nebula';
  const bucketInPath = endpoint.match(/^(https:\/\/[^/]+)\/([^/]+)$/);
  if (bucketInPath) {
    endpoint = bucketInPath[1];
    bucket = bucketInPath[2];
  }
  const publicBase = String(process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!accessKey || !secretKey || !endpoint || !publicBase) return null;
  return { accessKey, secretKey, endpoint, bucket, publicBase };
}

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

async function r2Put(cfg, key, body, type) {
  const host = new URL(cfg.endpoint).host;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const encodedKey = key.split('/').map((part) => encodeURIComponent(part)).join('/');
  const canonicalUri = '/' + cfg.bucket + '/' + encodedKey;
  const headers = {
    'cache-control': 'public, max-age=31536000, immutable',
    'content-type': type || 'application/octet-stream',
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => name + ':' + String(headers[name]).trim() + '\n').join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = dateStamp + '/auto/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + cfg.secretKey, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + cfg.accessKey + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  const res = await fetch(cfg.endpoint + canonicalUri, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Cache-Control': headers['cache-control'],
      'Content-Type': headers['content-type'],
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('R2 ' + res.status + ' ' + detail.slice(0, 180));
  }
}

async function r2Get(cfg, key) {
  const host = new URL(cfg.endpoint).host;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(Buffer.alloc(0));
  const encodedKey = key.split('/').map((part) => encodeURIComponent(part)).join('/');
  const canonicalUri = '/' + cfg.bucket + '/' + encodedKey;
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => name + ':' + String(headers[name]).trim() + '\n').join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = ['GET', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = dateStamp + '/auto/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + cfg.secretKey, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + cfg.accessKey + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  const res = await fetch(cfg.endpoint + canonicalUri, {
    method: 'GET',
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('R2 ' + res.status + ' ' + detail.slice(0, 180));
  }
  return Buffer.from(await res.arrayBuffer());
}

function shipMessages(body) {
  const cfg = r2Config();
  if (!cfg || !body) return;
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  r2Put(cfg, 'sealed/messages.bin', bytes, 'application/octet-stream')
    .then(() => { try { fs.unlinkSync(MESSAGES_FILE); } catch (_) {} })
    .catch((err) => console.log('Could not store messages in the cloud. ' + (err.message || err)));
}

async function pullCloud() {
  const cfg = r2Config();
  if (!cfg) return;
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const buf = fs.readFileSync(MESSAGES_FILE);
      const body = isSealedFile(buf) ? buf : sealJson(messages);
      await r2Put(cfg, 'sealed/messages.bin', body, 'application/octet-stream');
      fs.unlinkSync(MESSAGES_FILE);
    } else {
      const remote = await r2Get(cfg, 'sealed/messages.bin');
      if (remote && isSealedFile(remote)) {
        const data = openSealed(remote);
        if (data && typeof data === 'object') messages = data;
      }
    }
  } catch (err) {
    console.log('Cloud messages stayed on this PC. ' + (err.message || err));
  }
  if (!fs.existsSync(UPLOAD_DIR)) return;
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    const full = path.join(UPLOAD_DIR, name);
    let buf;
    try {
      if (!fs.statSync(full).isFile()) continue;
      buf = fs.readFileSync(full);
    } catch (_) { continue; }
    if (!isSealedFile(buf)) continue;
    try {
      await r2Put(cfg, 'sealed/uploads/' + name, buf, 'application/octet-stream');
      fs.unlinkSync(full);
    } catch (_) {
      console.log('Cloud file stayed on this PC: ' + name);
    }
  }
}

function mediaType(name) {
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.mp4$/i.test(name)) return 'video/mp4';
  if (/\.webm$/i.test(name)) return 'video/webm';
  if (/\.mov$/i.test(name)) return 'video/quicktime';
  return 'application/octet-stream';
}

async function saveProfileFile(user, slot, buf, ext) {
  const bucket = slot === 'avatar' ? 'avatars' : 'banners';
  const name = 'r2-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + ext;
  const rel = bucket + '/' + user.id + '/' + name;
  const cfg = r2Config();
  let url = '/files/' + rel;
  if (cfg) {
    try {
      await r2Put(cfg, rel, buf, mediaType(name));
      url = cfg.publicBase + '/' + rel;
    } catch (err) {
      const error = new Error('Cloudflare rejected that picture. ' + (err.message || 'Upload failed'));
      error.status = 502;
      throw error;
    }
  } else {
    const folder = path.join(FILES_DIR, bucket, user.id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, name), buf);
  }
  const urlKey = slot === 'avatar' ? 'avatarUrl' : 'bannerUrl';
  const pathKey = slot === 'avatar' ? 'avatarPath' : 'bannerPath';
  user[pathKey] = cfg ? '' : rel;
  user[urlKey] = url;
  return { path: user[pathKey], url };
}

async function storeUpload(buf, ext, scramble) {
  const stored = uuidv4() + ext;
  const body = scramble ? sealBytes(buf) : buf;
  const cfg = r2Config();
  if (scramble && cfg) {
    try {
      await r2Put(cfg, 'sealed/uploads/' + stored, body, 'application/octet-stream');
      return '/uploads/' + stored;
    } catch (err) {
      console.log('Cloud file store failed, kept on this PC. ' + (err.message || err));
    }
  }
  if (!cfg || scramble) {
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), body);
    return '/uploads/' + stored;
  }
  const key = 'uploads/' + stored;
  await r2Put(cfg, key, buf, mediaType(stored));
  return cfg.publicBase + '/' + key;
}

function allowedFileUrl(url) {
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(url)) return true;
  const cfg = r2Config();
  if (!cfg) return false;
  const prefix = cfg.publicBase + '/uploads/';
  return url.startsWith(prefix) && /^[A-Za-z0-9._-]+$/.test(url.slice(prefix.length));
}

async function publishExistingMedia() {
  const cfg = r2Config();
  if (!cfg) return;
  let changed = false;
  for (const user of Object.values(users)) {
    if (!user) continue;
    for (const slot of ['avatar', 'banner']) {
      const pathKey = slot === 'avatar' ? 'avatarPath' : 'bannerPath';
      const urlKey = slot === 'avatar' ? 'avatarUrl' : 'bannerUrl';
      if (isR2Url(user[urlKey])) continue;
      let rel = String(user[pathKey] || user[urlKey] || '').replace(/^\/+/, '');
      rel = rel.replace(/^files\//, '');
      if (!/^(avatars|banners)\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(rel)) continue;
      const full = path.join(FILES_DIR, rel);
      if (!fs.existsSync(full)) continue;
      try {
        await r2Put(cfg, rel, fs.readFileSync(full), mediaType(rel));
        user[urlKey] = cfg.publicBase + '/' + rel;
        user[pathKey] = '';
        changed = true;
        const dir = path.dirname(full);
        const stem = path.basename(full).replace(/\.(?:s)?(?:32|128|512)\.gif$/i, '.gif').replace(/\.gif$/i, '');
        for (const item of fs.readdirSync(dir)) {
          if (item === stem + '.gif' || item.startsWith(stem + '.')) {
            fs.unlink(path.join(dir, item), () => {});
          }
        }
        console.log('  Cloudflare has ' + rel);
      } catch (err) {
        console.log('  Cloudflare skipped ' + rel + ': ' + (err.message || err));
      }
    }
  }
  if (changed) save(USERS_FILE, users);
}

function userOwnsBadge(u, id) {
  if (!u || !id) return false;
  if (id === 'early') return (u.badges || []).includes('early') || signedUpForMoon(u);
  if (id === 'staff') return !!staffKey(guilds.servers && guilds.servers[OFFICIAL_ID], u);
  if (id === 'developer') return hasDeveloper(guilds.servers && guilds.servers[OFFICIAL_ID], u);
  return false;
}

const liveUsers = new Set();
const briefOnline = new Map();
const presenceRefresh = new Map();

function privacyMode(u) {
  if (!u) return 'everyone';
  if (u.lastSeenPrivacy === 'everyone' || u.lastSeenPrivacy === 'contacts' || u.lastSeenPrivacy === 'nobody') return u.lastSeenPrivacy;
  return u.hideLastSeen ? 'nobody' : 'everyone';
}

function friendsWith(a, b) {
  if (!a || !b) return false;
  return ensureFriendNode(a).friends.map(String).includes(String(b));
}

function pickPrivacy(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function dmPrivacyOf(u) {
  return pickPrivacy(u && u.dmPrivacy, ['everyone', 'servers', 'friends'], 'servers');
}

function groupPrivacyOf(u) {
  return pickPrivacy(u && u.groupPrivacy, ['everyone', 'mutual', 'friends', 'nobody'], 'friends');
}

function callPrivacyOf(u) {
  return pickPrivacy(u && u.callPrivacy, ['everyone', 'servers', 'friends', 'nobody'], 'everyone');
}

function linkPrivacyOf(u) {
  return pickPrivacy(u && u.linkPrivacy, ['everyone', 'servers', 'friends', 'nobody'], 'everyone');
}

function mediaPrivacyOf(u) {
  return pickPrivacy(u && u.mediaPrivacy, ['everyone', 'servers', 'friends', 'nobody'], 'everyone');
}

function storyPrivacyOf(u) {
  return pickPrivacy(u && u.storyPrivacy, ['everyone', 'servers', 'friends', 'nobody'], 'everyone');
}

function messageHasLink(content) {
  const text = String(content || '').replace(/\[\[(?:gif|sticker):[^\]]+\]\]/gi, ' ');
  if (/(?:https?:\/\/|www\.)\S+/i.test(text)) return true;
  return /(?:^|[\s(])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/i.test(text);
}

function messageHasMedia(content, files) {
  if (Array.isArray(files) && files.length) return true;
  return /\[\[(?:gif|sticker):/i.test(String(content || ''));
}

function allowsShare(sender, target, mode) {
  if (!sender || !target || String(sender.id) === String(target.id)) return true;
  if (isBlocked(sender.id, target.id)) return false;
  if (mode === 'nobody') return false;
  if (friendsWith(target.id, sender.id)) return true;
  if (mode === 'friends') return false;
  if (mode === 'servers') return sharesServer(sender.id, target.id);
  return true;
}

function shareBlockReason(kind, mode) {
  const noun = kind === 'media' ? 'media' : 'links';
  if (mode === 'nobody') return 'They are not accepting ' + noun;
  if (mode === 'friends') return 'They only accept ' + noun + ' from friends';
  if (mode === 'servers') return 'They only accept ' + noun + ' from friends and people in their servers';
  return 'You cannot send ' + noun + ' to this person';
}

function contentShareBlock(sender, targets, content, files) {
  if (String(content || '').startsWith('NEB2.')) content = '';
  const link = messageHasLink(content);
  const media = messageHasMedia(content, files);
  if (!link && !media) return '';
  for (const target of targets || []) {
    if (!target || String(target.id) === String(sender.id)) continue;
    if (media && !allowsShare(sender, target, mediaPrivacyOf(target))) return shareBlockReason('media', mediaPrivacyOf(target));
    if (link && !allowsShare(sender, target, linkPrivacyOf(target))) return shareBlockReason('links', linkPrivacyOf(target));
  }
  return '';
}

function friendOfFriend(a, b) {
  if (friendsWith(a, b)) return true;
  const theirs = new Set(ensureFriendNode(b).friends.map(String));
  return ensureFriendNode(a).friends.some((id) => theirs.has(String(id)));
}

function canMessage(sender, target) {
  if (!sender || !target || target.bot || String(sender.id) === String(target.id)) return false;
  if (isBlocked(sender.id, target.id)) return false;
  if (friendsWith(target.id, sender.id)) return true;
  const mode = dmPrivacyOf(target);
  if (mode === 'friends') return false;
  if (mode === 'servers') return sharesServer(sender.id, target.id);
  return true;
}

function messageBlockReason(target) {
  const mode = dmPrivacyOf(target);
  if (mode === 'friends') return 'They only accept messages from friends';
  if (mode === 'servers') return 'They only accept messages from friends and people in their servers';
  return 'You cannot message this person';
}

function canAddToGroup(adder, target) {
  if (!adder || !target || String(adder.id) === String(target.id)) return false;
  if (isBlocked(adder.id, target.id)) return false;
  const mode = groupPrivacyOf(target);
  if (mode === 'nobody') return false;
  if (mode === 'friends') return friendsWith(target.id, adder.id);
  if (mode === 'mutual') return friendOfFriend(target.id, adder.id);
  return true;
}

function groupBlockReason(target) {
  const mode = groupPrivacyOf(target);
  if (mode === 'nobody') return 'They do not allow anyone to add them to a group';
  if (mode === 'friends') return 'They only let friends add them to a group';
  if (mode === 'mutual') return 'They only let friends and friends of friends add them to a group';
  return 'You cannot add this person';
}

function canCall(sender, target) {
  if (!sender || !target || target.bot || String(sender.id) === String(target.id)) return false;
  if (isBlocked(sender.id, target.id)) return false;
  const mode = callPrivacyOf(target);
  if (mode === 'nobody') return false;
  if (friendsWith(target.id, sender.id)) return true;
  if (mode === 'friends') return false;
  if (mode === 'servers') return sharesServer(sender.id, target.id);
  return true;
}

function callBlockReason(target) {
  const mode = callPrivacyOf(target);
  if (mode === 'nobody') return 'They are not accepting calls';
  if (mode === 'friends') return 'They only accept calls from friends';
  if (mode === 'servers') return 'They only accept calls from friends and people in their servers';
  return 'You cannot call this person';
}

function sharesExact(owner, viewer) {
  if (!owner || !viewer) return false;
  if (String(owner.id) === String(viewer.id)) return true;
  const mode = privacyMode(owner);
  if (mode === 'nobody') return false;
  if (mode === 'contacts') return friendsWith(owner.id, viewer.id);
  return true;
}

function canSeeExact(viewer, owner) {
  return sharesExact(owner, viewer) && sharesExact(viewer, owner);
}

function effectiveStatus(u) {
  const chosen = u && u.status ? u.status : 'online';
  if (!u || chosen === 'offline') return 'offline';
  if (!liveUsers.has(String(u.id))) return 'offline';
  return chosen === 'online' ? 'online' : chosen;
}

function seenBucket(at) {
  if (!at) return 'long';
  const age = Date.now() - at;
  if (age <= 3 * 24 * 60 * 60 * 1000) return 'recent';
  if (age <= 7 * 24 * 60 * 60 * 1000) return 'week';
  if (age <= 30 * 24 * 60 * 60 * 1000) return 'month';
  return 'long';
}

function seenFor(owner, viewer) {
  const self = !viewer || String(owner.id) === String(viewer.id);
  const exact = self || canSeeExact(viewer, owner);
  const at = Number(owner.lastSeen) || 0;
  const chosen = owner.status || 'online';
  const row = briefOnline.get(String(owner.id));
  const flash = !self && viewer && row && row.until > Date.now() && row.peers.has(String(viewer.id));
  const live = chosen !== 'offline' && liveUsers.has(String(owner.id));
  if ((live || flash) && (exact || flash)) {
    const shown = live && exact ? effectiveStatus(owner) : 'online';
    const until = live ? Date.now() + 3 * 60 * 1000 : (row && row.until > Date.now() ? row.until : Date.now() + 30000);
    return { status: shown === 'offline' ? 'online' : shown, lastSeen: exact ? at : null, seen: exact ? 'exact' : 'online', onlineUntil: until };
  }
  if (!exact) return { status: 'offline', lastSeen: null, seen: seenBucket(at), onlineUntil: 0 };
  return { status: chosen === 'idle' || chosen === 'dnd' ? 'offline' : 'offline', lastSeen: at || null, seen: 'exact', onlineUntil: 0 };
}

function pushPresence(user, onlyIds) {
  if (!hub || !user) return;
  const build = (viewer) => Object.assign({ id: user.id }, seenFor(user, viewer));
  if (onlyIds) hub.users([user.id, ...onlyIds], 'PRESENCE', build);
  else hub.all('PRESENCE', build);
}

function setLive(user, online) {
  if (!user) return;
  const id = String(user.id);
  const was = liveUsers.has(id);
  if (online) {
    liveUsers.add(id);
    if (was) return;
  } else if (was) {
    liveUsers.delete(id);
    presenceRefresh.delete(id);
  } else return;
  user.lastSeen = Date.now();
  save(USERS_FILE, users);
  pushPresence(user);
}

function touchLive(user) {
  if (!user) return;
  const id = String(user.id);
  if (!liveUsers.has(id)) {
    setLive(user, true);
    return;
  }
  const now = Date.now();
  if (now - (presenceRefresh.get(id) || 0) < 40000) return;
  presenceRefresh.set(id, now);
  pushPresence(user);
}

function noteBrief(user, peerIds) {
  if (!user) return;
  const next = new Set((peerIds || []).map(String).filter((id) => id && id !== String(user.id)));
  if (!next.size) return;
  const id = String(user.id);
  const now = Date.now();
  const prev = briefOnline.get(id);
  const fresh = !prev || prev.until < now;
  let added = fresh;
  const peers = fresh ? next : new Set(prev.peers);
  if (!fresh) {
    for (const peer of next) {
      if (!peers.has(peer)) added = true;
      peers.add(peer);
    }
  }
  briefOnline.set(id, { until: now + 30000, peers });
  if (added || (prev && prev.until - now < 10000)) pushPresence(user, peers);
}

function peersOfRoom(roomId, selfId) {
  const id = String(roomId || '');
  if (id.startsWith('dm:')) return id.slice(3).split(':').filter((item) => item && item !== String(selfId));
  if (id.startsWith('group:')) {
    const group = groups[id.slice(6)];
    return ((group && group.memberIds) || []).map(String).filter((item) => item !== String(selfId));
  }
  return [];
}

function liveGallery(list) {
  const out = [];
  for (const row of Array.isArray(list) ? list : []) {
    const url = String(row && row.url || '');
    if (!allowedFileUrl(url)) continue;
    out.push({ id: String(row.id || '').slice(0, 40), url, kind: /\.(mp4|webm|mov)$/i.test(url) ? 'video' : 'image' });
  }
  return out.slice(-18);
}

function liveStories(list) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const out = [];
  for (const row of Array.isArray(list) ? list : []) {
    const url = String(row && row.url || '');
    const createdAt = Number(row && row.createdAt) || 0;
    if (!allowedFileUrl(url) || !createdAt || now - createdAt > day) continue;
    out.push({ id: String(row.id || '').slice(0, 40), url, createdAt, kind: /\.(mp4|webm|mov)$/i.test(url) ? 'video' : 'image' });
  }
  return out.slice(-8);
}

function playingName(u) {
  if (!u || u.bot || !u.activity || typeof u.activity !== 'object') return '';
  const name = String(u.activity.name || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) return '';
  if (Date.now() - Number(u.activity.at || 0) > 70000) return '';
  return name;
}

function clearBotMarks(row, u) {
  if (!row || !u || !u.bot) return row;
  row.badges = [];
  row.staff = '';
  row.developer = false;
  row.shownBadges = [];
  row.showcaseBadge = '';
  row.showcase = null;
  row.showcaseServerId = '';
  row.roleIcon = '';
  row.activity = '';
  return row;
}

function cleanBannerPos(value) {
  const src = value && typeof value === 'object' ? value : {};
  const axis = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return 50;
    return Math.max(0, Math.min(100, Math.round(num)));
  };
  return { x: axis(src.x), y: axis(src.y) };
}

function publicUser(u, viewer) {
  if (!u) return null;
  const seen = seenFor(u, viewer || u);
  const self = !viewer || String(viewer.id) === String(u.id);
  const row = {
    id: u.id,
    uid: u.uid || null,
    username: u.username,
    displayName: u.displayName || u.username,
    email: self ? String(u.email || '') : '',
    bio: String(u.bio || '').replace(/\s+/g, ' ').trim().slice(0, 29),
    aboutMe: u.aboutMe || '',
    pronouns: u.pronouns || '',
    aliases: Array.isArray(u.aliases) ? u.aliases.slice(0, 10) : [],
    status: seen.status,
    statusChoice: self ? (u.status || 'online') : undefined,
    lastSeen: seen.lastSeen,
    timezone: cleanZone(u.timezone),
    seen: seen.seen,
    onlineUntil: seen.onlineUntil,
    hideLastSeen: self ? privacyMode(u) === 'nobody' : false,
    lastSeenPrivacy: self ? privacyMode(u) : undefined,
    dmPrivacy: self ? dmPrivacyOf(u) : undefined,
    groupPrivacy: self ? groupPrivacyOf(u) : undefined,
    callPrivacy: self ? callPrivacyOf(u) : undefined,
    linkPrivacy: self ? linkPrivacyOf(u) : undefined,
    mediaPrivacy: self ? mediaPrivacyOf(u) : undefined,
    storyPrivacy: self ? storyPrivacyOf(u) : undefined,
    canMessage: self || !viewer ? undefined : canMessage(viewer, u),
    canCall: self || !viewer ? undefined : canCall(viewer, u),
    canSendLinks: self || !viewer ? undefined : allowsShare(viewer, u, linkPrivacyOf(u)),
    canSendMedia: self || !viewer ? undefined : allowsShare(viewer, u, mediaPrivacyOf(u)),
    canGroup: self || !viewer ? undefined : canAddToGroup(viewer, u),
    customStatus: u.customStatus || '',
    accentColor: u.accentColor || '#7c5cff',
    avatarColor: u.avatarColor || '#7c5cff',
    bannerColor: u.bannerColor || u.accentColor || '#7c5cff',
    avatarPath: u.avatarPath || '',
    avatarUrl: publishedMedia(u, 'avatar'),
    bannerPath: u.bannerPath || '',
    bannerUrl: publishedMedia(u, 'banner'),
    bannerPos: cleanBannerPos(u.bannerPos),
    gallery: liveGallery(u.gallery),
    stories: self || !viewer || allowsShare(viewer, u, storyPrivacyOf(u)) ? liveStories(u.stories) : [],
    serverTag: u.serverTag || '',
    nameEffect: cleanNameEffect(u.nameEffect),
    nameFont: cleanNameFont(u.nameFont),
    nameColors: cleanNameColors(u.nameColors),
    boxKey: cleanBoxKey(u.boxKey),
    profileStyle: cleanProfileStyle(u.profileStyle),
    profileColors: profileShades(u.profileColors),
    songUrl: cleanSongUrl(u.songUrl),
    songStart: cleanSongStart(u.songStart),
    songAutoplay: !!u.songAutoplay,
    songFile: cleanSongFile(u.songFile),
    songError: String(u.songError || '').slice(0, 140),
    badges: [...new Set([...(u.badges || []).filter((b) => b === 'early'), ...(signedUpForMoon(u) ? ['early'] : [])])],
    staff: staffKey(guilds.servers && guilds.servers[OFFICIAL_ID], u),
    canAdmin: isNebulaStaff(u),
    developer: hasDeveloper(guilds.servers && guilds.servers[OFFICIAL_ID], u),
    shownBadges: Array.isArray(u.shownBadges) ? u.shownBadges.filter((id) => id === 'early' || id === 'staff' || id === 'developer') : null,
    showcaseServerId: u.showcaseServerId || '',
    showcaseBadge: userOwnsBadge(u, u.showcaseBadge) ? u.showcaseBadge : '',
    showcase: showcaseOf(u),
    tagChoices: tagChoices(u),
    bot: !!u.bot,
    activity: playingName(u),
    server: SERVER_NAME,
    createdAt: u.createdAt,
    vaultPub: u.vaultPub || '',
    recovery: self ? (u.recovery || '') : undefined,
    mfa: !!(u.totp && u.totp.enabled),
    passkeyCount: Array.isArray(u.passkeys) ? u.passkeys.length : 0,
    sessionCount: security.sessionCount(u),
  };
  return clearBotMarks(row, u);
}

unpackImages();

function cleanNameEffect(value) {
  return ['plain', 'glow', 'gradient', 'rainbow', 'glitch', 'sparkle'].includes(value) ? value : '';
}

function cleanBoxKey(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9+/]{80,220}={0,2}$/.test(text)) return '';
  return text;
}

function cleanBoxSecret(value) {
  if (!value || typeof value !== 'object') return null;
  const d = String(value.d || '').trim();
  const x = String(value.x || '').trim();
  const y = String(value.y || '').trim();
  if (value.kty !== 'EC' || value.crv !== 'P-256') return null;
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(d)) return null;
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(x) || !/^[A-Za-z0-9_-]{20,120}$/.test(y)) return null;
  return { kty: 'EC', crv: 'P-256', d, x, y, ext: true, key_ops: ['deriveBits'] };
}

function cleanBoxRing(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const row of value) {
    const pub = cleanBoxKey(row && row.pub);
    const priv = cleanBoxSecret(row && row.priv);
    if (!pub || !priv || seen.has(pub)) continue;
    seen.add(pub);
    out.push({ pub, priv });
    if (out.length >= 6) break;
  }
  return out;
}

function withRing(u) {
  const pub = publicUser(u);
  pub.boxRing = cleanBoxRing(u && u.boxRing);
  return pub;
}

function cleanNameFont(value) {
  return ['serif', 'mono', 'round', 'script', 'display'].includes(value) ? value : '';
}

function cleanProfileStyle(value) {
  return ['solid', 'glow', 'rainbow'].includes(value) ? value : 'gradient';
}

function cleanSongStart(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  let sec = 0;
  if (/^\d+$/.test(raw)) sec = Number(raw);
  else {
    const clock = raw.match(/^(?:(\d+):)?(\d+):(\d+)$/);
    if (clock) sec = Number(clock[1] || 0) * 3600 + Number(clock[2] || 0) * 60 + Number(clock[3] || 0);
  }
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return Math.min(Math.floor(sec), 21600);
}

function youtubeVideoId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { return ''; }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id = '';
  if (host === 'youtu.be') id = (url.pathname.split('/').filter(Boolean)[0] || '');
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    id = url.searchParams.get('v') || '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (!id && (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live')) id = parts[1] || '';
  }
  id = String(id).replace(/[^A-Za-z0-9_-]/g, '');
  return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : '';
}

function cleanZone(value) {
  const zone = String(value || '').trim().slice(0, 80);
  if (!zone) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return '';
  }
}

function cleanSongUrl(value) {
  const id = youtubeVideoId(value);
  return id ? 'https://www.youtube.com/watch?v=' + id : '';
}

function cleanSongFile(value) {
  const raw = String(value || '');
  return /^\/uploads\/song-[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(raw) ? raw : '';
}

function deleteSongPath(urlPath) {
  const clean = cleanSongFile(urlPath);
  if (!clean) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(clean)), () => {});
}

const SONG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function requestText(url, options, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('Could not save that song'));
      return;
    }
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: options.headers || { 'User-Agent': SONG_UA },
    }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        requestText(new URL(res.headers.location, url).href, options, redirects + 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: code, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Could not save that song')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function youtubeAudioChoice(videoId) {
  const clients = [
    { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '18.3.2.22D82', hl: 'en', gl: 'US' },
    { clientName: 'ANDROID', clientVersion: '19.28.35', androidSdkVersion: 30, hl: 'en', gl: 'US' },
    { clientName: 'WEB', clientVersion: '2.20241120.01.00', hl: 'en', gl: 'US' },
  ];
  let reason = 'Could not save that song';
  for (const client of clients) {
    const sent = await requestText('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': SONG_UA,
        Cookie: 'CONSENT=YES+1; SOCS=CAI',
      },
      body: JSON.stringify({ context: { client }, videoId, contentCheckOk: true, racyCheckOk: true }),
    });
    let data = {};
    try { data = JSON.parse(sent.body.toString('utf8')); } catch (_) {}
    const status = data.playabilityStatus && data.playabilityStatus.status;
    if (status && status !== 'OK') {
      reason = data.playabilityStatus.reason || reason;
      continue;
    }
    const seconds = Number(data.videoDetails && data.videoDetails.lengthSeconds) || 0;
    if (seconds > 900) throw new Error('That video is too long to save');
    const formats = [...((data.streamingData && data.streamingData.adaptiveFormats) || []), ...((data.streamingData && data.streamingData.formats) || [])];
    const audio = formats.filter((item) => item && item.url && String(item.mimeType || '').startsWith('audio/'));
    audio.sort((a, b) => (String(a.mimeType).includes('mp4') ? 0 : 1) - (String(b.mimeType).includes('mp4') ? 0 : 1) || (b.bitrate || 0) - (a.bitrate || 0));
    if (audio[0]) return audio[0];
  }
  throw new Error(String(reason || 'Could not save that song').slice(0, 140));
}

function audioExt(mime) {
  const kind = String(mime || '');
  if (kind.includes('webm')) return '.webm';
  if (kind.includes('mpeg')) return '.mp3';
  return '.m4a';
}

function saveHttp(url, dest, redirects = 0, headers) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('Could not save that song'));
      return;
    }
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: Object.assign({ 'User-Agent': SONG_UA }, headers || {}) }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        saveHttp(new URL(res.headers.location, url).href, dest, redirects + 1, headers).then(resolve, reject);
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error('Could not save that song'));
        return;
      }
      const len = Number(res.headers['content-length'] || 0);
      if (len > 80 * 1024 * 1024) {
        res.resume();
        reject(new Error('Could not save that song'));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Could not save that song')));
  });
}

function runFile(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 180000, windowsHide: false, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        reject(err);
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

function ytDlpAsset() {
  if (process.platform === 'win32') {
    return { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', file: 'yt-dlp.exe' };
  }
  if (process.platform === 'darwin') {
    return { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos', file: 'yt-dlp' };
  }
  const name = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + name, file: 'yt-dlp' };
}

let ytDlpReady = null;
function bundledYtDlp() {
  if (ytDlpReady) return ytDlpReady;
  ytDlpReady = (async () => {
    const asset = ytDlpAsset();
    const dir = path.join(DATA_DIR, 'bin');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, asset.file);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000000) {
      const tmp = dest + '.part';
      await saveHttp(asset.url, tmp);
      fs.renameSync(tmp, dest);
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    }
    await runFile(dest, ['--version']);
    return dest;
  })().catch((err) => {
    ytDlpReady = null;
    throw err;
  });
  return ytDlpReady;
}

async function downloadWithYtDlp(pageUrl, destBase) {
  const bin = await bundledYtDlp();
  const browsers = ['chrome', 'edge', 'brave', 'firefox', 'chromium'];
  const tries = [[], ...browsers.map((name) => ['--cookies-from-browser', name])];
  let needsSignIn = false;
  for (const extra of tries) {
    try {
      await runFile(bin, [
        '--no-playlist',
        '--no-warnings',
        '--no-progress',
        '--no-cache-dir',
        '--force-overwrites',
        '--js-runtimes', 'node',
        '--max-filesize', '25M',
        '--match-filter', 'duration < 900',
        '-f', 'ba[ext=m4a][abr<=128]/ba[abr<=128]/ba[ext=m4a]/ba',
        '-o', destBase + '.%(ext)s',
        ...extra,
        pageUrl,
      ]);
    } catch (err) {
      const detail = String((err && err.stderr) || err.message || '');
      if (/does not pass filter|duration/i.test(detail)) throw new Error('That video is too long to save');
      if (/unavailable|private video|removed/i.test(detail)) throw new Error('That video is not available');
      if (/not a bot|Sign in to confirm|cookies/i.test(detail)) {
        needsSignIn = true;
        continue;
      }
      if (extra.length) continue;
      throw new Error('Could not save that song');
    }
    const base = path.basename(destBase);
    const found = fs.readdirSync(UPLOAD_DIR).find((name) => name.startsWith(base + '.') && !/\.(part|ytdl)$/i.test(name)) || '';
    if (found && fs.statSync(path.join(UPLOAD_DIR, found)).size > 1000) return found;
  }
  if (needsSignIn) throw new Error('Sign in to YouTube in Chrome or Edge, then save the link again');
  throw new Error('Could not save that song');
}

async function downloadDirect(pageUrl, destBase) {
  const format = await youtubeAudioChoice(youtubeVideoId(pageUrl));
  const dest = destBase + audioExt(format.mimeType);
  await saveHttp(format.url, dest, 0, { 'User-Agent': SONG_UA, Referer: 'https://www.youtube.com/' });
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) throw new Error('Could not save that song');
  return path.basename(dest);
}

async function downloadSongAudio(pageUrl, destBase) {
  try {
    return await downloadDirect(pageUrl, destBase);
  } catch (err) {
    if (err && err.message === 'That video is too long to save') throw err;
    for (const ext of ['.m4a', '.webm', '.mp3', '.opus', '.part']) fs.unlink(destBase + ext, () => {});
  }
  return downloadWithYtDlp(pageUrl, destBase);
}

const songQueue = [];
let songBusy = false;

function enqueueSong(userId) {
  const id = String(userId || '');
  if (!id || songQueue.includes(id)) return;
  songQueue.push(id);
  pumpSongs();
}

function pumpSongs() {
  if (songBusy) return;
  const id = songQueue.shift();
  if (!id) return;
  const user = users[id];
  if (!user) {
    pumpSongs();
    return;
  }
  songBusy = true;
  saveUserSong(user).finally(() => {
    songBusy = false;
    pumpSongs();
  });
}

async function saveUserSong(user) {
  const job = user.songJob;
  const pageUrl = cleanSongUrl(user.songUrl);
  if (!pageUrl || user.songJob !== job) return;
  const destBase = path.join(UPLOAD_DIR, 'song-' + String(user.id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + job);
  try {
    const filename = await downloadSongAudio(pageUrl, destBase);
    if (user.songJob !== job) {
      fs.unlink(path.join(UPLOAD_DIR, filename), () => {});
      return;
    }
    const previous = user.songFile;
    user.songFile = '/uploads/' + filename;
    user.songError = '';
    save(USERS_FILE, users);
    touchProfiles();
    if (previous && previous !== user.songFile) deleteSongPath(previous);
  } catch (err) {
    if (user.songJob !== job) return;
    user.songFile = '';
    user.songError = err.message || 'Could not save that song';
    save(USERS_FILE, users);
    touchProfiles();
  }
}

function queueSavedSongs() {
  for (const user of Object.values(users)) {
    const pageUrl = cleanSongUrl(user.songUrl);
    if (!pageUrl || cleanSongFile(user.songFile)) continue;
    user.songJob = (Number(user.songJob) || 0) + 1;
    user.songError = '';
    enqueueSong(user.id);
  }
}


function profileShades(input) {
  const clean = cleanNameColors(input);
  if (clean.length >= 2) return clean.slice(0, 2);
  if (clean.length === 1) return [clean[0], clean[0]];
  return ['#7c3aed', '#c084fc'];
}

function colorToHex(value) {
  const raw = String(value || '').trim();
  const hex = raw.slice(0, 9);
  if (/^#[0-9a-fA-F]{3,8}$/.test(hex)) return hex;
  const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!rgb) return '';
  const nums = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (nums.some((n) => n > 255)) return '';
  return '#' + nums.map((n) => n.toString(16).padStart(2, '0')).join('');
}

function cleanNameColors(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  for (const c of list) {
    const hex = colorToHex(c);
    if (hex) out.push(hex);
    if (out.length === 2) break;
  }
  return out;
}

function normalizeUsername(name) {
  return String(name || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 32);
}

function usernameKey(name) {
  return normalizeUsername(name);
}

function findLoginUser(raw, password) {
  const typed = String(raw || '').trim();
  const folded = typed.toLowerCase();
  const named = usernameKey(typed);
  const emailish = folded.includes('@');
  const ranked = { email: null, exact: null, loose: null, past: null, deleted: null };
  const take = (slot, user) => { if (!ranked[slot]) ranked[slot] = user; };
  for (const user of Object.values(users)) {
    if (!user || user.bot) continue;
    if (!checkPassword(password || '', user.passwordHash)) continue;
    const key = usernameKey(user.username);
    const nameHit = !!(named && key === named);
    const exact = nameHit && String(user.username || '') === named;
    const past = !nameHit && named && Array.isArray(user.nameHistory) && user.nameHistory.some((row) => row && usernameKey(row.name) === named);
    const legacy = !named && String(user.username || '').toLowerCase() === folded;
    const emailHit = emailish && emailMatches(folded, user.emailSalt, user.emailHash);
    if (!nameHit && !past && !legacy && !emailHit) continue;
    if (user.deleted) {
      take('deleted', user);
      continue;
    }
    if (emailHit) take('email', user);
    if (exact) take('exact', user);
    else if (nameHit || legacy) take('loose', user);
    else if (past) take('past', user);
  }
  if (emailish) return ranked.email || ranked.exact || ranked.loose || ranked.past || ranked.deleted;
  return ranked.exact || ranked.loose || ranked.past || ranked.deleted;
}

function claimUsername(user, clean) {
  const next = usernameKey(clean);
  if (!next || !user) return false;
  if (usernameTaken(next, user.id)) return false;
  const old = String(user.username || '');
  if (old !== next) {
    if (!Array.isArray(user.nameHistory)) user.nameHistory = [];
    if (old) user.nameHistory.unshift({ name: old, at: new Date().toISOString() });
    user.nameHistory = user.nameHistory.slice(0, 12);
    user.username = next;
  }
  return true;
}

function endsWithBotTag(name) {
  return String(name || '').toLowerCase().endsWith('_bot');
}

const RESERVED_USERNAMES = new Set(['owner', 'founder', 'admin', 'administrator', 'manager', 'staff', 'mod', 'support', 'official', 'system']);

function reservedUsername(name) {
  const folded = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return RESERVED_USERNAMES.has(folded);
}

function cleanAliases(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const clean = String(item || '').trim().replace(/^@+/, '').replace(/\s+/g, ' ').slice(0, 32);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 10) break;
  }
  return out;
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
  if (req.path === '/api/upload' || req.path === '/api/upload/part' || req.path === '/api/bot/v1/me/avatar') return next();
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
  if (endsWithBotTag(cleanUser)) return res.status(400).json({ error: 'Usernames cannot end with _bot' });
  if (reservedUsername(cleanUser)) return res.status(400).json({ error: 'That username is reserved' });
  if (!cleanEmail.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  if (Object.values(users).some((u) => emailMatches(cleanEmail, u.emailSalt, u.emailHash))) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  if (usernameTaken(cleanUser)) {
    return res.status(409).json({ error: 'Username taken' });
  }

  const vault = cleanVault(req.body || {});
  if (!vault) return res.status(400).json({ error: 'Choose a recovery code or a passphrase' });
  const entry = {
    username: cleanUser,
    email: cleanEmail,
    passwordHash: hashPassword(password),
    ...emailRecord(cleanEmail),
    vault,
    view: cleanView(req.body || {}),
  };
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    const made = createAccount(entry, req);
    if (made.error) return res.status(made.status || 400).json({ error: made.error });
    return res.json(made);
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeId = crypto.randomBytes(16).toString('hex');
  entry.codeId = codeId;
  codes[codeId] = {
    username: entry.username,
    email: entry.email,
    passwordHash: entry.passwordHash,
    emailSalt: entry.emailSalt,
    emailHash: entry.emailHash,
    vault: entry.vault,
    view: entry.view || null,
    code,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  save(CODES_FILE, codes);

  try {
    await sendVerificationCode(cleanEmail, code);
    res.json({ ok: true, message: 'Verification code sent' });
  } catch (err) {
    delete codes[codeId];
    save(CODES_FILE, codes);
    const msg = (err && err.message) || '';
    res.status(500).json({ error: msg.includes('not configured') ? msg : 'Failed to send email' });
  }
});

const authHolds = new Map();

function cleanVault(body) {
  const wrapped = String(body.wrapped || '');
  const salt = String(body.salt || '');
  const check = String(body.check || '').toLowerCase();
  const pub = String(body.pub || '');
  const kind = body.kind === 'code' ? 'code' : (body.kind === 'pass' ? 'pass' : '');
  if (!kind) return null;
  if (wrapped.length < 40 || wrapped.length > 20000) return null;
  if (salt.length < 8 || salt.length > 80) return null;
  if (!/^[a-f0-9]{64}$/.test(check)) return null;
  if (pub.length < 40 || pub.length > 400) return null;
  return { wrapped, salt, check, pub, kind };
}

function cleanView(body) {
  const view = body && body.view;
  if (!view || typeof view !== 'object') return null;
  const salt = String(view.salt || '');
  const wrapped = String(view.wrapped || '');
  if (salt.length < 8 || salt.length > 80 || wrapped.length < 16 || wrapped.length > 4000) return null;
  return { salt, wrapped };
}

function holdAuth(userId) {
  const ticket = crypto.randomBytes(24).toString('hex');
  authHolds.set(ticket, { userId, exp: Date.now() + 15 * 60 * 1000 });
  return ticket;
}

function peekHold(ticket) {
  const row = authHolds.get(String(ticket || ''));
  if (!row || row.exp < Date.now()) return null;
  return row;
}

function vaultGate(user) {
  if (!user.vault || !user.vault.wrapped || !user.vault.check) {
    return { ok: true, setup: true, ticket: holdAuth(user.id) };
  }
  return {
    ok: true,
    locked: true,
    ticket: holdAuth(user.id),
    vault: { wrapped: user.vault.wrapped, salt: user.vault.salt },
  };
}

function sessionFor(user, req) {
  const session = security.openSession(user, req);
  saveNow(USERS_FILE, users);
  return { ok: true, token: session.token, user: publicUser(user) };
}

function createAccount(entry, req) {
  if (endsWithBotTag(entry && entry.username)) return { error: 'Usernames cannot end with _bot', status: 400 };
  if (reservedUsername(entry && entry.username)) return { error: 'That username is reserved', status: 400 };
  const id = uuidv4();
  const uid = nextUid();
  const badges = [];
  if (isEarlySupporterWindow()) badges.push('early');
  users[id] = {
    id, uid,
    username: entry.username,
    displayName: entry.username,
    email: entry.email || '',
    emailSalt: entry.emailSalt,
    emailHash: entry.emailHash,
    passwordHash: entry.passwordHash,
    bio: '', aboutMe: '', pronouns: '',
    status: 'online',
    lastSeen: Date.now(),
    hideLastSeen: false,
    customStatus: '',
    accentColor: '#7c5cff',
    avatarColor: '#7c5cff',
    bannerColor: '#7c5cff',
    avatarUrl: '', avatarKey: '', bannerUrl: '', bannerKey: '',
    serverTag: '',
    server: SERVER_NAME,
    badges: [...new Set(badges)],
    token: '',
    createdAt: new Date().toISOString(),
  };
  if (entry.vault) {
    users[id].vault = { wrapped: entry.vault.wrapped, salt: entry.vault.salt, check: entry.vault.check };
    users[id].vaultPub = entry.vault.pub;
    users[id].recovery = entry.vault.kind;
  }
  if (entry.view) users[id].recoveryView = entry.view;
  if (entry.codeId) delete codes[entry.codeId];
  const session = security.openSession(users[id], req);
  saveNow(USERS_FILE, users);
  save(CODES_FILE, codes);
  ensureFriendNode(id);
  save(FRIENDS_FILE, friendGraph);
  ensureGuilds();
  return { ok: true, token: session.token, user: publicUser(users[id]), server: SERVER_NAME };
}

app.post('/api/auth/verify', (req, res) => {
  const { email, code } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const found = Object.entries(codes).find(([, row]) => row && emailMatches(cleanEmail, row.emailSalt, row.emailHash));
  const entry = found && found[1];
  if (!entry) return res.status(400).json({ error: 'No pending verification' });
  if (Date.now() > entry.expiresAt) {
    delete codes[found[0]];
    save(CODES_FILE, codes);
    return res.status(400).json({ error: 'Code expired' });
  }
  if (String(code).trim() !== entry.code) {
    return res.status(400).json({ error: 'Invalid code' });
  }
  entry.codeId = found[0];
  const made = createAccount(entry, req);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  res.json(made);
});

app.post('/api/auth/login', (req, res) => {
  const raw = String((req.body && (req.body.email || req.body.username)) || '');
  const password = req.body && req.body.password;
  const user = findLoginUser(raw, password);
  if (!user) {
    return res.status(400).json({ error: 'That email, username, or password is wrong' });
  }
  const held = accountHold(user);
  if (held) {
    const kind = user.globalBan && user.disabled ? 'both' : user.globalBan ? 'ban' : user.disabled ? 'disabled' : '';
    return res.status(403).json({ error: held, appeal: !!kind, kind });
  }
  const email = String(raw || '').trim().toLowerCase();
  if (email.includes('@') && emailMatches(email, user.emailSalt, user.emailHash) && user.email !== email) {
    user.email = email;
    save(USERS_FILE, users);
  }
  if (!String(user.passwordHash).startsWith('scrypt$')) {
    user.passwordHash = hashPassword(password || '');
    save(USERS_FILE, users);
  }
  if (user.totp && user.totp.enabled) {
    const ticket = security.mfaTicket(user.id);
    return res.json({
      ok: true,
      mfa: true,
      ticket,
      methods: ['totp', ...((user.passkeys || []).length ? ['passkey'] : [])],
    });
  }
  res.json(vaultGate(user));
});

app.post('/api/auth/appeal', (req, res) => {
  const raw = String((req.body && (req.body.email || req.body.username)) || '');
  const password = req.body && req.body.password;
  const text = String((req.body && req.body.text) || '').trim().slice(0, 500);
  const user = findLoginUser(raw, password);
  if (!user) {
    return res.status(400).json({ error: 'That email, username, or password is wrong' });
  }
  if (isRootAccount(user)) return res.status(400).json({ error: 'That account cannot send an appeal' });
  const kind = user.globalBan && user.disabled ? 'both' : user.globalBan ? 'ban' : user.disabled ? 'disabled' : '';
  if (!kind) return res.status(400).json({ error: 'This account is not banned or disabled' });
  if (text.length < 8) return res.status(400).json({ error: 'Tell staff why the account should be restored' });
  if (!Array.isArray(user.appeals)) user.appeals = [];
  if (user.appeals.some((row) => row && row.status === 'open')) {
    return res.status(400).json({ error: 'You already have an appeal waiting' });
  }
  user.appeals.unshift({ id: uuidv4(), at: new Date().toISOString(), text, status: 'open', kind });
  user.appeals = user.appeals.slice(0, 20);
  save(USERS_FILE, users);
  res.json({ ok: true });
});

app.post('/api/auth/mfa', (req, res) => {
  const ticket = req.body && req.body.ticket;
  const row = security.takeMfa(ticket);
  const user = row && users[row.userId];
  if (!user || !security.checkTotp(user, req.body && req.body.code)) {
    return res.status(400).json({ error: row ? 'That code is wrong' : 'That code expired. Log in again.' });
  }
  security.dropChallenge(ticket);
  res.json(vaultGate(user));
});

app.post('/api/auth/passkey/options', (req, res) => {
  let user = null;
  if (req.body && req.body.ticket) {
    const userId = security.mfaUserId(req.body.ticket);
    user = users[userId] || null;
    if (!user) return res.status(400).json({ error: 'That sign-in expired. Log in again.' });
  }
  res.json({ ok: true, ...security.loginOptions(req, user) });
});

app.post('/api/auth/passkey/verify', (req, res) => {
  try {
    const user = security.loginPasskey(users, req.body || {});
    res.json(vaultGate(user));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Passkey was rejected' });
  }
});

app.post('/api/auth/unlock', (req, res) => {
  const row = peekHold(req.body && req.body.ticket);
  const user = row && users[row.userId];
  const check = String(req.body && req.body.check || '').toLowerCase();
  if (!user || !user.vault || user.vault.check !== check) {
    return res.status(400).json({ error: 'That recovery code or passphrase is wrong' });
  }
  authHolds.delete(String(req.body.ticket));
  res.json(sessionFor(user, req));
});

app.post('/api/auth/setup', (req, res) => {
  const row = peekHold(req.body && req.body.ticket);
  const user = row && users[row.userId];
  const vault = cleanVault(req.body || {});
  if (!user) return res.status(400).json({ error: 'That sign-in expired. Log in again.' });
  if (!vault) return res.status(400).json({ error: 'Choose a recovery code or a passphrase' });
  user.vault = { wrapped: vault.wrapped, salt: vault.salt, check: vault.check };
  user.vaultPub = vault.pub;
  user.recovery = vault.kind;
  const view = cleanView(req.body || {});
  if (view) user.recoveryView = view;
  authHolds.delete(String(req.body.ticket));
  res.json(sessionFor(user, req));
});

app.post('/api/me/recovery', auth, (req, res) => {
  const vault = cleanVault(req.body || {});
  if (!vault) return res.status(400).json({ error: 'Choose a recovery code or a passphrase' });
  if (req.user.vault && req.user.vault.check && String(req.body.previous || '').toLowerCase() !== req.user.vault.check) {
    return res.status(400).json({ error: 'Enter the recovery code or passphrase you use now' });
  }
  const view = cleanView(req.body || {});
  if (view && !checkPassword(String(req.body.password || ''), req.user.passwordHash)) {
    return res.status(400).json({ error: 'Password is wrong' });
  }
  req.user.vault = { wrapped: vault.wrapped, salt: vault.salt, check: vault.check };
  if (vault.pub) req.user.vaultPub = vault.pub;
  req.user.recovery = vault.kind;
  if (view) req.user.recoveryView = view;
  save(USERS_FILE, users);
  res.json({ ok: true, recovery: vault.kind, user: publicUser(req.user) });
});

app.post('/api/me/recovery/show', auth, (req, res) => {
  if (!checkPassword(String(req.body && req.body.password || ''), req.user.passwordHash)) {
    return res.status(400).json({ error: 'Password is wrong' });
  }
  res.json({
    ok: true,
    kind: req.user.recovery || '',
    view: req.user.recoveryView || null,
  });
});

app.post('/api/auth/logout', auth, (req, res) => {
  if (req.session) security.removeSession(req.user, req.session.id);
  save(USERS_FILE, users);
  res.json({ ok: true });
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

const BANNER_GIF_SIZES = [32, 128, 512];

function writeBannerSizes(file) {
  const gif = decodeGif(fs.readFileSync(file));
  const edge = gif ? Math.max(gif.width, gif.height) : 0;
  let frames = null;
  for (const size of BANNER_GIF_SIZES) {
    const dest = file.replace(/\.gif$/i, '.' + size + '.gif');
    if (!gif || edge <= size) {
      fs.copyFileSync(file, dest);
      continue;
    }
    if (!frames) frames = composite(gif);
    const box = fitBox(gif.width, gif.height, size);
    const scaled = frames.map((frame) => ({
      rgba: scaleRGBA(frame.rgba, gif.width, gif.height, box.w, box.h),
      delay: frame.delay,
    }));
    const out = encodeGif(box.w, box.h, scaled);
    if (out && out.length) fs.writeFileSync(dest, out);
    else fs.copyFileSync(file, dest);
  }
}


function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return '';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return '.gif';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return '';
}

function sniffVideo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return '';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return '.webm';
  if (buf.slice(4, 8).toString('ascii') !== 'ftyp') return '';
  const brand = buf.slice(8, 12).toString('ascii');
  return brand.startsWith('qt') ? '.mov' : '.mp4';
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const found = security.findSession(users, token);
  if (!found) return res.status(401).json({ error: 'Invalid session' });
  const held = accountHold(found.user);
  if (held) return res.status(401).json({ error: held });
  req.user = found.user;
  req.session = found.session;
  if (!req.user.vault || !req.user.vault.check) {
    return res.status(401).json({ error: 'Sign in with your recovery code or passphrase' });
  }
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

app.post('/api/upload/finish', auth, async (req, res) => {
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
  let url = '';
  try {
    url = await storeUpload(body, '.gif');
  } catch (err) {
    return res.status(502).json({ error: 'Cloudflare rejected that file. ' + (err.message || 'Upload failed') });
  }
  res.json({ ok: true, url, name: 'animation.gif' });
});

app.post('/api/upload', auth, express.raw({ type: () => true, limit: '512mb' }), async (req, res) => {
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
    let url = '';
    try {
      url = await storeUpload(body, ext, String(req.query.chat || '') === '1');
    } catch (err) {
      return res.status(502).json({ error: 'Cloudflare rejected that file. ' + (err.message || 'Upload failed') });
    }
    return res.json({ ok: true, url, name: safe });
  }
  const imageExt = sniffImage(req.body);
  const videoExt = imageExt ? '' : sniffVideo(req.body);
  const ext = imageExt || videoExt;
  if (!ext) return res.status(400).json({ error: 'Use a photo or video' });
  if (videoExt && req.body.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Videos can be up to 25 MB' });
  if (videoExt && (slot === 'avatar' || slot === 'banner')) return res.status(400).json({ error: 'Use a PNG, JPG, WEBP, or GIF' });
  if (slot === 'avatar' || slot === 'banner') {
    try {
      const saved = await saveProfileFile(req.user, slot, req.body, ext);
      save(USERS_FILE, users);
      return res.json({ ok: true, path: saved.path, url: saved.url, user: publicUser(req.user) });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message || 'Could not save that picture' });
    }
  }
  let url = '';
  try {
    url = await storeUpload(req.body, ext);
  } catch (err) {
    return res.status(502).json({ error: 'Cloudflare rejected that file. ' + (err.message || 'Upload failed') });
  }
  res.json({ ok: true, url });
});

const pictureLinks = new Map();
const PICTURE_TTL = 15 * 60 * 1000;

function rememberPicture(name, buf, type) {
  const now = Date.now();
  for (const [key, row] of pictureLinks) {
    if (now - row.at > PICTURE_TTL) pictureLinks.delete(key);
  }
  while (pictureLinks.size >= 40) pictureLinks.delete(pictureLinks.keys().next().value);
  pictureLinks.set(name, { buf, type, at: now });
}

app.post('/api/preview', auth, express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  const buf = req.body;
  const ext = sniffImage(buf);
  if (!ext || !Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Use a photo' });
  if (buf.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'That picture is too large' });
  const name = crypto.randomBytes(18).toString('hex') + (ext === '.jpeg' ? '.jpg' : ext);
  rememberPicture(name, buf, mediaType(name));
  res.json({ ok: true, url: '/preview/' + name });
});

app.get('/preview/:name/raw', (req, res) => {
  const name = String(req.params.name || '');
  if (!/^[a-f0-9]{36}\.(?:png|jpe?g|gif|webp)$/i.test(name)) return res.status(404).end();
  const row = pictureLinks.get(name);
  if (!row || Date.now() - row.at > PICTURE_TTL) {
    pictureLinks.delete(name);
    return res.status(404).end();
  }
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Cache-Control', 'private, max-age=300');
  res.set('Content-Type', row.type);
  res.end(row.buf);
});

function localMediaFile(rel) {
  if (!/^(avatars|banners)\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(rel)) return '';
  const sized = rel.match(/^(banners\/[A-Za-z0-9_-]+\/)(.+?)\.(?:s)?(?:32|128|512)\.gif$/i);
  const picked = sized && fs.existsSync(path.join(FILES_DIR, sized[1] + sized[2] + '.gif')) ? sized[1] + sized[2] + '.gif' : rel;
  const file = path.resolve(FILES_DIR, picked);
  const root = path.resolve(FILES_DIR);
  if (file !== root && !file.startsWith(root + path.sep)) return '';
  return fs.existsSync(file) ? file : '';
}

app.get('/api/media/raw', auth, async (req, res) => {
  const raw = String(req.query.url || '').split(/[?#]/)[0];
  let buf = null;
  let name = 'image';
  try {
    if (raw.startsWith('/files/')) {
      const file = localMediaFile(raw.slice('/files/'.length));
      if (!file) return res.status(404).end();
      buf = fs.readFileSync(file);
      name = path.basename(file);
    } else if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(raw)) {
      const file = path.join(UPLOAD_DIR, path.basename(raw));
      if (!fs.existsSync(file)) return res.status(404).end();
      buf = fs.readFileSync(file);
      if (isSealedFile(buf)) buf = openSealedBytes(buf);
      name = path.basename(file);
    } else {
      const cfg = r2Config();
      if (!cfg || !raw.startsWith(cfg.publicBase + '/')) return res.status(404).end();
      let key = decodeURIComponent(raw.slice(cfg.publicBase.length + 1));
      if (!key || key.includes('..') || !/^(avatars|banners|uploads)\//.test(key)) return res.status(404).end();
      const sized = key.match(/^(banners\/[A-Za-z0-9_-]+\/)(.+?)\.(?:s)?(?:32|128|512)\.gif$/i);
      buf = await r2Get(cfg, key);
      if (!buf && sized) buf = await r2Get(cfg, sized[1] + sized[2] + '.gif');
      if (sized && buf) key = sized[1] + sized[2] + '.gif';
      if (!buf) return res.status(404).end();
      name = key.split('/').pop();
    }
  } catch (_) {
    return res.status(404).end();
  }
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Type', mediaType(name));
  res.end(buf);
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
  const pathname = decodeURIComponent(String(req.path || '').split('?')[0]);
  const parts = pathname.split('/');
  const base = parts[parts.length - 1] || '';
  const sized = base.match(/^(.+?)\.(?:s)?(?:32|128|512)\.gif$/i);
  if (parts[1] !== 'banners' || !sized || !/^[A-Za-z0-9_-]+$/.test(parts[2] || '')) return next();
  const dir = path.join(FILES_DIR, 'banners', parts[2]);
  const original = path.join(dir, sized[1] + '.gif');
  const requested = path.join(dir, base);
  const file = fs.existsSync(original) ? original : (fs.existsSync(requested) ? requested : '');
  if (!file) return next();
  res.type('image/gif');
  res.sendFile(file);
}, express.static(FILES_DIR, { maxAge: '365d', immutable: true, acceptRanges: true }));

function safeUploadPath(req) {
  const rel = decodeURIComponent(String(req.path || '').split('?')[0]).replace(/^\/+/, '');
  if (!rel || rel.includes('..') || rel.includes('/') || rel.includes('\\')) return '';
  if (!/^[A-Za-z0-9._-]+$/.test(rel)) return '';
  const full = path.resolve(UPLOAD_DIR, rel);
  if (full !== UPLOAD_DIR && !full.startsWith(UPLOAD_DIR + path.sep)) return '';
  return full;
}

function sendBytes(req, res, buf, type) {
  const total = buf.length;
  res.set('Content-Type', type);
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'private, max-age=604800');
  const header = String(req.headers.range || '');
  const match = header.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    res.set('Content-Length', String(total));
    if (req.method === 'HEAD') return res.end();
    return res.end(buf);
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    res.status(416);
    res.set('Content-Range', 'bytes */' + total);
    return res.end();
  }
  end = Math.min(end, total - 1);
  const slice = buf.subarray(start, end + 1);
  res.status(206);
  res.set('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
  res.set('Content-Length', String(slice.length));
  if (req.method === 'HEAD') return res.end();
  return res.end(slice);
}

app.use('/uploads', allowMedia, async (req, res, next) => {
  const full = safeUploadPath(req);
  const name = full ? path.basename(full) : '';
  if (full && fs.existsSync(full)) {
    let stored;
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) return next();
      stored = fs.readFileSync(full);
    } catch (_) {
      return next();
    }
    if (!isSealedFile(stored)) return next();
    let plain;
    try { plain = openSealedBytes(stored); } catch (_) { return res.status(404).end(); }
    return sendBytes(req, res, plain, mediaType(full));
  }
  const cfg = r2Config();
  if (!cfg || !name) return next();
  try {
    const remote = await r2Get(cfg, 'sealed/uploads/' + name);
    if (!remote || !isSealedFile(remote)) return next();
    return sendBytes(req, res, openSealedBytes(remote), mediaType(name));
  } catch (_) {
    return next();
  }
}, (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  next();
}, express.static(UPLOAD_DIR, {
  maxAge: '7d',
  immutable: true,
  acceptRanges: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.m4a')) res.setHeader('Content-Type', 'audio/mp4');
    else if (filePath.endsWith('.webm')) res.setHeader('Content-Type', /song-/i.test(filePath) ? 'audio/webm' : 'video/webm');
    else if (filePath.endsWith('.mp4')) res.setHeader('Content-Type', 'video/mp4');
    else if (filePath.endsWith('.mov')) res.setHeader('Content-Type', 'video/quicktime');
    else if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
    else if (filePath.endsWith('.opus')) res.setHeader('Content-Type', 'audio/opus');
  },
}));

app.get('/api/me', auth, (req, res) => {
  res.json({ ok: true, user: withRing(req.user) });
});

app.get('/api/me/vault', auth, (req, res) => {
  const vault = req.user.vault;
  if (!vault || !vault.wrapped || !vault.salt) return res.json({ ok: true, setup: true });
  res.json({ ok: true, vault: { wrapped: vault.wrapped, salt: vault.salt }, kind: req.user.recovery || 'pass' });
});

app.post('/api/seen', auth, (req, res) => {
  const seen = seenFor(req.user, req.user);
  res.json({ ok: true, lastSeen: seen.lastSeen, status: seen.status, seen: seen.seen, onlineUntil: seen.onlineUntil });
});

app.get('/api/username-available', auth, (req, res) => {
  const clean = normalizeUsername(req.query.name);
  if (!clean) return res.json({ ok: true, username: '', available: false, reason: 'invalid' });
  if (usernameKey(req.user.username) === clean) return res.json({ ok: true, username: clean, available: true, reason: 'yours' });
  if ((endsWithBotTag(clean) && !req.user.bot) || reservedUsername(clean)) return res.json({ ok: true, username: clean, available: false, reason: 'reserved' });
  const taken = usernameTaken(clean, req.user.id);
  res.json({ ok: true, username: clean, available: !taken, reason: taken ? 'taken' : 'available' });
});

app.patch('/api/me', auth, (req, res) => {
  const {
    username, displayName, aliases, bio, aboutMe, pronouns, customStatus, status, hideLastSeen,
    accentColor, avatarColor, bannerColor, avatarUrl, bannerUrl, serverTag, nameEffect, nameFont, nameColors, profileStyle, profileColors, songUrl, songStart, songAutoplay, boxKey, timezone,
    shownBadges, showcaseServerId, showcaseBadge,
  } = req.body || {};
  if (showcaseServerId) {
    const home = guilds.servers[String(showcaseServerId)];
    if (!home || !home.members || !home.members[req.user.id] || !home.tag || !canCustomize(home)) {
      return res.status(400).json({ error: 'You cannot showcase that server' });
    }
  }
  if (showcaseBadge && !userOwnsBadge(req.user, String(showcaseBadge))) {
    return res.status(400).json({ error: 'You do not have that badge' });
  }

  if (username !== undefined) {
    const clean = normalizeUsername(username);
    if (clean.length < 1) return res.status(400).json({ error: 'Username required' });
    if (endsWithBotTag(clean) && !req.user.bot) return res.status(400).json({ error: 'Usernames cannot end with _bot' });
    if (reservedUsername(clean)) return res.status(400).json({ error: 'That username is reserved' });
    if (usernameKey(req.user.username) !== clean || req.user.username !== clean) {
      if (!claimUsername(req.user, clean)) return res.status(409).json({ error: 'Username taken' });
    }
  }
  if (aliases !== undefined) req.user.aliases = cleanAliases(aliases);

  if (displayName !== undefined) req.user.displayName = String(displayName).slice(0, 32);
  if (bio !== undefined) req.user.bio = String(bio).replace(/\s+/g, ' ').trim().slice(0, 29);
  if (aboutMe !== undefined) req.user.aboutMe = String(aboutMe).slice(0, 190);
  if (pronouns !== undefined) req.user.pronouns = String(pronouns).slice(0, 40);
  if (timezone !== undefined) req.user.timezone = cleanZone(timezone);
  if (customStatus !== undefined) req.user.customStatus = String(customStatus).slice(0, 128);
  if (req.body && req.body.activity !== undefined) {
    const raw = req.body.activity;
    const text = String(raw && typeof raw === 'object' ? raw.name : raw || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    req.user.activity = text ? { name: text, at: Date.now() } : null;
  }
  let presenceChanged = false;
  if (status && ['online', 'idle', 'dnd', 'offline'].includes(status)) {
    const prev = req.user.status || 'online';
    req.user.status = status;
    if (status !== 'offline' && (prev === 'offline' || status === 'online')) req.user.lastSeen = Date.now();
    presenceChanged = status !== prev;
  }
  if (req.body && ['everyone', 'servers', 'friends'].includes(req.body.dmPrivacy)) req.user.dmPrivacy = req.body.dmPrivacy;
  if (req.body && ['everyone', 'mutual', 'friends', 'nobody'].includes(req.body.groupPrivacy)) req.user.groupPrivacy = req.body.groupPrivacy;
  if (req.body && ['everyone', 'servers', 'friends', 'nobody'].includes(req.body.callPrivacy)) req.user.callPrivacy = req.body.callPrivacy;
  if (req.body && ['everyone', 'servers', 'friends', 'nobody'].includes(req.body.linkPrivacy)) req.user.linkPrivacy = req.body.linkPrivacy;
  if (req.body && ['everyone', 'servers', 'friends', 'nobody'].includes(req.body.mediaPrivacy)) req.user.mediaPrivacy = req.body.mediaPrivacy;
  if (req.body && ['everyone', 'servers', 'friends', 'nobody'].includes(req.body.storyPrivacy)) req.user.storyPrivacy = req.body.storyPrivacy;
  if (req.body && ['everyone', 'contacts', 'nobody'].includes(req.body.lastSeenPrivacy)) {
    presenceChanged = presenceChanged || req.user.lastSeenPrivacy !== req.body.lastSeenPrivacy;
    req.user.lastSeenPrivacy = req.body.lastSeenPrivacy;
    req.user.hideLastSeen = req.body.lastSeenPrivacy === 'nobody';
  } else if (hideLastSeen !== undefined) {
    presenceChanged = presenceChanged || !!req.user.hideLastSeen !== !!hideLastSeen;
    req.user.hideLastSeen = !!hideLastSeen;
    req.user.lastSeenPrivacy = hideLastSeen ? 'nobody' : 'everyone';
  }
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
  if (req.body && req.body.bannerPos !== undefined) req.user.bannerPos = cleanBannerPos(req.body.bannerPos);
  if (bannerUrl !== undefined && !req.user.bannerUrl) req.user.bannerPos = { x: 50, y: 50 };
  if (serverTag !== undefined) req.user.serverTag = String(serverTag).slice(0, 16);
  if (Array.isArray(shownBadges)) {
    req.user.shownBadges = [...new Set(shownBadges.filter((id) => id === 'early' || id === 'staff' || id === 'developer'))];
  }
  if (showcaseServerId !== undefined) {
    const picked = String(showcaseServerId || '');
    if (!picked) req.user.showcaseServerId = '';
    else {
      const home = guilds.servers[picked];
      if (!home || !home.members || !home.members[req.user.id] || !home.tag || !canCustomize(home)) {
        return res.status(400).json({ error: 'You cannot showcase that server' });
      }
      req.user.showcaseServerId = picked;
    }
  }
  if (showcaseBadge !== undefined) req.user.showcaseBadge = showcaseBadge ? String(showcaseBadge) : '';
  if (req.body && Array.isArray(req.body.boxRing)) {
    const incoming = cleanBoxRing(req.body.boxRing);
    const have = cleanBoxRing(req.user.boxRing);
    const merged = [];
    const seen = new Set();
    for (const row of [...have, ...incoming]) {
      if (seen.has(row.pub)) continue;
      seen.add(row.pub);
      merged.push(row);
      if (merged.length >= 6) break;
    }
    req.user.boxRing = merged;
  }
  if (boxKey !== undefined) {
    const next = cleanBoxKey(boxKey);
    if (String(boxKey || '').trim() && !next) return res.status(400).json({ error: 'Bad encryption key' });
    const ring = cleanBoxRing(req.user.boxRing);
    if (next && (!ring.length || ring.some((row) => row.pub === next))) req.user.boxKey = next;
  }
  if (nameEffect !== undefined) req.user.nameEffect = cleanNameEffect(nameEffect);
  if (nameFont !== undefined) req.user.nameFont = cleanNameFont(nameFont);
  if (nameColors !== undefined) req.user.nameColors = cleanNameColors(nameColors);
  if (profileStyle !== undefined) req.user.profileStyle = cleanProfileStyle(profileStyle);
  if (songUrl !== undefined) {
    const next = cleanSongUrl(songUrl);
    if (String(songUrl || '').trim() && !next) return res.status(400).json({ error: 'Use a YouTube link' });
    const changed = next !== cleanSongUrl(req.user.songUrl);
    if (changed) {
      const previous = req.user.songFile;
      req.user.songUrl = next;
      req.user.songFile = '';
      req.user.songError = '';
      deleteSongPath(previous);
    }
    if (next && !cleanSongFile(req.user.songFile)) {
      req.user.songJob = (Number(req.user.songJob) || 0) + 1;
      req.user.songError = '';
      enqueueSong(req.user.id);
    }
  }
  if (songStart !== undefined) req.user.songStart = cleanSongStart(songStart);
  if (songAutoplay !== undefined) req.user.songAutoplay = !!songAutoplay;
  if (profileColors !== undefined) {
    const shades = cleanNameColors(profileColors);
    if (shades.length === 2) req.user.profileColors = shades;
    else if (shades.length === 1) req.user.profileColors = [shades[0], shades[0]];
  }
  save(USERS_FILE, users);
  touchProfiles();
  if (presenceChanged) pushPresence(req.user);
  res.json({ ok: true, user: withRing(req.user) });
});

function addProfileMedia(user, key, url, limit) {
  if (!allowedFileUrl(url)) return 'Choose a photo';
  const row = { id: crypto.randomBytes(6).toString('hex'), url, createdAt: Date.now(), kind: /\.(mp4|webm|mov)$/i.test(url) ? 'video' : 'image' };
  const current = key === 'stories' ? liveStories(user.stories) : liveGallery(user.gallery);
  if (current.length >= limit) return key === 'stories' ? 'You can keep 8 stories' : 'You can keep 18 photos';
  user[key] = [...current, row];
  return '';
}

app.post('/api/me/gallery', auth, (req, res) => {
  const problem = addProfileMedia(req.user, 'gallery', String(req.body?.url || ''), 18);
  if (problem) return res.status(400).json({ error: problem });
  save(USERS_FILE, users);
  res.json({ ok: true, user: publicUser(req.user) });
});

app.delete('/api/me/gallery/:id', auth, (req, res) => {
  const id = String(req.params.id || '');
  req.user.gallery = liveGallery(req.user.gallery).filter((row) => String(row.id) !== id);
  save(USERS_FILE, users);
  res.json({ ok: true, user: publicUser(req.user) });
});

app.post('/api/me/stories', auth, (req, res) => {
  const problem = addProfileMedia(req.user, 'stories', String(req.body?.url || ''), 8);
  if (problem) return res.status(400).json({ error: problem });
  save(USERS_FILE, users);
  res.json({ ok: true, user: publicUser(req.user) });
});

app.delete('/api/me/stories/:id', auth, (req, res) => {
  const id = String(req.params.id || '');
  req.user.stories = liveStories(req.user.stories).filter((row) => String(row.id) !== id);
  save(USERS_FILE, users);
  res.json({ ok: true, user: publicUser(req.user) });
});

app.post('/api/me/password', auth, (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  const confirm = String(req.body?.confirm || '');
  if (!checkPassword(current, req.user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  if (next.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (next !== confirm) return res.status(400).json({ error: 'Passwords do not match' });
  req.user.passwordHash = hashPassword(next);
  save(USERS_FILE, users);
  res.json({ ok: true });
});

app.post('/api/me/email', auth, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!checkPassword(password, req.user.passwordHash)) {
    return res.status(400).json({ error: 'Password is wrong' });
  }
  if (!email.includes('@') || email.length > 120) return res.status(400).json({ error: 'Invalid email' });
  if (Object.values(users).some((u) => u.id !== req.user.id && emailMatches(email, u.emailSalt, u.emailHash))) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const sealedEmail = emailRecord(email);
  req.user.emailSalt = sealedEmail.emailSalt;
  req.user.emailHash = sealedEmail.emailHash;
  req.user.email = email;
  save(USERS_FILE, users);
  res.json({ ok: true, user: publicUser(req.user) });
});

app.get('/api/me/security', auth, (req, res) => {
  res.json({ ok: true, ...security.summary(req.user, req.session && req.session.id) });
});

app.delete('/api/me/sessions/:id', auth, (req, res) => {
  const removed = security.removeSession(req.user, req.params.id);
  if (!removed) return res.status(404).json({ error: 'That device is not logged in' });
  save(USERS_FILE, users);
  res.json({
    ok: true,
    current: removed.id === (req.session && req.session.id),
    user: publicUser(req.user),
    ...security.summary(req.user, req.session && req.session.id),
  });
});

function passwordMatches(user, password) {
  return checkPassword(password || '', user && user.passwordHash);
}

app.post('/api/me/mfa/setup', auth, (req, res) => {
  if (!passwordMatches(req.user, req.body && req.body.password)) {
    return res.status(400).json({ error: 'Password is wrong' });
  }
  try {
    const data = security.beginTotp(req.user);
    save(USERS_FILE, users);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post('/api/me/mfa/enable', auth, (req, res) => {
  try {
    security.confirmTotp(req.user, req.body && req.body.code);
    save(USERS_FILE, users);
    res.json({ ok: true, user: publicUser(req.user) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post('/api/me/mfa/disable', auth, (req, res) => {
  if (!passwordMatches(req.user, req.body && req.body.password)) {
    return res.status(400).json({ error: 'Password is wrong' });
  }
  try {
    security.disableTotp(req.user, req.body && req.body.code);
    save(USERS_FILE, users);
    res.json({ ok: true, user: publicUser(req.user) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post('/api/me/passkeys/options', auth, (req, res) => {
  if (!passwordMatches(req.user, req.body && req.body.password)) {
    return res.status(400).json({ error: 'Password is wrong' });
  }
  res.json({ ok: true, ...security.registrationOptions(req.user, req) });
});

app.post('/api/me/passkeys', auth, (req, res) => {
  try {
    security.registerPasskey(req.user, req.body || {}, req);
    save(USERS_FILE, users);
    res.json({ ok: true, user: publicUser(req.user), ...security.summary(req.user, req.session && req.session.id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Could not save that passkey' });
  }
});

app.delete('/api/me/passkeys/:id', auth, (req, res) => {
  if (!security.removePasskey(req.user, req.params.id)) {
    return res.status(404).json({ error: 'Passkey not found' });
  }
  save(USERS_FILE, users);
  res.json({ ok: true, user: publicUser(req.user), ...security.summary(req.user, req.session && req.session.id) });
});

app.get('/api/members', auth, (req, res) => {
  ensureGuilds();
  if (!req.query.serverId) {
    const list = Object.values(users).filter((u) => u && !u.bot).map((u) => publicUser(u, req.user));
    return res.json({ ok: true, members: list, badges: BADGE_DEFS, server: SERVER_NAME });
  }
  const serverId = String(req.query.serverId);
  const g = guilds.servers[serverId];
  if (!g) return res.status(404).json({ error: 'Server not found' });
  if (!g.members[req.user.id]) return res.status(403).json({ error: 'You are not in this server' });
  if (!canSeeMemberList(g, req.user)) {
    return res.json({ ok: true, members: [], hidden: true, badges: BADGE_DEFS, server: g.name, roles: g.roles });
  }
  const list = Object.keys(g.members)
    .map((id) => users[id])
    .filter(Boolean)
    .map((u) => memberView(g, u, req.user));
  res.json({ ok: true, members: list, badges: BADGE_DEFS, server: g.name, roles: g.roles });
});

app.get('/api/discover', auth, (req, res) => {
  ensureGuilds();
  const list = Object.values(guilds.servers)
    .filter((g) => g && g.discover !== false && g.roomKey)
    .map((g) => publicServer(g, req.user));
  res.json({ ok: true, servers: list });
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
    color: '#c026d3',
    ownerIds: [req.user.id],
    roles: [everyoneRole(), ownerRole()],
    channels: [
      { id: uuidv4(), name: 'general', type: 'text', topic: 'Welcome to ' + name, overwrites: [] },
      { id: uuidv4(), name: 'General', type: 'voice', topic: '', overwrites: [] },
    ],
    members: { [req.user.id]: { roles: ['everyone', 'owner'], joinedAt: new Date().toISOString() } },
    invites: {},
    discover: req.body?.discover === false ? false : true,
  };
  if (g.discover) {
    const roomKey = String(req.body?.roomKey || '');
    if (!/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(roomKey)) {
      return res.status(400).json({ error: 'This server needs a key from your browser' });
    }
    g.roomKey = roomKey;
  }
  const code = inviteCode();
  g.invites[code] = { code, inviterId: req.user.id, createdAt: new Date().toISOString(), uses: 0 };
  guilds.servers[id] = g;
  saveGuilds();
  res.json({ ok: true, server: publicServer(g, req.user), slug: code, invite: code });
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
    categoryOrder: sectionOrder(g),
    theme: g.theme || null,
    bannerUrl: g.bannerUrl || '',
    iconUrl: g.iconUrl || '',
    tag: g.tag || '',
    onboarding: (g.onboarding && g.onboarding.enabled && g.members[req.user.id] && g.members[req.user.id].onboarded === false) ? g.onboarding : null,
    showLobby: !!g.showLobby,
    about: g.about || '',
    links: Array.isArray(g.links) ? g.links : [],
    hideMembers: !!g.hideMembers,
    seeMembers: canSeeMemberList(g, req.user),
    rulesChannelId: g.rulesChannelId || '',
    lobby: publicLobby(g),
    events: (g.events || []).filter((ev) => ev.status !== 'cancelled').slice(0, 12),
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

let callLog = load(CALLS_FILE, []);

function callPerson(id) {
  const u = users[id];
  if (!u) return { id, username: 'Someone', displayName: 'Someone' };
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatarUrl: publishedMedia(u, 'avatar'),
    avatarColor: u.avatarColor || '#7c5cff',
  };
}

function callView(row) {
  return {
    id: row.id,
    channelId: row.channelId,
    from: callPerson(row.from),
    to: callPerson(row.to),
    status: row.status,
    at: row.at,
  };
}

function saveCalls() {
  save(CALLS_FILE, callLog.slice(-200));
}

function expireCalls() {
  const now = Date.now();
  for (const row of callLog) {
    if (row.status === 'ringing' && now - Number(row.at) > 22000) finishCall(row, true);
  }
}

function callsFor(userId) {
  expireCalls();
  const id = String(userId);
  return {
    incoming: callLog.filter((row) => row.status === 'ringing' && String(row.to) === id).slice(-1).map(callView),
    missed: callLog.filter((row) => row.status === 'missed' && String(row.to) === id && !row.dismissed).slice(-20).reverse().map(callView),
  };
}

function finishCall(row, missed) {
  if (!row || row.status === 'ended' || row.status === 'missed' || row.status === 'declined') return;
  const wasActive = row.status === 'active';
  const seconds = wasActive ? Math.max(1, Math.round((Date.now() - (Number(row.answeredAt) || Date.now())) / 1000)) : 0;
  row.status = row.status === 'ringing' && missed ? 'missed' : 'ended';
  row.endedAt = Date.now();
  if (row.messageId && row.channelId && Array.isArray(messages[row.channelId])) {
    const list = messages[row.channelId];
    const idx = list.findIndex((msg) => msg && msg.id === row.messageId);
    if (idx >= 0) {
      const msg = list[idx];
      if (seconds) {
        msg.callSeconds = seconds;
        msg.createdAt = new Date().toISOString();
        list.splice(idx, 1);
        list.push(msg);
      } else if (row.status === 'missed') {
        msg.callMissed = true;
      }
      save(MESSAGES_FILE, messages);
      publishUpdate(row.channelId, msg);
    }
  }
  saveCalls();
  touchAlerts();
}

setInterval(() => {
  try { expireCalls(); } catch (_) {}
}, 2000);

app.post('/api/read', auth, (req, res) => {
  ensureGuilds();
  const rows = Array.isArray(req.body && req.body.reads) ? req.body.reads.slice(0, 100) : [];
  const incoming = {};
  const rewinds = {};
  for (const row of rows) {
    if (!row || !row.roomId) continue;
    incoming[String(row.roomId)] = row.messageId || '';
    if (row.rewind) rewinds[String(row.roomId)] = true;
  }
  const { book, changed } = mergeReadMap(req.user.id, incoming, rewinds);
  publishReads(req.user.id, changed, String(req.body && req.body.client || '').slice(0, 40));
  res.json({ ok: true, seen: book });
});

app.post('/api/activity', auth, (req, res) => {
  ensureGuilds();
  const incoming = req.body && req.body.seen && typeof req.body.seen === 'object' ? req.body.seen : {};
  const merged = mergeReadMap(req.user.id, incoming, null);
  const seen = merged.book;
  publishReads(req.user.id, merged.changed, String(req.body && req.body.client || '').slice(0, 40));
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
        start = idx === -1 ? list.length : idx + 1;
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
  const inbox = [];
  for (const g of Object.values(guilds.servers)) {
    if (!g || !g.members || !g.members[req.user.id]) continue;
    for (const channel of g.channels || []) {
      if (channel.type && channel.type !== 'text') continue;
      const list = messages[channel.id] || [];
      for (let i = Math.max(0, list.length - 80); i < list.length; i++) {
        const msg = list[i];
        if (!msg || msg.authorId === req.user.id || !messageMentions(msg, req.user, g)) continue;
        const author = users[msg.authorId];
        inbox.push({
          id: msg.id,
          at: msg.createdAt,
          content: dmPreview(msg.content || ''),
          channelId: channel.id,
          channelName: channel.name,
          serverId: g.id,
          serverName: g.name,
          author: author ? { id: author.id, username: author.username, displayName: author.displayName || author.username, avatarUrl: author.avatarUrl || '', avatarColor: author.avatarColor || '#7c5cff' } : { id: msg.authorId, username: 'Someone', displayName: 'Someone' },
        });
      }
    }
  }
  inbox.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  res.json({ ok: true, servers, channels, dms: dmNotes.counts, heads, speakers, inbox: inbox.slice(0, 30), calls: callsFor(req.user.id), seen });
});

app.post('/api/calls', auth, (req, res) => {
  const other = users[String(req.body && req.body.userId || '')];
  if (!other) return res.status(404).json({ error: 'User not found' });
  if (String(other.id) === String(req.user.id)) return res.status(400).json({ error: 'You cannot call yourself' });
  if (!canCall(req.user, other)) return res.status(403).json({ error: callBlockReason(other) });
  expireCalls();
  for (const row of callLog) {
    if (row.status === 'ringing' && String(row.from) === String(req.user.id)) finishCall(row, true);
  }
  const key = dmKey(req.user.id, other.id);
  const channelId = 'dm:' + key;
  const row = { id: uuidv4(), channelId, from: String(req.user.id), to: String(other.id), status: 'ringing', at: Date.now() };
  callLog.push(row);
  if (!dmThreads[key]) {
    dmThreads[key] = { id: key, a: key.split(':')[0], b: key.split(':')[1], updatedAt: Date.now() };
  } else {
    dmThreads[key].updatedAt = Date.now();
  }
  save(DMS_FILE, dmThreads);
  if (!messages[channelId]) messages[channelId] = [];
  const messageId = uuidv4();
  row.messageId = messageId;
  messages[channelId].push({
    id: messageId,
    channelId,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: '',
    kind: 'call',
    callSeconds: 0,
    files: [],
    createdAt: new Date().toISOString(),
  });
  saveCalls();
  save(MESSAGES_FILE, messages);
  publishCreate(channelId, messages[channelId][messages[channelId].length - 1]);
  touchAlerts();
  res.json({ ok: true, call: callView(row) });
});

app.post('/api/calls/:id/answer', auth, (req, res) => {
  const row = callLog.find((item) => item.id === req.params.id);
  if (!row || String(row.to) !== String(req.user.id)) return res.status(404).json({ error: 'Call not found' });
  if (row.status !== 'ringing') return res.status(409).json({ error: 'That call already ended' });
  row.status = 'active';
  row.answeredAt = Date.now();
  saveCalls();
  touchAlerts();
  res.json({ ok: true, call: callView(row) });
});

app.post('/api/calls/:id/decline', auth, (req, res) => {
  const row = callLog.find((item) => item.id === req.params.id);
  if (!row || String(row.to) !== String(req.user.id)) return res.status(404).json({ error: 'Call not found' });
  if (row.status === 'ringing') {
    row.status = 'declined';
    row.endedAt = Date.now();
    saveCalls();
    touchAlerts();
  }
  res.json({ ok: true });
});

function dropVoiceNow(userId) {
  const drop = app.locals.dropVoiceUser;
  if (typeof drop === 'function') drop(userId);
}

app.post('/api/calls/:id/end', auth, (req, res) => {
  const row = callLog.find((item) => item.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Call not found' });
  const mine = String(row.from) === String(req.user.id) || String(row.to) === String(req.user.id);
  if (!mine) return res.status(404).json({ error: 'Call not found' });
  dropVoiceNow(req.user.id);
  if (row.status === 'active') finishCall(row, false);
  else if (row.status === 'ringing' && String(row.from) === String(req.user.id)) finishCall(row, true);
  res.json({ ok: true });
});

app.post('/api/calls/:id/cancel', auth, (req, res) => {
  const row = callLog.find((item) => item.id === req.params.id);
  if (!row || String(row.from) !== String(req.user.id)) return res.status(404).json({ error: 'Call not found' });
  dropVoiceNow(req.user.id);
  finishCall(row, !(req.body && req.body.drop));
  res.json({ ok: true });
});

app.post('/api/calls/read', auth, (req, res) => {
  let changed = false;
  for (const row of callLog) {
    if (String(row.to) === String(req.user.id) && row.status === 'missed' && !row.dismissed) {
      row.dismissed = true;
      changed = true;
    }
  }
  if (changed) saveCalls();
  res.json({ ok: true });
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
  const isPrivate = !!req.body?.private;
  const readOnly = type === 'text' && !!req.body?.readOnly;
  const slowmode = type === 'text' ? Math.max(0, Math.min(21600, Number(req.body?.slowmode) || 0)) : 0;
  const stage = type === 'voice' && !!req.body?.stage;
  let deny = 0;
  if (isPrivate) deny |= PERM.VIEW;
  if (readOnly) deny |= PERM.SEND;
  const channel = {
    id: uuidv4(),
    name,
    type,
    topic: String(req.body?.topic || '').slice(0, 200),
    overwrites: deny ? [{ roleId: 'everyone', allow: 0, deny }] : [],
    private: isPrivate,
    readOnly,
    slowmode,
    stage,
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
  if (req.body?.slowmode != null) channel.slowmode = Math.max(0, Math.min(21600, Number(req.body.slowmode) || 0));
  if (req.body?.textOnly != null) channel.textOnly = !!req.body.textOnly;
  if (req.body?.noGifs != null) channel.noGifs = !!req.body.noGifs;
  if (req.body?.readOnly != null) channel.readOnly = !!req.body.readOnly;
  if (req.body?.private != null) channel.private = !!req.body.private;
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
  g.webhooks = (g.webhooks || []).filter((hook) => hook.channelId !== channel.id);
  saveGuilds();
  res.json({ ok: true });
});

function placeRoles(g, ids) {
  const locked = new Set(['everyone', 'here', 'owner']);
  const movable = (g.roles || []).filter((role) => role && !locked.has(role.id));
  const wanted = [];
  const seen = new Set();
  for (const id of ids || []) {
    const key = String(id || '');
    if (!key || seen.has(key) || locked.has(key)) continue;
    if (!movable.some((role) => role.id === key)) continue;
    seen.add(key);
    wanted.push(key);
  }
  for (const role of movable) {
    if (!seen.has(role.id)) wanted.push(role.id);
  }
  const rank = new Map(wanted.map((id, index) => [id, wanted.length - index]));
  for (const role of g.roles || []) {
    if (role.id === 'everyone' || role.id === 'here') role.position = 0;
    else if (rank.has(role.id)) role.position = rank.get(role.id);
  }
}

app.post('/api/servers/:id/roles/order', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.MANAGE_ROLES);
  if (!g) return;
  if (!Array.isArray(req.body?.ids)) return res.status(400).json({ error: 'Send the roles in order' });
  placeRoles(g, req.body.ids);
  saveGuilds();
  touchProfiles();
  res.json({ ok: true, settings: settingsView(g, req.user) });
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
  if (req.body?.icon != null) {
    const icon = String(req.body.icon || '');
    if (icon && !TAG_ICONS.includes(icon)) return res.status(400).json({ error: 'Pick a role icon from the list' });
    role.icon = icon;
  }
  if (req.body?.permissions != null && role.id !== 'owner') role.permissions = Number(req.body.permissions) || 0;
  if (req.body?.hoist != null && role.id !== 'everyone' && role.id !== 'here' && role.id !== 'owner') role.hoist = !!req.body.hoist;
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
  if (isRootAccount(users[req.params.userId])) return res.status(403).json({ error: 'That account is not affected by permissions' });
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
    slug: inv.code,
    uses: inv.uses || 0,
    createdAt: inv.createdAt,
  }));
  const custom = canCustomize(g) ? (g.vanity || '') : '';
  res.json({ ok: true, vanity: custom, memberCount: memberCount(g), canCustomize: canCustomize(g), invites: custom ? [] : list });
});

app.post('/api/servers/:id/invites', auth, (req, res) => {
  const g = requireGuild(req, res, PERM.INVITE);
  if (!g) return;
  if (canCustomize(g) && g.vanity) {
    return res.json({ ok: true, slug: g.vanity, vanity: true });
  }
  const code = inviteCode();
  g.invites[code] = { code, inviterId: req.user.id, createdAt: new Date().toISOString(), uses: 0 };
  saveGuilds();
  res.json({ ok: true, slug: code, vanity: false });
});

app.get('/api/invites/:code', auth, (req, res) => {
  ensureGuilds();
  const code = cleanSlug(req.params.code);
  const found = findByInvite(code);
  if (!found) return res.status(404).json({ error: 'Invite not found' });
  hydrateGuild(found);
  const ids = Object.keys(found.members || {});
  let online = 0;
  for (const id of ids) {
    const status = effectiveStatus(users[id]);
    if (status === 'online' || status === 'idle' || status === 'dnd') online += 1;
  }
  const member = !!(found.members && found.members[req.user.id]);
  res.json({
    ok: true,
    invite: {
      code,
      name: found.name || 'Server',
      icon: found.icon || (found.name || 'S').charAt(0).toUpperCase(),
      iconUrl: found.iconUrl || '',
      bannerUrl: found.bannerUrl || '',
      color: found.color || '#7c5cff',
      members: ids.length,
      online,
      joined: member,
      serverId: member ? found.id : '',
    },
  });
});

app.post('/api/invites/:code/join', auth, (req, res) => {
  ensureGuilds();
  const code = cleanSlug(req.params.code);
  const found = findByInvite(code);
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
    if (found.kicked) delete found.kicked[req.user.id];
    found.members[req.user.id] = { roles: ['everyone'], joinedAt: new Date().toISOString(), onboarded: !found.onboarding.enabled };
    if (found.id === OFFICIAL_ID && grantOfficialPerks(req.user, found.members[req.user.id])) save(USERS_FILE, users);
    const inviteKey = inviteRecordKey(found, code);
    if (inviteKey) found.invites[inviteKey].uses = (found.invites[inviteKey].uses || 0) + 1;
    audit(found, req.user, 'joined the server');
    saveGuilds();
    wakeGuild(found);
    noteBotJoin(found, req.user);
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
  if (!isRootAccount(req.user) && (req.user.locked || req.user.muted || req.user.restrictMessages)) {
    return res.status(403).json({ error: 'Messaging is restricted on this account' });
  }
  if (!isRootAccount(req.user) && (req.user.restrictImages || req.user.restrictFiles) && Array.isArray(req.body?.files) && req.body.files.length) {
    return res.status(403).json({ error: 'Uploads are restricted on this account' });
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
  if (!can(found.guild, req.user, PERM.VIEW, found.channel)) {
    return res.status(403).json({ error: 'You cannot view this channel' });
  }
  const channelBits = effectivePerms(found.guild, req.user, found.channel);
  const channelStaff = isOwner(found.guild, req.user) || (channelBits & PERM.MANAGE_CHANNELS) === PERM.MANAGE_CHANNELS || (channelBits & 16777216) === 16777216;
  if (found.channel.textOnly && extra.files && extra.files.length && !channelStaff) {
    return res.status(403).json({ error: 'This channel is text only' });
  }
  if (found.channel.noGifs && !channelStaff) {
    const blob = (extra.content || '') + ' ' + (extra.files || []).map((file) => (file && file.url) || '').join(' ');
    if (/giphy\.com|tenor\.com|\.gif(\?|#|\s|$)/i.test(blob)) {
      return res.status(403).json({ error: 'GIFs are turned off in this channel' });
    }
  }
  if (found.channel.readOnly && !channelStaff) {
    const roles = memberRoles(found.guild, req.user).filter((role) => role.id !== 'everyone' && role.id !== 'here');
    const allowed = (found.channel.overwrites || []).some((ow) => roles.some((role) => role.id === ow.roleId) && ((Number(ow.allow) || 0) & PERM.SEND));
    if (!allowed) return res.status(403).json({ error: 'This channel is read-only' });
  }
  const slow = Math.max(0, Math.min(21600, Number(found.channel.slowmode) || 0));
  if (slow && !channelStaff) {
    const list = messages[found.channel.id] || [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const prev = list[i];
      if (!prev || prev.webhook || String(prev.authorId) !== String(req.user.id)) continue;
      const waited = Date.now() - Date.parse(prev.createdAt || '');
      if (waited < slow * 1000) {
        const left = Math.max(1, Math.ceil((slow * 1000 - waited) / 1000));
        return res.status(429).json({ error: 'Slowmode is on. Wait ' + left + 's.' });
      }
      break;
    }
  }

  if (!messages[found.channel.id]) messages[found.channel.id] = [];
  const msg = {
    id: uuidv4(),
    channelId: found.channel.id,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: extra.seal ? '' : extra.content,
    seal: extra.seal || undefined,
    files: extra.files,
    poll: extra.poll,
    mentions: extra.seal ? null : parseMentions(found.guild, req.user, extra.content),
    replies: readReplies(req.body, found.channel.id),
    reply: readReply(req.body, found.channel.id),
    createdAt: new Date().toISOString(),
  };
  messages[found.channel.id].push(msg);
  if (messages[found.channel.id].length > 500) messages[found.channel.id] = messages[found.channel.id].slice(-500);
  save(MESSAGES_FILE, messages);
  silenceTyping('ch:' + found.guild.id + ':' + found.channel.id, req.user.id, req.body && req.body.typingToken);
  publishCreate(found.channel.id, msg);
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
  const groupId = String((req.body && req.body.groupId) || req.query.groupId || '');
  if (groupId) {
    const group = groups[groupId];
    if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) return null;
    return 'group:' + groupId;
  }
  const threadId = String((req.body && req.body.threadId) || req.query.threadId || '');
  if (threadId) {
    const thread = threads[threadId];
    if (!thread || thread.closed) return null;
    const found = findChannel(thread.channelId, thread.serverId);
    if (!found || !found.guild.members || !found.guild.members[req.user.id]) return null;
    return 'thread:' + threadId;
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
    if (now - row.at > 10000) {
      if (row.timer) clearTimeout(row.timer);
      room.delete(id);
      continue;
    }
    if (String(id) === String(selfId)) continue;
    out.push({ id, name: row.name, nameEffect: row.nameEffect || '', nameColors: row.nameColors || [], tick: Math.floor(row.at / 1000) });
  }
  return out;
}

const typingEpoch = new Map();

function wakeTyping(key) {
  const roomId = key.startsWith('ch:') ? key.split(':').pop() : key;
  wakePulse(roomId);
  if (!hub) return;
  const build = (user) => ({ roomId, typers: listTypers(key, user.id) });
  hub.room(roomId, 'TYPING', build);
  if (key.startsWith('dm:')) hub.users(key.slice(3).split(':'), 'TYPING', build);
  else if (key.startsWith('group:')) {
    const group = groups[key.slice('group:'.length)];
    if (group) hub.users(group.memberIds || [], 'TYPING', build);
  }
}

function noteEpoch(key, userId, token) {
  const next = Number(token) || 0;
  if (!next) return true;
  if (!typingEpoch.has(key)) typingEpoch.set(key, new Map());
  const book = typingEpoch.get(key);
  const prev = book.get(userId) || 0;
  if (next < prev && !(next > 1e12 && Math.abs(Date.now() - next) < 120000)) return false;
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
  const before = typingSignature(key);
  clearTyping(key, userId);
  if (typingSignature(key) !== before) wakeTyping(key);
}

function typingToken(typers) {
  return typers.map((row) => row.id + '@' + row.tick).sort().join(',');
}

function typingSignature(key) {
  return typingToken(listTypers(key, ''));
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
  }, 10000);
  room.set(userId, row);
}

app.post('/api/typing', auth, (req, res) => {
  const key = typingKeyFrom(req);
  if (!key) return res.status(404).json({ error: 'Chat not found' });
  const token = Number(req.body && req.body.token) || 0;
  if (req.body && req.body.stop) {
    if (!noteEpoch(key, req.user.id, token)) return res.json({ ok: true });
    const before = typingSignature(key);
    clearTyping(key, req.user.id);
    if (typingSignature(key) !== before) wakeTyping(key);
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
  noteBrief(req.user, peersOfRoom(key.startsWith('ch:') ? '' : key, req.user.id));
  res.json({ ok: true });
});

app.get('/api/typing', auth, (req, res) => {
  const key = typingKeyFrom(req);
  if (!key) return res.json({ ok: true, typers: [] });
  res.json({ ok: true, typers: listTypers(key, req.user.id) });
});

function pulseBody(roomId, typeKey, userId, extra) {
  const raw = messages[roomId] || [];
  const list = raw.slice(-100).map((msg) => presentMessage(msg, userId));
  const typers = listTypers(typeKey, userId);
  const last = list[list.length - 1];
  return {
    roomId,
    body: {
      ok: true,
      messages: list,
      typers,
      cursor: last ? last.id : '',
      typing: typingToken(typers),
      profiles: String(profileRev),
      polls: pollStamp(raw.slice(-100)),
      edits: messageStamp(raw.slice(-100)),
      ...(extra || {}),
    },
  };
}

function pulseSnap(req) {
  const dmUserId = String(req.query.dmUserId || '');
  if (dmUserId) {
    if (!users[dmUserId]) return null;
    const key = dmKey(req.user.id, dmUserId);
    return pulseBody('dm:' + key, 'dm:' + key, req.user.id);
  }
  const groupId = String(req.query.groupId || '');
  if (groupId) {
    const group = groups[groupId];
    if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) return null;
    return pulseBody('group:' + groupId, 'group:' + groupId, req.user.id);
  }
  const threadId = String(req.query.threadId || '');
  if (threadId) {
    const thread = threads[threadId];
    if (!thread) return null;
    const found = findChannel(thread.channelId, thread.serverId);
    if (!found || !can(found.guild, req.user, PERM.VIEW, found.channel)) return { forbidden: true };
    return pulseBody('thread:' + threadId, 'thread:' + threadId, req.user.id);
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
      typing: typingToken(typers),
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
      if (!res.writableEnded) {
        const voice = typeof app.locals.voiceSnapshot === 'function' ? app.locals.voiceSnapshot(req.user) : null;
        res.json({ ok: true, cursor: String(alertRev), voice });
      }
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
  const voice = typeof app.locals.voiceSnapshot === 'function' ? app.locals.voiceSnapshot(req.user) : null;
  res.json({ ok: true, cursor: current, voice });
});

function resolveWatch(user, data) {
  const dmUserId = String(data.dmUserId || '');
  if (dmUserId) {
    if (!users[dmUserId]) return null;
    const key = dmKey(user.id, dmUserId);
    return { roomId: 'dm:' + key, serverId: '' };
  }
  const groupId = String(data.groupId || '');
  if (groupId) {
    const group = groups[groupId];
    if (!group || !(group.memberIds || []).map(String).includes(String(user.id))) return null;
    return { roomId: 'group:' + groupId, serverId: '' };
  }
  const threadId = String(data.threadId || '');
  if (threadId) {
    const thread = threads[threadId];
    if (!thread) return null;
    const found = findChannel(thread.channelId, thread.serverId);
    if (!found || !can(found.guild, user, PERM.VIEW, found.channel)) return null;
    return { roomId: 'thread:' + threadId, serverId: found.guild.id };
  }
  const channelId = String(data.channelId || '');
  if (!channelId) return null;
  const found = findChannel(channelId, String(data.serverId || ''));
  if (!found || !can(found.guild, user, PERM.VIEW, found.channel)) return null;
  return { roomId: found.channel.id, serverId: found.guild.id };
}

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
  const mapUser = (id) => {
    const u = users[id];
    if (!u) return null;
    return publicUser(u, req.user);
  };
  const skip = new Set([
    String(req.user.id),
    ...node.friends,
    ...node.incoming,
    ...node.outgoing,
    ...node.blocked,
  ]);
  const suggested = [];
  for (const other of Object.values(users)) {
    if (!other || skip.has(String(other.id))) continue;
    if (isBlocked(req.user.id, other.id)) continue;
    if (!sharesServer(req.user.id, other.id)) continue;
    suggested.push(publicUser(other, req.user));
    if (suggested.length >= 40) break;
  }
  res.json({
    ok: true,
    friends: node.friends.map(mapUser).filter(Boolean),
    incoming: node.incoming.map(mapUser).filter(Boolean),
    outgoing: node.outgoing.map(mapUser).filter(Boolean),
    blocked: node.blocked.map(mapUser).filter(Boolean),
    suggested,
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
    target = Object.values(users).find((u) => u && usernameKey(u.username) === clean);
  } else {
    return res.status(400).json({ error: 'Provide username or uid' });
  }
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });
  if (isBlocked(req.user.id, target.id)) return res.status(400).json({ error: 'You cannot add this person' });

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
    return res.json({ ok: true, status: 'accepted', user: publicUser(target, req.user) });
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
  res.json({ ok: true, status: 'pending', user: publicUser(target, req.user) });
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
  res.json({ ok: true, user: publicUser(users[fromId], req.user) });
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

app.post('/api/friends/block', auth, (req, res) => {
  const otherId = String(req.body?.userId || '');
  if (!otherId || !users[otherId]) return res.status(404).json({ error: 'User not found' });
  if (otherId === String(req.user.id)) return res.status(400).json({ error: 'Cannot block yourself' });
  const me = ensureFriendNode(req.user.id);
  const them = ensureFriendNode(otherId);
  me.friends = me.friends.filter((id) => id !== otherId);
  me.incoming = me.incoming.filter((id) => id !== otherId);
  me.outgoing = me.outgoing.filter((id) => id !== otherId);
  them.friends = them.friends.filter((id) => id !== String(req.user.id));
  them.incoming = them.incoming.filter((id) => id !== String(req.user.id));
  them.outgoing = them.outgoing.filter((id) => id !== String(req.user.id));
  if (!me.blocked.includes(otherId)) me.blocked.push(otherId);
  save(FRIENDS_FILE, friendGraph);
  res.json({ ok: true });
});

app.post('/api/friends/unblock', auth, (req, res) => {
  const otherId = String(req.body?.userId || '');
  if (!otherId) return res.status(400).json({ error: 'userId required' });
  const me = ensureFriendNode(req.user.id);
  me.blocked = me.blocked.filter((id) => id !== otherId);
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
  const mine = new Set(memberRoles(g, user).map((r) => r.id));
  if (role.id === 'everyone' || role.id === 'here') {
    if (basePerms(g, user) & PERM.ADMIN) return true;
    if (['og', 'admin', 'manager', 'moderator', 'developer', 'owner'].some((id) => mine.has(id))) return true;
  }
  const list = Array.isArray(role.mentionBy) ? role.mentionBy : ['everyone'];
  if (!list.length) return false;
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
  const status = effectiveStatus(user);
  return status === 'online' || status === 'idle';
}

function broadcastMention(msg, viewer, g) {
  if (!msg || !g) return false;
  const author = users[msg.authorId];
  if (!author) return false;
  const text = String(msg.content || '');
  const everyone = (g.roles || []).find((role) => role.id === 'everyone');
  const here = (g.roles || []).find((role) => role.id === 'here');
  const everyoneHit = mentionPattern('everyone') && mentionPattern('everyone').test(text) && canMentionRole(g, author, everyone);
  if (everyoneHit) return true;
  const hereHit = mentionPattern('here') && mentionPattern('here').test(text) && canMentionRole(g, author, here);
  return !!(hereHit && isHere(viewer));
}

function messageMentions(msg, user, g) {
  if (broadcastMention(msg, user, g)) return true;
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

function accountReads(userId) {
  const id = String(userId);
  if (!reads[id] || typeof reads[id] !== 'object' || Array.isArray(reads[id])) reads[id] = {};
  return reads[id];
}

function readList(userId, key) {
  if (key.startsWith('dm:')) return messages['dm:' + dmKey(userId, key.slice(3))] || [];
  return messages[key] || [];
}

function cleanReadKey(userId, key) {
  const id = String(key || '');
  if (!id || id.length > 140 || /\s/.test(id)) return '';
  if (id.startsWith('dm:')) {
    const parts = id.slice(3).split(':').filter(Boolean);
    const other = parts.find((part) => part !== String(userId) && users[part]);
    if (!other) return '';
    return 'dm:' + other;
  }
  if (id.startsWith('group:') || id.startsWith('thread:')) return id;
  for (const g of Object.values(guilds.servers)) {
    if (!g || !g.members || !g.members[userId]) continue;
    if ((g.channels || []).some((channel) => channel && channel.id === id)) return id;
  }
  return '';
}

function cursorRank(list, messageId) {
  if (!messageId) return -1;
  const idx = (list || []).findIndex((msg) => msg && msg.id === messageId);
  return idx;
}

function mergeReadMap(userId, incoming, rewinds) {
  const book = accountReads(userId);
  const changed = [];
  const source = incoming && typeof incoming === 'object' ? incoming : {};
  const rewindOf = rewinds && typeof rewinds === 'object' ? rewinds : {};
  for (const raw of Object.keys(source).slice(0, 500)) {
    const key = cleanReadKey(userId, raw);
    if (!key) continue;
    const messageId = String(source[raw] || '').slice(0, 80);
    const before = book[key] || '';
    if (rewindOf[raw] || rewindOf[key]) {
      if (!messageId) {
        if (!before) continue;
        delete book[key];
        changed.push({ roomId: key, messageId: '', rewind: true });
        continue;
      }
      if (before === messageId) continue;
      book[key] = messageId;
      changed.push({ roomId: key, messageId, rewind: true });
      continue;
    }
    if (!messageId || before === messageId) continue;
    const list = readList(userId, key);
    const nextRank = cursorRank(list, messageId);
    const prevRank = cursorRank(list, before);
    if (nextRank === -1 && list.length) continue;
    if (before && prevRank !== -1 && nextRank !== -1 && nextRank < prevRank) continue;
    book[key] = messageId;
    changed.push({ roomId: key, messageId, rewind: false });
  }
  return { book, changed };
}

function publishReads(userId, changed, client) {
  if (!changed.length) return;
  save(READS_FILE, reads);
  if (!hub) return;
  hub.users([String(userId)], 'READ', {
    reads: changed.map((row) => ({ roomId: row.roomId, messageId: row.messageId || '', rewind: !!row.rewind, client: client || '' })),
  });
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
    const cursor = String((seen && (seen['dm:' + other] || seen['dm:' + [String(userId), String(other)].sort().join(':')])) || '');
    let start = list.length;
    if (cursor) {
      const idx = list.findIndex((msg) => msg && msg.id === cursor);
      start = idx === -1 ? list.length : idx + 1;
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
  if (String(content || '').startsWith('NEB2.')) return 'Encrypted message';
  return String(content || '')
    .replace(/\[\[gif:[^\]]+\]\]/g, 'GIF')
    .replace(/\[\[sticker:([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function sendDmList(req, res) {
  ensureGuilds();
  const incoming = req.body && req.body.seen && typeof req.body.seen === 'object' ? req.body.seen : null;
  let seen = accountReads(req.user.id);
  if (incoming) {
    const merged = mergeReadMap(req.user.id, incoming, null);
    seen = merged.book;
    publishReads(req.user.id, merged.changed, String(req.body && req.body.client || '').slice(0, 40));
  }
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
        other: publicUser(users[otherId], req.user),
        updatedAt: Math.max(Number(t.updatedAt) || 0, last && last.createdAt ? Date.parse(last.createdAt) || 0 : 0),
        preview: last ? (last.seal ? 'Encrypted message' : dmPreview(last.content || (last.poll && last.poll.question) || (last.files && last.files[0] && last.files[0].name) || '')) : '',
        lastId: last ? last.id : '',
        lastFrom: last ? last.authorId : '',
        unread: note ? note.unread : 0,
      };
    })
    .filter((t) => t.other);
  res.json({ ok: true, dms: list, seen });
}

app.get('/api/dms', auth, sendDmList);
app.post('/api/dms', auth, sendDmList);

app.get('/api/dms/:userId/messages', auth, (req, res) => {
  const otherId = req.params.userId;
  if (!users[otherId]) return res.status(404).json({ error: 'User not found' });
  const key = dmKey(req.user.id, otherId);
  const list = messages['dm:' + key] || [];
  const all = req.query.all === '1' || req.query.all === 'true';
  const after = String(req.query.after || '');
  let slice = list;
  let mode = 'all';
  if (!all) {
    if (after) {
      const at = list.findIndex((msg) => msg && msg.id === after);
      if (at >= 0) {
        slice = list.slice(at + 1);
        mode = 'delta';
      }
    } else {
      slice = list.slice(-100);
    }
  }
  noteBrief(req.user, [otherId]);
  res.json({
    ok: true,
    mode,
    wraps: (dmThreads[key] && dmThreads[key].wraps) || null,
    messages: slice.map((msg) => presentMessage(msg, req.user.id)),
    other: publicUser(users[otherId], req.user),
  });
});

app.post('/api/dms/:userId/messages', auth, (req, res) => {
  const otherId = req.params.userId;
  if (!users[otherId]) return res.status(404).json({ error: 'User not found' });
  if (otherId === req.user.id) return res.status(400).json({ error: 'Cannot DM yourself' });
  if (!canMessage(req.user, users[otherId])) return res.status(403).json({ error: messageBlockReason(users[otherId]) });
  if (!isRootAccount(req.user) && (req.user.locked || req.user.muted || req.user.restrictMessages)) {
    return res.status(403).json({ error: 'Messaging is restricted on this account' });
  }
  if (!isRootAccount(req.user) && (req.user.restrictImages || req.user.restrictFiles) && Array.isArray(req.body?.files) && req.body.files.length) {
    return res.status(403).json({ error: 'Uploads are restricted on this account' });
  }

  const extra = messageExtras(req.body);
  if (extra.error) return res.status(400).json({ error: extra.error });
  const shareBlock = contentShareBlock(req.user, [users[otherId]], extra.content, extra.files);
  if (shareBlock) return res.status(403).json({ error: shareBlock });

  const key = dmKey(req.user.id, otherId);
  const channelId = 'dm:' + key;

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
  const wraps = readWraps(req.body);
  if (wraps && !dmThreads[key].wraps) dmThreads[key].wraps = wraps;
  save(DMS_FILE, dmThreads);

  if (!messages[channelId]) messages[channelId] = [];
  const msg = {
    id: uuidv4(),
    channelId,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: extra.seal ? '' : extra.content,
    seal: extra.seal || undefined,
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
  publishCreate(channelId, msg);
  noteBrief(req.user, [otherId]);
  touchAlerts();
  res.json({ ok: true, message: presentMessage(msg, req.user.id) });
});

function appendRoomMessage(roomId, req) {
  const extra = messageExtras(req.body);
  if (extra.error) return { error: extra.error };
  if (!messages[roomId]) messages[roomId] = [];
  const msg = {
    id: uuidv4(),
    channelId: roomId,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: extra.seal ? '' : extra.content,
    seal: extra.seal || undefined,
    files: extra.files,
    poll: extra.poll,
    replies: readReplies(req.body, roomId),
    reply: readReply(req.body, roomId),
    createdAt: new Date().toISOString(),
  };
  messages[roomId].push(msg);
  if (messages[roomId].length > 500) messages[roomId] = messages[roomId].slice(-500);
  save(MESSAGES_FILE, messages);
  silenceTyping(roomId, req.user.id, req.body && req.body.typingToken);
  publishCreate(roomId, msg);
  noteBrief(req.user, peersOfRoom(roomId, req.user.id));
  touchAlerts();
  return { message: msg };
}

function publicGroup(group, viewer) {
  const memberIds = (group.memberIds || []).map(String);
  const members = memberIds.map((id) => publicUser(users[id], viewer)).filter(Boolean);
  const room = messages['group:' + group.id] || [];
  const last = room[room.length - 1];
  return {
    id: group.id,
    name: group.name || 'Group',
    iconUrl: group.iconUrl || '',
    ownerId: group.ownerId,
    memberCount: members.length,
    members,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt || Date.parse(group.createdAt) || 0,
    lastId: last ? last.id : '',
    preview: last ? (last.seal ? 'Encrypted message' : dmPreview(last.content || '')) : '',
  };
}

function threadVisible(thread, user, found) {
  if (!thread || !thread.private) return true;
  if (!user || !found) return false;
  const id = String(user.id);
  if (String(thread.ownerId) === id) return true;
  if ((thread.followers || []).map(String).includes(id)) return true;
  return isOwner(found.guild, user) || can(found.guild, user, PERM.MANAGE_CHANNELS, found.channel);
}

function publicThread(thread) {
  const room = messages['thread:' + thread.id] || [];
  const last = room[room.length - 1];
  return {
    id: thread.id,
    name: thread.name,
    channelId: thread.channelId,
    serverId: thread.serverId,
    ownerId: thread.ownerId,
    createdAt: thread.createdAt,
    messageCount: room.length,
    lastAt: last ? last.createdAt : thread.createdAt,
    closed: !!thread.closed,
    private: !!thread.private,
    followers: (thread.followers || []).map(String),
  };
}

function viewerRoom(req) {
  const groupId = String(req.query.groupId || (req.body && req.body.groupId) || '');
  if (groupId) {
    const group = groups[groupId];
    if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) {
      return { error: 'Not in this group', status: 403 };
    }
    return { roomId: 'group:' + groupId };
  }
  const threadId = String(req.query.threadId || (req.body && req.body.threadId) || '');
  if (threadId) {
    const thread = threads[threadId];
    if (!thread) return { error: 'Thread not found', status: 404 };
    const found = findChannel(thread.channelId, thread.serverId);
    if (!found || !can(found.guild, req.user, PERM.VIEW, found.channel)) {
      return { error: 'Cannot view this thread', status: 403 };
    }
    return { roomId: 'thread:' + threadId, thread, found };
  }
  const dmUserId = String(req.query.dmUserId || (req.body && req.body.dmUserId) || '');
  if (dmUserId) {
    if (!users[dmUserId]) return { error: 'User not found', status: 404 };
    return { roomId: 'dm:' + dmKey(req.user.id, dmUserId) };
  }
  const channelId = String(req.query.channelId || '');
  const serverId = String(req.query.serverId || '');
  const found = findChannel(channelId, serverId);
  if (!found) return { error: 'Chat not found', status: 404 };
  if (!can(found.guild, req.user, PERM.VIEW, found.channel)) {
    return { error: 'Cannot view this channel', status: 403 };
  }
  return { roomId: found.channel.id, found };
}

app.get('/api/users/search', auth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/^#/, '');
  if (!q) return res.json({ ok: true, users: [] });
  const rows = [];
  for (const user of Object.values(users)) {
    if (!user || String(user.id) === String(req.user.id)) continue;
    if (isBlocked(req.user.id, user.id)) continue;
    const blob = ((user.username || '') + ' ' + (user.displayName || '') + ' ' + (user.uid || '')).toLowerCase();
    if (!blob.includes(q)) continue;
    rows.push(publicUser(user, req.user));
    if (rows.length >= 20) break;
  }
  res.json({ ok: true, users: rows });
});

app.get('/api/users/:id', auth, (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const pub = publicUser(user, req.user);
  delete pub.email;
  delete pub.mfa;
  delete pub.passkeyCount;
  delete pub.sessionCount;
  delete pub.canAdmin;
  res.json({ ok: true, user: pub });
});

app.get('/api/groups', auth, (req, res) => {
  const mine = Object.values(groups)
    .filter((group) => group && (group.memberIds || []).map(String).includes(String(req.user.id)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(publicGroup);
  res.json({ ok: true, groups: mine });
});

app.post('/api/groups', auth, (req, res) => {
  const ids = [...new Set((req.body?.memberIds || []).map(String).filter((id) => id && id !== String(req.user.id) && users[id]))];
  if (ids.length < 1) return res.status(400).json({ error: 'Pick at least one friend' });
  if (ids.length > 9) return res.status(400).json({ error: 'A group can have 10 people' });
  for (const id of ids) {
    if (!canAddToGroup(req.user, users[id])) return res.status(400).json({ error: groupBlockReason(users[id]) });
  }
  const name = String(req.body?.name || '').trim().slice(0, 80) || 'Group';
  const iconUrl = String(req.body?.iconUrl || '').slice(0, 300);
  const id = uuidv4();
  const group = {
    id,
    name,
    iconUrl,
    ownerId: String(req.user.id),
    memberIds: [String(req.user.id), ...ids],
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
  };
  groups[id] = group;
  save(GROUPS_FILE, groups);
  const roomId = 'group:' + id;
  messages[roomId] = [{
    id: uuidv4(),
    channelId: roomId,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: 'Welcome to the beginning of the ' + name + ' group.',
    files: [],
    createdAt: new Date().toISOString(),
    system: true,
  }];
  save(MESSAGES_FILE, messages);
  res.json({ ok: true, group: publicGroup(group, req.user) });
});

app.post('/api/groups/:id/messages', auth, (req, res) => {
  const group = groups[req.params.id];
  if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) {
    return res.status(404).json({ error: 'Group not found' });
  }
  const preview = messageExtras(req.body);
  if (preview.error) return res.status(400).json({ error: preview.error });
  const members = (group.memberIds || []).map((id) => users[id]).filter(Boolean);
  const shareBlock = contentShareBlock(req.user, members, preview.content, preview.files);
  if (shareBlock) return res.status(403).json({ error: shareBlock });
  const made = appendRoomMessage('group:' + group.id, req);
  if (made.error) return res.status(400).json({ error: made.error });
  const wraps = readWraps(req.body);
  if (wraps && !group.wraps) group.wraps = wraps;
  group.updatedAt = Date.now();
  save(GROUPS_FILE, groups);
  res.json({ ok: true, message: presentMessage(made.message, req.user.id) });
});

app.get('/api/groups/:id/messages', auth, (req, res) => {
  const group = groups[req.params.id];
  if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) {
    return res.status(404).json({ error: 'Group not found' });
  }
  const list = messages['group:' + group.id] || [];
  noteBrief(req.user, peersOfRoom('group:' + group.id, req.user.id));
  res.json({ ok: true, wraps: group.wraps || null, messages: list.slice(-100).map((msg) => presentMessage(msg, req.user.id)), group: publicGroup(group, req.user) });
});

app.post('/api/groups/:id/members', auth, (req, res) => {
  const group = groups[req.params.id];
  if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) {
    return res.status(404).json({ error: 'Group not found' });
  }
  const userId = String(req.body?.userId || '');
  if (!users[userId]) return res.status(404).json({ error: 'User not found' });
  if (!canAddToGroup(req.user, users[userId])) return res.status(400).json({ error: groupBlockReason(users[userId]) });
  if (!group.memberIds.map(String).includes(userId)) {
    if (group.memberIds.length >= 10) return res.status(400).json({ error: 'This group is full' });
    group.memberIds.push(userId);
    group.updatedAt = Date.now();
    save(GROUPS_FILE, groups);
  }
  res.json({ ok: true, group: publicGroup(group, req.user) });
});

app.post('/api/groups/:id/leave', auth, (req, res) => {
  const group = groups[req.params.id];
  if (!group) return res.status(404).json({ error: 'Group not found' });
  group.memberIds = (group.memberIds || []).map(String).filter((id) => id !== String(req.user.id));
  group.updatedAt = Date.now();
  if (!group.memberIds.length) delete groups[group.id];
  else if (String(group.ownerId) === String(req.user.id)) group.ownerId = group.memberIds[0];
  save(GROUPS_FILE, groups);
  res.json({ ok: true });
});

app.post('/api/groups/:id', auth, (req, res) => {
  const group = groups[req.params.id];
  if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) {
    return res.status(404).json({ error: 'Group not found' });
  }
  if (req.body && typeof req.body.name === 'string') {
    const name = req.body.name.trim().slice(0, 80);
    if (name) group.name = name;
  }
  if (req.body && typeof req.body.iconUrl === 'string') group.iconUrl = req.body.iconUrl.slice(0, 300);
  group.updatedAt = Date.now();
  save(GROUPS_FILE, groups);
  res.json({ ok: true, group: publicGroup(group, req.user) });
});

app.get('/api/channels/:id/threads', auth, (req, res) => {
  const found = findChannel(req.params.id, String(req.query.serverId || ''));
  if (!found) return res.status(404).json({ error: 'Channel not found' });
  if (!can(found.guild, req.user, PERM.VIEW, found.channel)) return res.status(403).json({ error: 'Cannot view this channel' });
  const list = Object.values(threads)
    .filter((thread) => thread && thread.channelId === found.channel.id && !thread.closed && threadVisible(thread, req.user, found))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .map(publicThread);
  res.json({ ok: true, threads: list });
});

app.post('/api/channels/:id/threads', auth, (req, res) => {
  const found = findChannel(req.params.id, String(req.body?.serverId || ''));
  if (!found) return res.status(404).json({ error: 'Channel not found' });
  if (found.channel.type === 'voice') return res.status(400).json({ error: 'Threads belong in a text channel' });
  if (!can(found.guild, req.user, PERM.SEND, found.channel)) return res.status(403).json({ error: 'You cannot post here' });
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!name) return res.status(400).json({ error: 'Give the thread a name' });
  if (!content) return res.status(400).json({ error: 'Write the first message' });
  const id = uuidv4();
  const thread = {
    id,
    name,
    channelId: found.channel.id,
    serverId: found.guild.id,
    ownerId: String(req.user.id),
    createdAt: new Date().toISOString(),
    closed: false,
    private: !!req.body?.private,
    followers: [String(req.user.id)],
  };
  threads[id] = thread;
  save(THREADS_FILE, threads);
  const made = appendRoomMessage('thread:' + id, { user: req.user, body: { content } });
  if (made.error) return res.status(400).json({ error: made.error });
  res.json({ ok: true, thread: publicThread(thread) });
});

app.get('/api/threads/:id/messages', auth, (req, res) => {
  const thread = threads[req.params.id];
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  const found = findChannel(thread.channelId, thread.serverId);
  if (!found || !can(found.guild, req.user, PERM.VIEW, found.channel) || !threadVisible(thread, req.user, found)) {
    return res.status(403).json({ error: 'Cannot view this thread' });
  }
  const list = messages['thread:' + thread.id] || [];
  res.json({
    ok: true,
    messages: list.slice(-100).map((msg) => presentMessage(msg, req.user.id)),
    thread: publicThread(thread),
    channelName: found.channel.name,
  });
});

app.post('/api/threads/:id/messages', auth, (req, res) => {
  const thread = threads[req.params.id];
  if (!thread || thread.closed) return res.status(404).json({ error: 'Thread not found' });
  const found = findChannel(thread.channelId, thread.serverId);
  if (!found || !can(found.guild, req.user, PERM.SEND, found.channel) || !threadVisible(thread, req.user, found)) {
    return res.status(403).json({ error: 'You cannot post here' });
  }
  const made = appendRoomMessage('thread:' + thread.id, req);
  if (made.error) return res.status(400).json({ error: made.error });
  if (!(thread.followers || []).map(String).includes(String(req.user.id))) {
    thread.followers = [...(thread.followers || []).map(String), String(req.user.id)];
    save(THREADS_FILE, threads);
  }
  res.json({ ok: true, message: presentMessage(made.message, req.user.id) });
});

app.post('/api/threads/:id/action', auth, (req, res) => {
  const thread = threads[req.params.id];
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  const found = findChannel(thread.channelId, thread.serverId);
  if (!found || !can(found.guild, req.user, PERM.VIEW, found.channel) || !threadVisible(thread, req.user, found)) {
    return res.status(403).json({ error: 'Cannot view this thread' });
  }
  const type = String(req.body?.type || '');
  const mine = String(thread.ownerId) === String(req.user.id);
  const manage = can(found.guild, req.user, PERM.MANAGE_CHANNELS, found.channel);
  if (type === 'follow') {
    thread.followers = [...new Set([...(thread.followers || []).map(String), String(req.user.id)])];
  } else if (type === 'unfollow') {
    thread.followers = (thread.followers || []).map(String).filter((id) => id !== String(req.user.id));
  } else if (type === 'rename') {
    if (!mine && !manage) return res.status(403).json({ error: 'You cannot edit this thread' });
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Give the thread a name' });
    thread.name = name;
  } else if (type === 'close') {
    if (!mine && !manage) return res.status(403).json({ error: 'You cannot close this thread' });
    thread.closed = true;
  } else if (type === 'delete') {
    if (!mine && !manage) return res.status(403).json({ error: 'You cannot delete this thread' });
    delete messages['thread:' + thread.id];
    save(MESSAGES_FILE, messages);
    delete threads[thread.id];
    save(THREADS_FILE, threads);
    return res.json({ ok: true, deleted: true });
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }
  save(THREADS_FILE, threads);
  res.json({ ok: true, thread: publicThread(thread) });
});

app.post('/api/messages/:id/pin', auth, (req, res) => {
  const found = locateMessage(req.params.id);
  if (!found || !canSeeRoom(req.user, found.roomId)) return res.status(404).json({ error: 'Message not found' });
  const on = !(req.body && req.body.on === false);
  found.msg.pinned = on;
  found.msg.pinnedAt = on ? new Date().toISOString() : '';
  save(MESSAGES_FILE, messages);
  publishUpdate(found.roomId, found.msg);
  res.json({ ok: true, message: presentMessage(found.msg, req.user.id) });
});

function searchHit(msg, query) {
  const text = String(msg.content || '');
  let rest = query;
  const take = (token) => {
    const match = rest.match(new RegExp('(?:^|\\s)' + token + ':(\\S+)', 'i'));
    if (!match) return '';
    rest = rest.replace(match[0], ' ');
    return match[1];
  };
  const from = take('from');
  const mentions = take('mentions');
  const has = take('has');
  const before = take('before');
  const after = take('after');
  const during = take('during');
  const pinned = /(?:^|\s)pinned:true\b/i.test(rest);
  if (pinned) rest = rest.replace(/(?:^|\s)pinned:true\b/ig, ' ');
  rest = rest.trim().toLowerCase();
  if (pinned && !msg.pinned) return false;
  if (from) {
    const who = ((msg.author && (msg.author.username || '')) + ' ' + ((msg.author && msg.author.displayName) || '')).toLowerCase();
    if (!who.includes(from.toLowerCase())) return false;
  }
  if (mentions && !text.toLowerCase().includes('@' + mentions.toLowerCase())) return false;
  if (has === 'link' && !/https?:\/\//i.test(text)) return false;
  if (has === 'file' && !(msg.files || []).length) return false;
  if (has === 'image' && !(msg.files || []).some((file) => file.kind === 'image' || /^image\//.test(file.type || '') || /\.(png|jpe?g|gif|webp)$/i.test(file.name || file.url || ''))) return false;
  if (has === 'video' && !(msg.files || []).some((file) => file.kind === 'video' || /^video\//.test(file.type || '') || /\.(mp4|webm|mov)$/i.test(file.name || file.url || ''))) return false;
  if (before && Date.parse(msg.createdAt) >= Date.parse(before)) return false;
  if (after && Date.parse(msg.createdAt) <= Date.parse(after)) return false;
  if (during) {
    const day = String(msg.createdAt || '').slice(0, 10);
    if (day !== during) return false;
  }
  if (rest && !text.toLowerCase().includes(rest)) return false;
  return true;
}

app.get('/api/room/search', auth, (req, res) => {
  const room = viewerRoom(req);
  if (room.error) return res.status(room.status).json({ error: room.error });
  const q = String(req.query.q || '').trim();
  const list = (messages[room.roomId] || []).filter((msg) => msg && searchHit(msg, q)).slice(-50);
  res.json({ ok: true, messages: list.map((msg) => presentMessage(msg, req.user.id)) });
});

app.get('/api/room/pins', auth, (req, res) => {
  const room = viewerRoom(req);
  if (room.error) return res.status(room.status).json({ error: room.error });
  const list = (messages[room.roomId] || []).filter((msg) => msg && msg.pinned);
  res.json({ ok: true, messages: list.map((msg) => presentMessage(msg, req.user.id)) });
});

app.get('/api/room/media', auth, (req, res) => {
  const room = viewerRoom(req);
  if (room.error) return res.status(room.status).json({ error: room.error });
  const kind = String(req.query.kind || 'all');
  const who = String(req.query.user || '').trim().toLowerCase();
  const files = [];
  for (const msg of messages[room.roomId] || []) {
    if (!msg) continue;
    const author = (msg.author && (msg.author.username || msg.author.displayName) || '').toLowerCase();
    if (who && who !== 'anyone' && !author.includes(who)) continue;
    for (const file of msg.files || []) {
      const name = file.name || file.url || '';
      const type = file.type || '';
      const image = file.kind === 'image' || /^image\//.test(type) || /\.(png|jpe?g|gif|webp)$/i.test(name);
      const video = file.kind === 'video' || /^video\//.test(type) || /\.(mp4|webm|mov)$/i.test(name);
      if (kind === 'images' && !image) continue;
      if (kind === 'videos' && !video) continue;
      if (kind === 'files' && (image || video)) continue;
      files.push({ ...file, author: msg.author, createdAt: msg.createdAt, messageId: msg.id });
    }
  }
  res.json({ ok: true, files: files.slice(-80) });
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
    const pub = publicUser(other, req.user);
    dms.push({ id: pub.id, name: pub.displayName || pub.username, boxKey: pub.boxKey || '', canSendLinks: pub.canSendLinks, canSendMedia: pub.canSendMedia });
  };
  for (const thread of Object.values(dmThreads)) {
    if (!thread || (String(thread.a) !== String(req.user.id) && String(thread.b) !== String(req.user.id))) continue;
    addDm(String(thread.a) === String(req.user.id) ? thread.b : thread.a);
  }
  const node = ensureFriendNode(req.user.id);
  for (const id of node.friends || []) addDm(id);
  res.json({ ok: true, channels, dms });
});

app.get('/api/messages/:id/reactions', auth, (req, res) => {
  const found = locateMessage(req.params.id);
  if (!found || !canSeeRoom(req.user, found.roomId)) return res.status(404).json({ error: 'Message not found' });
  res.json({ ok: true, reactions: publicReactions(found.msg, req.user.id) });
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
  publishUpdate(found.roomId, msg);
  noteBotReaction(found.roomId, req.user, emoji, mine < 0, msg);
  res.json({ ok: true, message: presentMessage(msg, req.user.id) });
});

app.patch('/api/messages/:id', auth, (req, res) => {
  const found = locateMessage(req.params.id);
  if (!found || !canSeeRoom(req.user, found.roomId)) return res.status(404).json({ error: 'Message not found' });
  let content = String(req.body && req.body.content || '').trim();
  content = content.startsWith('NEB2.') ? content.slice(0, 16000) : content.slice(0, 2000);
  const packing = !!(req.body && req.body.reseal) && content.startsWith('NEB2.');
  if (!packing && String(found.msg.authorId) !== String(req.user.id)) return res.status(403).json({ error: 'You can only edit your own messages' });
  if (packing && String(found.msg.content || '').startsWith('NEB2.')) {
    return res.json({ ok: true, message: presentMessage(found.msg, req.user.id) });
  }
  if (!content && !(found.msg.files || []).length && !found.msg.poll) return res.status(400).json({ error: 'Message is empty' });
  found.msg.content = content;
  delete found.msg.seal;
  if (!packing) found.msg.editedAt = new Date().toISOString();
  if (!String(found.roomId).startsWith('dm:')) {
    const channel = findChannel(found.roomId, '');
    if (channel) found.msg.mentions = parseMentions(channel.guild, req.user, content);
  }
  save(MESSAGES_FILE, messages);
  publishUpdate(found.roomId, found.msg);
  if (!packing) noteBotEdit(found.roomId, found.msg);
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
  publishDelete(found.roomId, req.params.id);
  noteBotDelete(found.roomId, found.msg);
  res.json({ ok: true });
});

app.post('/api/messages/:id/forward', auth, (req, res) => {
  const found = locateMessage(req.params.id);
  if (!found || !canSeeRoom(req.user, found.roomId)) return res.status(404).json({ error: 'Message not found' });
  const src = found.msg;
  const name = (src.author && (src.author.displayName || src.author.username)) || 'Someone';
  if (src.seal) return res.status(400).json({ error: 'That message is encrypted' });
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
    if (!canMessage(req.user, users[userId])) return res.status(403).json({ error: messageBlockReason(users[userId]) });
    const shareBlock = contentShareBlock(req.user, [users[userId]], text, copiedFiles);
    if (shareBlock) return res.status(403).json({ error: shareBlock });
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
  publishCreate(roomId, msg);
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
    publishUpdate(msg.channelId, msg);
    return res.json({ ok: true, poll: publicPoll(msg.poll, req.user.id) });
  }
  res.status(404).json({ error: 'Poll not found' });
});

function sectionOrder(g, override) {
  const cats = (g.categories || []).map((cat) => String(cat && cat.id || '')).filter(Boolean);
  const allowed = new Set(['text', 'voice', ...cats]);
  const source = Array.isArray(override) ? override : (g.categoryOrder || []);
  const order = [];
  for (const id of source) {
    const key = String(id || '');
    if (!allowed.has(key) || order.includes(key)) continue;
    order.push(key);
  }
  if (!order.includes('text')) order.unshift('text');
  if (!order.includes('voice')) order.splice(order.indexOf('text') + 1, 0, 'voice');
  for (const id of cats) if (!order.includes(id)) order.push(id);
  return order;
}

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
    tagIcon: g.tagIcon || '',
    tagColor: g.tagColor || '',
    links: Array.isArray(g.links) ? g.links : [],
    hideMembers: !!g.hideMembers,
    rulesChannelId: g.rulesChannelId || '',
    lobby: publicLobby(g),
    vanity: g.id === OFFICIAL_ID ? 'nebula' : (g.vanity || ''),
    memberCount: memberCount(g),
    canCustomize: canCustomize(g),
    about: g.about || '',
    showLobby: !!g.showLobby,
    color: g.color,
    theme: g.theme,
    categories: g.categories,
    categoryOrder: sectionOrder(g),
    channels: g.channels,
    roles: g.roles,
    emoji: g.emoji,
    stickers: g.stickers,
    events: g.events,
    pingRoleIds: g.pingRoleIds,
    onboarding: g.onboarding,
    lockedUntil: g.lockedUntil || 0,
    official: g.id === OFFICIAL_ID,
    discover: g.discover !== false,
    slug: serverSlug(g),
    roomKey: g.discover !== false ? (g.roomKey || '') : '',
    myNick: (g.members[user.id] && g.members[user.id].nick) || '',
  };
  if (!manage) return base;
  const lobby = g.lobby && typeof g.lobby === 'object' ? g.lobby : {};
  return Object.assign(base, {
    lobby: Object.assign(publicLobby(g), { feedId: lobby.feedId || '', feedToken: lobby.feedToken || '' }),
    raid: g.raid,
    verification: g.verification,
    joinMode: g.joinMode,
    joinQuestions: g.joinQuestions,
    requests: (g.requests || []).map((r) => Object.assign({}, r, { user: users[r.userId] ? publicUser(users[r.userId]) : null })),
    reports: g.reports,
    audit: g.audit,
    bans: Object.keys(g.bans).map((id) => ({ userId: id, reason: g.bans[id].reason, at: g.bans[id].at, user: users[id] ? publicUser(users[id]) : null })),
    voiceBans: Object.keys(g.voiceBans || {}).map((id) => ({ userId: id, reason: (g.voiceBans[id] && g.voiceBans[id].reason) || '', at: g.voiceBans[id] && g.voiceBans[id].at, user: users[id] ? publicUser(users[id]) : null })),
    members: canSeeMemberList(g, user) ? Object.keys(g.members).map((id) => users[id] ? memberView(g, users[id], user) : null).filter(Boolean) : [],
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
    ? ['kick', 'ban', 'unban', 'timeout', 'nick-other', 'report-handle', 'voice-ban', 'voice-unban']
    : (staff >= 1 ? ['kick', 'timeout', 'nick-other', 'voice-ban', 'voice-unban'] : []);
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
  if (type === 'leave') {
    if (g.id === OFFICIAL_ID) return res.status(400).json({ error: 'You cannot leave Nebula Official' });
    if (!g.members[req.user.id]) return res.json({ ok: true });
    const owners = (g.ownerIds || []).map(String);
    const remaining = owners.filter((id) => id !== String(req.user.id));
    if (owners.includes(String(req.user.id)) && !remaining.length) {
      return res.status(400).json({ error: 'You own this server. Delete it instead of leaving.' });
    }
    delete g.members[req.user.id];
    g.ownerIds = remaining;
    audit(g, req.user, 'left the server');
    saveGuilds();
    noteBotLeave(g, req.user);
    wakeGuild(g);
    return res.json({ ok: true });
  }
  if (type === 'event') {
    const fresh = () => (g.events || []).filter((ev) => ev.status !== 'cancelled').slice(0, 30);
    const found = () => (g.events || []).find((ev) => ev.id === String(req.body.id || ''));
    const canEdit = (ev) => manage || (ev && String(ev.hostId) === String(req.user.id));
    if (req.body.cancel || req.body.remove) {
      const ev = found();
      if (!ev) return res.status(404).json({ error: 'Event not found' });
      if (!canEdit(ev)) return res.status(403).json({ error: 'You do not have permission' });
      g.events = g.events.filter((row) => row.id !== ev.id);
      saveGuilds();
      return res.json({ ok: true, events: fresh() });
    }
    if (req.body.interest) {
      const ev = found();
      if (!ev) return res.status(404).json({ error: 'Event not found' });
      const id = String(req.user.id);
      const list = Array.isArray(ev.interested) ? ev.interested.map(String) : [];
      ev.interested = list.includes(id) ? list.filter((row) => row !== id) : list.concat(id).slice(0, 500);
      saveGuilds();
      return res.json({ ok: true, events: fresh() });
    }
    if (req.body.startNow) {
      const ev = found();
      if (!ev) return res.status(404).json({ error: 'Event not found' });
      if (!canEdit(ev)) return res.status(403).json({ error: 'You do not have permission' });
      ev.status = 'live';
      ev.start = new Date().toISOString();
      saveGuilds();
      if (ev.announceChannelId) {
        try {
          const channel = (g.channels || []).find((ch) => ch.id === ev.announceChannelId && ch.type !== 'voice');
          if (channel) {
            if (!messages[channel.id]) messages[channel.id] = [];
            const msg = {
              id: uuidv4(),
              channelId: channel.id,
              authorId: req.user.id,
              author: slimAuthor(req.user),
              content: 'Event started: ' + (ev.title || 'Event'),
              files: [],
              createdAt: new Date().toISOString(),
            };
            messages[channel.id].push(msg);
            if (messages[channel.id].length > 500) messages[channel.id] = messages[channel.id].slice(-500);
            save(MESSAGES_FILE, messages);
            publishCreate(channel.id, msg);
          }
        } catch (_) {}
      }
      return res.json({ ok: true, events: fresh() });
    }
    const title = clip(req.body.title, 80).trim();
    if (!title) return res.status(400).json({ error: 'Event name required' });
    const existing = req.body.id ? found() : null;
    if (req.body.id && !existing) return res.status(404).json({ error: 'Event not found' });
    if (existing && !canEdit(existing)) return res.status(403).json({ error: 'You do not have permission' });
    const next = {
      id: existing ? existing.id : uuidv4(),
      title,
      description: clip(req.body.description, 400),
      where: req.body.where === 'elsewhere' ? 'elsewhere' : 'voice',
      channelId: clip(req.body.channelId, 80),
      elsewhere: clip(req.body.elsewhere, 80),
      start: clip(req.body.start, 40),
      end: clip(req.body.end, 40),
      repeat: 'once',
      announceChannelId: clip(req.body.announceChannelId, 80),
      coverUrl: clip(req.body.coverUrl, 2000000),
      hostId: existing ? existing.hostId : req.user.id,
      hostName: existing ? (existing.hostName || req.user.displayName || req.user.username || 'Member') : (req.user.displayName || req.user.username || 'Member'),
      interested: existing && Array.isArray(existing.interested) ? existing.interested : [],
      status: existing && existing.status === 'live' ? 'live' : 'scheduled',
      at: existing ? existing.at : new Date().toISOString(),
      when: clip(req.body.when, 40),
    };
    if (existing) g.events = g.events.map((row) => row.id === existing.id ? next : row);
    else {
      g.events.unshift(next);
      g.events = g.events.slice(0, 30);
    }
    audit(g, req.user, (existing ? 'updated the event ' : 'created the event ') + title);
    saveGuilds();
    return res.json({ ok: true, events: fresh() });
  }
  const channelOps = ['category', 'category-delete', 'category-move', 'category-order', 'set-category', 'move-channel'];
  const canChannels = can(g, req.user, PERM.MANAGE_CHANNELS);
  if (!manage && !(canChannels && channelOps.includes(type)) && !moderate.includes(type) && type !== 'report') return res.status(403).json({ error: 'You do not have permission' });
  if (['kick', 'ban', 'timeout', 'nick-other', 'voice-ban'].includes(type)) {
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
    if (b.tag != null || b.tagIcon != null || b.vanity != null || b.tagColor != null) {
      const nextTag = b.tag != null ? cleanTag(b.tag) : (g.tag || '');
      const nextIcon = b.tagIcon != null ? String(b.tagIcon || '') : (g.tagIcon || '');
      if (b.tag != null && nextTag && (nextTag.length < 2 || nextTag.length > 6)) return res.status(400).json({ error: 'A tag is 2 to 6 letters or numbers' });
      if (nextIcon && !TAG_ICONS.includes(nextIcon)) return res.status(400).json({ error: 'Pick a tag icon from the list' });
      const wantsCustom = (b.tag != null && nextTag) || (b.vanity != null && g.id !== OFFICIAL_ID && cleanSlug(b.vanity));
      if (wantsCustom && !canCustomize(g)) {
        return res.status(400).json({ error: 'This server needs 5 members before it can have a tag or invite link' });
      }
      if (b.tag != null) g.tag = nextTag;
      if (b.tagIcon != null) g.tagIcon = nextIcon && TAG_ICONS.includes(nextIcon) ? nextIcon : '';
      if (b.tagColor != null) {
        const color = String(b.tagColor || '').trim();
        g.tagColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '';
      }
      if (g.id === OFFICIAL_ID) g.vanity = 'nebula';
      else if (b.vanity != null) {
        const slug = cleanSlug(b.vanity);
        if (!slug) g.vanity = '';
        else if (slug.length < 2) return res.status(400).json({ error: 'Invite link needs at least 2 characters' });
        else if (RESERVED_LINKS.has(slug) || Object.values(guilds.servers).some((other) => other.id !== g.id && String(other.vanity || '').toLowerCase() === slug)) {
          return res.status(409).json({ error: 'That invite link is taken' });
        } else g.vanity = slug;
      }
    }
    if (b.about != null) g.about = clip(b.about, 2000);
    if (b.showLobby != null) g.showLobby = !!b.showLobby;
    if (Array.isArray(b.links)) {
      g.links = b.links.slice(0, 8).map((item) => ({
        label: clip(item && item.label, 40).trim(),
        url: clip(item && item.url, 200).trim(),
      })).filter((item) => item.label && /^https?:\/\//i.test(item.url));
    }
    if (b.hideMembers != null) g.hideMembers = !!b.hideMembers;
    if (b.rulesChannelId != null) {
      const id = String(b.rulesChannelId || '');
      g.rulesChannelId = id && (g.channels || []).some((ch) => ch.id === id) ? id : '';
    }
    if (b.lobby && typeof b.lobby === 'object') g.lobby = sanitizeLobby(b.lobby, g.lobby);
    if (b.makeFeed) {
      g.lobby = g.lobby && typeof g.lobby === 'object' ? g.lobby : defaultLobby();
      if (!g.lobby.feedId) g.lobby.feedId = uuidv4();
      if (!g.lobby.feedToken) g.lobby.feedToken = crypto.randomBytes(18).toString('hex');
    }
    if (b.discover != null) {
      g.discover = !!b.discover;
      if (g.discover) {
        const roomKey = String(b.roomKey || g.roomKey || '');
        if (!/^[A-Za-z0-9+/]{40,80}={0,2}$/.test(roomKey)) {
          return res.status(400).json({ error: 'Open this server on a device that already has the key, then list it' });
        }
        g.roomKey = roomKey;
      } else {
        g.roomKey = '';
      }
    }
    if (b.color != null) g.color = clip(b.color, 20);
    if (b.theme && typeof b.theme === 'object') {
      const accent = clip(b.theme.accent, 20) || (g.theme && g.theme.accent) || g.color || '#7c6af7';
      g.theme = { accent, tint: '' };
      g.color = accent;
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
    const taken = (g.categories || []).some((c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase());
    if (taken) return res.status(400).json({ error: 'A category with that name already exists' });
    const cat = { id: uuidv4(), name };
    g.categories.push(cat);
    g.categoryOrder = sectionOrder(g);
    audit(g, req.user, 'created the category ' + name);
    saveGuilds();
    return res.json({ ok: true, category: cat });
  }
  if (type === 'category-delete') {
    const categoryId = String(req.body.categoryId || '');
    if (!categoryId || !(g.categories || []).some((c) => String(c.id) === categoryId)) return res.status(404).json({ error: 'Category not found' });
    const removed = (g.categories || []).find((c) => String(c.id) === categoryId);
    g.categories = (g.categories || []).filter((c) => String(c.id) !== categoryId);
    g.categoryOrder = sectionOrder(g);
    (g.channels || []).forEach((c) => { if (String(c.categoryId) === categoryId) c.categoryId = ''; });
    audit(g, req.user, 'deleted the category ' + (removed && removed.name ? removed.name : categoryId));
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'category-move') {
    const categoryId = String(req.body.categoryId || '');
    const order = sectionOrder(g);
    const idx = order.indexOf(categoryId);
    const next = idx + (req.body.dir === 'up' ? -1 : 1);
    if (idx < 0 || next < 0 || next >= order.length) return res.json({ ok: true, categoryOrder: order });
    const tmp = order[idx];
    order[idx] = order[next];
    order[next] = tmp;
    g.categoryOrder = order;
    saveGuilds();
    return res.json({ ok: true, categoryOrder: order });
  }
  if (type === 'category-order') {
    const order = sectionOrder(g, req.body.ids);
    g.categoryOrder = order;
    saveGuilds();
    return res.json({ ok: true, categoryOrder: order });
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
  if (type === 'kick' || type === 'ban') {
    const userId = String(req.body.userId || '');
    if (!g.members[userId]) return res.status(404).json({ error: 'Member not found' });
    if (isOwner(g, users[userId])) return res.status(400).json({ error: 'You cannot remove an owner' });
    const name = users[userId] ? users[userId].username : userId;
    if (type === 'ban') g.bans[userId] = { reason: clip(req.body.reason, 200), at: new Date().toISOString() };
    else {
      g.kicked = g.kicked || {};
      g.kicked[userId] = Date.now();
    }
    delete g.members[userId];
    audit(g, req.user, (type === 'ban' ? 'banned ' : 'kicked ') + name);
    saveGuilds();
    if (users[userId] && users[userId].bot) {
      pushBotEvent(userId, 'server_remove', { object: 'server', server_id: g.id, name: g.name || 'Server' });
    }
    noteBotLeave(g, users[userId] || { id: userId, username: name });
    wakeGuild(g);
    return res.json({ ok: true });
  }
  if (type === 'unban') {
    delete g.bans[String(req.body.userId || '')];
    audit(g, req.user, 'removed a ban');
    saveGuilds();
    return res.json({ ok: true });
  }
  if (type === 'voice-ban') {
    const userId = String(req.body.userId || '');
    if (!g.members[userId]) return res.status(404).json({ error: 'Member not found' });
    if (isOwner(g, users[userId])) return res.status(400).json({ error: 'You cannot ban an owner from voice' });
    g.voiceBans[userId] = { reason: clip(req.body.reason, 200), at: new Date().toISOString() };
    audit(g, req.user, 'banned ' + (users[userId] ? users[userId].username : userId) + ' from voice');
    saveGuilds();
    if (app.locals.dropVoiceInServer) app.locals.dropVoiceInServer(g.id, userId);
    return res.json({ ok: true });
  }
  if (type === 'voice-unban') {
    if (g.voiceBans) delete g.voiceBans[String(req.body.userId || '')];
    audit(g, req.user, 'removed a voice ban');
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
      if (g.id === OFFICIAL_ID && grantOfficialPerks(users[reqItem.userId], g.members[reqItem.userId])) save(USERS_FILE, users);
      audit(g, req.user, 'accepted a join request');
      noteBotJoin(g, users[reqItem.userId]);
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

const REPORT_REASONS = ['harassment', 'hate', 'sexual', 'child', 'threats', 'self-harm', 'spam', 'illegal', 'other'];

function presentReport(report) {
  const target = users[report.targetId];
  const reporter = users[report.by];
  return {
    id: report.id,
    status: report.status || 'open',
    reason: report.reason || '',
    text: report.text || '',
    excerpt: report.excerpt || '',
    messageId: report.messageId || '',
    at: report.at,
    target: target
      ? { id: target.id, uid: target.uid, username: target.username, displayName: target.displayName || target.username }
      : { id: report.targetId, username: report.targetName || 'Unknown', displayName: report.targetName || 'Unknown' },
    reporter: reporter
      ? { id: reporter.id, username: reporter.username, displayName: reporter.displayName || reporter.username }
      : { id: report.by, username: 'Someone' },
  };
}

app.post('/api/reports', auth, (req, res) => {
  ensureGuilds();
  const g = guilds.servers[OFFICIAL_ID];
  if (!g) return res.status(500).json({ error: 'Reports are unavailable' });
  const target = users[String(req.body?.userId || '')];
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (String(target.id) === String(req.user.id)) return res.status(400).json({ error: 'You cannot report yourself' });
  const reason = REPORT_REASONS.includes(req.body?.reason) ? req.body.reason : 'other';
  if (!Array.isArray(g.reports)) g.reports = [];
  g.reports.unshift({
    id: uuidv4(),
    status: 'open',
    reason,
    text: String(req.body?.text || '').slice(0, 500),
    excerpt: String(req.body?.excerpt || '').slice(0, 240),
    messageId: String(req.body?.messageId || '').slice(0, 80),
    targetId: target.id,
    targetName: target.username,
    by: req.user.id,
    at: new Date().toISOString(),
  });
  g.reports = g.reports.slice(0, 200);
  saveGuilds();
  touchAlerts();
  res.json({ ok: true });
});

function accountServers(user) {
  const out = [];
  for (const g of Object.values((guilds && guilds.servers) || {})) {
    if (g && g.members && g.members[user.id]) out.push({ id: g.id, name: g.name || 'Server' });
  }
  return out;
}

function ownedBotCount(user) {
  if (!user || typeof bots !== 'object' || !bots) return 0;
  let count = 0;
  for (const bot of Object.values(bots)) {
    if (bot && String(bot.ownerId) === String(user.id)) count += 1;
  }
  return count;
}

function canEditAccount(actor, target) {
  if (!actor || !target || String(actor.id) === String(target.id)) return false;
  if (isRootAccount(target)) return false;
  if (isOfficialOwner(target) && !isOfficialOwner(actor)) return false;
  if (isOfficialOwner(actor)) return true;
  const home = guilds.servers && guilds.servers[OFFICIAL_ID];
  return canStaffTouch(home, actor, target.id);
}

function accountRoles(user) {
  const out = [];
  for (const g of Object.values((guilds && guilds.servers) || {})) {
    if (!g) continue;
    const mem = g.members && g.members[user.id];
    const banned = !!(g.bans && g.bans[user.id]);
    if (!mem && !banned) continue;
    const roles = ((mem && mem.roles) || []).map((id) => {
      const role = (g.roles || []).find((row) => row.id === id);
      return { id, name: role ? role.name : id, color: role && role.color ? role.color : '#99aab5' };
    });
    out.push({
      id: g.id,
      name: g.name || 'Server',
      roles,
      banned,
      timeoutUntil: mem ? Number(mem.timeoutUntil) || 0 : 0,
    });
  }
  return out;
}

function reportsAgainst(user) {
  const home = guilds.servers && guilds.servers[OFFICIAL_ID];
  return ((home && home.reports) || []).filter((row) => String(row.targetId) === String(user.id)).slice(0, 20).map((row) => ({
    id: row.id,
    status: row.status || 'open',
    reason: row.reason || '',
    text: String(row.text || '').slice(0, 240),
    at: row.at || '',
  }));
}

function pushStaffLog(actor, target, action, detail) {
  if (!guilds.staffAudit) guilds.staffAudit = [];
  guilds.staffAudit.unshift({
    id: uuidv4(),
    at: new Date().toISOString(),
    actorName: actor.username,
    targetName: target ? target.username : '',
    action: String(action || '').slice(0, 40),
    detail: String(detail || '').slice(0, 240),
  });
  guilds.staffAudit = guilds.staffAudit.slice(0, 200);
}

function setStaffDisplayName(user, value) {
  const next = String(value || user.username || '').replace(/\s+/g, ' ').trim().slice(0, 32);
  const old = user.displayName || '';
  if (!Array.isArray(user.displayHistory)) user.displayHistory = [];
  if (old && old !== next) user.displayHistory.unshift({ name: old, at: new Date().toISOString() });
  user.displayHistory = user.displayHistory.slice(0, 12);
  user.displayName = next || user.username;
}

function staffAccount(user, viewer) {
  const ownerView = isOfficialOwner(viewer);
  return {
    id: user.id,
    uid: user.uid || null,
    username: user.username,
    displayName: user.displayName || user.username,
    email: ownerView && !user.bot && !isRootAccount(user) ? String(user.email || '') : '',
    bot: !!user.bot,
    createdAt: user.createdAt || '',
    status: user.deleted ? 'deleted' : (user.disabled || user.globalBan ? 'offline' : effectiveStatus(user)),
    lastSeen: Number(user.lastSeen) || 0,
    disabled: !!user.disabled,
    deleted: !!user.deleted,
    locked: !!user.locked,
    muted: !!user.muted,
    globalBan: !!user.globalBan,
    suspendedUntil: Number(user.suspendedUntil) || 0,
    early: Array.isArray(user.badges) && user.badges.includes('early'),
    premium: !!user.premium,
    emailVerified: !!user.emailVerified,
    mfa: !!(user.totp && user.totp.enabled),
    restrictMessages: !!user.restrictMessages,
    restrictImages: !!user.restrictImages,
    restrictFiles: !!user.restrictFiles,
    restrictVoice: !!user.restrictVoice,
    sessions: security.sessionCount(user),
    sessionList: ownerView ? (Array.isArray(user.sessions) ? user.sessions : []).slice(-8).map((row) => ({
      id: row.id,
      createdAt: row.createdAt || '',
      lastSeen: Number(row.lastSeen) || 0,
    })) : [],
    servers: accountServers(user),
    roles: accountRoles(user),
    bots: ownedBotCount(user),
    warnings: Array.isArray(user.warnings) ? user.warnings.slice(0, 20) : [],
    cases: Array.isArray(user.cases) ? user.cases.slice(0, 20) : [],
    notes: Array.isArray(user.staffNotes) ? user.staffNotes.slice(0, 30) : [],
    nameHistory: Array.isArray(user.nameHistory) ? user.nameHistory.slice(0, 12) : [],
    displayHistory: Array.isArray(user.displayHistory) ? user.displayHistory.slice(0, 12) : [],
    reports: reportsAgainst(user),
    protected: isRootAccount(user),
    canEdit: canEditAccount(viewer, user),
    canModerate: ownerView && !isRootAccount(user) && String(viewer.id) !== String(user.id),
    avatarUrl: user.avatarUrl || '',
    avatarColor: user.avatarColor || '#7c5cff',
  };
}

function staffDirectory(viewer) {
  const list = Object.values(users).filter(Boolean).map((user) => staffAccount(user, viewer));
  list.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const home = guilds.servers && guilds.servers[OFFICIAL_ID];
  const openReports = ((home && home.reports) || []).filter((row) => row.status !== 'closed').length;
  const counts = {
    accounts: list.filter((user) => !user.deleted).length,
    people: list.filter((user) => !user.bot && !user.deleted).length,
    bots: list.filter((user) => user.bot).length,
    online: list.filter((user) => user.status === 'online').length,
    disabled: list.filter((user) => user.disabled || user.globalBan || user.deleted).length,
    servers: Object.keys((guilds && guilds.servers) || {}).length,
    reports: openReports,
  };
  const servers = Object.values((guilds && guilds.servers) || {}).slice(0, 8).map((g) => ({
    id: g.id,
    name: g.name || 'Server',
    members: Object.keys(g.members || {}).length,
    roles: (g.roles || []).filter((row) => row && row.id && row.id !== 'everyone' && row.id !== 'owner' && row.id !== 'here' && row.type !== 'text' && row.type !== 'voice').map((row) => ({ id: row.id, name: row.name, color: row.color || '#99aab5' })),
  }));
  const audit = (guilds.staffAudit || []).slice(0, 80).map((row) => ({
    id: row.id,
    at: row.at,
    actorName: row.actorName,
    targetName: row.targetName,
    action: row.action,
    detail: row.detail,
  }));
  return { users: list, counts, owner: isOfficialOwner(viewer), servers, audit, appeals: listAppeals() };
}

function listAppeals() {
  const out = [];
  for (const user of Object.values(users)) {
    if (!user || !Array.isArray(user.appeals)) continue;
    for (const row of user.appeals) {
      if (!row) continue;
      out.push({
        id: row.id,
        at: row.at,
        text: row.text || '',
        status: row.status || 'open',
        kind: row.kind || '',
        userId: user.id,
        username: user.username,
        uid: user.uid || null,
        resolvedBy: row.resolvedBy || '',
        resolvedAt: row.resolvedAt || '',
      });
    }
  }
  out.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  return out.slice(0, 80);
}

function dropSessions(user) {
  user.sessions = [];
  user.token = '';
  if (user.status === 'online') user.status = 'offline';
}

function usernameTaken(name, exceptId) {
  const key = usernameKey(name);
  if (!key) return false;
  return Object.values(users).some((user) => user && user.id !== exceptId && usernameKey(user.username) === key);
}

function spareUsername(user) {
  const tail = user.bot ? '_bot' : '';
  const stem = (user.bot ? 'bot' : 'user') + (user.uid || '');
  let name = normalizeUsername(stem + tail);
  let n = 2;
  while (!name || reservedUsername(name) || usernameTaken(name, user.id) || (user.bot ? !name.endsWith('_bot') : name.endsWith('_bot'))) {
    name = normalizeUsername(stem + n + tail);
    n += 1;
    if (n > 40) return '';
  }
  return name;
}

function applyStaffUsername(user, raw) {
  const clean = normalizeUsername(raw);
  if (!clean) return 'Username required';
  if (reservedUsername(clean)) return 'That username is reserved';
  if (user.bot && !clean.endsWith('_bot')) return 'Bot usernames have to end with _bot';
  if (!user.bot && clean.endsWith('_bot')) return 'Usernames cannot end with _bot';
  if (usernameTaken(clean, user.id)) return 'Username taken';
  const old = user.username;
  if (!Array.isArray(user.nameHistory)) user.nameHistory = [];
  if (old && old !== clean) user.nameHistory.unshift({ name: old, at: new Date().toISOString() });
  user.nameHistory = user.nameHistory.slice(0, 12);
  user.username = clean;
  if (!user.displayName || user.displayName === old) user.displayName = clean;
  return '';
}

function purgeAccount(user) {
  const id = String(user.id);
  dropSessions(user);
  delete users[id];
  for (const g of Object.values((guilds && guilds.servers) || {})) {
    if (!g) continue;
    if (g.members) delete g.members[id];
    if (g.bans) delete g.bans[id];
    if (g.kicked) delete g.kicked[id];
    if (g.voiceBans) delete g.voiceBans[id];
    if (Array.isArray(g.ownerIds)) g.ownerIds = g.ownerIds.filter((row) => String(row) !== id);
  }
  if (friendGraph) {
    delete friendGraph[id];
    for (const node of Object.values(friendGraph)) {
      if (!node) continue;
      for (const key of ['friends', 'incoming', 'outgoing', 'blocked']) {
        if (Array.isArray(node[key])) node[key] = node[key].filter((row) => String(row) !== id);
      }
    }
    save(FRIENDS_FILE, friendGraph);
  }
  if (typeof reads === 'object' && reads) {
    delete reads[id];
    save(READS_FILE, reads);
  }
  if (typeof dmThreads === 'object' && dmThreads) {
    for (const key of Object.keys(dmThreads)) {
      if (String(key).split(':').includes(id)) delete dmThreads[key];
    }
    save(DMS_FILE, dmThreads);
  }
  if (messages && typeof messages === 'object') {
    for (const key of Object.keys(messages)) {
      if (key.startsWith('dm:') && key.slice(3).split(':').includes(id)) {
        delete messages[key];
        continue;
      }
      if (Array.isArray(messages[key])) messages[key] = messages[key].filter((msg) => !msg || String(msg.authorId) !== id);
    }
    save(MESSAGES_FILE, messages);
  }
  if (typeof threads === 'object' && threads) {
    for (const [tid, thread] of Object.entries(threads)) {
      if (!thread) continue;
      if (String(thread.ownerId) === id) delete threads[tid];
      else if (Array.isArray(thread.followers)) thread.followers = thread.followers.filter((row) => String(row) !== id);
    }
    save(THREADS_FILE, threads);
  }
  save(USERS_FILE, users);
  saveGuilds();
}

app.get('/api/staff/directory', auth, (req, res) => {
  if (!isNebulaStaff(req.user)) return res.status(403).json({ error: 'Only Nebula staff can open admin' });
  res.json({ ok: true, ...staffDirectory(req.user) });
});

app.post('/api/staff/users/:id', auth, (req, res) => {
  if (!isNebulaStaff(req.user)) return res.status(403).json({ error: 'Only Nebula staff can open admin' });
  const target = users[String(req.params.id || '')];
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (isRootAccount(target)) return res.status(400).json({ error: 'That account is not affected by permissions' });
  const action = String(req.body?.action || '');
  const reason = String(req.body?.reason || req.body?.text || '').trim().slice(0, 240);
  const ownerOnly = new Set(['disable', 'enable', 'delete', 'restore', 'purge', 'global-ban', 'global-unban', 'password', 'email', 'premium', 'badge']);
  const needsReason = new Set(['global-ban', 'suspend', 'disable', 'delete', 'purge', 'kick', 'server-ban', 'delete-messages', 'lock', 'warn', 'case', 'timeout']);
  if (ownerOnly.has(action)) {
    if (!isOfficialOwner(req.user)) return res.status(403).json({ error: 'Only the server owners can do that' });
    if (String(target.id) === String(req.user.id)) return res.status(400).json({ error: 'That account stays as it is' });
  } else if (!canEditAccount(req.user, target)) {
    return res.status(403).json({ error: 'You cannot change that account' });
  }
  if (needsReason.has(action) && reason.length < 3) return res.status(400).json({ error: 'Add a reason' });
  const home = guilds.servers && guilds.servers[OFFICIAL_ID];
  const serverId = String(req.body?.serverId || (home && home.id) || '');
  const guild = (guilds.servers && guilds.servers[serverId]) || home;
  let temporaryPassword = '';
  let detail = reason;

  if (action === 'reset-username') {
    const next = spareUsername(target);
    const error = next ? applyStaffUsername(target, next) : 'Could not pick a username';
    if (error) return res.status(400).json({ error });
    detail = '@' + target.username;
  } else if (action === 'username') {
    const error = applyStaffUsername(target, req.body?.username);
    if (error) return res.status(400).json({ error });
    detail = '@' + target.username;
  } else if (action === 'display-name') {
    setStaffDisplayName(target, req.body?.displayName);
    detail = target.displayName;
  } else if (action === 'reset-display') {
    setStaffDisplayName(target, target.username);
    detail = target.displayName;
  } else if (action === 'disable') {
    target.disabled = true;
    dropSessions(target);
  } else if (action === 'enable' || action === 'unlock') {
    target.disabled = false;
    target.locked = false;
    target.suspendedUntil = 0;
  } else if (action === 'lock') {
    target.locked = true;
  } else if (action === 'logout') {
    dropSessions(target);
    detail = 'Signed out';
  } else if (action === 'badge') {
    const badges = new Set(Array.isArray(target.badges) ? target.badges : []);
    if (badges.has('early')) badges.delete('early');
    else badges.add('early');
    target.badges = [...badges];
    detail = badges.has('early') ? 'Granted early badge' : 'Removed early badge';
  } else if (action === 'premium') {
    target.premium = !target.premium;
    detail = target.premium ? 'Granted premium' : 'Removed premium';
  } else if (action === 'verify-email') {
    target.emailVerified = !target.emailVerified;
    detail = target.emailVerified ? 'Email marked verified' : 'Email marked unverified';
  } else if (action === 'email') {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email.includes('@') || email.length > 120) return res.status(400).json({ error: 'Invalid email' });
    if (Object.values(users).some((user) => user && user.id !== target.id && emailMatches(email, user.emailSalt, user.emailHash))) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const sealed = emailRecord(email);
    target.email = email;
    target.emailSalt = sealed.emailSalt;
    target.emailHash = sealed.emailHash;
    target.emailVerified = false;
    detail = 'Email changed';
  } else if (action === 'password') {
    temporaryPassword = crypto.randomBytes(9).toString('base64url');
    target.passwordHash = hashPassword(temporaryPassword);
    dropSessions(target);
    detail = 'Password reset';
  } else if (action === 'global-ban') {
    target.globalBan = { reason, at: new Date().toISOString(), by: req.user.id };
    dropSessions(target);
  } else if (action === 'global-unban') {
    target.globalBan = null;
    detail = 'Platform ban removed';
  } else if (action === 'suspend') {
    const hours = Math.min(24 * 30, Math.max(1, Number(req.body?.hours) || 24));
    target.suspendedUntil = Date.now() + hours * 3600000;
    dropSessions(target);
    detail = reason + ' · ' + hours + 'h';
  } else if (action === 'unsuspend') {
    target.suspendedUntil = 0;
    detail = 'Suspension cleared';
  } else if (action === 'mute') {
    target.muted = true;
    target.restrictMessages = true;
  } else if (action === 'unmute') {
    target.muted = false;
    target.restrictMessages = false;
    detail = 'Unmuted';
  } else if (action === 'restrict') {
    const flag = String(req.body?.flag || '');
    const map = { messages: 'restrictMessages', images: 'restrictImages', files: 'restrictFiles', voice: 'restrictVoice' };
    if (!map[flag]) return res.status(400).json({ error: 'Unknown restriction' });
    target[map[flag]] = !target[map[flag]];
    detail = flag + (target[map[flag]] ? ' restricted' : ' allowed');
  } else if (action === 'warn') {
    if (!Array.isArray(target.warnings)) target.warnings = [];
    target.warnings.unshift({ id: uuidv4(), text: reason, at: new Date().toISOString(), by: req.user.username });
    target.warnings = target.warnings.slice(0, 30);
  } else if (action === 'case') {
    if (!Array.isArray(target.cases)) target.cases = [];
    target.cases.unshift({ id: uuidv4(), text: reason, at: new Date().toISOString(), by: req.user.username, status: 'open' });
    target.cases = target.cases.slice(0, 30);
  } else if (action === 'note') {
    const text = String(req.body?.text || '').trim().slice(0, 500);
    if (text.length < 2) return res.status(400).json({ error: 'Write a note' });
    if (!Array.isArray(target.staffNotes)) target.staffNotes = [];
    target.staffNotes.unshift({ id: uuidv4(), text, at: new Date().toISOString(), by: req.user.username });
    target.staffNotes = target.staffNotes.slice(0, 40);
    detail = 'Note added';
  } else if (action === 'kick' || action === 'server-ban') {
    if (!guild || !guild.members || !guild.members[target.id]) return res.status(400).json({ error: 'That account is not in that server' });
    if (action === 'server-ban') {
      if (!guild.bans) guild.bans = {};
      guild.bans[target.id] = { reason, at: new Date().toISOString() };
    } else {
      guild.kicked = guild.kicked || {};
      guild.kicked[target.id] = Date.now();
    }
    delete guild.members[target.id];
    detail = (guild.name || 'Server') + ' · ' + reason;
  } else if (action === 'unban') {
    if (guild && guild.bans) delete guild.bans[target.id];
    detail = 'Server ban removed';
  } else if (action === 'timeout') {
    if (!guild || !guild.members || !guild.members[target.id]) return res.status(400).json({ error: 'That account is not in that server' });
    const minutes = Math.min(10080, Math.max(1, Number(req.body?.minutes) || 60));
    guild.members[target.id].timeoutUntil = Date.now() + minutes * 60000;
    detail = (guild.name || 'Server') + ' · ' + minutes + 'm';
  } else if (action === 'role') {
    if (!guild || !guild.members || !guild.members[target.id]) return res.status(400).json({ error: 'That account is not in that server' });
    const roleId = String(req.body?.roleId || '');
    const role = (guild.roles || []).find((row) => row.id === roleId);
    if (!role || role.id === 'everyone' || role.id === 'owner') return res.status(400).json({ error: 'Pick a role' });
    if ((role.id === 'admin' || role.id === 'developer' || role.id === 'owner') && !isOfficialOwner(req.user)) {
      return res.status(403).json({ error: 'Only the server owners can assign that role' });
    }
    const mem = guild.members[target.id];
    mem.roles = mem.roles || ['everyone'];
    if (req.body?.remove) mem.roles = mem.roles.filter((id) => id !== role.id);
    else if (!mem.roles.includes(role.id)) mem.roles.push(role.id);
    detail = (req.body?.remove ? 'Removed ' : 'Added ') + role.name;
  } else if (action === 'reset-avatar') {
    target.avatarUrl = '';
    target.avatarPath = '';
    detail = 'Avatar reset';
  } else if (action === 'reset-banner') {
    target.bannerUrl = '';
    target.bannerPath = '';
    detail = 'Banner reset';
  } else if (action === 'clear-status') {
    target.customStatus = '';
    detail = 'Status cleared';
  } else if (action === 'clear-effects') {
    target.nameEffect = '';
    detail = 'Effects removed';
  } else if (action === 'delete-messages') {
    const since = Date.parse(req.body?.since || '') || 0;
    let removed = 0;
    if (messages && typeof messages === 'object') {
      for (const key of Object.keys(messages)) {
        if (!Array.isArray(messages[key])) continue;
        messages[key] = messages[key].filter((msg) => {
          if (!msg || String(msg.authorId) !== String(target.id)) return true;
          if (since && Date.parse(msg.createdAt || 0) < since) return true;
          removed += 1;
          return false;
        });
      }
      save(MESSAGES_FILE, messages);
    }
    detail = removed + ' messages · ' + reason;
  } else if (action === 'delete') {
    target.deleted = true;
    target.deletedAt = new Date().toISOString();
    dropSessions(target);
  } else if (action === 'restore') {
    target.deleted = false;
    target.disabled = false;
    target.globalBan = null;
    detail = 'Account restored';
  } else if (action === 'purge') {
    if (ownedBotCount(target) > 0) return res.status(400).json({ error: 'Delete their bots in Developer first' });
    pushStaffLog(req.user, target, action, reason);
    purgeAccount(target);
    touchAlerts();
    return res.json({ ok: true, ...staffDirectory(req.user) });
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }
  pushStaffLog(req.user, target, action, detail);
  save(USERS_FILE, users);
  saveGuilds();
  touchAlerts();
  const body = { ok: true, user: staffAccount(target, req.user), ...staffDirectory(req.user) };
  if (temporaryPassword) body.temporaryPassword = temporaryPassword;
  res.json(body);
});

app.post('/api/staff/appeals/:id', auth, (req, res) => {
  if (!isNebulaStaff(req.user)) return res.status(403).json({ error: 'Only Nebula staff can review appeals' });
  const id = String(req.params.id || '');
  let target = null;
  let appeal = null;
  for (const user of Object.values(users)) {
    if (!user || !Array.isArray(user.appeals)) continue;
    const found = user.appeals.find((row) => row && row.id === id);
    if (found) {
      target = user;
      appeal = found;
      break;
    }
  }
  if (!appeal || !target) return res.status(404).json({ error: 'Appeal not found' });
  if (appeal.status !== 'open') return res.status(400).json({ error: 'That appeal is already closed' });
  if (isRootAccount(target)) return res.status(400).json({ error: 'That account is not affected by permissions' });
  const action = String(req.body?.action || '');
  if (action === 'approve') {
    target.globalBan = null;
    target.disabled = false;
    appeal.status = 'approved';
  } else if (action === 'deny') {
    appeal.status = 'denied';
  } else return res.status(400).json({ error: 'Unknown action' });
  appeal.resolvedBy = req.user.username;
  appeal.resolvedAt = new Date().toISOString();
  pushStaffLog(req.user, target, action === 'approve' ? 'appeal-approve' : 'appeal-deny', appeal.text.slice(0, 160));
  save(USERS_FILE, users);
  saveGuilds();
  res.json({ ok: true, ...staffDirectory(req.user) });
});

app.get('/api/staff/reports', auth, (req, res) => {
  if (!isNebulaStaff(req.user)) return res.status(403).json({ error: 'Only Nebula staff can see reports' });
  ensureGuilds();
  const g = guilds.servers[OFFICIAL_ID];
  const list = ((g && g.reports) || []).filter((row) => row.status !== 'closed').map(presentReport);
  res.json({ ok: true, reports: list });
});

app.post('/api/staff/reports/:id', auth, (req, res) => {
  if (!isNebulaStaff(req.user)) return res.status(403).json({ error: 'Only Nebula staff can see reports' });
  ensureGuilds();
  const g = guilds.servers[OFFICIAL_ID];
  const report = ((g && g.reports) || []).find((row) => row.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const action = String(req.body?.action || '');
  if (action === 'handle') report.status = 'handled';
  else if (action === 'close') report.status = 'closed';
  else if (action === 'view') {
    if (report.status === 'open') report.status = 'viewed';
  } else return res.status(400).json({ error: 'Unknown action' });
  report.handledBy = req.user.id;
  report.handledAt = new Date().toISOString();
  saveGuilds();
  res.json({ ok: true, report: presentReport(report) });
});

app.get('/api/online', (req, res) => {
  let online = 0;
  for (const user of Object.values(users)) {
    if (user && effectiveStatus(user) === 'online') online += 1;
  }
  res.set('Cache-Control', 'no-store');
  res.json({ online });
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

  let voiceRev = 1;
  function bumpVoice() {
    voiceRev += 1;
    touchAlerts();
    pushVoice();
  }

  function prune(room) {
    const now = Date.now();
    for (const [id, member] of room.members) {
      if (now - member.seen > 8000) room.members.delete(id);
    }
    room.signals = room.signals.filter((signal) => now - signal.at < 20000);
  }

  function present(member, viewer) {
    const user = publicUser(users[member.userId], viewer) || {
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
      sharing: !!member.sharing,
      watching: !!member.watching,
    };
  }

  function locate(req, res) {
    const serverId = String((req.body && req.body.serverId) || req.query.serverId || '');
    const channelId = String(req.params.channelId || '');
    if (serverId === 'call') {
      const allowed = channelId.startsWith('dm:')
        ? channelId.slice(3).split(':').map(String).includes(String(req.user.id))
        : channelId.startsWith('group:')
          ? !!((groups[channelId.slice(6)] || {}).memberIds || []).map(String).includes(String(req.user.id))
          : false;
      if (!allowed) {
        res.status(403).json({ error: 'You cannot join this call' });
        return null;
      }
      return { guild: { id: 'call', members: { [req.user.id]: {} } }, channel: { id: channelId, type: 'voice', name: 'Call' } };
    }
    const found = findChannel(channelId, serverId);
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
    if (found.guild.voiceBans && found.guild.voiceBans[req.user.id]) {
      res.status(403).json({ error: 'You are banned from voice in this server' });
      return null;
    }
    return found;
  }

  function noteCrowd(room) {
    if (!room) return;
    if (room.members.size === 1) {
      if (!room.aloneSince) room.aloneSince = Date.now();
    } else room.aloneSince = 0;
  }

  function dropUser(userId, exceptKey) {
    for (const [id, room] of rooms) {
      if (id === exceptKey) continue;
      if (room.members.delete(userId)) noteCrowd(room);
    }
  }

  function dropVoiceInServer(serverId, userId) {
    const prefix = String(serverId) + '\n';
    const id = String(userId || '');
    if (!id) return false;
    let changed = false;
    for (const [roomId, room] of rooms) {
      if (!roomId.startsWith(prefix)) continue;
      if (room.members.delete(id)) {
        changed = true;
        noteCrowd(room);
      }
    }
    if (changed) bumpVoice();
    return changed;
  }

  function dropVoiceUser(userId) {
    const id = String(userId || '');
    if (!id) return false;
    let changed = false;
    for (const room of rooms.values()) {
      if (room.members.delete(id)) {
        changed = true;
        noteCrowd(room);
      }
    }
    if (changed) bumpVoice();
    return changed;
  }

  function finishSittingCall(channelId) {
    for (const row of callLog) {
      if (row.channelId !== channelId) continue;
      if (row.status === 'active') finishCall(row, false);
      else if (row.status === 'ringing') finishCall(row, true);
    }
  }

  function sweepAlone() {
    const now = Date.now();
    const ended = [];
    let changed = false;
    for (const [id, room] of rooms) {
      const before = room.members.size;
      prune(room);
      if (room.members.size !== before) changed = true;
      noteCrowd(room);
      const split = id.split('\n');
      const callChannel = split[0] === 'call' ? split[1] : '';
      if (before > 0 && !room.members.size) {
        if (callChannel) ended.push(callChannel);
        continue;
      }
      if (room.members.size !== 1 || !room.aloneSince || now - room.aloneSince < 3 * 60 * 1000) continue;
      room.members.clear();
      room.aloneSince = 0;
      changed = true;
      if (callChannel) ended.push(callChannel);
    }
    for (const channelId of ended) finishSittingCall(channelId);
    if (changed) bumpVoice();
  }

  setInterval(() => {
    try { sweepAlone(); } catch (_) {}
  }, 5000);

  function allowedCall(user, channelId) {
    if (channelId.startsWith('dm:')) return channelId.slice(3).split(':').map(String).includes(String(user.id));
    if (channelId.startsWith('group:')) return !!((groups[channelId.slice(6)] || {}).memberIds || []).map(String).includes(String(user.id));
    return false;
  }

  function callRoomsFor(user) {
    const out = {};
    for (const [id, room] of rooms) {
      const split = id.split('\n');
      if (split[0] !== 'call' || !split[1]) continue;
      if (!allowedCall(user, split[1])) continue;
      prune(room);
      if (!room.members.size) continue;
      out[split[1]] = [...room.members.values()].map((member) => present(member, user));
    }
    return out;
  }

  function guildRoomsFor(user, guild) {
    const out = {};
    if (!guild || !guild.members || !guild.members[user.id]) return out;
    for (const channel of guild.channels || []) {
      if (channel.type !== 'voice') continue;
      const room = rooms.get(key(guild.id, channel.id));
      if (!room) continue;
      prune(room);
      if (!room.members.size) continue;
      out[channel.id] = [...room.members.values()].map((member) => present(member, user));
    }
    return out;
  }

  app.locals.dropVoiceUser = dropVoiceUser;
  app.locals.dropVoiceInServer = dropVoiceInServer;
  app.locals.voiceSnapshot = (user) => {
    const servers = {};
    for (const guild of Object.values(guilds.servers || {})) {
      const listed = guildRoomsFor(user, guild);
      if (Object.keys(listed).length) servers[guild.id] = listed;
    }
    return { rev: voiceRev, call: callRoomsFor(user), servers };
  };

  app.post('/api/voice/leave', auth, (req, res) => {
    dropVoiceUser(req.user.id);
    res.json({ ok: true, rev: voiceRev });
  });

  app.get('/api/voice/overview', auth, (req, res) => {
    const serverId = String(req.query.serverId || '');
    if (serverId === 'call') {
      return res.json({ ok: true, rev: voiceRev, rooms: callRoomsFor(req.user) });
    }
    const guild = guilds.servers[serverId];
    if (!guild || !guild.members || !guild.members[req.user.id]) {
      return res.status(403).json({ error: 'You are not in this server' });
    }
    res.json({ ok: true, rev: voiceRev, rooms: guildRoomsFor(req.user, guild) });
  });

  app.post('/api/voice/:channelId/join', auth, (req, res) => {
    if (req.user.restrictVoice && !isRootAccount(req.user)) return res.status(403).json({ error: 'Voice is restricted on this account' });
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
      sharing: false,
      watching: false,
      seen: Date.now(),
    });
    noteCrowd(room);
    bumpVoice();
    res.json({ ok: true, rev: voiceRev, members: [...room.members.values()].map((member) => present(member, req.user)) });
  });

  app.post('/api/voice/:channelId/leave', auth, (req, res) => {
    dropVoiceUser(req.user.id);
    res.json({ ok: true, rev: voiceRev });
  });

  app.post('/api/voice/:channelId/state', auth, (req, res) => {
    const serverId = String((req.body && req.body.serverId) || '');
    const room = rooms.get(key(serverId, req.params.channelId));
    const member = room && room.members.get(req.user.id);
    if (!member) return res.status(404).json({ error: 'You are not in this call' });
    if (req.body.muted != null) member.muted = !!req.body.muted;
    if (req.body.deafened != null) member.deafened = !!req.body.deafened;
    if (req.body.speaking != null) member.speaking = !!req.body.speaking;
    if (req.body.sharing != null && !!member.sharing !== !!req.body.sharing) {
      member.sharing = !!req.body.sharing;
      bumpVoice();
    }
    if (req.body.watching != null) member.watching = !!req.body.watching;
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
      rev: voiceRev,
      joined: !!member,
      members: [...room.members.values()].map((member) => present(member, req.user)),
      signals: mine.map((signal) => ({ from: signal.from, kind: signal.kind, payload: signal.payload })),
    });
  });
})(app, { auth, guilds, users, findChannel, can, PERM, publicUser });

function canManageWebhooks(g, user) {
  if (!g || !user || !g.members || !g.members[user.id]) return false;
  if (isOwner(g, user)) return true;
  const bits = effectivePerms(g, user);
  if ((bits & PERM.ADMIN) === PERM.ADMIN) return true;
  if ((bits & PERM.MANAGE_CHANNELS) === PERM.MANAGE_CHANNELS) return true;
  return (bits & 256) === 256;
}

function hookToken() {
  return crypto.randomBytes(24).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function tokensMatch(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function publicHook(g, hook) {
  const channel = (g.channels || []).find((row) => row.id === hook.channelId);
  return {
    id: hook.id,
    name: hook.name,
    channelId: hook.channelId,
    channelName: channel ? channel.name : '',
    avatarUrl: hook.avatarUrl || '',
    token: hook.token,
    createdAt: hook.createdAt,
  };
}

function findWebhook(id) {
  for (const g of Object.values(guilds.servers || {})) {
    const hook = (g.webhooks || []).find((row) => row.id === id);
    if (hook) return { guild: g, hook };
  }
  return null;
}

function cleanHookAvatar(value) {
  const url = String(value || '').slice(0, 500);
  if (/^https?:\/\//i.test(url) || url.startsWith('/uploads/') || url.startsWith('/files/')) return url;
  return '';
}

function cleanEmbeds(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows.slice(0, 4)) {
    if (!row || typeof row !== 'object') continue;
    const title = String(row.title || '').slice(0, 256);
    const description = String(row.description || '').slice(0, 2000);
    const url = /^https?:\/\//i.test(String(row.url || '')) ? String(row.url).slice(0, 500) : '';
    const color = Number(row.color);
    const fields = Array.isArray(row.fields) ? row.fields.slice(0, 6).map((field) => ({
      name: String(field && field.name || '').slice(0, 256),
      value: String(field && field.value || '').slice(0, 1024),
      inline: !!(field && field.inline),
    })).filter((field) => field.name && field.value) : [];
    const footer = row.footer && row.footer.text ? String(row.footer.text).slice(0, 200) : '';
    if (!title && !description && !url && !fields.length) continue;
    const card = { title, description, url, color: Number.isFinite(color) ? (color >>> 0) : 0 };
    if (fields.length) card.fields = fields;
    if (footer) card.footer = footer;
    out.push(card);
  }
  return out;
}

const hookHits = new Map();

function hookLimited(id) {
  const now = Date.now();
  const prev = (hookHits.get(id) || []).filter((at) => now - at < 5000);
  if (prev.length >= 5) {
    hookHits.set(id, prev);
    return true;
  }
  prev.push(now);
  hookHits.set(id, prev);
  return false;
}

app.get('/api/servers/:id/webhooks', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  if (!canManageWebhooks(g, req.user)) return res.status(403).json({ error: 'You cannot manage webhooks' });
  hydrateGuild(g);
  res.json({ ok: true, webhooks: (g.webhooks || []).map((hook) => publicHook(g, hook)) });
});

app.get('/api/servers/:id/channels/:channelId/webhooks', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  if (!canManageWebhooks(g, req.user)) return res.status(403).json({ error: 'You cannot manage webhooks' });
  const channel = (g.channels || []).find((row) => row.id === req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  hydrateGuild(g);
  const list = (g.webhooks || []).filter((hook) => hook.channelId === channel.id).map((hook) => publicHook(g, hook));
  res.json({ ok: true, webhooks: list });
});

app.post('/api/servers/:id/channels/:channelId/webhooks', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  if (!canManageWebhooks(g, req.user)) return res.status(403).json({ error: 'You cannot manage webhooks' });
  const channel = (g.channels || []).find((row) => row.id === req.params.channelId);
  if (!channel || channel.type === 'voice') return res.status(404).json({ error: 'Text channel not found' });
  hydrateGuild(g);
  const here = (g.webhooks || []).filter((hook) => hook.channelId === channel.id);
  if (here.length >= 10) return res.status(400).json({ error: 'This channel already has 10 webhooks' });
  const name = String(req.body?.name || channel.name || 'webhook').trim().slice(0, 80) || channel.name || 'webhook';
  const hook = {
    id: uuidv4(),
    channelId: channel.id,
    name,
    avatarUrl: cleanHookAvatar(req.body?.avatarUrl),
    token: hookToken(),
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  g.webhooks.push(hook);
  audit(g, req.user, 'created a webhook in #' + channel.name);
  saveGuilds();
  res.json({ ok: true, webhook: publicHook(g, hook) });
});

app.patch('/api/servers/:id/webhooks/:hookId', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  if (!canManageWebhooks(g, req.user)) return res.status(403).json({ error: 'You cannot manage webhooks' });
  hydrateGuild(g);
  const hook = (g.webhooks || []).find((row) => row.id === req.params.hookId);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  if (req.body?.name != null) {
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Webhook name required' });
    hook.name = name;
  }
  if (req.body?.avatarUrl != null) hook.avatarUrl = cleanHookAvatar(req.body.avatarUrl);
  if (req.body?.channelId) {
    const next = (g.channels || []).find((row) => row.id === req.body.channelId && row.type !== 'voice');
    if (!next) return res.status(404).json({ error: 'Text channel not found' });
    const count = (g.webhooks || []).filter((row) => row.channelId === next.id && row.id !== hook.id).length;
    if (count >= 10) return res.status(400).json({ error: 'That channel already has 10 webhooks' });
    hook.channelId = next.id;
  }
  audit(g, req.user, 'updated the webhook ' + hook.name);
  saveGuilds();
  res.json({ ok: true, webhook: publicHook(g, hook) });
});

app.delete('/api/servers/:id/webhooks/:hookId', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  if (!canManageWebhooks(g, req.user)) return res.status(403).json({ error: 'You cannot manage webhooks' });
  hydrateGuild(g);
  const hook = (g.webhooks || []).find((row) => row.id === req.params.hookId);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  g.webhooks = g.webhooks.filter((row) => row.id !== hook.id);
  audit(g, req.user, 'deleted the webhook ' + hook.name);
  saveGuilds();
  res.json({ ok: true });
});

app.post('/api/feeds/:id', (req, res) => {
  ensureGuilds();
  const token = String(req.query.token || req.get('x-nebula-token') || '');
  let found = null;
  for (const g of Object.values(guilds.servers || {})) {
    if (g.lobby && g.lobby.feedId === req.params.id && g.lobby.feedToken && tokensMatch(g.lobby.feedToken, token)) {
      found = g;
      break;
    }
  }
  if (!found) return res.status(404).json({ error: 'Unknown feed' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const embed = Array.isArray(body.embeds) ? (body.embeds[0] || {}) : {};
  const title = String(body.title || embed.title || '').slice(0, 120);
  const text = String(body.text || body.content || embed.description || '').slice(0, 500);
  const url = String(body.url || embed.url || '').slice(0, 300);
  const image = String(body.image || (embed.image && embed.image.url) || '').slice(0, 300);
  if (!title && !text) return res.status(400).json({ error: 'Add a title or text' });
  if (url && !/^https:\/\//i.test(url)) return res.status(400).json({ error: 'Links need https' });
  found.lobby.posts = [{
    title,
    text,
    url: /^https:\/\//i.test(url) ? url : '',
    image: /^https:\/\//i.test(image) && hostOk(image) ? image : '',
    at: new Date().toISOString(),
  }, ...(found.lobby.posts || [])].slice(0, 20);
  saveGuilds();
  res.json({ ok: true });
});

app.post('/api/webhooks/:id/:token', (req, res) => {
  ensureGuilds();
  const found = findWebhook(req.params.id);
  if (!found || !tokensMatch(found.hook.token, req.params.token)) {
    return res.status(404).json({ error: 'Unknown webhook' });
  }
  if (hookLimited(found.hook.id)) return res.status(429).json({ error: 'Too many webhook posts. Wait a few seconds.' });
  const channel = (found.guild.channels || []).find((row) => row.id === found.hook.channelId);
  if (!channel || channel.type === 'voice') return res.status(404).json({ error: 'Channel not found' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const override = body.username == null ? '' : String(body.username).trim().slice(0, 80);
  const content = body.content == null ? '' : String(body.content).slice(0, 2000);
  const embeds = cleanEmbeds(body.embeds);
  if (!content.trim() && !embeds.length) return res.status(400).json({ error: 'Add a message' });
  const avatar = cleanHookAvatar(body.avatar_url) || found.hook.avatarUrl || '';
  const name = override || found.hook.name || 'Webhook';
  const actor = users[found.hook.createdBy] || null;
  if (!messages[channel.id]) messages[channel.id] = [];
  const msg = {
    id: uuidv4(),
    channelId: channel.id,
    authorId: 'wh:' + found.hook.id,
    webhook: true,
    webhookId: found.hook.id,
    author: { displayName: name, username: 'webhook', avatarUrl: avatar, webhook: true },
    content,
    embeds,
    files: [],
    mentions: actor ? parseMentions(found.guild, actor, content) : { users: [], roles: [], everyone: false, here: false },
    createdAt: new Date().toISOString(),
  };
  messages[channel.id].push(msg);
  if (messages[channel.id].length > 500) messages[channel.id] = messages[channel.id].slice(-500);
  save(MESSAGES_FILE, messages);
  publishCreate(channel.id, msg);
  touchAlerts();
  res.json({ ok: true, id: msg.id, message: presentMessage(msg, '') });
});

const BOTS_FILE = path.join(DATA_DIR, 'bots.json');
let bots = load(BOTS_FILE, {});
botJoinReady = true;
let botEventSeq = 0;
const botEvents = [];
const botWaiters = new Set();
const botPosts = new Map();
const botPulse = new Map();

function saveBots() {
  save(BOTS_FILE, bots);
}

function hashBotToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function makeBotToken() {
  return 'nb_' + crypto.randomBytes(32).toString('base64url');
}

function botUsername(name, selfId) {
  let stem = String(name || '').toLowerCase().replace(/[^a-z0-9._]/g, '').replace(/_bot$/, '');
  if (!/^[a-z]/.test(stem)) stem = ('bot' + stem).replace(/_bot$/, '');
  stem = stem.slice(0, 28);
  if (stem.length < 2) stem = 'bot';
  const taken = (value) => Object.values(users).some((user) => user && user.id !== selfId && String(user.username || '').toLowerCase() === value);
  let n = 0;
  let candidate = stem + '_bot';
  while (taken(candidate)) {
    n += 1;
    const extra = String(n);
    candidate = stem.slice(0, Math.max(2, 28 - extra.length)) + extra + '_bot';
  }
  return candidate.slice(0, 32);
}

function ensureBotUsernames() {
  let usersChanged = false;
  let botsChanged = false;
  const rows = new Map();
  for (const bot of Object.values(bots)) if (bot && bot.id) rows.set(bot.id, bot);
  for (const user of Object.values(users)) if (user && user.bot) rows.set(user.id, rows.get(user.id) || null);
  for (const [id, bot] of rows) {
    const user = users[id];
    const current = String((user && user.username) || (bot && bot.username) || (bot && bot.name) || 'bot');
    if (current.endsWith('_bot')) {
      if (bot && bot.username !== current) {
        bot.username = current;
        botsChanged = true;
      }
      continue;
    }
    const next = botUsername(current, id);
    if (user && user.username !== next) {
      user.username = next;
      user.bot = true;
      usersChanged = true;
    }
    if (bot && bot.username !== next) {
      bot.username = next;
      botsChanged = true;
    }
  }
  if (usersChanged) save(USERS_FILE, users);
  if (botsChanged) saveBots();
}

function ownedBots(userId) {
  return Object.values(bots).filter((bot) => bot && String(bot.ownerId) === String(userId));
}

function botServers(botId) {
  const out = [];
  for (const g of Object.values(guilds.servers || {})) {
    if (g && g.members && g.members[botId]) out.push({ id: g.id, name: g.name || 'Server' });
  }
  return out;
}

function publicBot(bot, withToken) {
  const user = users[bot.id] || {};
  const row = {
    id: bot.id,
    name: bot.name,
    username: user.username || bot.username,
    displayName: user.displayName || bot.name,
    bio: String(user.bio || '').slice(0, 300),
    avatarUrl: publishedMedia(user, 'avatar') || '',
    bannerUrl: publishedMedia(user, 'banner') || '',
    avatarColor: user.avatarColor || '#5865f2',
    accentColor: user.accentColor || user.avatarColor || '#5865f2',
    bannerColor: user.bannerColor || user.accentColor || '#5865f2',
    profileColors: profileShades(user.profileColors),
    tokenTail: bot.tokenTail || '',
    createdAt: bot.createdAt,
    servers: botServers(bot.id),
    commands: Array.isArray(bot.commands) ? bot.commands : [],
  };
  if (withToken) row.token = withToken;
  return row;
}

function botView(bot) {
  const user = users[bot.id] || {};
  return {
    id: bot.id,
    username: user.username || bot.username,
    display_name: user.displayName || bot.name,
    displayName: user.displayName || bot.name,
    bio: String(user.bio || '').slice(0, 300),
    avatar_url: publishedMedia(user, 'avatar') || '',
    banner_url: publishedMedia(user, 'banner') || '',
    avatar_color: user.avatarColor || '#5865f2',
    accent_color: user.accentColor || user.avatarColor || '#5865f2',
    banner_color: user.bannerColor || user.accentColor || '#5865f2',
    bot: true,
    owner_id: bot.ownerId,
    name: bot.name,
  };
}

const botHolds = new Map();
const botPolls = new Map();

function releaseBotHold(user) {
  if (!user) return;
  const id = String(user.id);
  const left = (botHolds.get(id) || 1) - 1;
  if (left > 0) botHolds.set(id, left);
  else botHolds.delete(id);
  const prev = botPulse.get(id);
  if (prev) clearTimeout(prev);
  botPulse.set(id, setTimeout(() => {
    botPulse.delete(id);
    if ((botHolds.get(id) || 0) > 0) return;
    setLive(user, false);
  }, 3000));
}

function holdBot(user, req, res) {
  const id = String(user.id);
  botHolds.set(id, (botHolds.get(id) || 0) + 1);
  const prev = botPulse.get(id);
  if (prev) clearTimeout(prev);
  botPulse.delete(id);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (req.socket) req.socket.off('close', release);
    releaseBotHold(user);
  };
  res.on('finish', release);
  req.on('aborted', release);
  if (req.socket) req.socket.on('close', release);
}

function freshBotPoll(user, raw) {
  const text = String(raw || '');
  if (!text) return true;
  const id = String(user.id);
  const last = botPolls.get(id) || '';
  if (last === text) return false;
  const [session, seq] = text.split('-');
  const [prevSession, prevSeq] = String(last).split('-');
  if (last && session === prevSession && Number(seq) <= Number(prevSeq)) return false;
  botPolls.set(id, text);
  return true;
}

function markBotOnline(user, req, res) {
  if (!user) return;
  if (req && !freshBotPoll(user, req.query && req.query.poll)) return;
  touchLive(user);
  if (req && res) holdBot(user, req, res);
}

function dropBotOnline(user) {
  if (!user) return;
  const id = String(user.id);
  botHolds.delete(id);
  const prev = botPulse.get(id);
  if (prev) clearTimeout(prev);
  botPulse.delete(id);
  setLive(user, false);
}

function botAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bot ') ? header.slice(4).trim() : '';
  if (!token.startsWith('nb_')) return res.status(401).json({ error: 'Missing bot token', code: 'unauthorized' });
  const hash = hashBotToken(token);
  const bot = Object.values(bots).find((row) => row && row.tokenHash === hash);
  const user = bot && users[bot.id];
  if (!bot || !user) return res.status(401).json({ error: 'Wrong token', code: 'unauthorized' });
  const held = accountHold(user);
  if (held) return res.status(403).json({ error: held, code: 'disabled' });
  req.bot = bot;
  req.botUser = user;
  if (req.method === 'POST' && (req.path === '/offline' || req.path === '/api/bot/v1/offline')) return next();
  markBotOnline(user, req, res);
  next();
}

function botFail(res, status, error, code) {
  return res.status(status).json({ error, code: code || 'invalid_request' });
}

function canHostBot(g, user) {
  return !!(g && user && g.members && g.members[user.id] && (isOwner(g, user) || can(g, user, PERM.MANAGE_SERVER)));
}

function pushBotEvent(botId, type, data) {
  const row = {
    id: ++botEventSeq,
    botId: String(botId),
    type,
    data,
    created_at: new Date().toISOString(),
  };
  botEvents.push(row);
  if (botEvents.length > 5000) botEvents.splice(0, botEvents.length - 4000);
  for (const waiter of [...botWaiters]) {
    if (waiter.botId === row.botId) waiter.finish();
  }
}

function takeBotEvents(botId, after) {
  return botEvents.filter((row) => row.botId === String(botId) && row.id > after).slice(0, 100);
}

function noteBotJoin(guild, user) {
  if (!guild || !user || user.bot) return;
  const data = {
    object: 'member',
    server_id: guild.id,
    server_name: guild.name || 'Server',
    user_id: user.id,
    username: user.username || '',
    display_name: user.displayName || user.username || '',
    member_count: memberCount(guild),
  };
  for (const bot of Object.values(bots)) {
    if (!bot || !guild.members || !guild.members[bot.id] || String(bot.id) === String(user.id)) continue;
    pushBotEvent(bot.id, 'member_join', data);
  }
}

function noteBotMessage(msg) {
  if (!msg || msg.webhook || !msg.channelId || msg.seal) return;
  const author = users[msg.authorId];
  if (author && author.bot) return;
  const found = findChannel(msg.channelId, '');
  if (!found || found.channel.type === 'voice') return;
  const content = String(msg.content || '');
  for (const bot of Object.values(bots)) {
    if (!bot || !found.guild.members || !found.guild.members[bot.id]) continue;
    const botUser = users[bot.id];
    if (!botUser || !can(found.guild, botUser, PERM.VIEW, found.channel)) continue;
    const data = {
      object: 'message',
      id: msg.id,
      channel_id: found.channel.id,
      channel_name: found.channel.name,
      server_id: found.guild.id,
      author_id: msg.authorId,
      author: (author && (author.displayName || author.username)) || 'Someone',
      content,
      created_at: msg.createdAt,
      mentioned: content.includes('<@' + bot.id + '>'),
      author_bot: false,
    };
    const matched = content.match(/^[/!]([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i);
    if (matched) {
      const name = matched[1].toLowerCase();
      if ((bot.commands || []).some((cmd) => cmd.name === name)) {
        data.command = name;
        data.args = String(matched[2] || '').trim();
      }
    }
    pushBotEvent(bot.id, 'message', data);
  }
}

function botsWatching(roomId) {
  if (!roomId || String(roomId).startsWith('dm:') || String(roomId).startsWith('group:') || String(roomId).startsWith('thread:')) return [];
  const found = findChannel(roomId, '');
  if (!found || found.channel.type === 'voice') return [];
  const out = [];
  for (const bot of Object.values(bots)) {
    if (!bot || !found.guild.members || !found.guild.members[bot.id]) continue;
    const botUser = users[bot.id];
    if (!botUser || !can(found.guild, botUser, PERM.VIEW, found.channel)) continue;
    out.push({ bot, found });
  }
  return out;
}

function noteBotLeave(guild, user) {
  if (!guild || !user) return;
  const data = {
    object: 'member',
    server_id: guild.id,
    server_name: guild.name || 'Server',
    user_id: user.id,
    username: user.username || '',
    display_name: user.displayName || user.username || '',
    member_count: memberCount(guild),
  };
  for (const bot of Object.values(bots)) {
    if (!bot || !guild.members || !guild.members[bot.id] || String(bot.id) === String(user.id)) continue;
    pushBotEvent(bot.id, 'member_leave', data);
  }
}

function noteBotEdit(roomId, msg) {
  if (!msg || msg.webhook || msg.seal) return;
  const author = users[msg.authorId];
  if (author && author.bot) return;
  for (const row of botsWatching(roomId)) {
    pushBotEvent(row.bot.id, 'message_update', {
      object: 'message',
      id: msg.id,
      channel_id: row.found.channel.id,
      server_id: row.found.guild.id,
      author_id: msg.authorId,
      content: String(msg.content || ''),
      edited_at: msg.editedAt || '',
      author_bot: false,
    });
  }
}

function noteBotDelete(roomId, msg) {
  if (!msg) return;
  for (const row of botsWatching(roomId)) {
    pushBotEvent(row.bot.id, 'message_delete', {
      object: 'message',
      id: msg.id,
      channel_id: row.found.channel.id,
      server_id: row.found.guild.id,
      author_id: msg.authorId || '',
    });
  }
}

function noteBotReaction(roomId, user, emoji, added, msg) {
  if (!user || !msg) return;
  const type = added ? 'reaction_add' : 'reaction_remove';
  for (const row of botsWatching(roomId)) {
    pushBotEvent(row.bot.id, type, {
      object: 'reaction',
      message_id: msg.id,
      channel_id: row.found.channel.id,
      server_id: row.found.guild.id,
      user_id: user.id,
      username: user.username || '',
      emoji: String(emoji || ''),
      added,
      message_author_id: msg.authorId || '',
    });
  }
}

function botEmbeds(rows) {
  if (!Array.isArray(rows)) return [];
  return cleanEmbeds(rows.map((row) => {
    if (!row || typeof row !== 'object' || typeof row.color !== 'string') return row;
    const hex = row.color.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return row;
    return Object.assign({}, row, { color: parseInt(hex, 16) });
  }));
}

function botLimited(id) {
  const now = Date.now();
  const prev = (botPosts.get(id) || []).filter((at) => now - at < 60000);
  if (prev.length >= 30) {
    botPosts.set(id, prev);
    return true;
  }
  prev.push(now);
  botPosts.set(id, prev);
  return false;
}

function addBotToServer(g, bot, actor) {
  hydrateGuild(g);
  if (g.members[bot.id]) return { error: 'That bot is already in this server', status: 400 };
  const here = Object.keys(g.members).filter((id) => users[id] && users[id].bot).length;
  if (here >= 25) return { error: 'This server already has 25 bots', status: 400 };
  g.members[bot.id] = { roles: ['everyone'], joinedAt: new Date().toISOString(), bot: true };
  audit(g, actor, 'added the bot ' + (bot.name || 'bot'));
  saveGuilds();
  pushBotEvent(bot.id, 'server_add', {
    object: 'server',
    server_id: g.id,
    name: g.name || 'Server',
    member_count: memberCount(g),
  });
  return { ok: true };
}

function removeBotFromServer(g, bot, actor) {
  if (!g.members || !g.members[bot.id]) return { error: 'That bot is not in this server', status: 404 };
  delete g.members[bot.id];
  audit(g, actor, 'removed the bot ' + (bot.name || 'bot'));
  saveGuilds();
  pushBotEvent(bot.id, 'server_remove', { object: 'server', server_id: g.id, name: g.name || 'Server' });
  return { ok: true };
}

app.get('/api/bot/v1/version', (req, res) => {
  res.set('X-Nebula-API-Version', '1.1.0');
  res.json({ api: '1.1.0', sdk: { js: '1.1.0' } });
});

app.get('/api/me/bots', auth, (req, res) => {
  res.json({ ok: true, bots: ownedBots(req.user.id).map((bot) => publicBot(bot)), limit: 2 });
});

app.post('/api/me/bots', auth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 32);
  if (name.length < 2) return res.status(400).json({ error: 'Name the bot with at least 2 characters' });
  if (ownedBots(req.user.id).length >= 2) return res.status(400).json({ error: 'Free accounts can have 2 bots' });
  const id = uuidv4();
  const token = makeBotToken();
  const username = botUsername(name, id);
  const now = new Date().toISOString();
  users[id] = {
    id,
    username,
    displayName: name,
    bot: true,
    ownerId: req.user.id,
    avatarColor: '#5865f2',
    accentColor: '#5865f2',
    bio: '',
    createdAt: now,
    badges: [],
  };
  bots[id] = {
    id,
    name,
    username,
    ownerId: req.user.id,
    tokenHash: hashBotToken(token),
    tokenTail: token.slice(-6),
    commands: [],
    createdAt: now,
  };
  save(USERS_FILE, users);
  saveBots();
  res.json({ ok: true, bot: publicBot(bots[id], token) });
});

ensureBotUsernames();

app.patch('/api/me/bots/:id', auth, (req, res) => {
  const bot = bots[req.params.id];
  if (!bot || String(bot.ownerId) !== String(req.user.id)) return res.status(404).json({ error: 'Bot not found' });
  const user = users[bot.id];
  if (!user) return res.status(404).json({ error: 'Bot not found' });
  if (req.body?.name != null) {
    const name = String(req.body.name || '').trim().slice(0, 32);
    if (name.length < 2) return res.status(400).json({ error: 'Name the bot with at least 2 characters' });
    bot.name = name;
    user.displayName = name;
  }
  if (req.body?.displayName != null) {
    const displayName = String(req.body.displayName || '').trim().slice(0, 32);
    if (!displayName) return res.status(400).json({ error: 'Display name required' });
    user.displayName = displayName;
    bot.name = displayName;
  }
  if (req.body?.bio != null) user.bio = String(req.body.bio || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (req.body?.avatarUrl != null) {
    const raw = String(req.body.avatarUrl || '');
    const url = storeImage(raw);
    if (raw && !url) return res.status(400).json({ error: 'Use an uploaded picture' });
    user.avatarUrl = String(url || '').slice(0, 500);
  }
  if (req.body?.bannerUrl != null) {
    const raw = String(req.body.bannerUrl || '');
    const url = storeImage(raw);
    if (raw && !url) return res.status(400).json({ error: 'Use an uploaded picture' });
    user.bannerUrl = String(url || '').slice(0, 500);
  }
  const paint = req.body?.accentColor || req.body?.avatarColor || req.body?.bannerColor || (Array.isArray(req.body?.profileColors) ? req.body.profileColors[0] : '');
  if (paint) {
    const hex = String(paint).trim().slice(0, 9);
    if (!/^#[0-9a-fA-F]{3,8}$/.test(hex)) return res.status(400).json({ error: 'Use a color like #5865f2' });
    user.avatarColor = hex;
    user.accentColor = hex;
    user.bannerColor = hex;
    user.profileColors = [hex, hex];
  }
  save(USERS_FILE, users);
  saveBots();
  touchProfiles();
  res.json({ ok: true, bot: publicBot(bot) });
});

app.post('/api/me/bots/:id/token', auth, (req, res) => {
  const bot = bots[req.params.id];
  if (!bot || String(bot.ownerId) !== String(req.user.id)) return res.status(404).json({ error: 'Bot not found' });
  const token = makeBotToken();
  bot.tokenHash = hashBotToken(token);
  bot.tokenTail = token.slice(-6);
  saveBots();
  res.json({ ok: true, bot: publicBot(bot, token) });
});

app.post('/api/me/bots/:id/test', auth, (req, res) => {
  const bot = bots[req.params.id];
  if (!bot || String(bot.ownerId) !== String(req.user.id)) return res.status(404).json({ error: 'Bot not found' });
  pushBotEvent(bot.id, 'test', { object: 'test', bot: bot.id, by: req.user.id, at: new Date().toISOString(), hello: 'nebula' });
  res.json({ ok: true });
});

app.delete('/api/me/bots/:id', auth, (req, res) => {
  const bot = bots[req.params.id];
  if (!bot || String(bot.ownerId) !== String(req.user.id)) return res.status(404).json({ error: 'Bot not found' });
  for (const g of Object.values(guilds.servers || {})) {
    if (g && g.members && g.members[bot.id]) delete g.members[bot.id];
  }
  saveGuilds();
  const gone = users[bot.id];
  if (gone) dropBotOnline(gone);
  delete users[bot.id];
  delete bots[bot.id];
  save(USERS_FILE, users);
  saveBots();
  res.json({ ok: true });
});

app.post('/api/me/bots/:id/servers', auth, (req, res) => {
  const bot = bots[req.params.id];
  if (!bot || String(bot.ownerId) !== String(req.user.id)) return res.status(404).json({ error: 'Bot not found' });
  ensureGuilds();
  const g = guilds.servers[String(req.body?.serverId || '')];
  if (!g) return res.status(404).json({ error: 'Server not found' });
  if (!canHostBot(g, req.user)) return res.status(403).json({ error: 'You need Manage Server there' });
  const added = addBotToServer(g, bot, req.user);
  if (added.error) return res.status(added.status).json({ error: added.error });
  res.json({ ok: true, bot: publicBot(bot) });
});

app.delete('/api/me/bots/:id/servers/:serverId', auth, (req, res) => {
  const bot = bots[req.params.id];
  if (!bot || String(bot.ownerId) !== String(req.user.id)) return res.status(404).json({ error: 'Bot not found' });
  ensureGuilds();
  const g = guilds.servers[req.params.serverId];
  if (!g) return res.status(404).json({ error: 'Server not found' });
  if (!canHostBot(g, req.user)) return res.status(403).json({ error: 'You need Manage Server there' });
  const removed = removeBotFromServer(g, bot, req.user);
  if (removed.error) return res.status(removed.status).json({ error: removed.error });
  res.json({ ok: true, bot: publicBot(bot) });
});

app.get('/api/servers/:id/bots', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  if (!canHostBot(g, req.user)) return res.status(403).json({ error: 'You need Manage Server' });
  const list = Object.keys(g.members || {})
    .map((id) => bots[id])
    .filter((bot) => bot && users[bot.id] && users[bot.id].bot)
    .map((bot) => publicBot(bot));
  const mine = ownedBots(req.user.id).map((bot) => publicBot(bot));
  res.json({ ok: true, bots: list, mine });
});

app.post('/api/servers/:id/bots', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  if (!canHostBot(g, req.user)) return res.status(403).json({ error: 'You need Manage Server' });
  const bot = bots[String(req.body?.botId || '')];
  if (!bot || String(bot.ownerId) !== String(req.user.id)) return res.status(404).json({ error: 'That bot is not yours' });
  const added = addBotToServer(g, bot, req.user);
  if (added.error) return res.status(added.status).json({ error: added.error });
  res.json({ ok: true, bots: Object.keys(g.members).map((id) => bots[id]).filter(Boolean).map((row) => publicBot(row)) });
});

app.delete('/api/servers/:id/bots/:botId', auth, (req, res) => {
  const g = requireGuild(req, res);
  if (!g) return;
  if (!canHostBot(g, req.user)) return res.status(403).json({ error: 'You need Manage Server' });
  const bot = bots[req.params.botId];
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const removed = removeBotFromServer(g, bot, req.user);
  if (removed.error) return res.status(removed.status).json({ error: removed.error });
  res.json({ ok: true });
});

const botApi = express.Router();
botApi.use((req, res, next) => {
  res.set('X-Nebula-API-Version', '1.1.0');
  next();
});
botApi.use(botAuth);

botApi.post('/offline', (req, res) => {
  dropBotOnline(req.botUser);
  res.json({ ok: true });
});

botApi.get('/me', (req, res) => {
  res.json(botView(req.bot));
});

botApi.patch('/me', (req, res) => {
  const user = req.botUser;
  if (req.body?.display_name != null || req.body?.displayName != null) {
    const displayName = String(req.body.display_name != null ? req.body.display_name : req.body.displayName).trim().slice(0, 32);
    if (!displayName) return botFail(res, 400, 'Display name required');
    user.displayName = displayName;
    req.bot.name = displayName;
  }
  if (req.body?.bio != null) user.bio = String(req.body.bio || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  save(USERS_FILE, users);
  saveBots();
  res.json(botView(req.bot));
});

botApi.put('/me/avatar', express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
  const ext = sniffImage(req.body);
  if (!ext) return botFail(res, 400, 'Use a PNG, JPG, GIF, or WebP');
  if (req.body.length > 8 * 1024 * 1024) return botFail(res, 413, 'Pictures can be up to 8 MB', 'too_large');
  try {
    req.botUser.avatarUrl = await storeUpload(req.body, ext);
  } catch (err) {
    return botFail(res, 502, err.message || 'Could not save that picture', 'unavailable');
  }
  save(USERS_FILE, users);
  res.json(Object.assign({ ok: true }, botView(req.bot)));
});

botApi.get('/commands', (req, res) => {
  res.json({ commands: req.bot.commands || [] });
});

botApi.put('/commands', (req, res) => {
  const rows = Array.isArray(req.body?.commands) ? req.body.commands : [];
  if (rows.length > 100) return botFail(res, 400, 'A bot can have 100 commands');
  const commands = [];
  const seen = new Set();
  for (const row of rows) {
    const name = String(row?.name || '').trim().toLowerCase();
    const description = String(row?.description || '').trim().slice(0, 100);
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) return botFail(res, 400, 'Command names use 1 to 32 lowercase letters, numbers, - or _');
    if (seen.has(name)) return botFail(res, 400, 'Two commands are named ' + name);
    seen.add(name);
    commands.push({ name, description });
  }
  req.bot.commands = commands;
  saveBots();
  res.json({ commands });
});

botApi.get('/events', (req, res) => {
  const after = Math.max(0, Number(req.query.after) || 0);
  const wait = Math.max(0, Math.min(25, Number(req.query.wait) || 0));
  const ready = takeBotEvents(req.bot.id, after);
  const answer = (events) => {
    const last = events.length ? events[events.length - 1].id : after;
    res.json({ events: events.map((row) => ({ id: row.id, type: row.type, data: row.data, created_at: row.created_at })), last });
  };
  if (ready.length || !wait) return answer(ready);
  let finished = false;
  const waiter = { botId: String(req.bot.id), finish: () => {} };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    botWaiters.delete(waiter);
    if (!res.headersSent) answer(takeBotEvents(req.bot.id, after));
  };
  waiter.finish = finish;
  const timer = setTimeout(finish, wait * 1000);
  botWaiters.add(waiter);
  req.on('aborted', () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    botWaiters.delete(waiter);
  });
});

botApi.get('/servers', (req, res) => {
  const servers = botServers(req.bot.id).map((row) => {
    const g = guilds.servers[row.id];
    return { id: row.id, name: row.name, member_count: g ? memberCount(g) : 0 };
  });
  res.json({ servers });
});

botApi.get('/servers/:id/channels', (req, res) => {
  ensureGuilds();
  const g = guilds.servers[req.params.id];
  if (!g || !g.members || !g.members[req.bot.id]) return botFail(res, 404, 'Server not found', 'not_found');
  const type = String(req.query.type || '');
  const channels = visibleChannels(g, req.botUser)
    .filter((ch) => !type || ch.type === type)
    .map((ch) => botChannelView(g, ch));
  res.json({ channels });
});

botApi.get('/channels/:id', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !can(found.guild, req.botUser, PERM.VIEW, found.channel)) return botFail(res, 404, 'Channel not found', 'not_found');
  res.json(botChannelView(found.guild, found.channel));
});

botApi.get('/channels/:id/messages', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !can(found.guild, req.botUser, PERM.VIEW, found.channel)) return botFail(res, 404, 'Channel not found', 'not_found');
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const list = (messages[found.channel.id] || []).slice(-limit);
  res.json({
    messages: list.map((msg) => ({
      id: msg.id,
      channel_id: msg.channelId,
      author_id: msg.authorId,
      author: (msg.author && (msg.author.displayName || msg.author.username)) || '',
      content: msg.seal ? '' : String(msg.content || ''),
      created_at: msg.createdAt,
      bot: !!(msg.bot || msg.webhook),
    })),
  });
});

botApi.post('/channels/:id/messages', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || found.channel.type === 'voice') return botFail(res, 404, 'Channel not found', 'not_found');
  if (!can(found.guild, req.botUser, PERM.VIEW, found.channel)) return botFail(res, 403, 'The bot cannot see that channel', 'missing_permission');
  if (!can(found.guild, req.botUser, PERM.SEND, found.channel)) return botFail(res, 403, 'The bot cannot send messages there', 'missing_permission');
  if (found.channel.readOnly) return botFail(res, 403, 'This channel is read-only', 'missing_permission');
  if (botLimited(req.bot.id)) return botFail(res, 429, '30 messages a minute for this bot', 'rate_limited');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const content = body.content == null ? '' : String(body.content).slice(0, 2000);
  const embeds = botEmbeds(body.embeds);
  if (!content.trim() && !embeds.length) return botFail(res, 400, 'Add a message');
  const slow = Math.max(0, Math.min(21600, Number(found.channel.slowmode) || 0));
  if (slow) {
    const list = messages[found.channel.id] || [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const prev = list[i];
      if (!prev || String(prev.authorId) !== String(req.bot.id)) continue;
      const waited = Date.now() - Date.parse(prev.createdAt || '');
      if (waited < slow * 1000) return botFail(res, 429, 'Slowmode is on', 'rate_limited');
      break;
    }
  }
  if (!messages[found.channel.id]) messages[found.channel.id] = [];
  const msg = {
    id: uuidv4(),
    channelId: found.channel.id,
    authorId: req.bot.id,
    author: slimAuthor(req.botUser),
    bot: true,
    content,
    embeds,
    files: [],
    mentions: parseMentions(found.guild, req.botUser, content),
    replies: body.reply_to ? readReplies({ replies: [{ id: String(body.reply_to) }] }, found.channel.id) : [],
    createdAt: new Date().toISOString(),
  };
  msg.reply = msg.replies[0] || null;
  messages[found.channel.id].push(msg);
  if (messages[found.channel.id].length > 500) messages[found.channel.id] = messages[found.channel.id].slice(-500);
  save(MESSAGES_FILE, messages);
  publishCreate(found.channel.id, msg);
  touchAlerts();
  res.json({
    ok: true,
    message: {
      id: msg.id,
      channel_id: msg.channelId,
      content: msg.content,
      embeds: msg.embeds,
    },
  });
});

function botGuild(req, res) {
  ensureGuilds();
  const g = guilds.servers[req.params.id];
  if (!g || !g.members || !g.members[req.bot.id]) {
    botFail(res, 404, 'Server not found', 'not_found');
    return null;
  }
  hydrateGuild(g);
  return g;
}

function botChannelView(g, ch) {
  return {
    id: ch.id,
    name: ch.name,
    type: ch.type || 'text',
    server_id: g.id,
    topic: ch.topic || '',
    category_id: ch.categoryId || null,
    private: !!ch.private,
    read_only: !!ch.readOnly,
    slowmode: Number(ch.slowmode) || 0,
    stage: !!ch.stage,
  };
}

function botMemberView(g, userId) {
  const user = users[userId];
  const mem = g.members && g.members[userId];
  if (!user || !mem) return null;
  return {
    object: 'member',
    id: user.id,
    username: user.username || '',
    display_name: user.displayName || user.username || '',
    nick: mem.nick || '',
    bot: !!user.bot,
    roles: (mem.roles || []).filter((id) => id !== 'owner'),
    joined_at: mem.joinedAt || '',
    timeout_until: mem.timeoutUntil || 0,
  };
}

const BOT_PERM_NAMES = {
  view_channel: PERM.VIEW,
  send_messages: PERM.SEND,
  manage_channels: PERM.MANAGE_CHANNELS,
  manage_roles: PERM.MANAGE_ROLES,
  create_invite: PERM.INVITE,
  manage_server: PERM.MANAGE_SERVER,
  administrator: PERM.ADMIN,
};

function botPermBits(value) {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return PERM.VIEW | PERM.SEND;
  let bits = 0;
  for (const [key, on] of Object.entries(value)) {
    if (on && BOT_PERM_NAMES[key]) bits |= BOT_PERM_NAMES[key];
  }
  return bits;
}

function botManage(g, user, perm) {
  return isOwner(g, user) || can(g, user, PERM.ADMIN) || can(g, user, perm);
}

botApi.get('/servers/:id', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  res.json({
    id: g.id,
    name: g.name || 'Server',
    member_count: memberCount(g),
    icon: g.icon || '',
  });
});

botApi.get('/servers/:id/counts', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  res.json({ server_id: g.id, member_count: memberCount(g) });
});

botApi.get('/servers/:id/members', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
  const after = String(req.query.after || '');
  const ids = Object.keys(g.members).filter((id) => users[id]).sort();
  const start = after ? ids.findIndex((id) => id > after) : 0;
  const page = ids.slice(Math.max(0, start), Math.max(0, start) + limit);
  res.json({ members: page.map((id) => botMemberView(g, id)).filter(Boolean) });
});

botApi.get('/servers/:id/members/:uid', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  const member = botMemberView(g, req.params.uid);
  if (!member) return botFail(res, 404, 'Member not found', 'not_found');
  res.json(member);
});

botApi.patch('/servers/:id/members/:uid', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_SERVER)) return botFail(res, 403, 'The bot cannot change nicknames', 'missing_permission');
  const mem = g.members[req.params.uid];
  if (!mem) return botFail(res, 404, 'Member not found', 'not_found');
  mem.nick = String(req.body?.nickname == null ? req.body?.nick || '' : req.body.nickname).slice(0, 32);
  audit(g, req.botUser, 'changed a nickname');
  saveGuilds();
  res.json(botMemberView(g, req.params.uid));
});

botApi.get('/servers/:id/roles', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  const roles = (g.roles || []).slice().sort((a, b) => (b.position || 0) - (a.position || 0)).map((role) => ({
    id: role.id,
    name: role.name,
    color: role.color || '',
    position: role.position || 0,
    permissions: Number(role.permissions) || 0,
  }));
  res.json({ roles });
});

botApi.post('/servers/:id/roles', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_ROLES)) return botFail(res, 403, 'The bot cannot manage roles', 'missing_permission');
  const name = String(req.body?.name || '').trim().slice(0, 32);
  if (!name) return botFail(res, 400, 'Role name required');
  const role = {
    id: uuidv4(),
    name,
    color: String(req.body?.color || '#7c5cff').slice(0, 20),
    permissions: botPermBits(req.body?.permissions),
    position: (g.roles || []).reduce((max, row) => Math.max(max, row.position || 0), 0) + 1,
  };
  g.roles.push(role);
  audit(g, req.botUser, 'created the role ' + name);
  saveGuilds();
  res.json({ role });
});

botApi.patch('/servers/:id/roles/:rid', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_ROLES)) return botFail(res, 403, 'The bot cannot manage roles', 'missing_permission');
  const role = (g.roles || []).find((row) => row.id === req.params.rid);
  if (!role || role.id === 'owner') return botFail(res, 404, 'Role not found', 'not_found');
  if (req.body?.name != null && role.id !== 'everyone') role.name = String(req.body.name).trim().slice(0, 32) || role.name;
  if (req.body?.color != null) role.color = String(req.body.color).slice(0, 20);
  if (req.body?.permissions != null && role.id !== 'owner') role.permissions = botPermBits(req.body.permissions);
  saveGuilds();
  res.json({ role: { id: role.id, name: role.name, color: role.color || '', permissions: Number(role.permissions) || 0 } });
});

botApi.delete('/servers/:id/roles/:rid', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_ROLES)) return botFail(res, 403, 'The bot cannot manage roles', 'missing_permission');
  const roleId = req.params.rid;
  if (roleId === 'everyone' || roleId === 'owner' || roleId === 'here') return botFail(res, 400, 'That role cannot be deleted');
  if (!(g.roles || []).some((row) => row.id === roleId)) return botFail(res, 404, 'Role not found', 'not_found');
  g.roles = g.roles.filter((row) => row.id !== roleId);
  for (const mem of Object.values(g.members)) mem.roles = (mem.roles || []).filter((id) => id !== roleId);
  audit(g, req.botUser, 'deleted a role');
  saveGuilds();
  res.json({ ok: true });
});

botApi.put('/servers/:id/members/:uid/roles/:rid', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_ROLES)) return botFail(res, 403, 'The bot cannot manage roles', 'missing_permission');
  const mem = g.members[req.params.uid];
  const role = (g.roles || []).find((row) => row.id === req.params.rid);
  if (!mem || !role || role.id === 'everyone' || role.id === 'owner') return botFail(res, 404, 'Member or role not found', 'not_found');
  if (isRootAccount(users[req.params.uid])) return botFail(res, 403, 'That account is not affected by permissions', 'missing_permission');
  mem.roles = mem.roles || ['everyone'];
  if (!mem.roles.includes(role.id)) mem.roles.push(role.id);
  audit(g, req.botUser, 'gave a role');
  saveGuilds();
  res.json(botMemberView(g, req.params.uid));
});

botApi.delete('/servers/:id/members/:uid/roles/:rid', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_ROLES)) return botFail(res, 403, 'The bot cannot manage roles', 'missing_permission');
  const mem = g.members[req.params.uid];
  if (!mem) return botFail(res, 404, 'Member not found', 'not_found');
  if (isRootAccount(users[req.params.uid])) return botFail(res, 403, 'That account is not affected by permissions', 'missing_permission');
  mem.roles = (mem.roles || []).filter((id) => id !== req.params.rid);
  saveGuilds();
  res.json(botMemberView(g, req.params.uid));
});

botApi.post('/servers/:id/kick', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_SERVER)) return botFail(res, 403, 'The bot cannot kick members', 'missing_permission');
  const userId = String(req.body?.user_id || req.body?.userId || '');
  const target = users[userId];
  if (!g.members[userId] || !target) return botFail(res, 404, 'Member not found', 'not_found');
  if (isOwner(g, target)) return botFail(res, 403, 'You cannot remove an owner', 'missing_permission');
  delete g.members[userId];
  audit(g, req.botUser, 'kicked ' + (target.username || userId));
  saveGuilds();
  if (target.bot) pushBotEvent(userId, 'server_remove', { object: 'server', server_id: g.id, name: g.name || 'Server' });
  noteBotLeave(g, target);
  res.json({ ok: true });
});

botApi.get('/servers/:id/bans', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_SERVER)) return botFail(res, 403, 'The bot cannot view bans', 'missing_permission');
  const bans = Object.entries(g.bans || {}).map(([user_id, row]) => ({
    user_id,
    reason: (row && row.reason) || '',
    at: (row && row.at) || '',
  }));
  res.json({ bans });
});

botApi.post('/servers/:id/bans', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_SERVER)) return botFail(res, 403, 'The bot cannot ban members', 'missing_permission');
  const userId = String(req.body?.user_id || req.body?.userId || '');
  const target = users[userId];
  if (!target || isOwner(g, target)) return botFail(res, 403, 'That member cannot be banned', 'missing_permission');
  g.bans = g.bans || {};
  g.bans[userId] = { reason: String(req.body?.reason || '').slice(0, 200), at: new Date().toISOString() };
  if (g.members[userId]) delete g.members[userId];
  audit(g, req.botUser, 'banned ' + (target.username || userId));
  saveGuilds();
  if (target.bot) pushBotEvent(userId, 'server_remove', { object: 'server', server_id: g.id, name: g.name || 'Server' });
  noteBotLeave(g, target);
  res.json({ ok: true });
});

botApi.delete('/servers/:id/bans/:uid', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_SERVER)) return botFail(res, 403, 'The bot cannot unban members', 'missing_permission');
  if (g.bans) delete g.bans[req.params.uid];
  saveGuilds();
  res.json({ ok: true });
});

botApi.post('/servers/:id/timeouts', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_SERVER)) return botFail(res, 403, 'The bot cannot time members out', 'missing_permission');
  const userId = String(req.body?.user_id || req.body?.userId || '');
  const mem = g.members[userId];
  if (!mem) return botFail(res, 404, 'Member not found', 'not_found');
  const minutes = Math.max(0, Math.min(40320, Number(req.body?.minutes) || 0));
  mem.timeoutUntil = minutes ? Date.now() + minutes * 60000 : 0;
  audit(g, req.botUser, minutes ? 'timed out a member' : 'cleared a timeout');
  saveGuilds();
  res.json(botMemberView(g, userId));
});

botApi.get('/servers/:id/invites', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!can(g, req.botUser, PERM.INVITE) && !botManage(g, req.botUser, PERM.MANAGE_SERVER)) {
    return botFail(res, 403, 'The bot cannot see invites', 'missing_permission');
  }
  const invites = Object.values(g.invites || {}).map((inv) => ({
    code: inv.code,
    uses: inv.uses || 0,
    created_at: inv.createdAt || '',
  }));
  res.json({ invites });
});

botApi.get('/servers/:id/voice', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  const snap = typeof app.locals.voiceSnapshot === 'function' ? app.locals.voiceSnapshot(req.botUser) : null;
  const rooms = (snap && snap.servers && snap.servers[g.id]) || {};
  const voice = Object.entries(rooms).map(([channel_id, people]) => ({
    channel_id,
    user_ids: (people || []).map((person) => person.id),
  }));
  res.json({ voice });
});

botApi.post('/servers/:id/channels', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot manage channels', 'missing_permission');
  const type = req.body?.type === 'voice' || req.body?.kind === 'voice' ? 'voice' : 'text';
  const name = slugChannel(req.body?.name);
  if (!name) return botFail(res, 400, 'Channel name required');
  if ((g.channels || []).some((row) => row.name === name && row.type === type)) return botFail(res, 409, 'A channel with that name already exists', 'invalid_request');
  const channel = {
    id: uuidv4(),
    name,
    type,
    topic: String(req.body?.topic || '').slice(0, 200),
    categoryId: String(req.body?.category_id || req.body?.categoryId || ''),
    overwrites: [],
    private: !!req.body?.private,
    readOnly: type === 'text' && !!(req.body?.read_only || req.body?.readOnly),
    slowmode: type === 'text' ? Math.max(0, Math.min(21600, Number(req.body?.slowmode) || 0)) : 0,
    stage: type === 'voice' && !!req.body?.stage,
  };
  let deny = 0;
  if (channel.private) deny |= PERM.VIEW;
  if (channel.readOnly) deny |= PERM.SEND;
  if (deny) channel.overwrites = [{ roleId: 'everyone', allow: 0, deny }];
  g.channels.push(channel);
  audit(g, req.botUser, 'created #' + name);
  saveGuilds();
  res.json({ channel: botChannelView(g, channel) });
});

botApi.post('/servers/:id/categories', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot manage channels', 'missing_permission');
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return botFail(res, 400, 'Category name required');
  g.categories = g.categories || [];
  if (g.categories.some((row) => String(row.name || '').trim().toLowerCase() === name.toLowerCase())) {
    return botFail(res, 400, 'A category with that name already exists', 'invalid_request');
  }
  const category = { id: uuidv4(), name };
  g.categories.push(category);
  saveGuilds();
  res.json({ category });
});

botApi.delete('/servers/:id/categories/:cid', (req, res) => {
  const g = botGuild(req, res);
  if (!g) return;
  if (!botManage(g, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot manage channels', 'missing_permission');
  g.categories = (g.categories || []).filter((row) => row.id !== req.params.cid);
  (g.channels || []).forEach((row) => { if (row.categoryId === req.params.cid) row.categoryId = ''; });
  saveGuilds();
  res.json({ ok: true });
});

botApi.patch('/channels/:id', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !found.guild.members[req.bot.id]) return botFail(res, 404, 'Channel not found', 'not_found');
  if (!botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot manage channels', 'missing_permission');
  const channel = found.channel;
  if (req.body?.name != null) {
    const name = slugChannel(req.body.name);
    if (!name) return botFail(res, 400, 'Channel name required');
    channel.name = name;
  }
  if (req.body?.topic != null) channel.topic = String(req.body.topic).slice(0, 200);
  if (req.body?.slowmode != null) channel.slowmode = Math.max(0, Math.min(21600, Number(req.body.slowmode) || 0));
  if (req.body?.read_only != null || req.body?.readOnly != null) channel.readOnly = !!(req.body.read_only || req.body.readOnly);
  if (req.body?.private != null) channel.private = !!req.body.private;
  if (req.body?.category_id != null || req.body?.categoryId != null) channel.categoryId = String(req.body.category_id || req.body.categoryId || '');
  saveGuilds();
  res.json(botChannelView(found.guild, channel));
});

botApi.delete('/channels/:id', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !found.guild.members[req.bot.id]) return botFail(res, 404, 'Channel not found', 'not_found');
  if (!botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot manage channels', 'missing_permission');
  const g = found.guild;
  const channel = found.channel;
  const textLeft = g.channels.filter((row) => row.type === 'text' && row.id !== channel.id);
  if (channel.type === 'text' && !textLeft.length) return botFail(res, 400, 'A server needs at least one text channel');
  g.channels = g.channels.filter((row) => row.id !== channel.id);
  saveGuilds();
  res.json({ ok: true });
});

botApi.get('/channels/:id/messages/:mid', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !can(found.guild, req.botUser, PERM.VIEW, found.channel)) return botFail(res, 404, 'Channel not found', 'not_found');
  const msg = (messages[found.channel.id] || []).find((row) => row && row.id === req.params.mid);
  if (!msg) return botFail(res, 404, 'Message not found', 'not_found');
  res.json({
    id: msg.id,
    channel_id: msg.channelId,
    author_id: msg.authorId,
    content: msg.seal ? '' : String(msg.content || ''),
    embeds: msg.embeds || [],
    created_at: msg.createdAt,
  });
});

botApi.patch('/channels/:id/messages/:mid', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found) return botFail(res, 404, 'Channel not found', 'not_found');
  const msg = (messages[found.channel.id] || []).find((row) => row && row.id === req.params.mid);
  if (!msg || String(msg.authorId) !== String(req.bot.id)) return botFail(res, 404, 'Message not found', 'not_found');
  if (req.body?.content != null) msg.content = String(req.body.content).slice(0, 2000);
  if (req.body?.embeds != null) msg.embeds = botEmbeds(req.body.embeds);
  msg.editedAt = new Date().toISOString();
  save(MESSAGES_FILE, messages);
  publishUpdate(found.channel.id, msg);
  res.json({ id: msg.id, content: msg.content, embeds: msg.embeds || [] });
});

botApi.delete('/channels/:id/messages/:mid', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !found.guild.members[req.bot.id]) return botFail(res, 404, 'Channel not found', 'not_found');
  const list = messages[found.channel.id] || [];
  const index = list.findIndex((row) => row && row.id === req.params.mid);
  if (index < 0) return botFail(res, 404, 'Message not found', 'not_found');
  const msg = list[index];
  const own = String(msg.authorId) === String(req.bot.id);
  if (!own && !botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot delete that message', 'missing_permission');
  list.splice(index, 1);
  save(MESSAGES_FILE, messages);
  publishDelete(found.channel.id, msg.id);
  res.json({ ok: true });
});

botApi.post('/channels/:id/messages/bulk-delete', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !found.guild.members[req.bot.id]) return botFail(res, 404, 'Channel not found', 'not_found');
  if (!botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot delete those messages', 'missing_permission');
  const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 100).map(String));
  const list = messages[found.channel.id] || [];
  const before = list.length;
  messages[found.channel.id] = list.filter((row) => !row || !ids.has(String(row.id)));
  save(MESSAGES_FILE, messages);
  res.json({ ok: true, deleted: before - messages[found.channel.id].length });
});

botApi.put('/channels/:id/messages/:mid/pin', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found) return botFail(res, 404, 'Channel not found', 'not_found');
  if (!botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot pin messages', 'missing_permission');
  const msg = (messages[found.channel.id] || []).find((row) => row && row.id === req.params.mid);
  if (!msg) return botFail(res, 404, 'Message not found', 'not_found');
  msg.pinned = true;
  save(MESSAGES_FILE, messages);
  res.json({ ok: true });
});

botApi.delete('/channels/:id/messages/:mid/pin', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found) return botFail(res, 404, 'Channel not found', 'not_found');
  if (!botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot pin messages', 'missing_permission');
  const msg = (messages[found.channel.id] || []).find((row) => row && row.id === req.params.mid);
  if (!msg) return botFail(res, 404, 'Message not found', 'not_found');
  msg.pinned = false;
  save(MESSAGES_FILE, messages);
  res.json({ ok: true });
});

botApi.get('/channels/:id/messages/:mid/reactions', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !can(found.guild, req.botUser, PERM.VIEW, found.channel)) return botFail(res, 404, 'Channel not found', 'not_found');
  const msg = (messages[found.channel.id] || []).find((row) => row && row.id === req.params.mid);
  if (!msg) return botFail(res, 404, 'Message not found', 'not_found');
  res.json({ reactions: publicReactions(msg, req.bot.id) });
});

botApi.put('/channels/:id/messages/:mid/reactions/:emoji', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !can(found.guild, req.botUser, PERM.VIEW, found.channel)) return botFail(res, 404, 'Channel not found', 'not_found');
  const msg = (messages[found.channel.id] || []).find((row) => row && row.id === req.params.mid);
  if (!msg) return botFail(res, 404, 'Message not found', 'not_found');
  const emoji = cleanReactionEmoji(req.botUser, decodeURIComponent(req.params.emoji || ''));
  if (!emoji) return botFail(res, 400, 'Pick an emoji');
  msg.reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
  let row = msg.reactions.find((item) => item && item.emoji === emoji);
  if (!row) {
    row = { emoji, users: [] };
    msg.reactions.push(row);
  }
  if (!row.users.map(String).includes(String(req.bot.id))) row.users.push(String(req.bot.id));
  save(MESSAGES_FILE, messages);
  publishUpdate(found.channel.id, msg);
  res.json({ ok: true });
});

botApi.delete('/channels/:id/messages/:mid/reactions/:emoji', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !can(found.guild, req.botUser, PERM.VIEW, found.channel)) return botFail(res, 404, 'Channel not found', 'not_found');
  const msg = (messages[found.channel.id] || []).find((row) => row && row.id === req.params.mid);
  if (!msg) return botFail(res, 404, 'Message not found', 'not_found');
  const emoji = decodeURIComponent(req.params.emoji || '');
  msg.reactions = (msg.reactions || []).map((item) => {
    if (!item || item.emoji !== emoji) return item;
    return { ...item, users: (item.users || []).filter((id) => String(id) !== String(req.bot.id)) };
  }).filter((item) => item && item.users && item.users.length);
  save(MESSAGES_FILE, messages);
  publishUpdate(found.channel.id, msg);
  res.json({ ok: true });
});

botApi.get('/channels/:id/threads', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !can(found.guild, req.botUser, PERM.VIEW, found.channel)) return botFail(res, 404, 'Channel not found', 'not_found');
  const list = Object.values(threads)
    .filter((thread) => thread && thread.channelId === found.channel.id && !thread.closed && threadVisible(thread, req.botUser, found))
    .map(publicThread);
  res.json({ threads: list });
});

botApi.post('/channels/:id/threads', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || found.channel.type === 'voice') return botFail(res, 400, 'Threads belong in a text channel');
  if (!can(found.guild, req.botUser, PERM.SEND, found.channel)) return botFail(res, 403, 'The bot cannot post there', 'missing_permission');
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!name) return botFail(res, 400, 'Give the thread a name');
  if (!content) return botFail(res, 400, 'Write the first message');
  const id = uuidv4();
  const thread = {
    id,
    name,
    channelId: found.channel.id,
    serverId: found.guild.id,
    ownerId: String(req.bot.id),
    createdAt: new Date().toISOString(),
    closed: false,
    private: !!req.body?.private,
    followers: [String(req.bot.id)],
  };
  threads[id] = thread;
  save(THREADS_FILE, threads);
  const made = appendRoomMessage('thread:' + id, { user: req.botUser, body: { content } });
  if (made.error) return botFail(res, 400, made.error);
  res.json({ thread: publicThread(thread) });
});

botApi.get('/users/:id', (req, res) => {
  const user = users[req.params.id];
  if (!user) return botFail(res, 404, 'User not found', 'not_found');
  const shares = Object.values(guilds.servers || {}).some((g) => g && g.members && g.members[req.bot.id] && g.members[user.id]);
  if (!shares && String(user.id) !== String(req.bot.id)) return botFail(res, 404, 'User not found', 'not_found');
  res.json({
    object: 'user',
    id: user.id,
    username: user.username || '',
    display_name: user.displayName || user.username || '',
    bot: !!user.bot,
    avatar_url: publishedMedia(user, 'avatar') || '',
  });
});

botApi.get('/channels/:id/webhooks', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || !found.guild.members[req.bot.id]) return botFail(res, 404, 'Channel not found', 'not_found');
  if (!botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot manage webhooks', 'missing_permission');
  hydrateGuild(found.guild);
  const list = (found.guild.webhooks || []).filter((hook) => hook.channelId === found.channel.id).map((hook) => ({
    id: hook.id,
    name: hook.name,
    channel_id: hook.channelId,
  }));
  res.json({ webhooks: list });
});

botApi.post('/channels/:id/webhooks', (req, res) => {
  const found = findChannel(req.params.id, '');
  if (!found || found.channel.type === 'voice' || !found.guild.members[req.bot.id]) return botFail(res, 404, 'Channel not found', 'not_found');
  if (!botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) return botFail(res, 403, 'The bot cannot manage webhooks', 'missing_permission');
  hydrateGuild(found.guild);
  const here = (found.guild.webhooks || []).filter((hook) => hook.channelId === found.channel.id);
  if (here.length >= 10) return botFail(res, 400, 'This channel already has 10 webhooks');
  const hook = {
    id: uuidv4(),
    channelId: found.channel.id,
    name: String(req.body?.name || found.channel.name || 'webhook').trim().slice(0, 80) || 'webhook',
    avatarUrl: '',
    token: hookToken(),
    createdBy: req.bot.id,
    createdAt: new Date().toISOString(),
  };
  found.guild.webhooks = found.guild.webhooks || [];
  found.guild.webhooks.push(hook);
  audit(found.guild, req.botUser, 'created a webhook in #' + found.channel.name);
  saveGuilds();
  res.json({
    webhook: publicHook(found.guild, hook),
    url: 'https://nebulaapp.space/api/webhooks/' + hook.id + '/' + hook.token,
  });
});

botApi.delete('/webhooks/:id', (req, res) => {
  const found = findWebhook(req.params.id);
  if (!found) return botFail(res, 404, 'Webhook not found', 'not_found');
  if (String(found.hook.createdBy) !== String(req.bot.id) && !botManage(found.guild, req.botUser, PERM.MANAGE_CHANNELS)) {
    return botFail(res, 403, 'The bot cannot delete that webhook', 'missing_permission');
  }
  found.guild.webhooks = (found.guild.webhooks || []).filter((hook) => hook.id !== found.hook.id);
  saveGuilds();
  res.json({ ok: true });
});

app.use('/api/bot/v1', botApi);

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
      detached: process.platform !== 'win32',
      stdio: 'inherit',
      windowsHide: false,
      env: { ...process.env, NEBULA_RESTART_DELAY: '800' },
    });
    child.unref();
    process.exit(0);
  } finally {
    pulling = false;
  }
}

function openNeb2(key, buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32 || buf.subarray(0, 4).toString() !== 'NEB2') return null;
  try {
    const iv = buf.subarray(4, 16);
    const body = buf.subarray(16);
    const tag = body.subarray(body.length - 16);
    const data = body.subarray(0, body.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch (_) {
    return null;
  }
}

function payloadKind(plain) {
  if (!plain || plain.length < 8) return null;
  const len = plain.readUInt32BE(0);
  if (!len || len > 400 || 4 + len >= plain.length) return null;
  const bytes = plain.subarray(4 + len);
  const ext = sniffImage(bytes) || sniffVideo(bytes);
  if (!ext) return null;
  const kind = ext === '.mp4' || ext === '.webm' || ext === '.mov' ? 'video' : 'image';
  return { kind, ext };
}

function neb2Pack(key, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]);
}

function sealListedHistory() {
  ensureGuilds();
  let changed = false;
  for (const g of Object.values(guilds.servers || {})) {
    hydrateGuild(g);
    if (!g.roomKey) continue;
    const key = Buffer.from(g.roomKey, 'base64');
    if (key.length !== 32) continue;
    for (const channel of g.channels || []) {
      const list = messages[channel.id];
      if (!Array.isArray(list)) continue;
      for (const msg of list) {
        if (!msg) continue;
        if (msg.content && !String(msg.content).startsWith('NEB2.')) {
          msg.content = 'NEB2.' + neb2Pack(key, Buffer.from(String(msg.content), 'utf8')).toString('base64');
          changed = true;
        }
        for (const file of msg.files || []) {
          if (!file || file.lock) continue;
          const stored = uploadName(file.url);
          if (!stored) continue;
          const full = path.join(UPLOAD_DIR, stored);
          if (!fs.existsSync(full)) continue;
          try {
            let bytes = fs.readFileSync(full);
            if (isSealedFile(bytes)) bytes = openSealedBytes(bytes);
            if (!file.enc && bytes.slice(0, 4).toString() !== 'NEB2') {
              const sniffed = sniffImage(bytes) || sniffVideo(bytes);
              const mime = sniffed ? mediaType('file' + sniffed) : '';
              const header = Buffer.from(JSON.stringify({ name: file.name || 'file', type: mime }));
              const len = Buffer.alloc(4);
              len.writeUInt32BE(header.length, 0);
              const packed = neb2Pack(key, Buffer.concat([len, header, bytes]));
              fs.writeFileSync(full, Buffer.concat([Buffer.from('NEB2'), packed]));
              file.enc = 1;
              const visual = sniffed === '.mp4' || sniffed === '.webm' || sniffed === '.mov' ? 'video' : (sniffed ? 'image' : '');
              if (visual) {
                file.kind = visual;
                if (!file.name || file.name === 'file') file.name = visual + sniffed;
              }
              delete file.alt;
              changed = true;
            } else if (file.enc && file.kind !== 'image' && file.kind !== 'video' && file.kind !== 'audio') {
              const plain = openNeb2(key, bytes);
              const info = plain ? payloadKind(plain) : null;
              if (info && info.kind && info.kind !== file.kind) {
                file.kind = info.kind;
                if (!file.name || file.name === 'file') file.name = info.kind + (info.ext || '');
                changed = true;
              }
            }
          } catch (_) {}
        }
      }
    }
  }
  if (changed) save(MESSAGES_FILE, messages);
  saveGuilds();
}

function listen() {
  try { sealListedHistory(); } catch (err) { console.log('Room seal skipped: ' + (err.message || err)); }
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    hub = attachGateway(httpServer, {
      identify(token) {
        const found = security.findSession(users, token);
        return found ? found.user : null;
      },
      watch: resolveWatch,
      presence: setLive,
      touch: touchLive,
      ready(user) {
        const voice = typeof app.locals.voiceSnapshot === 'function' ? app.locals.voiceSnapshot(user) : null;
        return { cursor: String(alertRev), voice };
      },
    });
    console.log('\n  Nebula backend -> http://localhost:' + PORT);
    console.log('  Frontend folder: ' + FRONTEND_DIR);
    console.log('  Users: ' + Object.keys(users).length);
    console.log('  Email: ' + GMAIL_USER);
    console.log(r2Config() ? '  Scrambled chats: Cloudflare R2' : '  Scrambled chats: this PC (.env has no Cloudflare keys)');
    publishExistingMedia().catch((err) => console.log('  Cloudflare sync skipped: ' + (err.message || err)));
    console.log('  Checking GitHub for updates every 30s.');
    setInterval(() => { pullUpdates().catch(() => {}); }, 30000);
    try { queueSavedSongs(); } catch (err) { console.log('  Profile songs will save when you open settings.'); }
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

console.log('Nebula starting');
setTimeout(() => {
  pullCloud().catch((err) => console.log('Cloud store skipped: ' + (err.message || err))).finally(listen);
}, Number(process.env.NEBULA_RESTART_DELAY || 0));