const KEY = 'nebula-binds-off';
const CHORDS = 'nebula-bind-chords';
const PTT = 'nebula-ptt-chord';

export const DEFAULT_CHORDS = {
  switcher: { ctrl: true, alt: false, shift: false, key: 'k' },
  prev: { ctrl: false, alt: true, shift: false, key: 'ArrowUp' },
  next: { ctrl: false, alt: true, shift: false, key: 'ArrowDown' },
  'prev-unread': { ctrl: false, alt: true, shift: true, key: 'ArrowUp' },
  'next-unread': { ctrl: false, alt: true, shift: true, key: 'ArrowDown' },
  'edit-last': { ctrl: false, alt: false, shift: false, key: 'ArrowUp' },
  'mark-read': { ctrl: false, alt: false, shift: true, key: 'Escape' },
  mute: { ctrl: true, alt: false, shift: true, key: 'm' },
  deafen: { ctrl: true, alt: false, shift: true, key: 'd' },
  clip: { ctrl: false, alt: true, shift: false, key: 'c' },
  help: { ctrl: true, alt: false, shift: false, key: '/' },
};

let recording = false;
export function isRecordingBind() { return recording; }
export function setRecordingBind(on) { recording = !!on; }

export const BIND_GROUPS = [
  {
    label: '',
    rows: [
      { id: 'switcher', title: 'Quick switcher', text: 'Jump to any channel, DM or server', keys: ['Ctrl', 'K'] },
      { id: 'prev', title: 'Previous channel', keys: ['Alt', '↑'] },
      { id: 'next', title: 'Next channel', keys: ['Alt', '↓'] },
      { id: 'prev-unread', title: 'Previous unread channel', keys: ['Alt', 'Shift', '↑'] },
      { id: 'next-unread', title: 'Next unread channel', keys: ['Alt', 'Shift', '↓'] },
      { id: 'edit-last', title: 'Edit your last message', text: 'When the message box is empty', keys: ['↑'] },
      { id: 'mark-read', title: 'Mark this server as read', keys: ['Shift', 'Esc'] },
      { id: 'mute', title: 'Mute / unmute in a call', keys: ['Ctrl', 'Shift', 'M'] },
      { id: 'deafen', title: 'Deafen / undeafen in a call', keys: ['Ctrl', 'Shift', 'D'] },
      { id: 'clip', title: 'Clip the last few seconds of a call or stream', keys: ['Alt', 'C'] },
      { id: 'help', title: 'Show the list of shortcuts', keys: ['Ctrl', '/'] },
    ],
  },
  {
    label: 'Always on',
    rows: [
      { id: 'reload', title: 'Reload', text: 'Desktop app', keys: ['Ctrl', 'R', '/', 'F5'], locked: true },
      { id: 'type', title: 'Start typing anywhere and it goes into the message box', keys: ['Any letter'], locked: true },
      { id: 'newline', title: 'New line', keys: ['Shift', 'Enter'], locked: true },
      { id: 'esc', title: 'Cancel a reply or an edit, then close the side panel, then mark the chat read and jump to the newest message', keys: ['Esc'], locked: true },
      { id: 'page', title: 'Scroll the chat, even while typing', keys: ['PageUp', '/', 'PageDown'], locked: true },
      { id: 'delete', title: 'Delete a message without the confirm', keys: ['Shift', 'click Delete'], locked: true },
      { id: 'bold', title: 'Bold', text: 'On selected text', keys: ['Ctrl', 'B'], locked: true },
      { id: 'italic', title: 'Italic', keys: ['Ctrl', 'I'], locked: true },
      { id: 'underline', title: 'Underline', keys: ['Ctrl', 'U'], locked: true },
      { id: 'code', title: 'Code', keys: ['Ctrl', 'E'], locked: true },
    ],
  },
];

function offSet() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); }
  catch { return new Set(); }
}

export function bindOn(id) {
  return !offSet().has(id);
}

export function setBind(id, on) {
  const next = offSet();
  if (on) next.delete(id);
  else next.add(id);
  localStorage.setItem(KEY, JSON.stringify([...next]));
}

function readChords() {
  try { return JSON.parse(localStorage.getItem(CHORDS) || '{}'); }
  catch { return {}; }
}

export function chordOf(id) {
  const base = DEFAULT_CHORDS[id];
  const saved = readChords()[id];
  if (!base) return null;
  if (!saved || !saved.key) return base;
  return { ctrl: !!saved.ctrl, alt: !!saved.alt, shift: !!saved.shift, key: String(saved.key) };
}

export function setChord(id, chord) {
  const all = readChords();
  all[id] = { ctrl: !!chord.ctrl, alt: !!chord.alt, shift: !!chord.shift, key: String(chord.key || '') };
  localStorage.setItem(CHORDS, JSON.stringify(all));
}

export function prettyKey(key) {
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', ' ': 'Space', Space: 'Space' };
  if (map[key]) return map[key];
  if (!key) return '';
  return key.length === 1 ? key.toUpperCase() : key;
}

export function chordLabel(chord) {
  if (!chord) return [];
  const parts = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(prettyKey(chord.key));
  return parts;
}

export function chordFromEvent(event) {
  const key = event.key === ' ' ? 'Space' : event.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  return { ctrl: !!(event.ctrlKey || event.metaKey), alt: !!event.altKey, shift: !!event.shiftKey, key };
}

export function sameChord(chord, event) {
  if (!chord || !chord.key) return false;
  const ctrl = !!(event.ctrlKey || event.metaKey);
  if (!!chord.ctrl !== ctrl) return false;
  if (!!chord.alt !== !!event.altKey) return false;
  if (!!chord.shift !== !!event.shiftKey) return false;
  const key = event.key === ' ' ? 'Space' : event.key;
  return key.toLowerCase() === String(chord.key).toLowerCase();
}

export function matchBind(id, event) {
  if (recording || !bindOn(id)) return false;
  return sameChord(chordOf(id), event);
}

export function pttChord() {
  try {
    const saved = JSON.parse(localStorage.getItem(PTT) || 'null');
    if (saved && saved.key) return { ctrl: !!saved.ctrl, alt: !!saved.alt, shift: !!saved.shift, key: String(saved.key) };
  } catch { /* keep the default */ }
  return { ctrl: false, alt: false, shift: false, key: 'v' };
}

export function setPttChord(chord) {
  localStorage.setItem(PTT, JSON.stringify({
    ctrl: !!chord.ctrl,
    alt: !!chord.alt,
    shift: !!chord.shift,
    key: String(chord.key || 'v'),
  }));
}

export function pttKeyDown(event) {
  return sameChord(pttChord(), event);
}
