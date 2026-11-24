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
  message: 'message',
  dm: 'dm',
  mention: 'mention',
  group: 'group',
  sent: 'sent',
  friend: 'friend',
  'call-in': 'call-in',
  'call-out': 'call-out',
  'call-end': 'call-end',
  'voice-join': 'voice-join',
  'voice-leave': 'voice-leave',
  'voice-other-join': 'voice-other-join',
  'voice-other-leave': 'voice-other-leave',
  'voice-move': 'voice-move',
  'voice-lost': 'voice-lost',
  'voice-back': 'voice-back',
  mute: 'mute',
  unmute: 'unmute',
  deafen: 'deafen',
  undeafen: 'undeafen',
  'ptt-down': 'ptt-down',
  'ptt-up': 'ptt-up',
  stage: 'stage',
  'share-start': 'share-start',
  'share-stop': 'share-stop',
  'stream-start': 'stream-start',
  'stream-stop': 'stream-stop',
  'watch-start': 'watch-start',
  'watch-stop': 'watch-stop',
  clip: 'clip',
  error: 'error',
};

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); }
  catch { return {}; }
}

export function soundVolume() {
  const raw = localStorage.getItem(VOLUME);
  const chosen = localStorage.getItem(VOLUME + '-set') === '1';
  if (!chosen || raw == null || raw === '') return 0.75;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.75;
  return Math.min(1, Math.max(0, n));
}

export function setSoundVolume(value) {
  const n = Number(value);
  localStorage.setItem(VOLUME + '-set', '1');
  localStorage.setItem(VOLUME, String(Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0.75))));
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

