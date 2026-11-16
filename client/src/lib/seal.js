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

const BOX = 'nebula-box-v1';

function readBoxes() {
  try { return JSON.parse(localStorage.getItem(BOX) || '{}') || {}; } catch (_) { return {}; }
}

function rowsFrom(entry) {
  const keys = [];
  const push = (row) => {
    if (!row?.priv || !row?.pub || keys.some((item) => item.pub === row.pub)) return;
    keys.push({ priv: row.priv, pub: row.pub });
  };
  if (Array.isArray(entry?.keys)) entry.keys.forEach(push);
  push(entry);
  if (Array.isArray(entry?.extra)) entry.extra.forEach(push);
  return keys;
}

export function localKeys(userId) {
  return rowsFrom(readBoxes()[String(userId || '')]);
}

export function saveKeys(userId, keys) {
  const id = String(userId || '');
  const list = [];
  for (const row of keys || []) {
    if (!row?.priv || !row?.pub || list.some((item) => item.pub === row.pub)) continue;
    list.push({ priv: row.priv, pub: row.pub });
  }
  const all = readBoxes();
  if (!list.length) delete all[id];
  else all[id] = { priv: list[0].priv, pub: list[0].pub, extra: list.slice(1) };
  localStorage.setItem(BOX, JSON.stringify(all));
  return list;
}

export async function ensureBox(userId) {
  const id = String(userId || '');
  if (!id || !crypto?.subtle) throw new Error('This browser cannot encrypt messages');
  const existing = localKeys(id);
  if (existing.length) return existing[0].pub;
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
  saveKeys(id, [{ priv, pub }]);
  return pub;
}

async function ownPrivates(userId) {
  const out = [];
  for (const row of localKeys(userId)) {
    try {
      out.push(await crypto.subtle.importKey('jwk', row.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']));
    } catch (_) {}
  }
  return out;
}

async function ownPrivate(userId) {
  const keys = await ownPrivates(userId);
  return keys[0] || null;
}

async function theirPublic(spki) {
  return crypto.subtle.importKey('spki', raw(spki), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function wrapFor(messageKey, spki) {
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: await theirPublic(spki) }, eph.privateKey, 256);
  const wrapKey = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, messageKey);
  return { eph: b64(await crypto.subtle.exportKey('spki', eph.publicKey)), iv: b64(iv), ct: b64(ct) };
}

export async function sealText(plain, recipients) {
  const people = [];
  const seen = new Set();
  for (const person of recipients || []) {
    if (!person?.id || !person.boxKey || seen.has(String(person.id))) continue;
    seen.add(String(person.id));
    people.push({ id: String(person.id), boxKey: person.boxKey });
  }
  if (!people.length) throw new Error('Nobody in this chat can open an encrypted message yet');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const messageKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plain)));
  const wrap = {};
  for (const person of people) wrap[person.id] = await wrapFor(messageKey, person.boxKey);
  return { v: 1, iv: b64(iv), data: b64(data), for: wrap };
}

async function pairKey(myId, theirBox, usage, mine) {
  const key = mine || await ownPrivate(myId);
  if (!key || !theirBox) throw new Error('locked');
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: await theirPublic(theirBox) }, key, 256);
  return crypto.subtle.importKey('raw', secret, 'AES-GCM', false, [usage]);
}

export async function sealCall(plain, myId, theirBox) {
  const key = await pairKey(myId, theirBox, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(plain)));
  return { v: 1, iv: b64(iv), data: b64(data) };
}

export async function openCall(blob, myId, theirBox) {
  if (!blob || blob.v !== 1 || !blob.iv || !blob.data) throw new Error('locked');
  const keys = await ownPrivates(myId);
  if (!keys.length) throw new Error('locked');
  let last = new Error('locked');
  for (const mine of keys) {
    try {
      const key = await pairKey(myId, theirBox, 'decrypt', mine);
      const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(blob.iv) }, key, raw(blob.data));
      return JSON.parse(new TextDecoder().decode(text));
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

export async function sealFile(bytes, meta, recipients) {
  const people = [];
  const seen = new Set();
  for (const person of recipients || []) {
    if (!person?.id || !person.boxKey || seen.has(String(person.id))) continue;
    seen.add(String(person.id));
    people.push({ id: String(person.id), boxKey: person.boxKey });
  }
  if (!people.length) throw new Error('Nobody in this chat can open an encrypted file yet');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body);
  const metaIv = crypto.getRandomValues(new Uint8Array(12));
  const metaCt = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: metaIv }, key, new TextEncoder().encode(JSON.stringify(meta || {})));
  const wrap = {};
  for (const person of people) wrap[person.id] = await wrapFor(rawKey, person.boxKey);
  return {
    bytes: new Uint8Array(data),
    lock: { v: 1, iv: b64(iv), metaIv: b64(metaIv), meta: b64(metaCt), for: wrap },
  };
}

async function unlockMessageKey(slot, mine) {
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: await theirPublic(slot.eph) }, mine, 256);
  const wrapKey = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(slot.iv) }, wrapKey, raw(slot.ct));
}

export async function openFile(lock, bytes, userId) {
  const slot = lock && lock.for && lock.for[String(userId || '')];
  const keys = await ownPrivates(userId);
  if (!slot || !keys.length || !lock.iv || !lock.metaIv || !lock.meta) throw new Error('locked');
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let last = new Error('locked');
  for (const mine of keys) {
    try {
      const messageKey = await unlockMessageKey(slot, mine);
      const key = await crypto.subtle.importKey('raw', messageKey, 'AES-GCM', false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(lock.iv) }, key, body);
      const metaRaw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(lock.metaIv) }, key, raw(lock.meta));
      let meta = {};
      try { meta = JSON.parse(new TextDecoder().decode(metaRaw)); } catch (_) {}
      return { bytes: new Uint8Array(plain), meta };
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

export async function openSeal(seal, userId) {
  const slot = seal && seal.for && seal.for[String(userId || '')];
  const keys = await ownPrivates(userId);
  if (!slot || !keys.length) throw new Error('locked');
  let last = new Error('locked');
  for (const mine of keys) {
    try {
      const messageKey = await unlockMessageKey(slot, mine);
      const key = await crypto.subtle.importKey('raw', messageKey, 'AES-GCM', false, ['decrypt']);
      const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(seal.iv) }, key, raw(seal.data));
      return new TextDecoder().decode(text);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
