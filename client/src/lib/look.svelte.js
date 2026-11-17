const KEY = 'nebula-look';

function stored() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

const saved = stored();

export const look = $state({
  theme: ['dark', 'light', 'amoled'].includes(saved.theme) ? saved.theme : 'dark',
  accent: /^#[0-9a-fA-F]{6}$/.test(saved.accent || '') ? saved.accent : '#ff4f9a',
  background: typeof saved.background === 'string' ? saved.background : '',
  blur: saved.blur !== false,
  motion: saved.motion !== false,
});

function hexAlpha(hex, alpha) {
  const n = String(hex || '').replace('#', '');
  if (n.length !== 6) return `rgba(255, 79, 154, ${alpha})`;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function wallpaper() {
  if (look.background) return `url("${look.background}")`;
  try { return `url("${new URL('space.jpg', document.baseURI).href}")`; } catch { return 'none'; }
}

export function applyLook() {
  const root = document.documentElement;
  root.dataset.theme = look.theme;
  root.style.setProperty('--brand', look.accent);
  root.style.setProperty('--brand-2', look.accent);
  root.style.setProperty('--bg-active', hexAlpha(look.accent, 0.28));
  root.style.setProperty('--app-wallpaper', wallpaper());
  root.classList.toggle('app-blur', !!look.blur);
  root.classList.toggle('no-motion', !look.motion);
  const desktop = new URLSearchParams(location.search).has('app') || !!window.nebulaDesktop;
  root.classList.toggle('desktop-frame', desktop);
}

export function setLook(patch) {
  Object.assign(look, patch);
  const pack = { theme: look.theme, accent: look.accent, background: look.background, blur: look.blur, motion: look.motion };
  try {
    localStorage.setItem(KEY, JSON.stringify(pack));
  } catch {
    look.background = '';
    pack.background = '';
    try { localStorage.setItem(KEY, JSON.stringify(pack)); } catch { /* keep the rest of the look */ }
    applyLook();
    throw new Error('That background is too large. Try a smaller picture.');
  }
  applyLook();
}

applyLook();
