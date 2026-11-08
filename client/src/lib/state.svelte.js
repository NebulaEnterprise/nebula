import { api, warmMedia } from './api.js';
import { PERM } from './format.js';

export const ui = $state({
  booting: true,
  me: null,
  auth: 'login',
  authError: '',
  authOk: '',
  pending: null,
  mode: 'friends',
  friendsTab: 'online',
  friends: [],
  incoming: [],
  outgoing: [],
  dms: [],
  dmUser: null,
  servers: [],
  serverId: 'nebula-official',
  serverMeta: null,
  serverPerms: 0,
  roles: [],
  categories: [],
  channels: [],
  channelId: '',
  theme: null,
  bannerUrl: '',
  about: '',
  showLobby: false,
  emoji: [],
  stickers: [],
  onboarding: null,
  messages: [],
  members: [],
  badgeDefs: {},
  menuOpen: false,
  stickersOpen: false,
  popout: null,
  userSettings: false,
  serverSettings: false,
  settingsPage: 'overview',
  settings: null,
  dialog: null,
  toast: '',
  seenMessageId: '',
  composer: '',
  typers: [],
  voice: null,
  voiceRooms: {},
});

let pollTimer = null;

export function hasPerm(bit) {
  if (ui.serverPerms & PERM.ADMIN) return true;
  return (ui.serverPerms & bit) === bit;
}

export function toast(msg) {
  ui.toast = msg;
  setTimeout(() => {
    if (ui.toast === msg) ui.toast = '';
  }, 2800);
}

export function logout() {
  import('./voice.js').then((mod) => mod.leaveVoice());
  localStorage.removeItem('dc_token');
  ui.me = null;
  ui.userSettings = false;
  ui.serverSettings = false;
  ui.dialog = null;
  ui.popout = null;
  ui.auth = 'login';
  if (pollTimer) clearInterval(pollTimer);
}

function applyTheme() {
  const root = document.documentElement;
  if (ui.mode === 'chat' && ui.theme?.accent) root.style.setProperty('--brand', ui.theme.accent);
  else root.style.setProperty('--brand', '#7c6af7');
  if (ui.mode === 'chat' && ui.theme?.tint) root.style.setProperty('--bg-main', ui.theme.tint);
  else root.style.removeProperty('--bg-main');
}

export function notifyMode() {
  return localStorage.getItem('nebula-notify-' + ui.serverId) || 'mentions';
}
export function serverMuted() {
  return Number(localStorage.getItem('nebula-mute-' + ui.serverId) || 0) > Date.now();
}

export async function boot() {
  warmMedia();
  const token = localStorage.getItem('dc_token');
  if (!token) {
    ui.booting = false;
    return;
  }
  try {
    const data = await api('/api/me');
    ui.me = data.user;
    warmMedia([data.user?.avatarUrl, data.user?.bannerUrl]);
    await enterApp();
  } catch {
    logout();
  } finally {
    ui.booting = false;
  }
}

async function enterApp() {
  try {
    const ch = await api('/api/channels');
    ui.channels = ch.channels || [];
    ui.servers = ch.servers || [];
  } catch (_) {}
  await loadFriends();
  await loadDms();
  await openServer(ui.serverId || 'nebula-official');
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  watchChat();
}

export async function login(email, password) {
  ui.authError = '';
  const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  localStorage.setItem('dc_token', data.token);
  ui.me = data.user;
  ui.booting = false;
  await enterApp();
}

export async function requestCode(email, username, password) {
  ui.authError = '';
  await api('/api/auth/request-code', { method: 'POST', body: { email, username, password } });
  ui.pending = { email, username, password };
  ui.auth = 'verify';
  ui.authOk = 'Code sent to ' + email;
}

export async function verify(code) {
  ui.authError = '';
  const data = await api('/api/auth/verify', {
    method: 'POST',
    body: { email: ui.pending.email, code, username: ui.pending.username, password: ui.pending.password },
  });
  localStorage.setItem('dc_token', data.token);
  ui.me = data.user;
  ui.pending = null;
  await enterApp();
}

