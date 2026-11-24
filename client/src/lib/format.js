export function shortBio(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 29);
}

export function playingName(user) {
  const value = user && user.activity;
  if (!value) return '';
  const name = String(typeof value === 'string' ? value : value.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return name;
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

export function gifUrls(text) {
  const out = [];
  String(text || '').replace(/\[\[gif:(https:\/\/[^\]\s]{8,1000})\]\]/g, (_, url) => {
    out.push(url);
    return '';
  });
  return out;
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
    const code = inviteCodeFromUrl(href);
    links.push(code ? inviteLink(code) : href);
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
  if (!user || user.bot) return false;
  if ((user.badges || []).includes('early')) return true;
  const created = Date.parse(user.createdAt || '');
  return Number.isFinite(created) && created <= MOON_CUTOFF;
}

export function ownedBadges(user) {
  if (!user || user.bot) return [];
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

export const SITE_ORIGIN = 'https://nebulaapp.space';

const INVITE_SKIP = new Set(['api', 'assets', 'files', 'uploads', 'index', 'index.html', 'sw', 'sw.js', 'look', 'theme', 'invite', 'favicon.png', 'favicon.svg', 'icons.svg', 'logo.webp', 'space.jpg', 'space.png', 'voice.js', 'server.js', '404.html', 'developers', 'sdk']);

function inviteHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'nebulaapp.space' || host === 'www.nebulaapp.space' || host === 'nebulaspace.lol' || host === 'www.nebulaspace.lol';
}

export function inviteCodeFromUrl(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const query = text.match(/[?&]invite=([A-Za-z0-9_-]+)/i);
  if (query) return query[1];
  const nested = text.match(/\/invite\/([A-Za-z0-9_-]+)/i);
  if (nested) return nested[1];
  try {
    const parsed = new URL(text, SITE_ORIGIN);
    if (!inviteHost(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return '';
    const code = parts[0];
    if (!/^[A-Za-z0-9_-]{2,32}$/.test(code) || code.includes('.')) return '';
    if (INVITE_SKIP.has(code.toLowerCase())) return '';
    return code;
  } catch (_) {
    return '';
  }
}

export function inviteLink(slug, key) {
  const raw = String(slug || '').trim();
  if (!raw) return '';
  const picked = inviteCodeFromUrl(raw) || raw.replace(/^\/+|\/+$/g, '').replace(/^invite\//i, '').split(/[?#]/)[0];
  const code = String(picked || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!code) return '';
  const base = SITE_ORIGIN + '/' + code;
  const secret = String(key || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return secret ? base + '#k=' + secret : base;
}

export function inviteSlugs(input) {
  const text = String(input || '');
  const found = new Set();
  for (const match of text.matchAll(/https?:\/\/[^\s]+/gi)) {
    const body = match[0].replace(/[.,!?;:'"]+$/g, '');
    const code = inviteCodeFromUrl(body);
    if (code) found.add(code.toLowerCase());
  }
  for (const match of text.matchAll(/(?:^|[\s(])invite\/([A-Za-z0-9_-]+)/gi)) found.add(match[1].toLowerCase());
  return [...found];
}

export function inviteSlug(input) {
  const fromUrl = inviteCodeFromUrl(input);
  if (fromUrl) return fromUrl.toLowerCase();
  const text = String(input || '').trim();
  if (!text || /\s/.test(text) || /^https?:\/\//i.test(text)) return '';
  const tail = text.split(/[/?#]/).filter(Boolean).pop() || '';
  const code = tail.replace(/[^A-Za-z0-9_-]/gi, '');
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(code)) return '';
  return code.toLowerCase();
}

export function stripInviteText(content) {
  return String(content || '')
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      const body = url.replace(/[.,!?;:'"]+$/g, '');
      return inviteCodeFromUrl(body) ? ' ' : url;
    })
    .replace(/(?:^|[\s(])invite\/[A-Za-z0-9_-]+/gi, ' ');
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

const bit = (n) => 2 ** n;

export const PERM = {
  VIEW: bit(0),
  SEND: bit(1),
  MANAGE_CHANNELS: bit(2),
  MANAGE_ROLES: bit(3),
  INVITE: bit(4),
  MANAGE_SERVER: bit(5),
  MANAGE_EMOJI: bit(6),
  ADMIN: bit(7),
  MANAGE_WEBHOOKS: bit(8),
  MANAGE_EVENTS: bit(9),
  VIEW_AUDIT: bit(10),
  CHANGE_NICK: bit(11),
  MANAGE_NICKS: bit(12),
  KICK: bit(13),
  BAN: bit(14),
  TIMEOUT: bit(15),
  EMBED: bit(16),
  ATTACH: bit(17),
  VOICE_MSG: bit(18),
  REACT: bit(19),
  EXTERNAL_EMOJI: bit(20),
  POLLS: bit(21),
  BIG_TEXT: bit(22),
  MENTION_EVERYONE: bit(23),
  MANAGE_MESSAGES: bit(24),
  CREATE_THREADS: bit(25),
  SEND_THREADS: bit(26),
  MANAGE_THREADS: bit(27),
  READ_HISTORY: bit(28),
  CONNECT: bit(29),
  SPEAK: bit(30),
  MUTE_MEMBERS: bit(31),
  MOVE_MEMBERS: bit(32),
  SEE_MEMBERS: bit(33),
};

export function hasBit(perms, flag) {
  let n = Number(perms) || 0;
  const b = Number(flag) || 0;
  if (b <= 0) return false;
  if (n < 0) n = n >>> 0;
  return Math.floor(n / b) % 2 === 1;
}

export function setBit(perms, flag, on) {
  let n = Number(perms) || 0;
  const b = Number(flag) || 0;
  if (b <= 0) return n;
  if (n < 0) n = n >>> 0;
  const has = Math.floor(n / b) % 2 === 1;
  if (on && !has) return n + b;
  if (!on && has) return n - b;
  return n;
}

export const PERM_GROUPS = [
  {
    title: 'General Permissions',
    items: [
      ['Manage Channels', PERM.MANAGE_CHANNELS, 'Create, edit, reorder and delete channels.'],
      ['Manage Roles', PERM.MANAGE_ROLES, 'Create and edit roles below their own, and give them to people.'],
      ['Manage Emoji', PERM.MANAGE_EMOJI, 'Add and remove server emojis.'],
      ['Manage Server', PERM.MANAGE_SERVER, 'Change the server name, icon, banner and settings.'],
      ['Manage Webhooks', PERM.MANAGE_WEBHOOKS, 'Make, change and delete channel webhooks.'],
      ['Manage Events', PERM.MANAGE_EVENTS, 'Create, edit, start and cancel server events.'],
      ['View Audit Log', PERM.VIEW_AUDIT, 'See who changed what in the server.'],
      ['Create Invite', PERM.INVITE, 'Invite people to the server.'],
      ['Change Nickname', PERM.CHANGE_NICK, 'Change their own nickname.'],
      ['Manage Nicknames', PERM.MANAGE_NICKS, 'Change other people’s nicknames.'],
    ],
  },
  {
    title: 'Membership Permissions',
    items: [
      ['See Server List', PERM.SEE_MEMBERS, 'See the member list when the server hides it.'],
      ['Kick Members', PERM.KICK, 'Remove people; they can rejoin with an invite.'],
      ['Ban Members', PERM.BAN, 'Remove people for good (until unbanned).'],
      ['Timeout Members', PERM.TIMEOUT, 'Stop someone from talking for a while.'],
    ],
  },
  {
    title: 'Text Channel Permissions',
    items: [
      ['View Channels', PERM.VIEW, 'See channels and read what’s in them.'],
      ['Send Messages', PERM.SEND, 'Post in text channels.'],
      ['Embed Links', PERM.EMBED, 'Post links.'],
      ['Attach Files', PERM.ATTACH, 'Upload pictures, videos and audio.'],
      ['Send Voice Messages', PERM.VOICE_MSG, 'Record and send voice messages.'],
      ['Add Reactions', PERM.REACT, 'Add new reactions. Without it people can still click ones already there.'],
      ['Use External Emoji', PERM.EXTERNAL_EMOJI, 'Use emojis from other servers.'],
      ['Create Polls', PERM.POLLS, 'Start polls.'],
      ['Use Big Text', PERM.BIG_TEXT, 'Post headings (# text). Turn it off for @everyone to keep big text for the roles you pick.'],
      ['Mention @everyone', PERM.MENTION_EVERYONE, 'Ping the whole server.'],
      ['Manage Messages', PERM.MANAGE_MESSAGES, 'Delete and pin anyone’s messages. Moderator stuff.'],
      ['Create Threads', PERM.CREATE_THREADS, 'Start threads in text channels. Turn it off for @everyone to keep threads to the roles you pick.'],
      ['Send Messages in Threads', PERM.SEND_THREADS, 'Reply in threads and forum posts.'],
      ['Manage Threads', PERM.MANAGE_THREADS, 'Close, lock, pin, rename, move and delete threads and forum posts, and post in locked ones.'],
      ['Read Message History', PERM.READ_HISTORY, 'See messages sent before they were around.'],
    ],
  },
  {
    title: 'Voice Channel Permissions',
    items: [
      ['Connect', PERM.CONNECT, 'Join voice channels.'],
      ['Speak', PERM.SPEAK, 'Talk in voice channels.'],
      ['Mute Members', PERM.MUTE_MEMBERS, 'Mute other people in voice.'],
      ['Move Members', PERM.MOVE_MEMBERS, 'Disconnect people from voice.'],
    ],
  },
  {
    title: 'Advanced Permissions',
    items: [
      ['Administrator', PERM.ADMIN, 'Every permission, and bypasses channel restrictions. Dangerous.'],
    ],
  },
];

export const ROLE_FLAGS = PERM_GROUPS.flatMap((group) => group.items.map(([label, flag]) => [label, flag]));
