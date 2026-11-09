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
  if (user.token && !user.sessions.some((row) => row.token === user.token)) {
    user.sessions.unshift({
      id: 'legacy-' + String(user.id || '').slice(0, 8),
      token: user.token,
      createdAt: user.createdAt || new Date().toISOString(),
      lastSeen: Number(user.lastSeen) || Date.now(),
      label: 'Saved session',
      ua: '',
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
    token,
    createdAt: new Date().toISOString(),
    lastSeen: Date.now(),
    label: deviceLabel(req && req.headers && req.headers['user-agent']),
    ua: String((req && req.headers && req.headers['user-agent']) || '').slice(0, 180),
  };
  user.sessions.push(session);
  if (user.sessions.length > 24) user.sessions.splice(0, user.sessions.length - 24);
  user.token = token;
  user.status = 'online';
  user.lastSeen = Date.now();
  return session;
}

function findSession(users, token) {
  if (!token) return null;
  for (const user of Object.values(users || {})) {
    ensureSessions(user);
    const session = user.sessions.find((row) => row.token === token);
    if (session) return { user, session };
  }
  for (const user of Object.values(users || {})) {
    if (!user || user.token !== token) continue;
    ensureSessions(user);
    const session = user.sessions.find((row) => row.token === token);
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
    label: row.label || 'Unknown device',
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
        name: user.email || user.username,
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
    name: deviceLabel(req && req.headers && req.headers['user-agent']),
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
function saveNow(file, data) {
  dirtyFiles.set(file, data);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
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
}
let codes = load(CODES_FILE, {});
let friendGraph = load(FRIENDS_FILE, {});
let dmThreads = load(DMS_FILE, {});
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const THREADS_FILE = path.join(DATA_DIR, 'threads.json');
let groups = load(GROUPS_FILE, {});
let threads = load(THREADS_FILE, {});

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
  if (g.tagIcon == null) g.tagIcon = '';
  if (g.vanity == null) g.vanity = '';
  if (g.id === OFFICIAL_ID) g.vanity = 'nebula';
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

const TAG_ICONS = ['⚡', '💜', '💎', '🔥', '🌸', '💧', '💙', '🍃', '❤️', '💖', '⭐', '👑', '💀', '👻', '🌙', '☀️', '✨', '🍄', '🐾', '🎵', '🎮', '⚔️', '🛡️', '🐱', '🐰', '☁️', '🌈', '❄️', '🎃', '🦋', '🐟', '🪐', '🍀', '♥', '★', '☆', '♡', '✦'];
const RESERVED_LINKS = new Set(['api', 'invite', 'assets', 'files', 'uploads', 'index', 'nebula', 'sw']);

function memberCount(g) {
  return Object.keys((g && g.members) || {}).length;
}

function canCustomize(g) {
  return !!g && (g.id === OFFICIAL_ID || memberCount(g) >= 5);
}

function cleanTag(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function cleanSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
}

function inviteCode() {
  for (let i = 0; i < 6; i += 1) {
    const code = crypto.randomBytes(4).toString('hex');
    const taken = Object.values(guilds.servers || {}).some((g) =>
      (g.vanity && String(g.vanity).toLowerCase() === code) || (g.invites && g.invites[code]));
    if (!taken) return code;
  }
  return crypto.randomBytes(6).toString('hex');
}

function findByInvite(slug) {
  const key = cleanSlug(slug);
  if (!key) return null;
  for (const g of Object.values(guilds.servers || {})) {
    if (g.vanity && String(g.vanity).toLowerCase() === key) return g;
  }
  for (const g of Object.values(guilds.servers || {})) {
    if (g.invites && g.invites[key]) return g;
  }
  return null;
}

function showcaseOf(u) {
  if (!u || !u.showcaseServerId || !guilds.servers) return null;
  const g = guilds.servers[u.showcaseServerId];
  if (!g || !g.tag || !g.members || !g.members[u.id] || !canCustomize(g)) return null;
  return { serverId: g.id, name: g.name || '', tag: g.tag, icon: g.tagIcon || '' };
}

function tagChoices(u) {
  if (!u || !guilds.servers) return [];
  const out = [];
  for (const g of Object.values(guilds.servers)) {
    if (!g || !g.tag || !g.members || !g.members[u.id] || !canCustomize(g)) continue;
    out.push({ serverId: g.id, name: g.name || '', tag: g.tag, icon: g.tagIcon || '' });
  }
  return out;
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
  pub.roles = roles.filter((r) => r.id !== 'owner').map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position || 0, icon: r.icon || '' }));
  const iconRole = roles.find((r) => r.icon && r.id !== 'everyone' && r.id !== 'here' && r.id !== 'owner');
  pub.roleIcon = iconRole ? iconRole.icon : '';
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
    nameFont: cleanNameFont(u.nameFont),
    nameColors: cleanNameColors(u.nameColors),
    showcase: showcaseOf(u),
    showcaseBadge: userOwnsBadge(u, u.showcaseBadge) ? u.showcaseBadge : '',
    badges: [...new Set([...(u.badges || []).filter((b) => b === 'early'), ...(signedUpForMoon(u) ? ['early'] : [])])],
    staff: staffKey(guilds.servers && guilds.servers[OFFICIAL_ID], u),
    developer: hasDeveloper(guilds.servers && guilds.servers[OFFICIAL_ID], u),
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
    const reacts = (msg.reactions || []).map((row) => row.emoji + ':' + ((row.users || []).length)).join(',');
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
  let stored = String((u && u[pathKey]) || '').replace(/^\/+/, '');
  if (slot === 'banner') {
    const original = stored.replace(/\.(?:s)?(?:32|128|512)\.gif$/i, '.gif');
    if (original !== stored && fs.existsSync(path.join(FILES_DIR, original))) stored = original;
  }
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
  const full = path.join(folder, name);
  fs.writeFileSync(full, buf);
  const rel = bucket + '/' + user.id + '/' + name;
  const urlKey = slot === 'avatar' ? 'avatarUrl' : 'bannerUrl';
  const pathKey = slot === 'avatar' ? 'avatarPath' : 'bannerPath';
  user[pathKey] = rel;
  user[urlKey] = '/files/' + rel;
  return { path: rel, url: '/files/' + rel };
}

