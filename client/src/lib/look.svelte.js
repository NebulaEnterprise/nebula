const KEY = 'nebula-look';
const THEMES_KEY = 'nebula-themes';
const DB = 'nebula-look';
const SHARE_ORIGIN = 'https://nebulaapp.space';
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
const COLOR_KEYS = ['button', 'secondary', 'danger', 'menu', 'outline', 'voice', 'highlight', 'mention', 'text', 'muted', 'rail', 'side', 'chat', 'members'];
const SOLID = new Set(['text', 'muted', 'outline', 'voice', 'button', 'secondary', 'danger', 'highlight', 'mention']);
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
  if (look.paint === 'one' && hexOk(look.one)) return look.one;
  return look.accent || '#ff4f9a';
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
    if (hex) root.style.setProperty(name, SOLID.has(key) ? hex : mix(hex, amount));
    else root.style.removeProperty(name);
  };
  panel('--btn-primary', 'button', 0);
  panel('--btn-secondary', 'secondary', 0);
  panel('--btn-danger', 'danger', 0);
  panel('--panel-rail', 'rail', 58);
  panel('--panel-side', 'side', 46);
  panel('--panel-chat', 'chat', 32);
  panel('--panel-members', 'members', 40);
  panel('--menu-bg', 'menu', 38);
  panel('--outline', 'outline', 0);
  panel('--voice', 'voice', 0);
  panel('--highlight', 'highlight', 0);
  panel('--mention', 'mention', 0);
  panel('--text', 'text', 0);
  panel('--muted', 'muted', 0);
  const panels = ['rail', 'side', 'chat', 'members', 'menu'].some((key) => paintColor(key));
  root.classList.toggle('paint-panels', panels);
  root.classList.toggle('paint-text', !!paintColor('text'));
  root.classList.toggle('paint-primary', !!paintColor('button'));
  root.classList.toggle('paint-secondary', !!paintColor('secondary'));
  root.classList.toggle('paint-danger', !!paintColor('danger'));
  root.classList.toggle('paint-outline', !!paintColor('outline'));
  root.classList.toggle('paint-voice', !!paintColor('voice'));
  root.classList.toggle('paint-highlight', !!paintColor('highlight'));
  root.classList.toggle('paint-mention', !!paintColor('mention'));
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

function readThemes() {
  try {
    const list = JSON.parse(localStorage.getItem(THEMES_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list.map((row) => {
      const pack = normalizePack(row && row.pack);
      if (!pack || !row.id) return null;
      const name = String((row && row.name) || pack.name || 'Theme').replace(/\s+/g, ' ').trim().slice(0, 32) || 'Theme';
      return { id: String(row.id), name, pack: { ...pack, name }, at: Number(row.at) || 0 };
    }).filter(Boolean).slice(0, 24);
  } catch {
    return [];
  }
}

export const savedThemes = $state(readThemes());
let sharedNote = '';

function writeThemes() {
  try { localStorage.setItem(THEMES_KEY, JSON.stringify(savedThemes)); } catch { /* the look itself still saves */ }
}

export function currentPack(name) {
  return normalizePack({
    name,
    theme: look.theme,
    accent: look.accent,
    blur: look.blur,
    motion: look.motion,
    paint: look.paint,
    one: look.one,
    textSize: look.textSize,
    ignoreServerAccent: look.ignoreServerAccent,
    colors: look.colors,
  });
}

function packBody(pack) {
  const { name, ...rest } = pack;
  return JSON.stringify(rest);
}

export function createTheme(name) {
  const pack = currentPack(name);
  if (!pack.name || pack.name.length < 2) throw new Error('Name the theme with at least 2 characters');
  const row = { id: crypto.randomUUID(), name: pack.name, pack, at: Date.now() };
  savedThemes.unshift(row);
  if (savedThemes.length > 24) savedThemes.splice(24);
  writeThemes();
  return row;
}

export function deleteTheme(id) {
  const index = savedThemes.findIndex((row) => row.id === id);
  if (index >= 0) savedThemes.splice(index, 1);
  writeThemes();
}

export function useTheme(source) {
  const pack = normalizePack(source && source.pack ? source.pack : source);
  if (!pack) throw new Error('That theme is missing');
  setLook({
    theme: pack.theme,
    accent: pack.accent,
    blur: pack.blur,
    motion: pack.motion,
    paint: pack.paint,
    one: pack.one,
    textSize: pack.textSize,
    ignoreServerAccent: pack.ignoreServerAccent,
    colors: { ...pack.colors },
  });
}

function encodeTheme(pack) {
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeTheme(token) {
  const text = String(token || '');
  if (!text || text.length > 4000) return null;
  try {
    const pad = text.length % 4 ? '='.repeat(4 - (text.length % 4)) : '';
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const bytes = Uint8Array.from(bin, (char) => char.charCodeAt(0));
    return normalizePack(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export function themeShareLink(source) {
  const pack = source && source.pack
    ? normalizePack({ ...source.pack, name: source.name || source.pack.name })
    : currentPack(typeof source === 'string' ? source : '');
  if (!pack) return '';
  return SHARE_ORIGIN + '/?theme=' + encodeTheme(pack);
}

function rememberShared(pack) {
  const named = normalizePack({ ...pack, name: pack.name || 'Shared theme' });
  if (savedThemes.some((row) => row.name === named.name && packBody(row.pack) === packBody(named))) return named.name;
  let name = named.name;
  const taken = new Set(savedThemes.map((row) => row.name));
  if (taken.has(name)) {
    let n = 2;
    while (taken.has(name + ' ' + n)) n += 1;
    name = name + ' ' + n;
  }
  const row = { id: crypto.randomUUID(), name, pack: { ...named, name }, at: Date.now() };
  savedThemes.unshift(row);
  if (savedThemes.length > 24) savedThemes.splice(24);
  writeThemes();
  return name;
}

function consumeSharedTheme() {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return; }
  if (!params.has('theme')) return;
  const pack = decodeTheme(params.get('theme'));
  params.delete('theme');
  const next = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
  try { history.replaceState(null, '', next); } catch { /* keep the address */ }
  if (!pack) {
    sharedNote = 'That theme link did not open.';
    return;
  }
  useTheme(pack);
  const name = rememberShared(pack);
  sharedNote = name + ' is on.';
}

export function pullSharedTheme() {
  const note = sharedNote;
  sharedNote = '';
  return note;
}

export function normalizePack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return {
    name,
    theme: ['dark', 'light', 'amoled'].includes(raw.theme) ? raw.theme : 'dark',
    accent: hexOk(raw.accent) ? raw.accent : '#ff4f9a',
    blur: raw.blur !== false,
    motion: raw.motion !== false,
    paint: ['theme', 'one', 'custom'].includes(raw.paint) ? raw.paint : 'theme',
    one: hexOk(raw.one) ? raw.one : '#a855f7',
    textSize: SIZES[raw.textSize] ? raw.textSize : 'normal',
    ignoreServerAccent: !!raw.ignoreServerAccent,
    colors: colorsFrom(raw.colors),
  };
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
consumeSharedTheme();

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
