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

export async function ensureBox(userId) {
  const id = String(userId || '');
  if (!id || !crypto?.subtle) throw new Error('This browser cannot encrypt messages');
  const all = readBoxes();
  if (all[id]?.pub && all[id]?.priv) return all[id].pub;
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
  all[id] = { priv, pub };
  localStorage.setItem(BOX, JSON.stringify(all));
  return pub;
}

async function ownPrivate(userId) {
  const saved = readBoxes()[String(userId || '')];
  if (!saved?.priv) return null;
  return crypto.subtle.importKey('jwk', saved.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
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

export async function openSeal(seal, userId) {
  const slot = seal && seal.for && seal.for[String(userId || '')];
  const mine = await ownPrivate(userId);
  if (!slot || !mine) throw new Error('locked');
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: await theirPublic(slot.eph) }, mine, 256);
  const wrapKey = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['decrypt']);
  const messageKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(slot.iv) }, wrapKey, raw(slot.ct));
  const key = await crypto.subtle.importKey('raw', messageKey, 'AES-GCM', false, ['decrypt']);
  const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw(seal.iv) }, key, raw(seal.data));
  return new TextDecoder().decode(text);
}