export async function loadFriends() {
  try {
    const data = await api('/api/friends');
    ui.friends = data.friends || [];
    ui.incoming = data.incoming || [];
    ui.outgoing = data.outgoing || [];
  } catch (_) {}
}

export async function loadDms() {
  try {
    const data = await api('/api/dms');
    ui.dms = data.dms || [];
  } catch (_) {}
}

export function showFriends(tab) {
  ui.mode = 'friends';
  ui.friendsTab = tab || 'online';
  ui.dmUser = null;
  ui.menuOpen = false;
  applyTheme();
  loadFriends();
}

export function showAddFriend() {
  ui.mode = 'add';
  ui.dmUser = null;
  applyTheme();
}

export async function openDm(user) {
  ui.mode = 'dm';
  ui.dmUser = user;
  ui.menuOpen = false;
  ui.stickersOpen = false;
  ui.popout = null;
  applyTheme();
  dropLive();
  await loadMessages();
}

export async function openServer(id, opts = {}) {
  if (id && ui.voice && id !== ui.serverId) {
    const { leaveVoice } = await import('./voice.js');
    await leaveVoice();
  }
  if (id) ui.serverId = id;
  ui.mode = 'chat';
  ui.dmUser = null;
  ui.menuOpen = false;
  ui.stickersOpen = false;
  const data = await api('/api/channels?serverId=' + encodeURIComponent(ui.serverId));
  ui.channels = data.channels || [];
  if (data.servers) ui.servers = data.servers;
  ui.serverPerms = data.permissions || 0;
  ui.roles = data.roles || [];
  ui.categories = data.categories || [];
  ui.serverMeta = data.server || null;
  ui.theme = data.theme || null;
  ui.bannerUrl = data.bannerUrl || '';
  ui.about = data.about || '';
  ui.showLobby = !!data.showLobby;
  ui.emoji = data.emoji || [];
  ui.stickers = data.stickers || [];
  ui.onboarding = data.onboarding || null;
  applyTheme();
  const current = ui.channels.find((c) => c.id === ui.channelId && c.type === 'text');
  const ch = current || ui.channels.find((c) => c.type === 'text') || ui.channels[0];
  ui.channelId = ch ? ch.id : '';
  ui.seenMessageId = '';
  memberStamp = '';
  dropLive();
  await loadMessages();
  await loadMembers();
  import('./voice.js').then((mod) => mod.refreshVoiceRooms()).catch(() => {});
  if (!opts.keepDialog && ui.onboarding) ui.dialog = { kind: 'onboarding' };
}

export function pickChannel(ch) {
  if (!ch || ch.type !== 'text') return;
  ui.channelId = ch.id;
  ui.seenMessageId = '';
  ui.stickersOpen = false;
  dropLive();
  loadMessages();
}

let messagesBusy = false;
let memberStamp = '';
let pulseMissing = false;
let watchStarted = false;
let liveCtrl = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dropLive() {
  if (liveCtrl) liveCtrl.abort();
}

