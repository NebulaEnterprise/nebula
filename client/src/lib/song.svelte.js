import { fileUrl } from './api.js';

export const player = $state({ key: '', playing: false });

export function parseStamp(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Math.min(Number(raw), 21600);
  const clock = raw.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (clock) {
    const h = Number(clock[1] || 0);
    const m = Number(clock[2] || 0);
    const s = Number(clock[3] || 0);
    return Math.min(h * 3600 + m * 60 + s, 21600);
  }
  const loose = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (loose && (loose[1] || loose[2] || loose[3])) {
    return Math.min(Number(loose[1] || 0) * 3600 + Number(loose[2] || 0) * 60 + Number(loose[3] || 0), 21600);
  }
  return 0;
}

export function formatStamp(value) {
  const sec = Math.max(0, Math.floor(Number(value) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? h + ':' + mm + ':' + ss : m + ':' + ss;
}

export function parseSong(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    id = url.searchParams.get('v') || '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (!id && (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live')) id = parts[1] || '';
  }
  id = String(id).replace(/[^A-Za-z0-9_-]/g, '');
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
  return { kind: 'youtube', id };
}

export function hasSong(file) {
  return /^\/uploads\/song-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(file || ''));
}

function songKey(file, startAt) {
  return file + ':' + startAt;
}

function startAtOf(start) {
  const n = Number(start);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 21600);
}

export function playing(file, start) {
  if (!hasSong(file)) return false;
  return player.playing && player.key === songKey(file, startAtOf(start));
}

let audio = null;
let active = null;
let paintToken = 0;
let releaseTimer = 0;
let playingKey = '';
let pausedKey = '';

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('playing', () => {
    if (active) player.playing = true;
  });
  audio.addEventListener('pause', () => {
    player.playing = false;
  });
  audio.addEventListener('ended', () => {
    if (!active || !audio) return;
    const key = active.key;
    const at = active.startAt || 0;
    const again = () => {
      if (!active || active.key !== key) return;
      audio.play().catch(() => {
        if (active && active.key === key) player.playing = false;
      });
    };
    if (at > 0) {
      const seeked = () => {
        audio.removeEventListener('seeked', seeked);
        again();
      };
      audio.addEventListener('seeked', seeked);
      try { audio.currentTime = at; } catch { again(); }
    } else again();
  });
  return audio;
}

function seekTo(el, startAt, key) {
  if (!active || active.key !== key || startAt <= 0) return;
  if (el.readyState < 1 || !Number.isFinite(el.duration)) return;
  const cap = Math.max(0, el.duration - 0.25);
  const at = Math.min(startAt, cap);
  if (Math.abs((el.currentTime || 0) - at) < 0.35) return;
  try { el.currentTime = at; } catch { /* metadata not ready */ }
}

function beginSong(file, start, fromStart = false) {
  if (!hasSong(file)) return '';
  const startAt = startAtOf(start);
  const key = songKey(file, startAt);
  if (!fromStart && player.key === key && player.playing) return key;
  const el = ensureAudio();
  active = { file, startAt, key };
  playingKey = key;
  pausedKey = '';
  player.key = key;
  player.playing = true;
  el.loop = startAt === 0;
  if (el.dataset.file !== file) {
    el.dataset.file = file;
    el.src = fileUrl(file);
  }
  if (fromStart && el.readyState >= 1) {
    const cap = Number.isFinite(el.duration) ? Math.max(0, el.duration - 0.25) : startAt;
    try { el.currentTime = Math.min(startAt, cap); } catch { /* metadata not ready */ }
  } else if (startAt > 0) {
    el.addEventListener('loadedmetadata', () => seekTo(el, startAt, key), { once: true });
  }
  el.play().then(() => {
    if (active && active.key === key) player.playing = true;
  }).catch(() => {
    if (active && active.key === key) player.playing = false;
  });
  return key;
}

export function playSong(file, start) {
  paintToken += 1;
  beginSong(file, start);
}

export function playSongAfterPaint(file, start) {
  clearTimeout(releaseTimer);
  releaseTimer = 0;
  const key = songKey(file, startAtOf(start));
  if (pausedKey === key || playingKey === key) return;
  const token = ++paintToken;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (token !== paintToken || pausedKey === key) return;
      beginSong(file, start, true);
    });
  });
}

export function releaseSong(file, start) {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = 0;
    stopSong(file, start);
  }, 0);
}

export function stopSong(file, start) {
  if (!hasSong(file)) return;
  paintToken += 1;
  const key = songKey(file, startAtOf(start));
  if (playingKey === key) playingKey = '';
  if (pausedKey === key) pausedKey = '';
  const mine = player.key === key || (audio && audio.dataset.file === file);
  if (!mine) return;
  active = null;
  if (player.key === key) {
    player.playing = false;
    player.key = '';
  }
  if (audio && audio.dataset.file === file) {
    audio.pause();
    try {
      if (audio.readyState >= 1) audio.currentTime = startAtOf(start);
    } catch { /* metadata not ready */ }
  }
}

export function toggleSong(file, start) {
  if (!hasSong(file)) return;
  const key = songKey(file, startAtOf(start));
  if ((player.key === key && player.playing) || playingKey === key) {
    paintToken += 1;
    pausedKey = key;
    playingKey = '';
    active = null;
    player.playing = false;
    player.key = '';
    if (audio) audio.pause();
    return;
  }
  beginSong(file, start);
}
