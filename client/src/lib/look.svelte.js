const KEY = 'nebula-look';
const DB = 'nebula-look';
let objectUrl = '';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not save that picture'));
  });
}

function idb(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = run(tx.objectStore('files'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not save that picture'));
  }));
}

function stored() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

const saved = stored();
const COLOR_KEYS = ['button', 'menu', 'text', 'muted', 'rail', 'side', 'chat', 'members'];
const SIZES = { small: '13px', normal: '14px', large: '16px', xl: '18px' };

function hexOk(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '');
}

function colorsFrom(raw) {
  const out = {};
  for (const key of COLOR_KEYS) out[key] = hexOk(raw && raw[key]) ? raw[key] : '';
  return out;
}

export const look = $state({
  theme: ['dark', 'light', 'amoled'].includes(saved.theme) ? saved.theme : 'dark',
  accent: hexOk(saved.accent) ? saved.accent : '#ff4f9a',
  background: typeof saved.background === 'string' ? saved.background : '',
  blur: saved.blur !== false,
  motion: saved.motion !== false,
  paint: ['theme', 'one', 'custom'].includes(saved.paint) ? saved.paint : 'theme',
  one: hexOk(saved.one) ? saved.one : '#a855f7',
  textSize: SIZES[saved.textSize] ? saved.textSize : 'normal',
  ignoreServerAccent: !!saved.ignoreServerAccent,
  colors: colorsFrom(saved.colors),
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
  if (objectUrl) return `url("${objectUrl}")`;
  if (typeof look.background === 'string' && look.background.startsWith('data:')) return `url("${look.background}")`;
  try { return `url("${new URL('space.png?v=3', document.baseURI).href}")`; } catch { return 'none'; }
}

function mix(hex, amount) {
  return `color-mix(in srgb, ${hex} ${amount}%, rgba(8, 4, 16, 0.72))`;
}

function paintColor(key) {
  if (look.paint === 'one' && hexOk(look.one) && key !== 'text' && key !== 'muted') return look.one;
  if (look.paint === 'custom' && hexOk(look.colors[key])) return look.colors[key];
  return '';
}

export function myAccent() {
  return paintColor('button') || look.accent || '#ff4f9a';
}

export function applyLook() {
  const root = document.documentElement;
  root.dataset.theme = look.theme;
  const accent = myAccent();
  root.style.setProperty('--brand', accent);
  root.style.setProperty('--brand-2', accent);
  root.style.setProperty('--bg-active', hexAlpha(accent, 0.28));
  root.style.setProperty('--ui-size', SIZES[look.textSize] || '14px');
  root.style.setProperty('--app-wallpaper', wallpaper());
  root.style.removeProperty('--bg-main');
  root.classList.toggle('app-blur', !!look.blur);
  root.classList.toggle('no-motion', !look.motion);
  const desktop = new URLSearchParams(location.search).has('app') || !!window.nebulaDesktop;
  root.classList.toggle('desktop-frame', desktop);

  const panel = (name, key, amount) => {
    const hex = paintColor(key);
    if (hex) root.style.setProperty(name, key === 'text' || key === 'muted' ? hex : mix(hex, amount));
    else root.style.removeProperty(name);
  };
  panel('--panel-rail', 'rail', 58);
  panel('--panel-side', 'side', 46);
  panel('--panel-chat', 'chat', 32);
  panel('--panel-members', 'members', 40);
  panel('--menu-bg', 'menu', 38);
  panel('--text', 'text', 0);
  panel('--muted', 'muted', 0);
  const panels = ['rail', 'side', 'chat', 'members', 'menu'].some((key) => paintColor(key));
  root.classList.toggle('paint-panels', panels);
  root.classList.toggle('paint-text', !!paintColor('text'));
}

export async function saveWallpaper(file) {
  if (!file) throw new Error('Choose an image');
  const type = String(file.type || '');
  const name = String(file.name || '');
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(type) && !/\.(png|jpe?g|webp|gif)$/i.test(name)) {
    throw new Error('Use a PNG, JPEG, or WebP picture');
  }
  if (file.size > 32 * 1024 * 1024) throw new Error('That picture is over 32 MB.');
  await idb('readwrite', (store) => store.put(file, 'background'));
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  setLook({ background: 'idb' });
}

export function setLook(patch) {
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'background') && !patch.background) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    idb('readwrite', (store) => store.delete('background')).catch(() => {});
  }
  Object.assign(look, patch);
  const pack = {
    theme: look.theme,
    accent: look.accent,
    background: look.background,
    blur: look.blur,
    motion: look.motion,
    paint: look.paint,
    one: look.one,
    textSize: look.textSize,
    ignoreServerAccent: look.ignoreServerAccent,
    colors: { ...look.colors },
  };
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

if (look.background === 'idb') {
  idb('readonly', (store) => store.get('background')).then((blob) => {
    if (!blob) {
      look.background = '';
      applyLook();
      return;
    }
    objectUrl = URL.createObjectURL(blob);
    applyLook();
  }).catch(() => {
    look.background = '';
    applyLook();
  });
}