async function pullLive(query, signal) {
  if (!pulseMissing) {
    try {
      return await api('/api/pulse?' + query, { signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      if (!/not found/i.test(err.message || '')) throw err;
      pulseMissing = true;
    }
  }
  if (query.startsWith('dmUserId=')) {
    const id = decodeURIComponent(query.slice('dmUserId='.length).split('&')[0]);
    const data = await api('/api/dms/' + id + '/messages', { signal });
    return { messages: data.messages || [], typers: [] };
  }
  const data = await api('/api/channels/' + ui.channelId + '/messages', { signal });
  return { messages: data.messages || [], typers: [] };
}

async function watchChat() {
  if (watchStarted) return;
  watchStarted = true;
  while (true) {
    const looking = !document.hidden && !!localStorage.getItem('dc_token') && (ui.mode === 'chat' || ui.mode === 'dm');
    if (!looking) {
      await sleep(1500);
      continue;
    }
    liveCtrl = new AbortController();
    const signal = liveCtrl.signal;
    const after = ui.messages.length ? ui.messages[ui.messages.length - 1].id : '';
    const typing = (ui.typers || []).map((row) => row.id).sort().join(',');
    const started = Date.now();
    try {
      await loadMessages(true, { after, typing, members: memberStamp, signal });
    } catch (err) {
      if (err && err.name === 'AbortError') continue;
      await sleep(8000);
      continue;
    }
    if (Date.now() - started < 1500) await sleep(8000);
  }
}

export async function loadMessages(quiet, live) {
  if (quiet && messagesBusy) return;
  messagesBusy = true;
  const mode = ui.mode;
  const channelId = ui.channelId;
  const dmId = ui.dmUser?.id || '';
  try {
    let data;
    const signal = live && live.signal;
    const wait = live
      ? '&after=' + encodeURIComponent(live.after || '') + '&typing=' + encodeURIComponent(live.typing || '') + '&members=' + encodeURIComponent(live.members || '') + '&wait=1'
      : '';
    if (ui.mode === 'dm' && ui.dmUser) {
      data = await pullLive('dmUserId=' + encodeURIComponent(ui.dmUser.id) + wait, signal);
    } else if (!ui.channelId) {
      ui.messages = [];
      ui.typers = [];
      return;
    } else {
      data = await pullLive('channelId=' + encodeURIComponent(ui.channelId) + '&serverId=' + encodeURIComponent(ui.serverId || '') + wait, signal);
    }
    if (ui.mode !== mode || ui.channelId !== channelId || (ui.dmUser?.id || '') !== dmId) return;
    if (mode === 'chat' && data.members && data.members !== memberStamp) {
      memberStamp = data.members;
      loadMembers(true);
    }
    if (data.same) return;
    ui.typers = data.typers || [];
    const list = data.messages || [];
    if (ui.mode === 'dm') {
      ui.messages = list;
      return;
    }
    ui.messages = list;
    const newest = list[list.length - 1];
    if (newest && newest.id && newest.id !== ui.seenMessageId) {
      const first = !ui.seenMessageId;
      ui.seenMessageId = newest.id;
      const mine = ui.me && newest.author && newest.author.id === ui.me.id;
      if (!first && !mine && !serverMuted() && quiet) {
        const mode = notifyMode();
        const text = newest.content || '';
        const mention = ui.me && (text.includes('@' + ui.me.username) || text.includes('@everyone'));
        if (mode === 'all' || (mode === 'mentions' && mention)) {
          const old = document.title;
          document.title = 'New message · Nebula';
          setTimeout(() => {
            if (document.title === 'New message · Nebula') document.title = old;
          }, 2500);
        }
      }
    }
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    if (!quiet) toast(err.message);
  } finally {
    messagesBusy = false;
  }
}

let membersBusy = false;

export async function loadMembers(quiet) {
  if (quiet && membersBusy) return;
  membersBusy = true;
  try {
    const data = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
    ui.members = data.members || [];
    ui.badgeDefs = data.badges || {};
    warmMedia(ui.members.flatMap((m) => [m.avatarUrl, m.bannerUrl]));
  } catch (_) {}
  finally { membersBusy = false; }
}

export async function sendMessage() {
  const content = ui.composer.trim();
  if (!content) return;
  ui.composer = '';
  try {
    if (ui.mode === 'dm' && ui.dmUser) {
      await api('/api/dms/' + ui.dmUser.id + '/messages', { method: 'POST', body: { content } });
    } else {
      await api('/api/channels/' + ui.channelId + '/messages', { method: 'POST', body: { content } });
    }
    await loadMessages();
  } catch (err) {
    ui.composer = content;
    toast(err.message);
  }
}

export async function sendSticker(name) {
  ui.stickersOpen = false;
  ui.composer = '[[sticker:' + name + ']]';
  await sendMessage();
}

export async function guildAction(body) {
  return api('/api/servers/' + ui.serverId + '/action', { method: 'POST', body });
}

export async function openServerSettings(page) {
  ui.menuOpen = false;
  ui.settingsPage = page || 'overview';
  const data = await api('/api/servers/' + ui.serverId + '/settings');
  ui.settings = data.settings;
  ui.serverSettings = true;
}

export async function reloadSettings() {
  const data = await api('/api/servers/' + ui.serverId + '/settings');
  ui.settings = data.settings;
  await openServer(ui.serverId, { keepDialog: true });
}

let lastTypingPing = 0;

export function typingLine(list) {
  const names = (list || []).map((row) => row.name).filter(Boolean);
  if (!names.length) return '';
  if (names.length > 5) return '5+ are typing';
  if (names.length === 1) return names[0] + ' is typing';
  return names.slice(0, 5).map((name) => name + ' is typing').join(', ');
}

export async function noteTyping() {
  if (!ui.composer.trim()) return;
  const now = Date.now();
  if (now - lastTypingPing < 2000) return;
  lastTypingPing = now;
  const body = ui.mode === 'dm'
    ? { dmUserId: ui.dmUser?.id }
    : { channelId: ui.channelId, serverId: ui.serverId };
  if (ui.mode === 'dm' && !ui.dmUser?.id) return;
  if (ui.mode === 'chat' && !ui.channelId) return;
  try { await api('/api/typing', { method: 'POST', body }); } catch (_) {}
}

let typingBusy = false;

export async function refreshTyping() {
  if (document.hidden) return;
  if (ui.mode !== 'chat' && ui.mode !== 'dm') {
    ui.typers = [];
    return;
  }
  if (typingBusy) return;
  const q = ui.mode === 'dm'
    ? 'dmUserId=' + encodeURIComponent(ui.dmUser?.id || '')
    : 'channelId=' + encodeURIComponent(ui.channelId || '') + '&serverId=' + encodeURIComponent(ui.serverId || '');
  typingBusy = true;
  try {
    const data = await api('/api/typing?' + q);
    ui.typers = data.typers || [];
  } catch (_) {}
  finally { typingBusy = false; }
}

export async function saveMe(body) {
  const data = await api('/api/me', { method: 'PATCH', body });
  ui.me = {
    ...data.user,
    nameEffect: data.user?.nameEffect || body.nameEffect || '',
    nameColors: data.user?.nameColors?.length ? data.user.nameColors : (body.nameColors || []),
  };
  ui.userSettings = false;
  await loadMembers();
  toast('Profile saved');
}

export function relation(id) {
  if (!id || !ui.me || id === ui.me.id) return 'self';
  if (ui.friends.some((x) => x.id === id)) return 'friends';
  if (ui.incoming.some((x) => x.id === id)) return 'incoming';
  if (ui.outgoing.some((x) => x.id === id)) return 'outgoing';
  return 'none';
}

export async function friendAct(kind, body) {
  await api('/api/friends/' + kind, { method: 'POST', body });
  await loadFriends();
  await loadDms();
}

export async function openPopout(user, x, y) {
  const known = ui.members.find((m) => m.id === user.id);
  const seed = known ? { ...user, ...known, roles: known.roles || user.roles || [] } : user;
  ui.popout = { user: seed, x, y };
  warmMedia([seed.bannerUrl, seed.avatarUrl]);
  loadFriends().catch(() => {});
  try {
    const q = ui.serverId ? ('?serverId=' + encodeURIComponent(ui.serverId)) : '';
    const data = await api('/api/members' + q);
    if (!ui.popout || ui.popout.user?.id !== user.id) return;
    const fresh = (data.members || []).find((m) => m.id === user.id);
    ui.badgeDefs = data.badges || ui.badgeDefs;
    if (!fresh) return;
    ui.popout = { user: { ...seed, ...fresh, roles: fresh.roles || seed.roles || [] }, x, y };
    warmMedia([fresh.bannerUrl, fresh.avatarUrl]);
  } catch (_) {}
}

export const currentChannel = () => ui.channels.find((c) => c.id === ui.channelId) || null;
