export function shortBio(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 29);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const EMOJI_TOKEN = '(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:\\uFE0F|\\uFE0E)?(?:\\p{Emoji_Modifier})?(?:\\u200D(?:\\p{Extended_Pictographic})(?:\\uFE0F)?(?:\\p{Emoji_Modifier})?)*|:[a-z0-9_]+:';

export function emojiScale(text) {
  const raw = String(text || '').trim();
  if (!raw || /[\r\n]/.test(raw) || raw.includes('[[')) return '';
  let count = 0;
  try {
    const re = new RegExp('^(' + EMOJI_TOKEN + ')(?:\\s+(' + EMOJI_TOKEN + '))*$', 'u');
    if (!re.test(raw)) return '';
    count = raw.split(/\s+/).filter(Boolean).length;
  } catch (_) {
    return '';
  }
  if (!count || count > 27) return '';
  if (count === 1) return 'jumbo';
  if (count < 7) return 'jumbo-mid';
  return 'jumbo-sm';
}

export function formatContent(text, emoji, stickers, namesList) {
  const gifs = [];
  let raw = String(text || '').replace(/\[\[gif:(https:\/\/[^\]\s]{8,1000})\]\]/g, (_, url) => {
    gifs.push(url);
    return '\u0000GIF' + (gifs.length - 1) + '\u0000';
  });
  const mentions = [];
  const names = [...(namesList || [])]
    .map((name) => String(name || '').trim())
    .filter((name) => name.length > 0 && name.length <= 32);
  const unique = [...new Set(names)].sort((a, b) => b.length - a.length);
  const take = (label) => {
    if (!unique.some((name) => name.toLowerCase() === label)) return;
    raw = raw.replace(new RegExp('(^|\\s)@(' + label + ')(?![\\w.])', 'gi'), (match, lead, name) => {
      mentions.push(name);
      return lead + '\u0000MEN' + (mentions.length - 1) + '\u0000';
    });
  };
  take('everyone');
  take('here');
  const rest = unique.filter((name) => name.toLowerCase() !== 'everyone' && name.toLowerCase() !== 'here');
  if (rest.length) {
    const pattern = rest.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    try {
      raw = raw.replace(new RegExp('(^|\\s)@(' + pattern + ')(?![\\w.])', 'gi'), (match, lead, name) => {
        mentions.push(name);
        return lead + '\u0000MEN' + (mentions.length - 1) + '\u0000';
      });
    } catch (_) {}
  }
  const links = [];
  raw = raw.replace(/https?:\/\/[^\s\u0000]+/gi, (url) => {
    let body = url.replace(/[.,!?;:'"]+$/g, '');
    const extra = (body.match(/\)/g) || []).length - (body.match(/\(/g) || []).length;
    if (extra > 0) body = body.slice(0, -extra);
    if (body.length < 8) return url;
    let href = '';
    try {
      const parsed = new URL(body);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
      href = parsed.href;
    } catch (_) {
      return url;
    }
    links.push(href);
    return '\u0000URL' + (links.length - 1) + '\u0000' + url.slice(body.length);
  });
  let html = escapeHtml(raw);
  html = html.replace(/\u0000MEN(\d+)\u0000/g, (_, index) => {
    return '<span class="mention">@' + escapeHtml(mentions[Number(index)] || '') + '</span>';
  });
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
  html = html.replace(/\u0000URL(\d+)\u0000/g, (_, index) => {
    const href = links[Number(index)] || '';
    const safe = escapeHtml(href);
    return '<a class="msg-link" href="' + safe + '" rel="noopener noreferrer">' + safe + '</a>';
  });
  return html;
}

export const MOON_CUTOFF = Date.UTC(2026, 11, 31, 23, 59, 59);

export function hasMoonBadge(user) {
  if (!user) return false;
  if ((user.badges || []).includes('early')) return true;
  const created = Date.parse(user.createdAt || '');
  return Number.isFinite(created) && created <= MOON_CUTOFF;
}

export function ownedBadges(user) {
  const list = [];
  if (hasMoonBadge(user)) list.push('early');
  if (user?.staff) list.push('staff');
  if (user?.developer) list.push('developer');
  return list;
}

export function visibleBadges(user) {
  const owned = ownedBadges(user);
  if (!Array.isArray(user?.shownBadges)) return owned;
  return owned.filter((id) => user.shownBadges.includes(id));
}

export const TAG_ICONS = ['⚡', '💜', '💎', '🔥', '🌸', '💧', '💙', '🍃', '❤️', '💖', '⭐', '👑', '💀', '👻', '🌙', '☀️', '✨', '🍄', '🐾', '🎵', '🎮', '⚔️', '🛡️', '🐱', '🐰', '☁️', '🌈', '❄️', '🎃', '🦋', '🐟', '🪐', '🍀', '♥', '★', '☆', '♡', '✦'];

export function inviteLink(slug) {
  const clean = String(slug || '').trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  return window.location.origin + '/invite/' + clean.replace(/^\/+|\/+$/g, '').replace(/^invite\//, '');
}

export function inviteSlug(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const found = text.match(/invite\/([a-z0-9_-]+)/i);
  if (found) return found[1].toLowerCase();
  const tail = text.split(/[/?#]/).filter(Boolean).pop() || '';
  return tail.toLowerCase().replace(/[^a-z0-9_-]/g, '');
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
