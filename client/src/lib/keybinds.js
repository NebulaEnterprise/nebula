const KEY = 'nebula-binds-off';

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
