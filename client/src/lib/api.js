import { frameDataUrl } from './image.js';

const DEFAULT_BACKEND = 'https://scowling-anthill-civil.ngrok-free.dev';

const TUNNEL_HEADERS = {
  'ngrok-skip-browser-warning': 'true',
  'bypass-tunnel-reminder': 'true',
};

export function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('backend');
  if (fromQuery) {
    const clean = fromQuery.replace(/\/$/, '');
    try { localStorage.setItem('dc_backend', clean); } catch (_) {}
    return clean;
  }
  try {
    const saved = localStorage.getItem('dc_backend');
    if (saved) return saved.replace(/\/$/, '');
  } catch (_) {}
  const port = window.location.port;
  if (window.location.protocol !== 'file:' && (port === '3850' || port === '4178')) {
    return window.location.origin;
  }
  return DEFAULT_BACKEND.replace(/\/$/, '');
}

export async function api(path, opts = {}) {
  const token = localStorage.getItem('dc_token') || '';
  const headers = {
    ...TUNNEL_HEADERS,
    ...(opts.headers || {}),
    Authorization: 'Bearer ' + token,
  };
  let body = opts.body;
  const rawFile = typeof Blob !== 'undefined' && body instanceof Blob;
  if (body && typeof body === 'object' && !rawFile && !(typeof FormData !== 'undefined' && body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const url = getApiBase() + path;
  const res = await fetch(url, { ...opts, headers, body, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem('dc_token');
    throw new Error('Session expired');
  }
  if (res.status === 413) throw new Error('That image is too large for the connection. Try a shorter GIF.');
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const MEDIA_SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

function snapMediaSize(value) {
  const n = Number(value) || 512;
  let best = MEDIA_SIZES[0];
  for (const size of MEDIA_SIZES) {
    if (Math.abs(size - n) < Math.abs(best - n)) best = size;
  }
  return best;
}

const STILL_STORE = 'nebula-stills';

function assetId(ref) {
  const match = String(ref || '').split('?')[0].match(/\/uploads\/([^/]+?)(?:\.(gif|png|jpe?g|webp))?$/i);
  return match ? match[1] : '';
}

export function readStill(ref) {
  const id = assetId(ref);
  if (!id) return '';
  try {
    const map = JSON.parse(localStorage.getItem(STILL_STORE) || '{}');
    const hit = map[id];
    return typeof hit === 'string' && hit.startsWith('data:image/') ? hit : '';
  } catch (_) {
    return '';
  }
}

export function writeStill(ref, dataUrl) {
  const id = assetId(ref);
  if (!id || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > 140000) return;
  try {
    const map = JSON.parse(localStorage.getItem(STILL_STORE) || '{}');
    const next = { [id]: dataUrl };
    for (const key of Object.keys(map)) {
      if (key !== id && Object.keys(next).length < 16) next[key] = map[key];
    }
    localStorage.setItem(STILL_STORE, JSON.stringify(next));
  } catch (_) {}
}

export function isCloud(url) {
  return typeof url === 'string' && url.includes('raw.githubusercontent.com/') && url.includes('/banners/');
}

export function cloudStill(url) {
  return isCloud(url) && url.includes('/banners/a_') ? url.replace(/\.bin(\?.*)?$/, '.still.bin') : '';
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function openCloud(url, keyHex) {
  if (!url) return Promise.resolve('');
  if (!isCloud(url)) return resolveMedia(url);
  if (!/^[0-9a-f]{64}$/i.test(keyHex || '')) return Promise.resolve('');
  if (mediaCache.has(url)) return mediaCache.get(url);
  const pending = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('image');
    const raw = new Uint8Array(await res.arrayBuffer());
    if (raw.length < 29) throw new Error('image');
    const iv = raw.slice(0, 12);
    const tag = raw.slice(12, 28);
    const data = raw.slice(28);
    const combined = new Uint8Array(data.length + tag.length);
    combined.set(data);
    combined.set(tag, data.length);
    const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined));
    let type = 'image/png';
    if (plain[0] === 0x47 && plain[1] === 0x49) type = 'image/gif';
    else if (plain[0] === 0xff && plain[1] === 0xd8) type = 'image/jpeg';
    else if (plain.length > 12 && plain[0] === 0x52 && plain[8] === 0x57) type = 'image/webp';
    return URL.createObjectURL(new Blob([plain], { type }));
  })().catch(() => {
    mediaCache.delete(url);
    return '';
  });
  mediaCache.set(url, pending);
  return pending;
}

export function assetPath(ref, opts = {}) {
  if (!ref) return '';
  if (ref.startsWith('data:') || ref.startsWith('blob:')) return ref;
  const clean = String(ref).split('?')[0];
  const match = clean.match(/\/uploads\/([^/]+?)(?:\.(gif|png|jpe?g|webp))?$/i);
  if (!match) return ref;
  const id = match[1];
  const original = (match[2] || '').toLowerCase();
  const animated = id.startsWith('a_') || original === 'gif';
  let format = opts.format || (animated ? 'gif' : (original || 'png'));
  if (format === 'jpeg') format = 'jpg';
  const size = opts.size ? snapMediaSize(opts.size) : 0;
  return '/uploads/' + id + '.' + format + (size ? '?size=' + size : '');
}

const mediaCache = new Map();
const MEDIA_KEY = 'dc_media';
const MEDIA_STORE = 'nebula-media-v1';

function savedMedia() {
  try { return JSON.parse(localStorage.getItem(MEDIA_KEY) || '[]'); } catch (_) { return []; }
}

function rememberMedia(url) {
  if (!url || !String(url).includes('/uploads/')) return;
  const list = savedMedia().filter((item) => item !== url);
  list.unshift(url);
  try { localStorage.setItem(MEDIA_KEY, JSON.stringify(list.slice(0, 40))); } catch (_) {}
}

async function cachedBlob(full) {
  if (!('caches' in window)) return null;
  const store = await caches.open(MEDIA_STORE);
  const hit = await store.match(full);
  if (!hit) return null;
  const blob = await hit.blob();
  if (!blob || !blob.size || /text\/html|application\/json/i.test(blob.type || '')) return null;
  return blob;
}

export function warmMedia(urls) {
  const set = new Set([...(urls || []), ...savedMedia()]);
  for (const url of set) {
    if (url) resolveMedia(url);
  }
}

export function resolveMedia(url) {
  if (!url) return Promise.resolve('');
  if (url.startsWith('data:') || url.startsWith('blob:')) return Promise.resolve(url);
  const full = url.startsWith('/uploads/') ? getApiBase() + url : url;
  if (!full.includes('/uploads/')) return Promise.resolve(url);
  rememberMedia(url);
  if (mediaCache.has(full)) return mediaCache.get(full);
  const pending = (async () => {
    const saved = await cachedBlob(full);
    if (saved) return URL.createObjectURL(saved);
    const res = await fetch(full, { headers: TUNNEL_HEADERS });
    if (res.status === 202 || !res.ok) throw new Error('image');
    const type = res.headers.get('content-type') || '';
    if (/text\/html|application\/json/i.test(type)) throw new Error('image');
    const blob = await res.blob();
    if (/text\/html|application\/json/i.test(blob.type || '')) throw new Error('image');
    if ('caches' in window) {
      const copy = blob.slice(0, blob.size, blob.type || type || 'image/gif');
      caches.open(MEDIA_STORE).then((store) => store.put(full, new Response(copy, {
        headers: { 'Content-Type': copy.type || 'image/gif' },
      }))).catch(() => {});
    }
    return URL.createObjectURL(blob);
  })().catch(() => {
    mediaCache.delete(full);
    return '';
  });
  mediaCache.set(full, pending);
  return pending;
}

export function seedStill(ref) {
  if (!ref || isCloud(ref) || readStill(ref)) return;
  const motion = /\/uploads\/a_|\/uploads\/[^/]+\.gif(\?|$)/i.test(String(ref));
  const stillUrl = assetPath(ref, { format: motion ? 'png' : undefined, size: 512 });
  resolveMedia(stillUrl).then(async (src) => {
    if (!src) return;
    try {
      const data = await frameDataUrl(src);
      if (data) writeStill(ref, data);
    } catch (_) {}
  });
}

export function uploadFile(file, onProgress) {
  const token = localStorage.getItem('dc_token') || '';
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', getApiBase() + '/api/upload');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('ngrok-skip-browser-warning', 'true');
    xhr.setRequestHeader('bypass-tunnel-reminder', 'true');
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (xhr.status === 401) {
        localStorage.removeItem('dc_token');
        reject(new Error('Session expired'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) reject(new Error(data.error || 'Upload failed'));
      else resolve(data);
    };
    xhr.onerror = () => reject(new Error('Could not reach your server'));
    xhr.send(file);
  });
}
