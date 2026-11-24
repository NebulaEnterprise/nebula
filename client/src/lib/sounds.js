const FLAGS = 'nebula-sound-flags';
const VOLUME = 'nebula-sound-volume';
const PINGS = 'nebula-sound-pings';

let ctx = null;
let lastAt = 0;

const MESSAGE_EVENTS = new Set(['message', 'dm', 'mention', 'group', 'friend']);

export const PING_CHOICES = [
  { id: 'default', label: 'Default' },
  { id: 'pulse', label: 'Nebula Pulse' },
  { id: 'pulse-bright', label: 'Brighter Pulse' },
  { id: 'double', label: 'Double chime' },
  { id: 'glass', label: 'Soft glass tap' },
  { id: 'click', label: 'Digital click' },
  { id: 'off', label: 'Off' },
];

const EVENT_TONE = {
  message: 'pulse',
  dm: 'pulse-bright',
  mention: 'double',
  group: 'pulse',
  sent: 'click',
  friend: 'glass',
  'call-in': 'ring',
  'call-out': 'ring-out',
  'call-end': 'end',
  'voice-join': 'join',
  'voice-leave': 'leave',
  'voice-other-join': 'join',
  'voice-other-leave': 'leave',
  'voice-move': 'click',
  'voice-lost': 'error',
  'voice-back': 'click',
  mute: 'click',
  unmute: 'click',
  deafen: 'click',
  undeafen: 'click',
  'ptt-down': 'click',
  'ptt-up': 'click',
  stage: 'glass',
  'share-start': 'click',
  'share-stop': 'click',
  'stream-start': 'click',
  'stream-stop': 'click',
  'watch-start': 'click',
  'watch-stop': 'click',
  clip: 'glass',
  error: 'error',
};

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); }
  catch { return {}; }
}

export function soundVolume() {
  const n = Number(localStorage.getItem(VOLUME));
  if (!Number.isFinite(n)) return 0.8;
  return Math.min(1, Math.max(0, n));
}

export function setSoundVolume(value) {
  localStorage.setItem(VOLUME, String(Math.min(1, Math.max(0, Number(value) || 0))));
}

export function notifySounds() {
  return localStorage.getItem('nebula-sound') !== 'off';
}

export function setNotifySounds(on) {
  localStorage.setItem('nebula-sound', on ? 'on' : 'off');
}

export function soundEnabled(id) {
  if (!id || id === 'notify') return notifySounds();
  const flags = readJson(FLAGS);
  return flags[id] !== false;
}

export function setSoundEnabled(id, on) {
  const flags = readJson(FLAGS);
  flags[id] = !!on;
  localStorage.setItem(FLAGS, JSON.stringify(flags));
}

export function pingChoice(slot) {
  const picks = readJson(PINGS);
  return picks[slot] || 'default';
}

export function setPingChoice(slot, id) {
  const picks = readJson(PINGS);
  picks[slot] = id || 'default';
  localStorage.setItem(PINGS, JSON.stringify(picks));
}

function audio() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function unlockAudio() {
  try {
    const node = audio();
    if (node.state === 'suspended') node.resume().catch(() => {});
  } catch (_) {}
}

function blip(context, { freq, at, dur, gain, slide }) {
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, at);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), at + dur);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(amp);
  amp.connect(context.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function recipe(name, context, at, gain) {
  if (name === 'pulse-bright') blip(context, { freq: 587, at, dur: 0.14, gain: gain * 0.1, slide: 466 });
  else if (name === 'double') {
    blip(context, { freq: 659, at, dur: 0.08, gain: gain * 0.09 });
    blip(context, { freq: 784, at: at + 0.1, dur: 0.11, gain: gain * 0.07 });
  } else if (name === 'glass') blip(context, { freq: 1318, at, dur: 0.06, gain: gain * 0.05, slide: 988 });
  else if (name === 'ring') {
    blip(context, { freq: 440, at, dur: 0.26, gain: gain * 0.09 });
    blip(context, { freq: 554, at: at + 0.3, dur: 0.26, gain: gain * 0.08 });
  } else if (name === 'ring-out') blip(context, { freq: 392, at, dur: 0.2, gain: gain * 0.07, slide: 330 });
  else if (name === 'end') blip(context, { freq: 349, at, dur: 0.16, gain: gain * 0.07, slide: 262 });
  else if (name === 'join') blip(context, { freq: 392, at, dur: 0.12, gain: gain * 0.08, slide: 494 });
  else if (name === 'leave') blip(context, { freq: 440, at, dur: 0.1, gain: gain * 0.06, slide: 330 });
  else if (name === 'error') {
    blip(context, { freq: 311, at, dur: 0.07, gain: gain * 0.06 });
    blip(context, { freq: 247, at: at + 0.09, dur: 0.1, gain: gain * 0.05 });
  } else if (name === 'click') blip(context, { freq: 988, at, dur: 0.03, gain: gain * 0.045 });
  else blip(context, { freq: 494, at, dur: 0.15, gain: gain * 0.09, slide: 392 });
}

export function playEvent(id, opts = {}) {
  const preview = !!opts.preview;
  const volume = soundVolume();
  if (volume <= 0) return;
  if (!preview) {
    if (MESSAGE_EVENTS.has(id) && !notifySounds()) return;
    if (!soundEnabled(id)) return;
    const now = Date.now();
    const gap = MESSAGE_EVENTS.has(id) ? 700 : 120;
    if (now - lastAt < gap) return;
    lastAt = now;
  }
  let name = EVENT_TONE[id] || 'click';
  if (id === 'dm' || id === 'mention' || id === 'group') {
    const pick = pingChoice(id);
    if (pick === 'off') return;
    if (pick && pick !== 'default') name = pick;
  }
  try {
    const context = audio();
    const start = () => recipe(name, context, context.currentTime + 0.01, volume);
    if (context.state === 'running') start();
    else context.resume().then(() => { if (context.state === 'running') start(); }).catch(() => {});
  } catch (_) {}
}
