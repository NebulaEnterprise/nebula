export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatContent(text, emoji, stickers) {
  let html = escapeHtml(text || '');
  for (const e of stickers || []) {
    if (!e?.name || !e?.url) continue;
    const src = String(e.url).replace(/"/g, '');
    html = html.split('[[sticker:' + e.name + ']]').join('<img class="sticker" alt="" src="' + src + '">');
  }
  for (const e of emoji || []) {
    if (!e?.name || !e?.url) continue;
    const src = String(e.url).replace(/"/g, '');
    html = html.split(':' + e.name + ':').join('<img class="emoji" alt="" src="' + src + '">');
  }
  return html;
}

export function initial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const PERM = {
  VIEW: 1,
  SEND: 2,
  MANAGE_CHANNELS: 4,
  MANAGE_ROLES: 8,
  INVITE: 16,
  MANAGE_SERVER: 32,
  ADMIN: 128,
};

export const ROLE_FLAGS = [
  ['View channels', PERM.VIEW],
  ['Send messages', PERM.SEND],
  ['Create invite', PERM.INVITE],
  ['Manage channels', PERM.MANAGE_CHANNELS],
  ['Manage roles', PERM.MANAGE_ROLES],
  ['Manage server', PERM.MANAGE_SERVER],
  ['Administrator', PERM.ADMIN],
];