function userOwnsBadge(u, id) {
  if (!u || !id) return false;
  if (id === 'early') return (u.badges || []).includes('early') || signedUpForMoon(u);
  if (id === 'staff') return !!staffKey(guilds.servers && guilds.servers[OFFICIAL_ID], u);
  if (id === 'developer') return hasDeveloper(guilds.servers && guilds.servers[OFFICIAL_ID], u);
  return false;
}

const IDLE_MS = 10 * 60 * 1000;

function effectiveStatus(u) {
  const chosen = u && u.status ? u.status : 'online';
  if (chosen !== 'online') return chosen;
  const seen = Number(u && u.lastSeen) || 0;
  if (!seen || Date.now() - seen > IDLE_MS) return 'idle';
  return 'online';
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    uid: u.uid || null,
    username: u.username,
    displayName: u.displayName || u.username,
    email: u.email,
    bio: String(u.bio || '').replace(/\s+/g, ' ').trim().slice(0, 29),
    aboutMe: u.aboutMe || '',
    pronouns: u.pronouns || '',
    aliases: Array.isArray(u.aliases) ? u.aliases.slice(0, 10) : [],
    status: effectiveStatus(u),
    statusChoice: u.status || 'online',
    lastSeen: u.hideLastSeen ? null : (Number(u.lastSeen) || null),
    hideLastSeen: !!u.hideLastSeen,
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
    nameFont: cleanNameFont(u.nameFont),
    nameColors: cleanNameColors(u.nameColors),
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
    server: SERVER_NAME,
    createdAt: u.createdAt,
    mfa: !!(u.totp && u.totp.enabled),
    passkeyCount: Array.isArray(u.passkeys) ? u.passkeys.length : 0,
    sessionCount: security.sessionCount(u),
  };
}

unpackImages();

function cleanNameEffect(value) {
  return ['plain', 'glow', 'gradient', 'rainbow', 'glitch', 'sparkle'].includes(value) ? value : '';
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

  const entry = {
    username: cleanUser,
    passwordHash: hashPassword(password),
  };
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return res.json(createAccount(cleanEmail, entry, req));
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  codes[cleanEmail] = {
    ...entry,
    code,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  save(CODES_FILE, codes);

  try {
    await sendVerificationCode(cleanEmail, code);
    res.json({ ok: true, message: 'Verification code sent' });
  } catch (err) {
    delete codes[cleanEmail];
    save(CODES_FILE, codes);
    const msg = (err && err.message) || '';
    res.status(500).json({ error: msg.includes('not configured') ? msg : 'Failed to send email' });
  }
});

