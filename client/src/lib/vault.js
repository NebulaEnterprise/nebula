const VAULT_KEY = 'nebula-vault';
const SECRET_KEY = 'nebula-unlock';

function b64(bytes) {
  let text = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) text += String.fromCharCode(arr[i]);
  return btoa(text);
}

function raw(text) {
  const src = atob(String(text || ''));
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 1) out[i] = src.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const len = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function recoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i !== bytes.length - 1) out += '-';
  }
  return out;
}

export function newRoomKey() {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}

export function keyForUrl(value) {
  return String(value || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function keyFromUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  return text.replace(/-/g, '+').replace(/_/g, '/') + pad;
}

export function keyInLink(input) {
  const match = String(input || '').match(/[#&?]k=([A-Za-z0-9_-]+)/);
  return match ? keyFromUrl(match[1]) : '';
}

async function kek(secret, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function vaultCheck(vault) {
  const digest = await crypto.subtle.digest('SHA-256', raw(vault.master));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function wrapVault(vault, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await kek(secret, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(vault))));
  return { wrapped: b64(concat(iv, ct)), salt: b64(salt) };
}

export async function createVault(secret) {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = b64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  const vault = { v: 1, master: b64(master), pub, priv, servers: {}, dms: {}, groups: {} };
  const packed = await wrapVault(vault, secret);
  return { ...packed, check: await vaultCheck(vault), pub, vault };
}

export async function lockSecret(password, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await kek(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(secret))));
  return { salt: b64(salt), wrapped: b64(concat(iv, ct)) };
}

export async function unlockSecret(password, lock) {
  try {
    const packed = raw(lock.wrapped);
    const key = await kek(password, raw(lock.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12));
    return new TextDecoder().decode(plain);
  } catch (_) {
    return '';
  }
}

export async function openVault(wrapped, salt, secret) {
  try {
    const packed = raw(wrapped);
    const key = await kek(secret, raw(salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12));
    const vault = JSON.parse(new TextDecoder().decode(plain));
    if (!vault || !vault.master || !vault.priv) return null;
    vault.servers = vault.servers || {};
    vault.dms = vault.dms || {};
    vault.groups = vault.groups || {};
    return vault;
  } catch (_) {
    return null;
  }
}

export function secretForms(secret) {
  const text = String(secret || '').trim();
  const compact = text.replace(/\s+/g, '');
  const forms = [];
  const add = (value) => { if (value && !forms.includes(value)) forms.push(value); };
  add(text);
  add(compact);
  if (/^[A-Za-z0-9-]{8,}$/.test(compact)) {
    const bare = compact.replace(/-/g, '').toUpperCase();
    add(bare);
    add(bare.replace(/(.{4})(?=.)/g, '$1-'));
  }
  return forms;
}

export async function openVaultSecret(wrapped, salt, secret) {
  for (const form of secretForms(secret)) {
    const vault = await openVault(wrapped, salt, form);
    if (vault) return { vault, secret: form };
  }
  return null;
}

async function aes(master) {
  return crypto.subtle.importKey('raw', raw(master), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function isSealedText(text) {
  return String(text || '').startsWith('NEB2.');
}

export async function sealText(master, text) {
  const key = await aes(master);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(text))));
  return 'NEB2.' + b64(concat(iv, ct));
}

export async function openText(master, packed) {
  const body = raw(String(packed).slice(5));
  const key = await aes(master);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.slice(0, 12) }, key, body.slice(12));
  return new TextDecoder().decode(plain);
}

export async function sealFile(master, bytes, name, type) {
  const header = new TextEncoder().encode(JSON.stringify({
    name: String(name || 'file').slice(0, 80),
    type: String(type || '').slice(0, 120),
  }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, header.length);
  const body = concat(len, header, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const key = await aes(master);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
  return concat(new TextEncoder().encode('NEB2'), iv, ct);
}

export async function openPackedFile(master, bytes) {
  const all = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (all.length < 20 || new TextDecoder().decode(all.slice(0, 4)) !== 'NEB2') throw new Error('locked');
  const key = await aes(master);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(4, 16) }, key, all.slice(16)));
  const len = new DataView(plain.buffer, plain.byteOffset, 4).getUint32(0);
  const meta = JSON.parse(new TextDecoder().decode(plain.slice(4, 4 + len)));
  return { name: meta.name || 'file', type: meta.type || '', bytes: plain.slice(4 + len) };
}

export async function wrapKeyFor(roomKey, theirPub) {
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.importKey('spki', raw(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
  const wrapKey = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, raw(roomKey)));
  return {
    eph: b64(new Uint8Array(await crypto.subtle.exportKey('spki', eph.publicKey))),
    iv: b64(iv),
    ct: b64(ct),
  };
}

export async function unwrapKey(pack, priv) {
  const mine = await crypto.subtle.importKey('jwk', priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await crypto.subtle.importKey('spki', raw(pack.eph), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, mine, 256);
  const wrapKey = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(pack.iv) }, wrapKey, raw(pack.ct)));
  return b64(plain);
}

function readMap(name) {
  try { return JSON.parse(localStorage.getItem(name) || '{}') || {}; } catch (_) { return {}; }
}

export function rememberVault(userId, vault) {
  const all = readMap(VAULT_KEY);
  all[userId] = vault;
  localStorage.setItem(VAULT_KEY, JSON.stringify(all));
}

export function loadVault(userId) {
  return readMap(VAULT_KEY)[String(userId || '')] || null;
}

export function rememberSecret(userId, secret) {
  const all = readMap(SECRET_KEY);
  all[userId] = secret;
  localStorage.setItem(SECRET_KEY, JSON.stringify(all));
}

export function loadSecret(userId) {
  return readMap(SECRET_KEY)[String(userId || '')] || '';
}

export function forgetVault(userId) {
  const vaults = readMap(VAULT_KEY);
  const secrets = readMap(SECRET_KEY);
  delete vaults[userId];
  delete secrets[userId];
  localStorage.setItem(VAULT_KEY, JSON.stringify(vaults));
  localStorage.setItem(SECRET_KEY, JSON.stringify(secrets));
}
