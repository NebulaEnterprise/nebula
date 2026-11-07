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
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  let body = opts.body;
  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let url = getApiBase() + path;
  if (!opts.method || opts.method === 'GET') {
    url += (path.includes('?') ? '&' : '?') + '_=' + Date.now();
  }
  const res = await fetch(url, { ...opts, headers, body, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem('dc_token');
    throw new Error('Session expired');
  }
  if (res.status === 413) throw new Error('Image is too large. Use a smaller file or a shorter GIF.');
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