function blip(context, { freq, at, dur, gain, slide, type = 'sine' }) {
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), at + dur);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(amp);
  amp.connect(context.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function recipe(name, context, at, gain) {
  const g = gain;
  const tone = {
    pulse: () => blip(context, { freq: 523, at, dur: 0.22, gain: g * 0.46, slide: 392, type: 'sine' }),
    'pulse-bright': () => blip(context, { freq: 698, at, dur: 0.18, gain: g * 0.44, slide: 554, type: 'sine' }),
    double: () => {
      blip(context, { freq: 784, at, dur: 0.1, gain: g * 0.4, type: 'sine' });
      blip(context, { freq: 988, at: at + 0.12, dur: 0.14, gain: g * 0.36, type: 'sine' });
    },
    glass: () => blip(context, { freq: 1568, at, dur: 0.09, gain: g * 0.28, slide: 1174 }),
    click: () => blip(context, { freq: 880, at, dur: 0.05, gain: g * 0.32, type: 'sine' }),
    message: () => blip(context, { freq: 494, at, dur: 0.24, gain: g * 0.5, slide: 370, type: 'sine' }),
    dm: () => {
      blip(context, { freq: 659, at, dur: 0.1, gain: g * 0.42, type: 'sine' });
      blip(context, { freq: 880, at: at + 0.11, dur: 0.16, gain: g * 0.38, slide: 740, type: 'sine' });
    },
    mention: () => {
      blip(context, { freq: 880, at, dur: 0.09, gain: g * 0.4 });
      blip(context, { freq: 1174, at: at + 0.13, dur: 0.16, gain: g * 0.36 });
    },
    group: () => blip(context, { freq: 392, at, dur: 0.26, gain: g * 0.48, slide: 294, type: 'sine' }),
    sent: () => blip(context, { freq: 740, at, dur: 0.06, gain: g * 0.3, slide: 988 }),
    friend: () => blip(context, { freq: 1318, at, dur: 0.12, gain: g * 0.34, slide: 1760 }),
    'call-in': () => {
      blip(context, { freq: 440, at, dur: 0.28, gain: g * 0.42, type: 'sine' });
      blip(context, { freq: 554, at: at + 0.32, dur: 0.32, gain: g * 0.4, type: 'sine' });
    },
    'call-out': () => {
      blip(context, { freq: 349, at, dur: 0.18, gain: g * 0.36, type: 'sine' });
      blip(context, { freq: 349, at: at + 0.28, dur: 0.18, gain: g * 0.32, type: 'sine' });
    },
    'call-end': () => blip(context, { freq: 523, at, dur: 0.28, gain: g * 0.4, slide: 196, type: 'sine' }),
    'voice-join': () => blip(context, { freq: 330, at, dur: 0.2, gain: g * 0.42, slide: 523, type: 'sine' }),
    'voice-leave': () => blip(context, { freq: 494, at, dur: 0.2, gain: g * 0.38, slide: 247, type: 'sine' }),
    'voice-other-join': () => blip(context, { freq: 587, at, dur: 0.12, gain: g * 0.3, slide: 784 }),
    'voice-other-leave': () => blip(context, { freq: 698, at, dur: 0.12, gain: g * 0.28, slide: 392 }),
    'voice-move': () => {
      blip(context, { freq: 440, at, dur: 0.06, gain: g * 0.3 });
      blip(context, { freq: 554, at: at + 0.08, dur: 0.06, gain: g * 0.3 });
      blip(context, { freq: 659, at: at + 0.16, dur: 0.1, gain: g * 0.32 });
    },
    'voice-lost': () => {
      blip(context, { freq: 311, at, dur: 0.1, gain: g * 0.4, type: 'sine' });
      blip(context, { freq: 196, at: at + 0.12, dur: 0.16, gain: g * 0.36, type: 'sine' });
    },
    'voice-back': () => {
      blip(context, { freq: 392, at, dur: 0.08, gain: g * 0.34 });
      blip(context, { freq: 587, at: at + 0.1, dur: 0.12, gain: g * 0.34 });
    },
    mute: () => blip(context, { freq: 220, at, dur: 0.1, gain: g * 0.4, slide: 140, type: 'sine' }),
    unmute: () => blip(context, { freq: 280, at, dur: 0.1, gain: g * 0.38, slide: 440, type: 'sine' }),
    deafen: () => blip(context, { freq: 160, at, dur: 0.14, gain: g * 0.42, slide: 90, type: 'sine' }),
    undeafen: () => blip(context, { freq: 247, at, dur: 0.12, gain: g * 0.38, slide: 494, type: 'sine' }),
    'ptt-down': () => blip(context, { freq: 660, at, dur: 0.04, gain: g * 0.28, type: 'sine' }),
    'ptt-up': () => blip(context, { freq: 440, at, dur: 0.05, gain: g * 0.24, type: 'sine' }),
    stage: () => blip(context, { freq: 1046, at, dur: 0.16, gain: g * 0.36, slide: 1318 }),
    'share-start': () => blip(context, { freq: 523, at, dur: 0.1, gain: g * 0.34, slide: 784 }),
    'share-stop': () => blip(context, { freq: 784, at, dur: 0.1, gain: g * 0.3, slide: 392 }),
    'stream-start': () => blip(context, { freq: 466, at, dur: 0.08, gain: g * 0.32, slide: 622, type: 'sine' }),
    'stream-stop': () => blip(context, { freq: 622, at, dur: 0.1, gain: g * 0.28, slide: 311, type: 'sine' }),
    'watch-start': () => blip(context, { freq: 880, at, dur: 0.08, gain: g * 0.26, slide: 1174 }),
    'watch-stop': () => blip(context, { freq: 988, at, dur: 0.08, gain: g * 0.24, slide: 659 }),
    clip: () => {
      blip(context, { freq: 988, at, dur: 0.06, gain: g * 0.3 });
      blip(context, { freq: 1318, at: at + 0.08, dur: 0.1, gain: g * 0.28 });
    },
    error: () => {
      blip(context, { freq: 349, at, dur: 0.1, gain: g * 0.4, type: 'sine' });
      blip(context, { freq: 233, at: at + 0.12, dur: 0.16, gain: g * 0.38, type: 'sine' });
    },
  };
  (tone[name] || tone.pulse)();
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
