self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
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
