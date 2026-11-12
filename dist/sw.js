let apiHost = '';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const origin = event.data && event.data.type === 'nebula-api' && event.data.origin;
  if (!origin) return;
  try { apiHost = new URL(origin).host; } catch (_) {}
});

function proxyHost(hostname) {
  if (hostname.endsWith('.ngrok-free.dev') || hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok.io') || hostname.endsWith('.ngrok.app')) return true;
  return !!apiHost && hostname === apiHost;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!proxyHost(url.hostname)) return;
  if (url.pathname.indexOf('/uploads/') === -1 && url.pathname.indexOf('/files/') === -1) return;
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return;
  event.respondWith(streamMedia(event.request));
});

async function streamMedia(request) {
  const headers = new Headers();
  headers.set('ngrok-skip-browser-warning', 'true');
  headers.set('bypass-tunnel-reminder', 'true');
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  return fetch(request.url, { method: request.method, headers, mode: 'cors', credentials: 'omit' });
}
