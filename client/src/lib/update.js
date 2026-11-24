import { ui } from './state.svelte.js';
import { onGateway } from './gateway.js';

const TUNNEL = {
  'ngrok-skip-browser-warning': 'true',
  'bypass-tunnel-reminder': 'true',
};

let reloading = false;

function stampFrom(value) {
  return [...String(value || '').matchAll(/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)\?v=\d+/g)].map((match) => match[0]).sort().join('|');
}

function runningBuild() {
  const files = [];
  for (const node of document.querySelectorAll('script[src],link[rel="stylesheet"]')) {
    files.push(node.getAttribute('src') || node.getAttribute('href') || '');
  }
  return stampFrom(files.join('\n'));
}

function reloadFresh() {
  if (reloading) return;
  reloading = true;
  ui.link = 'updating';
  const next = new URL('index.html', document.baseURI);
  next.searchParams.set('_nebula', String(Date.now()));
  setTimeout(() => location.replace(next.href), 600);
}

async function check() {
  if (reloading) return;
  const mine = runningBuild();
  if (!mine) return;
  const page = new URL('index.html', document.baseURI);
  page.searchParams.set('_nebula', String(Date.now()));
  let html = '';
  try {
    const res = await fetch(page.href, { cache: 'no-store', headers: TUNNEL });
    if (!res.ok) return;
    html = await res.text();
  } catch (_) {
    return;
  }
  const published = stampFrom(html);
  if (!published || published === mine) return;
  reloadFresh();
}

export function watchForUpdates() {
  const tick = () => { check(); };
  setTimeout(tick, 3000);
  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  onGateway((packet) => {
    const type = packet && packet.t;
    if (type === 'READY' || type === 'RESUMED' || type === 'RESYNC') tick();
  });
}
