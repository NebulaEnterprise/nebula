export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatContent(text, emoji, stickers) {
  const gifs = [];
  const raw = String(text || '').replace(/\[\[gif:(https:\/\/[^\]\s]{8,400})\]\]/g, (_, url) => {
    gifs.push(url);
    return '\u0000GIF' + (gifs.length - 1) + '\u0000';
  });
  let html = escapeHtml(raw);
  html = html.replace(/\u0000GIF(\d+)\u0000/g, (_, index) => {
    const url = gifs[Number(index)] || '';
    return '<img class="gif" alt="" src="' + escapeHtml(url) + '">';
  });
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

export const MOON_CUTOFF = Date.UTC(2026, 11, 31, 23, 59, 59);

export function hasMoonBadge(user) {
  if (!user) return false;
  if ((user.badges || []).includes('early')) return true;
  const created = Date.parse(user.createdAt || '');
  return Number.isFinite(created) && created <= MOON_CUTOFF;
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
