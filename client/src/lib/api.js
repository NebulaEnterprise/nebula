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
    if (!res.ok) throw new Error('image');
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