function createAccount(cleanEmail, entry, req) {
  const id = uuidv4();
  const uid = nextUid();
  const badges = [];
  if (isEarlySupporterWindow()) badges.push('early');
  users[id] = {
    id, uid,
    username: entry.username,
    displayName: entry.username,
    email: cleanEmail,
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
  delete codes[cleanEmail];
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
  res.json(createAccount(cleanEmail, entry, req));
});

app.post('/api/auth/login', (req, res) => {
  const raw = String((req.body && (req.body.email || req.body.username)) || '').trim().toLowerCase();
  const password = req.body && req.body.password;
  const user = Object.values(users).find((u) => u.email === raw || u.username === raw);
  if (!user || user.passwordHash !== hashPassword(password || '')) {
    return res.status(400).json({ error: 'That email, username, or password is wrong' });
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
  const session = security.openSession(user, req);
  saveNow(USERS_FILE, users);
  res.json({ ok: true, token: session.token, user: publicUser(user) });
});

app.post('/api/auth/mfa', (req, res) => {
  const ticket = req.body && req.body.ticket;
  const row = security.takeMfa(ticket);
  const user = row && users[row.userId];
  if (!user || !security.checkTotp(user, req.body && req.body.code)) {
    return res.status(400).json({ error: row ? 'That code is wrong' : 'That code expired. Log in again.' });
  }
  security.dropChallenge(ticket);
  const session = security.openSession(user, req);
  saveNow(USERS_FILE, users);
  res.json({ ok: true, token: session.token, user: publicUser(user) });
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
    const session = security.openSession(user, req);
    saveNow(USERS_FILE, users);
    res.json({ ok: true, token: session.token, user: publicUser(user) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Passkey was rejected' });
  }
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

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const found = security.findSession(users, token);
  if (!found) return res.status(401).json({ error: 'Invalid session' });
  req.user = found.user;
  req.session = found.session;
  if (found.session.label === 'Saved session' && !found.session.ua) {
    found.session.label = security.deviceLabel(req.headers['user-agent']);
    found.session.ua = String(req.headers['user-agent'] || '').slice(0, 180);
    save(USERS_FILE, users);
  }
  const now = Date.now();
  if (now - (Number(found.session.lastSeen) || 0) > 60000) {
    found.session.lastSeen = now;
    found.user.lastSeen = now;
    save(USERS_FILE, users);
  } else {
    found.session.lastSeen = now;
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

app.use('/uploads', allowMedia, (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  next();
}, express.static(UPLOAD_DIR, {
  maxAge: '7d',
  immutable: true,
  acceptRanges: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.m4a')) res.setHeader('Content-Type', 'audio/mp4');
    else if (filePath.endsWith('.webm')) res.setHeader('Content-Type', 'audio/webm');
    else if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
    else if (filePath.endsWith('.opus')) res.setHeader('Content-Type', 'audio/opus');
  },
}));

app.get('/api/me', auth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
});

app.post('/api/seen', auth, (req, res) => {
  const now = Date.now();
  const prev = Number(req.user.lastSeen) || 0;
  if (now - prev > 15000) {
    req.user.lastSeen = now;
    save(USERS_FILE, users);
  }
  res.json({ ok: true, lastSeen: Number(req.user.lastSeen) || now, status: effectiveStatus(req.user) });
});

app.get('/api/username-available', auth, (req, res) => {
  const clean = normalizeUsername(req.query.name);
  if (!clean) return res.json({ ok: true, username: '', available: false, reason: 'invalid' });
  if (clean === req.user.username) return res.json({ ok: true, username: clean, available: true, reason: 'yours' });
  const taken = Object.values(users).some((u) => u && u.id !== req.user.id && u.username === clean);
  res.json({ ok: true, username: clean, available: !taken, reason: taken ? 'taken' : 'available' });
});

app.patch('/api/me', auth, (req, res) => {
  const {
    username, displayName, aliases, bio, aboutMe, pronouns, customStatus, status, hideLastSeen,
    accentColor, avatarColor, bannerColor, avatarUrl, bannerUrl, serverTag, nameEffect, nameFont, nameColors, profileStyle, profileColors, songUrl, songStart, songAutoplay,
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
    if (clean !== req.user.username) {
      const taken = Object.values(users).some((u) => u.id !== req.user.id && u.username === clean);
      if (taken) return res.status(409).json({ error: 'Username taken' });
      req.user.username = clean;
    }
  }
  if (aliases !== undefined) req.user.aliases = cleanAliases(aliases);

  if (displayName !== undefined) req.user.displayName = String(displayName).slice(0, 32);
  if (bio !== undefined) req.user.bio = String(bio).replace(/\s+/g, ' ').trim().slice(0, 29);
  if (aboutMe !== undefined) req.user.aboutMe = String(aboutMe).slice(0, 190);
  if (pronouns !== undefined) req.user.pronouns = String(pronouns).slice(0, 40);
  if (customStatus !== undefined) req.user.customStatus = String(customStatus).slice(0, 128);
  if (status && ['online', 'idle', 'dnd', 'offline'].includes(status)) {
    req.user.status = status;
    if (status === 'online') req.user.lastSeen = Date.now();
  }
  if (hideLastSeen !== undefined) req.user.hideLastSeen = !!hideLastSeen;
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
  res.json({ ok: true, user: publicUser(req.user) });
});

app.post('/api/me/password', auth, (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  const confirm = String(req.body?.confirm || '');
  if (req.user.passwordHash !== hashPassword(current)) {
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
  if (req.user.passwordHash !== hashPassword(password)) {
    return res.status(400).json({ error: 'Password is wrong' });
  }
  if (!email.includes('@') || email.length > 120) return res.status(400).json({ error: 'Invalid email' });
  if (Object.values(users).some((u) => u.id !== req.user.id && u.email === email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }
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
  return user.passwordHash === hashPassword(password || '');
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
  if (req.body?.icon != null) {
    const icon = String(req.body.icon || '');
    if (icon && !TAG_ICONS.includes(icon)) return res.status(400).json({ error: 'Pick a role icon from the list' });
    role.icon = icon;
  }
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
    found.members[req.user.id] = { roles: ['everyone'], joinedAt: new Date().toISOString(), onboarded: !found.onboarding.enabled };
    if (found.invites && found.invites[code]) found.invites[code].uses = (found.invites[code].uses || 0) + 1;
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
      typing: typers.map((row) => row.id).sort().join(','),
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
  const mapUser = (id) => {
    const u = users[id];
    if (!u) return null;
    return publicUser(u);
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
    suggested.push(publicUser(other));
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
    target = Object.values(users).find((u) => u.username === clean);
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
  res.json({
    ok: true,
    mode,
    messages: slice.map((msg) => presentMessage(msg, req.user.id)),
    other: publicUser(users[otherId]),
  });
});

app.post('/api/dms/:userId/messages', auth, (req, res) => {
  const otherId = req.params.userId;
  if (!users[otherId]) return res.status(404).json({ error: 'User not found' });
  if (otherId === req.user.id) return res.status(400).json({ error: 'Cannot DM yourself' });
  if (isBlocked(req.user.id, otherId)) return res.status(403).json({ error: 'You cannot message this person' });

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

function appendRoomMessage(roomId, req) {
  const extra = messageExtras(req.body);
  if (extra.error) return { error: extra.error };
  if (!messages[roomId]) messages[roomId] = [];
  const msg = {
    id: uuidv4(),
    channelId: roomId,
    authorId: req.user.id,
    author: slimAuthor(req.user),
    content: extra.content,
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
  wakePulse(roomId);
  touchAlerts();
  return { message: msg };
}

function publicGroup(group) {
  const memberIds = (group.memberIds || []).map(String);
  const members = memberIds.map((id) => publicUser(users[id])).filter(Boolean);
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
    preview: last ? dmPreview(last.content || '') : '',
  };
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
    rows.push(publicUser(user));
    if (rows.length >= 20) break;
  }
  res.json({ ok: true, users: rows });
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
  const me = ensureFriendNode(req.user.id);
  for (const id of ids) {
    if (isBlocked(req.user.id, id)) return res.status(400).json({ error: 'You cannot add someone you blocked' });
    if (!me.friends.includes(id)) return res.status(400).json({ error: 'You can only add friends' });
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
  res.json({ ok: true, group: publicGroup(group) });
});

app.post('/api/groups/:id/messages', auth, (req, res) => {
  const group = groups[req.params.id];
  if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) {
    return res.status(404).json({ error: 'Group not found' });
  }
  const made = appendRoomMessage('group:' + group.id, req);
  if (made.error) return res.status(400).json({ error: made.error });
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
  res.json({ ok: true, messages: list.slice(-100).map((msg) => presentMessage(msg, req.user.id)), group: publicGroup(group) });
});

app.post('/api/groups/:id/members', auth, (req, res) => {
  const group = groups[req.params.id];
  if (!group || !(group.memberIds || []).map(String).includes(String(req.user.id))) {
    return res.status(404).json({ error: 'Group not found' });
  }
  const userId = String(req.body?.userId || '');
  if (!users[userId]) return res.status(404).json({ error: 'User not found' });
  const me = ensureFriendNode(req.user.id);
  if (!me.friends.includes(userId)) return res.status(400).json({ error: 'You can only add friends' });
  if (isBlocked(req.user.id, userId)) return res.status(400).json({ error: 'You cannot add this person' });
  if (!group.memberIds.map(String).includes(userId)) {
    if (group.memberIds.length >= 10) return res.status(400).json({ error: 'This group is full' });
    group.memberIds.push(userId);
    group.updatedAt = Date.now();
    save(GROUPS_FILE, groups);
  }
  res.json({ ok: true, group: publicGroup(group) });
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
  res.json({ ok: true, group: publicGroup(group) });
});

app.get('/api/channels/:id/threads', auth, (req, res) => {
  const found = findChannel(req.params.id, String(req.query.serverId || ''));
  if (!found) return res.status(404).json({ error: 'Channel not found' });
  if (!can(found.guild, req.user, PERM.VIEW, found.channel)) return res.status(403).json({ error: 'Cannot view this channel' });
  const list = Object.values(threads)
    .filter((thread) => thread && thread.channelId === found.channel.id && !thread.closed)
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
  if (!found || !can(found.guild, req.user, PERM.VIEW, found.channel)) {
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
  if (!found || !can(found.guild, req.user, PERM.SEND, found.channel)) {
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
  if (!found || !can(found.guild, req.user, PERM.VIEW, found.channel)) {
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
  wakePulse(found.roomId);
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
  if (has === 'image' && !(msg.files || []).some((file) => /^image\//.test(file.type || '') || /\.(png|jpe?g|gif|webp)$/i.test(file.name || file.url || ''))) return false;
  if (has === 'video' && !(msg.files || []).some((file) => /^video\//.test(file.type || '') || /\.(mp4|webm|mov)$/i.test(file.name || file.url || ''))) return false;
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
      const image = /^image\//.test(type) || /\.(png|jpe?g|gif|webp)$/i.test(name);
      const video = /^video\//.test(type) || /\.(mp4|webm|mov)$/i.test(name);
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
    tagIcon: g.tagIcon || '',
    vanity: g.id === OFFICIAL_ID ? 'nebula' : (g.vanity || ''),
    memberCount: memberCount(g),
    canCustomize: canCustomize(g),
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
    if (b.tag != null || b.tagIcon != null || b.vanity != null) {
      const nextTag = b.tag != null ? cleanTag(b.tag) : (g.tag || '');
      const nextIcon = b.tagIcon != null ? String(b.tagIcon || '') : (g.tagIcon || '');
      if (b.tag != null && nextTag && nextTag.length < 2) return res.status(400).json({ error: 'A tag is 2 to 4 letters or numbers' });
      if (nextIcon && !TAG_ICONS.includes(nextIcon)) return res.status(400).json({ error: 'Pick a tag icon from the list' });
      const wantsCustom = (b.tag != null && nextTag) || (b.vanity != null && g.id !== OFFICIAL_ID && cleanSlug(b.vanity));
      if (wantsCustom && !canCustomize(g)) {
        return res.status(400).json({ error: 'This server needs 5 members before it can have a tag or invite link' });
      }
      if (b.tag != null) g.tag = nextTag;
      if (b.tagIcon != null) g.tagIcon = nextIcon && TAG_ICONS.includes(nextIcon) ? nextIcon : '';
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

const REPORT_REASONS = ['harassment', 'hate', 'sexual', 'child', 'threats', 'self-harm', 'spam', 'illegal', 'other'];

function presentReport(report) {
  const target = users[report.targetId];
  const reporter = users[report.by];
  return {
    id: report.id,
    status: report.status || 'open',
    reason: report.reason || '',
    text: report.text || '',
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

app.get('/api/staff/reports', auth, (req, res) => {
  if (!isNebulaStaff(req.user)) return res.status(403).json({ error: 'Only Nebula staff can see reports' });
  ensureGuilds();
  const g = guilds.servers[OFFICIAL_ID];
  const list = ((g && g.reports) || []).map(presentReport);
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

function listen() {
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n  Nebula backend -> http://localhost:' + PORT);
    console.log('  Frontend folder: ' + FRONTEND_DIR);
    console.log('  Users: ' + Object.keys(users).length);
    console.log('  Email: ' + GMAIL_USER);
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
setTimeout(listen, Number(process.env.NEBULA_RESTART_DELAY || 0));
