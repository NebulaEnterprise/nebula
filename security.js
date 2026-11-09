const crypto = require('crypto');
const { qrSvg } = require('./qr');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const challenges = new Map();

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

module.exports = {
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
