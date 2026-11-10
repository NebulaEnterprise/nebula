import { api, pinMedia, warmMedia, uploadFile, setUnauthorizedHandler } from './api.js';
import { getPasskey } from './webauthn.js';
import { fileKind, packUpload } from './media.js';
import { PERM } from './format.js';

export const ui = $state({
  booting: true,
  me: null,
  auth: 'login',
  mfa: null,
  authError: '',
  authOk: '',
  pending: null,
  mode: 'friends',
  friendsTab: 'online',
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  suggested: [],
  dms: [],
  groups: [],
  dmUser: null,
  group: null,
  thread: null,
  dock: '',
  dockQuery: '',
  threadDraft: null,
  switcher: false,
  showMembers: true,
  closedChats: {},
  muteTick: 0,
  devTick: 0,
  idMenu: null,
  reportPopup: null,
  staffReports: [],
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
  chatLoading: false,
  members: [],
  badgeDefs: {},
  menuOpen: false,
  picker: '',
  attachOpen: false,
  packs: [],
  activity: { servers: {}, channels: {}, dms: {} },
  mentions: [],
  heads: {},
  inboxOpen: false,
  popout: null,
  userSettings: false,
  userPage: 'profile',
  serverSettings: false,
  settingsPage: 'overview',
  settings: null,
  dialog: null,
  toast: '',
  seenMessageId: '',
  composer: '',
  reply: null,
  editing: null,
  typers: [],
  voice: null,
  voiceRooms: {},
  screen: null,
  incomingCall: null,
  outgoingCall: null,
  missedCalls: [],
  dmMenu: null,
  memberMenu: null,
  pinTick: 0,
  readHold: '',
  jumpTo: '',
  addingAccount: false,
  authGate: false,
  quickOpen: false,
  quickUser: null,
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

const ACCOUNT_LIMIT = 7;
const ACCOUNTS_KEY = 'nebula-accounts';
let returnAccountId = '';

export function savedAccounts() {
  try {
    const list = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((row) => row && row.id && row.token).slice(0, ACCOUNT_LIMIT);
  } catch {
    return [];
  }
}

function writeAccounts(list) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list.slice(0, ACCOUNT_LIMIT)));
}

function rememberAccount(user, token) {
  if (!user?.id || !token) return;
  const existing = savedAccounts();
  const known = existing.some((row) => row.id === user.id);
  if (!known && existing.length >= ACCOUNT_LIMIT) {
    throw new Error('You can keep 7 accounts');
  }
  const row = {
    id: user.id,
    token,
    username: user.username || '',
    displayName: user.displayName || user.username || '',
    avatarUrl: user.avatarUrl || '',
    avatarColor: user.avatarColor || '#7c6af7',
    status: user.status || 'online',
  };
  writeAccounts([row, ...existing.filter((item) => item.id !== user.id)]);
}

function forgetToken(token) {
  if (!token) return;
  writeAccounts(savedAccounts().filter((row) => row.token !== token));
}

let loggingOut = false;
export function logout() {
  if (loggingOut) return;
  loggingOut = true;
  const id = ui.me?.id;
  api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  import('./voice.js').then((mod) => mod.leaveVoice());
  if (id) writeAccounts(savedAccounts().filter((row) => row.id !== id));
  localStorage.removeItem('dc_token');
  ui.me = null;
  ui.members = [];
  ui.messages = [];
  ui.activity = { servers: {}, channels: {}, dms: {} };
  ui.userSettings = false;
  ui.serverSettings = false;
  ui.dialog = null;
  ui.popout = null;
  ui.addingAccount = false;
  ui.authGate = false;
  ui.mfa = null;
  ui.auth = 'login';
  if (pollTimer) clearInterval(pollTimer);
  loggingOut = false;
}
setUnauthorizedHandler(logout);

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
    rememberAccount(data.user, token);
    warmMedia([data.user?.avatarUrl, data.user?.bannerUrl]);
    await enterApp();
  } catch {
    forgetToken(token);
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
  await consumeInvite();
  await openSharedLink();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  watchChat();
  startClocks();
  startPresence();
}

async function finishLogin(data) {
  if (!data || !data.token) throw new Error('Sign-in did not finish. Try again.');
  rememberAccount(data.user, data.token);
  localStorage.setItem('dc_token', data.token);
  ui.me = data.user;
  ui.addingAccount = false;
  ui.mfa = null;
  ui.auth = 'login';
  ui.booting = false;
  ui.activity = { servers: {}, channels: {}, dms: {} };
  await enterApp();
}

export async function login(email, password) {
  ui.authError = '';
  const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  if (data.mfa) {
    ui.mfa = { ticket: data.ticket, methods: data.methods || ['totp'], email };
    ui.auth = 'mfa';
    return;
  }
  await finishLogin(data);
}

export async function submitMfa(code) {
  ui.authError = '';
  const data = await api('/api/auth/mfa', { method: 'POST', body: { ticket: ui.mfa?.ticket, code } });
  await finishLogin(data);
}

export async function loginWithPasskey() {
  ui.authError = '';
  const start = await api('/api/auth/passkey/options', {
    method: 'POST',
    body: ui.mfa?.ticket ? { ticket: ui.mfa.ticket } : {},
  });
  const credential = await getPasskey(start.publicKey);
  const data = await api('/api/auth/passkey/verify', {
    method: 'POST',
    body: { challengeId: start.challengeId, credential },
  });
  await finishLogin(data);
}

export async function requestCode(email, username, password) {
  ui.authError = '';
  const data = await api('/api/auth/request-code', { method: 'POST', body: { email, username, password } });
  if (data.token) {
    await finishLogin(data);
    return;
  }
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
  rememberAccount(data.user, data.token);
  localStorage.setItem('dc_token', data.token);
  ui.me = data.user;
  ui.addingAccount = false;
  ui.pending = null;
  await enterApp();
}

function resetSession() {
  roomLogs.clear();
  serverSnap.clear();
  memberStamp = '';
  profileStamp = '';
  pollStamp = '';
  editStamp = '';
  dropLive();
  ui.messages = [];
  ui.members = [];
  ui.friends = [];
  ui.incoming = [];
  ui.outgoing = [];
  ui.dms = [];
  ui.dmUser = null;
  ui.channels = [];
  ui.channelId = '';
  ui.servers = [];
  ui.serverMeta = null;
  ui.serverPerms = 0;
  ui.roles = [];
  ui.categories = [];
  ui.popout = null;
  ui.userSettings = false;
  ui.serverSettings = false;
  ui.dialog = null;
  ui.composer = '';
  ui.reply = null;
  ui.editing = null;
  ui.typers = [];
  ui.voice = null;
  ui.voiceRooms = {};
  ui.activity = { servers: {}, channels: {}, dms: {} };
  ui.mode = 'friends';
  ui.chatLoading = true;
}

export async function switchAccount(id) {
  const row = savedAccounts().find((item) => item.id === id);
  if (!row) throw new Error('That account is not saved');
  if (ui.me && row.id === ui.me.id) return;
  try {
    const mod = await import('./voice.js');
    await mod.leaveVoice();
  } catch (_) {}
  resetSession();
  localStorage.setItem('dc_token', row.token);
  ui.booting = true;
  ui.addingAccount = false;
  try {
    const data = await api('/api/me');
    ui.me = data.user;
    rememberAccount(data.user, row.token);
    warmMedia([data.user?.avatarUrl, data.user?.bannerUrl]);
    await enterApp();
  } catch (err) {
    forgetToken(row.token);
    localStorage.removeItem('dc_token');
    ui.me = null;
    ui.auth = 'login';
    throw new Error(err.message === 'Session expired' ? 'That account needs to log in again' : err.message);
  } finally {
    ui.booting = false;
  }
}

export function addAccount() {
  if (savedAccounts().length >= ACCOUNT_LIMIT) {
    toast('You can keep 7 accounts');
    return false;
  }
  returnAccountId = ui.me?.id || '';
  import('./voice.js').then((mod) => mod.leaveVoice()).catch(() => {});
  resetSession();
  localStorage.removeItem('dc_token');
  ui.me = null;
  ui.addingAccount = true;
  ui.auth = 'login';
  ui.authError = '';
  ui.authOk = '';
  return true;
}

export async function cancelAdd() {
  ui.addingAccount = false;
  ui.authError = '';
  const id = returnAccountId;
  if (!id) return;
  await switchAccount(id);
}

function pendingInvite() {
  const path = window.location.pathname || '';
  const match = path.match(/\/invite\/([a-z0-9_-]+)/i);
  if (match) return match[1].toLowerCase();
  return (new URLSearchParams(window.location.search).get('invite') || '').toLowerCase();
}

export async function openSharedLink() {
  const params = new URLSearchParams(window.location.search);
  const msg = params.get('msg');
  if (!msg || !ui.me) return;
  try {
    if (params.get('dm')) {
      const known = (ui.dms || []).find((row) => String(row.other?.id) === String(params.get('dm')));
      await openDm(known?.other || { id: params.get('dm'), username: 'user', displayName: 'User' });
    } else if (params.get('group')) {
      const group = (ui.groups || []).find((row) => String(row.id) === String(params.get('group')));
      if (group) await openGroup(group);
    } else if (params.get('thread')) {
      ui.jumpTo = msg;
    } else if (params.get('server')) {
      if (String(params.get('server')) !== String(ui.serverId)) await openServer(params.get('server'));
      const channel = (ui.channels || []).find((row) => String(row.id) === String(params.get('channel')));
      if (channel) pickChannel(channel);
    }
    ui.jumpTo = msg;
    const clean = new URL(window.location.href);
    ['msg', 'dm', 'group', 'server', 'channel', 'thread'].forEach((key) => clean.searchParams.delete(key));
    history.replaceState(null, '', clean.pathname + (clean.searchParams.toString() ? '?' + clean.searchParams.toString() : '') + clean.hash);
  } catch (_) {}
}

export function messageLink(message) {
  if (!message) return '';
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  if (ui.mode === 'dm' && ui.dmUser) url.searchParams.set('dm', ui.dmUser.id);
  else if (ui.mode === 'group' && ui.group) url.searchParams.set('group', ui.group.id);
  else if (ui.mode === 'thread' && ui.thread) url.searchParams.set('thread', ui.thread.id);
  else {
    url.searchParams.set('server', ui.serverId || '');
    url.searchParams.set('channel', ui.channelId || '');
  }
  url.searchParams.set('msg', message.id);
  return url.toString();
}

export function markUnread(message) {
  if (!message || !message.id) return;
  const roomKey = currentRoom().replace(/^ch:/, '') || ui.channelId;
  const list = (ui.messages || []).filter((row) => row && !row.pending && !row.failed && !String(row.id || '').startsWith('local-'));
  const idx = list.findIndex((row) => row.id === message.id);
  const prev = idx > 0 ? list[idx - 1].id : '';
  const map = seenMap();
  if (prev) map[roomKey] = prev;
  else delete map[roomKey];
  saveSeen(map);
  ui.readHold = roomKey;
  const count = Math.max(1, list.length - Math.max(idx, 0));
  if (String(roomKey).startsWith('dm:')) {
    const id = roomKey.slice(3);
    ui.activity = { ...ui.activity, dms: { ...ui.activity.dms, [id]: { unread: count } } };
  } else if (!String(roomKey).startsWith('group:') && !String(roomKey).startsWith('thread:')) {
    const channels = { ...ui.activity.channels, [roomKey]: { unread: count, mentions: (ui.activity.channels[roomKey] || {}).mentions || 0, serverId: ui.serverId } };
    ui.activity = { ...ui.activity, channels };
  }
  toast('Marked as unread');
}

export async function consumeInvite() {
  const slug = pendingInvite();
  if (!slug || !ui.me) return;
  try {
    const data = await api('/api/invites/' + encodeURIComponent(slug) + '/join', { method: 'POST', body: {} });
    history.replaceState(null, '', '/');
    if (data.pending) toast('Request sent. An owner has to accept you.');
    else if (data.server) {
      await openServer(data.server.id);
      toast('Joined ' + (data.server.name || 'the server'));
    }
  } catch (err) {
    toast(err.message);
  }
}

export async function loadFriends() {
  try {
    const data = await api('/api/friends');
    ui.friends = data.friends || [];
    ui.incoming = data.incoming || [];
    ui.outgoing = data.outgoing || [];
    ui.blocked = data.blocked || [];
    ui.suggested = data.suggested || [];
  } catch (_) {}
}

const heardDm = {};
let inboxReady = false;
let lastSentId = '';
let dmSerial = 0;

function sameDms(prev, next) {
  if (!Array.isArray(prev) || prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (!a || !b || a.id !== b.id || a.preview !== b.preview || a.lastId !== b.lastId || a.unread !== b.unread) return false;
    const left = a.other || {};
    const right = b.other || {};
        if (left.id !== right.id || left.displayName !== right.displayName || left.username !== right.username || left.avatarUrl !== right.avatarUrl || left.status !== right.status || left.lastSeen !== right.lastSeen) return false;
  }
  return true;
}

function isMine(msg) {
  if (!msg || !ui.me) return false;
  if (msg.id && msg.id === lastSentId) return true;
  const id = msg.authorId || (msg.author && msg.author.id);
  return String(id || '') === String(ui.me.id);
}

function dmSeenAt() {
  try { return JSON.parse(localStorage.getItem('nebula-dm-at') || '{}'); }
  catch { return {}; }
}

function rememberDm(id, at) {
  if (!id) return;
  const map = dmSeenAt();
  map[id] = at || Date.now();
  try { localStorage.setItem('nebula-dm-at', JSON.stringify(map)); } catch (_) {}
}

function hydrateClosed() {
  try { ui.closedChats = JSON.parse(localStorage.getItem(accountKey('nebula-closed')) || '{}') || {}; }
  catch { ui.closedChats = {}; }
}

export function chatClosed(key, lastId) {
  const stamp = (ui.closedChats || {})[key];
  if (!stamp) return false;
  return stamp === (lastId || 'none');
}

export function closeConversation(key, lastId) {
  hydrateClosed();
  const map = { ...ui.closedChats, [key]: lastId || 'none' };
  ui.closedChats = map;
  try { localStorage.setItem(accountKey('nebula-closed'), JSON.stringify(map)); } catch (_) {}
  if (key.startsWith('dm:') && ui.dmUser && key === 'dm:' + ui.dmUser.id) showFriends();
  if (key.startsWith('group:') && ui.group && key === 'group:' + ui.group.id) showFriends();
}

function revealChat(key) {
  if (!key || !(ui.closedChats || {})[key]) return;
  const map = { ...ui.closedChats };
  delete map[key];
  ui.closedChats = map;
  try { localStorage.setItem(accountKey('nebula-closed'), JSON.stringify(map)); } catch (_) {}
}

export async function loadGroups() {
  try {
    const data = await api('/api/groups');
    ui.groups = data.groups || [];
  } catch (_) {}
}

export async function loadDms() {
  const serial = ++dmSerial;
  hydrateClosed();
  try {
    const seen = seenMap();
    const seeded = localStorage.getItem(accountKey('nebula-dm-baseline')) === '1';
    let data;
    try {
      data = await api('/api/dms', { method: 'POST', body: { seen, seeded } });
    } catch (_) {
      data = await api('/api/dms');
    }
    if (serial !== dmSerial) return;
    const next = data.dms || [];
    if (!sameDms(ui.dms, next)) ui.dms = next;
    for (const row of next.slice(0, 12)) warmDm(row.other && row.other.id);
    const map = seenMap();
    const ready = localStorage.getItem(accountKey('nebula-dm-baseline')) === '1';
    if (!ready) {
      for (const row of next) {
        const id = row.other && row.other.id;
        if (!id) continue;
        if (row.lastId) {
          map['dm:' + id] = row.lastId;
          heardDm[id] = row.lastId;
        }
        rememberDm(id, row.updatedAt || Date.now());
      }
      saveSeen(map);
      try { localStorage.setItem(accountKey('nebula-dm-baseline'), '1'); } catch (_) {}
      ui.activity = { ...ui.activity, dms: {} };
      inboxReady = true;
      return;
    }
    const seenAt = dmSeenAt();
    const unread = {};
    let changed = false;
    for (const row of next) {
      const id = row.other && row.other.id;
      if (!id) continue;
      const key = 'dm:' + id;
      const stamp = row.lastId || String(row.updatedAt || '');
      const viewing = (ui.mode === 'dm' && ui.dmUser && String(ui.dmUser.id) === String(id))
        || (ui.quickOpen && ui.quickUser && String(ui.quickUser.id) === String(id));
      const own = (row.lastFrom && ui.me && String(row.lastFrom) === String(ui.me.id)) || (stamp && stamp === lastSentId);
      if (viewing || own) {
        if (row.lastId && map[key] !== row.lastId) {
          map[key] = row.lastId;
          changed = true;
        }
        rememberDm(id, row.updatedAt || Date.now());
        heardDm[id] = stamp;
        continue;
      }
      const reported = row.unread != null && row.unread !== '';
      const serverCount = reported
        ? Number(row.unread) || 0
        : Number(serverDmNotes[id] && serverDmNotes[id].unread) || 0;
      let count = serverCount;
      if (!reported && !serverCount && !own) {
        const freshId = row.lastId && map[key] && map[key] !== row.lastId;
        const freshAt = row.updatedAt && Number(row.updatedAt) > Number(seenAt[id] || 0);
        if (freshId || freshAt) {
          const prev = (ui.activity.dms[id] && ui.activity.dms[id].unread) || 0;
          count = heardDm[id] && heardDm[id] !== stamp ? prev + 1 : Math.max(prev, 1);
        }
      }
      if (count > 0) {
        unread[id] = { unread: count };
        if (inboxReady && heardDm[id] !== stamp && !viewing && !own) {
          const who = (row.other && (row.other.displayName || row.other.username)) || 'Someone';
          if (!roomMuted('dm:' + id)) noteArrival(stamp || key, who, 'New direct message');
        }
      }
      heardDm[id] = stamp;
    }
    if (changed) saveSeen(map);
    if (!sameNotes(ui.activity.dms, unread)) ui.activity = { ...ui.activity, dms: unread };
    if (ui.dmUser) {
      const row = next.find((dm) => dm.other && String(dm.other.id) === String(ui.dmUser.id));
      if (row && row.other) ui.dmUser = { ...ui.dmUser, ...row.other };
    }
    inboxReady = true;
  } catch (_) {}
}

export function showFriends(tab) {
  leaveChat();
  ui.readHold = '';
  ui.mode = 'friends';
  ui.friendsTab = tab || ui.friendsTab || 'online';
  ui.dmUser = null;
  ui.group = null;
  ui.thread = null;
  ui.dock = '';
  ui.menuOpen = false;
  applyTheme();
  loadFriends();
  loadDms();
}

export function showAddFriend() {
  leaveChat();
  ui.mode = 'add';
  ui.dmUser = null;
  applyTheme();
}

export function openQuick(user) {
  if (!user || !user.id) return;
  const same = ui.quickUser && String(ui.quickUser.id) === String(user.id);
  ui.quickUser = same ? { ...ui.quickUser, ...user } : user;
  ui.quickOpen = true;
  if (ui.activity.dms[user.id]) {
    const dms = { ...ui.activity.dms };
    delete dms[user.id];
    ui.activity = { ...ui.activity, dms };
  }
  rememberDm(user.id, Date.now());
}

export function closeQuick() {
  ui.quickOpen = false;
}

export async function openDm(user) {
  ui.readHold = '';
  const prev = currentRoom();
  const same = ui.mode === 'dm' && ui.dmUser && user && String(ui.dmUser.id) === String(user.id);
  ui.mode = 'dm';
  ui.dmUser = user;
  if (user && user.id) {
    loadProfile(user.id).then((fresh) => {
      if (fresh && ui.dmUser && String(ui.dmUser.id) === String(fresh.id)) ui.dmUser = { ...ui.dmUser, ...fresh };
    }).catch(() => {});
  }
  ui.group = null;
  ui.thread = null;
  if (user && user.id) revealChat('dm:' + user.id);
  if (user && user.id && ui.activity.dms[user.id]) {
    const dms = { ...ui.activity.dms };
    delete dms[user.id];
    ui.activity = { ...ui.activity, dms };
    rememberDm(user.id, Date.now());
  }
  ui.menuOpen = false;
  ui.picker = '';
  ui.popout = null;
  ui.reply = null;
  ui.editing = null;
  applyTheme();
  if (!same) {
    if (prev.startsWith('ch:')) snapServer(ui.serverId);
    stashRoom(prev);
    showCached(user && user.id ? 'dm:' + user.id : '');
  }
  dropLive();
  await loadMessages();
}

export async function openGroup(group) {
  if (!group || !group.id) return;
  ui.readHold = '';
  const prev = currentRoom();
  const same = ui.mode === 'group' && ui.group && String(ui.group.id) === String(group.id);
  ui.mode = 'group';
  ui.group = group;
  ui.dmUser = null;
  ui.thread = null;
  ui.dock = '';
  revealChat('group:' + group.id);
  ui.menuOpen = false;
  ui.reply = null;
  ui.editing = null;
  applyTheme();
  if (!same) {
    stashRoom(prev);
    showCached('group:' + group.id);
  }
  dropLive();
  await loadMessages();
}

export async function openThread(thread) {
  if (!thread || !thread.id) return;
  const prev = currentRoom();
  ui.mode = 'thread';
  ui.thread = thread;
  ui.dmUser = null;
  ui.group = null;
  ui.dock = '';
  ui.reply = null;
  ui.editing = null;
  stashRoom(prev);
  showCached('thread:' + thread.id);
  dropLive();
  await loadMessages();
}

export async function leaveThread() {
  const prev = currentRoom();
  stashRoom(prev);
  ui.mode = 'chat';
  ui.thread = null;
  ui.dock = '';
  showCached(ui.channelId ? 'ch:' + ui.channelId : '');
  dropLive();
  await loadMessages();
}

export async function pinMessage(id, on) {
  const data = await api('/api/messages/' + encodeURIComponent(id) + '/pin', { method: 'POST', body: { on } });
  if (data.message) ui.messages = ui.messages.map((msg) => msg.id === id ? data.message : msg);
}

export function roomMuted(key) {
  ui.muteTick;
  if (!key) return false;
  const raw = localStorage.getItem(accountKey('nebula-mute-' + key));
  if (!raw) return false;
  if (raw === 'forever') return true;
  const until = Number(raw);
  if (!until || Date.now() > until) {
    localStorage.removeItem(accountKey('nebula-mute-' + key));
    return false;
  }
  return true;
}

export function muteRoom(key, ms) {
  const store = accountKey('nebula-mute-' + key);
  if (!ms) localStorage.removeItem(store);
  else localStorage.setItem(store, ms === 'forever' ? 'forever' : String(Date.now() + ms));
  ui.muteTick += 1;
}

export function channelNotify(channelId) {
  return localStorage.getItem(accountKey('nebula-ch-notify-' + channelId)) || 'default';
}

export function setChannelNotify(channelId, level) {
  localStorage.setItem(accountKey('nebula-ch-notify-' + channelId), level || 'default');
  ui.muteTick += 1;
}

export async function openServer(id, opts = {}) {
  const voiceLeave = id && ui.voice && id !== ui.serverId;
  const prev = currentRoom();
  const fromServer = ui.serverId;
  const fromChannel = ui.channelId;
  const target = id || ui.serverId;
  const leavingRoom = ui.mode !== 'chat' || (target && target !== ui.serverId);
  if (ui.mode === 'chat') snapServer(fromServer);
  if (leavingRoom) stashRoom(prev);
  if (id) ui.serverId = id;
  ui.mode = 'chat';
  ui.dmUser = null;
  ui.group = null;
  ui.thread = null;
  ui.dock = '';
  ui.menuOpen = false;
  ui.picker = '';
  ui.reply = null;
  ui.editing = null;
  if (leavingRoom) {
    const known = restoreServer(target) || (target === fromServer ? fromChannel : '');
    if (known) ui.channelId = known;
    showCached(known ? 'ch:' + known : '');
  }
  if (voiceLeave) import('./voice.js').then((mod) => mod.leaveVoice()).catch(() => {});
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
  const nextId = ch ? ch.id : '';
  if (nextId !== ui.channelId) {
    ui.channelId = nextId;
    showCached(nextId ? 'ch:' + nextId : '');
  }
  snapServer(ui.serverId);
  warmServerChannels(ui.channels, ui.serverId);
  ui.seenMessageId = '';
  memberStamp = '';
  dropLive();
  await loadMessages();
  await loadMembers();
  import('./voice.js').then((mod) => mod.refreshVoiceRooms()).catch(() => {});
  if (!opts.keepDialog && ui.onboarding) ui.dialog = { kind: 'onboarding' };
}

const roomLogs = new Map();

function currentRoom() {
  if (ui.mode === 'dm' && ui.dmUser && ui.dmUser.id) return 'dm:' + ui.dmUser.id;
  if (ui.mode === 'group' && ui.group && ui.group.id) return 'group:' + ui.group.id;
  if (ui.mode === 'thread' && ui.thread && ui.thread.id) return 'thread:' + ui.thread.id;
  if (ui.mode === 'chat' && ui.channelId) return 'ch:' + ui.channelId;
  return '';
}

function stashRoom(id) {
  if (!id) return;
  roomLogs.set(id, ui.messages.filter((msg) => msg && !msg.pending && !msg.failed));
}

function leaveChat() {
  if (ui.mode !== 'chat') return;
  snapServer(ui.serverId);
  stashRoom(currentRoom());
}

const serverSnap = new Map();

function snapServer(id) {
  if (!id) return;
  serverSnap.set(id, {
    channels: ui.channels.slice(),
    servers: ui.servers.slice(),
    serverPerms: ui.serverPerms,
    roles: ui.roles.slice(),
    categories: ui.categories.slice(),
    serverMeta: ui.serverMeta,
    theme: ui.theme,
    bannerUrl: ui.bannerUrl,
    about: ui.about,
    showLobby: ui.showLobby,
    emoji: ui.emoji.slice(),
    stickers: ui.stickers.slice(),
    onboarding: ui.onboarding,
    channelId: ui.channelId,
  });
}

function restoreServer(id) {
  const snap = serverSnap.get(id);
  if (!snap) return '';
  ui.channels = snap.channels.slice();
  if (snap.servers.length) ui.servers = snap.servers.slice();
  ui.serverPerms = snap.serverPerms;
  ui.roles = snap.roles.slice();
  ui.categories = snap.categories.slice();
  ui.serverMeta = snap.serverMeta;
  ui.theme = snap.theme;
  ui.bannerUrl = snap.bannerUrl;
  ui.about = snap.about;
  ui.showLobby = snap.showLobby;
  ui.emoji = snap.emoji.slice();
  ui.stickers = snap.stickers.slice();
  ui.onboarding = snap.onboarding;
  applyTheme();
  return snap.channelId || '';
}

function showCached(id) {
  ui.typers = [];
  if (id && roomLogs.has(id)) {
    ui.messages = roomLogs.get(id).slice();
    ui.chatLoading = false;
    return;
  }
  ui.messages = [];
  ui.chatLoading = true;
}

function rememberLog(id, list) {
  if (!id) return;
  const clean = (list || []).filter((msg) => msg && !msg.pending && !msg.failed && !String(msg.id || '').startsWith('local-'));
  const prev = roomLogs.get(id);
  if (!clean.length && prev && prev.length) return;
  roomLogs.set(id, clean);
}

function msgSig(msg) {
  if (!msg) return '';
  const reacts = (msg.reactions || []).map((row) => (row.emoji || '') + row.count + (row.me ? '1' : '0') + (row.users || []).map((person) => person.id).join(',')).join('.');
  return [msg.id, msg.content || '', msg.editedAt || '', msg.pending ? 1 : 0, msg.failed ? 1 : 0, reacts, (msg.files || []).length, msg.poll ? JSON.stringify(msg.poll) : ''].join('|');
}

function sameLog(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (msgSig(a[i]) !== msgSig(b[i])) return false;
  return true;
}

const warmSeen = new Set();
let warmTail = Promise.resolve();

export function warmDm(id) {
  if (!id) return;
  warmRoom('dm:' + id, '/api/dms/' + encodeURIComponent(id) + '/messages');
}

export function warmChannel(id, serverId) {
  if (!id) return;
  const server = serverId || ui.serverId || '';
  warmRoom('ch:' + id, '/api/channels/' + encodeURIComponent(id) + '/messages?serverId=' + encodeURIComponent(server));
}

function warmServerChannels(channels, serverId) {
  for (const ch of (channels || []).filter((row) => row && row.type === 'text').slice(0, 12)) warmChannel(ch.id, serverId);
}

function warmRoom(key, path) {
  if (!key || roomLogs.has(key) || warmSeen.has(key)) return;
  warmSeen.add(key);
  warmTail = warmTail.then(async () => {
    if (roomLogs.has(key)) return;
    try {
      const data = await api(path);
      if (!roomLogs.has(key)) roomLogs.set(key, data.messages || []);
    } catch (_) {
      warmSeen.delete(key);
    }
  });
}

export function markAllRead() {
  const map = seenMap();
  for (const [id, messageId] of Object.entries(ui.heads || {})) {
    if (messageId) map[id] = messageId;
  }
  saveSeen(map);
  ui.activity = { servers: {}, channels: {}, dms: {} };
  ui.mentions = [];
  ui.missedCalls = [];
  api('/api/calls/read', { method: 'POST', body: {} }).catch(() => {});
  pollActivity();
  loadDms();
}

export async function openMention(row) {
  if (!row) return;
  ui.inboxOpen = false;
  if (row.serverId && row.serverId !== ui.serverId) await openServer(row.serverId);
  const channel = (ui.channels || []).find((item) => item.id === row.channelId) || { id: row.channelId, type: 'text', name: row.channelName || 'channel' };
  pickChannel(channel);
}

export function pickChannel(ch) {
  if (!ch || ch.type !== 'text') return;
  if (ch.id === ui.channelId && ui.mode === 'chat') return;
  ui.readHold = '';
  const prev = currentRoom();
  if (ui.mode === 'chat') snapServer(ui.serverId);
  stashRoom(prev);
  ui.mode = 'chat';
  ui.dmUser = null;
  ui.channelId = ch.id;
  ui.seenMessageId = '';
  ui.picker = '';
  ui.reply = null;
  ui.editing = null;
  showCached('ch:' + ch.id);
  snapServer(ui.serverId);
  dropLive();
  loadMessages();
}

let messagesBusy = false;
let pulseSerial = 0;
let memberStamp = '';
let profileStamp = '';
let pollStamp = '';
let editStamp = '';
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
  if (query.startsWith('groupId=')) {
    const id = decodeURIComponent(query.slice('groupId='.length).split('&')[0]);
    const data = await api('/api/groups/' + id + '/messages', { signal });
    return { messages: data.messages || [], typers: [] };
  }
  if (query.startsWith('threadId=')) {
    const id = decodeURIComponent(query.slice('threadId='.length).split('&')[0]);
    const data = await api('/api/threads/' + id + '/messages', { signal });
    return { messages: data.messages || [], typers: [] };
  }
  const data = await api('/api/channels/' + ui.channelId + '/messages', { signal });
  return { messages: data.messages || [], typers: [] };
}

async function watchChat() {
  if (watchStarted) return;
  watchStarted = true;
  while (true) {
    const looking = !!localStorage.getItem('dc_token') && (ui.mode === 'chat' || ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'thread');
    if (!looking) {
      await sleep(1500);
      continue;
    }
    liveCtrl = new AbortController();
    const signal = liveCtrl.signal;
    const real = [...ui.messages].reverse().find((msg) => msg && !msg.pending && !msg.failed);
    const after = real ? real.id : '';
    const typing = (ui.typers || []).map((row) => row.id + '@' + (row.tick || '')).sort().join(',');
    const started = Date.now();
    let pace = 'same';
    try {
      pace = await loadMessages(true, { after, typing, members: memberStamp, profiles: profileStamp, polls: pollStamp, edits: editStamp, signal });
    } catch (err) {
      if (err && err.name === 'AbortError') continue;
      await sleep(1000);
      continue;
    }
    if (pace === 'changed') {
      await sleep(80);
      continue;
    }
    if (Date.now() - started < 1500) await sleep(150);
  }
}

function paintNames(list) {
  const fresh = new Map();
  for (const msg of list || []) {
    if (msg && msg.author && msg.author.id) fresh.set(msg.author.id, msg.author);
  }
  if (!fresh.size || !ui.members.length) return;
  let changed = false;
  const next = ui.members.map((member) => {
    const author = fresh.get(member.id);
    if (!author) return member;
    const username = author.username || member.username;
    const displayName = author.displayName || member.displayName;
    const avatarUrl = author.avatarUrl || member.avatarUrl;
    if (username === member.username && displayName === member.displayName && avatarUrl === member.avatarUrl) return member;
    changed = true;
    return {
      ...member,
      username,
      displayName,
      avatarUrl,
      avatarColor: author.avatarColor || member.avatarColor,
    };
  });
  if (changed) ui.members = next;
}

function adoptMe(members) {
  if (!ui.me) return;
  const mine = (members || []).find((member) => member && String(member.id) === String(ui.me.id));
  if (!mine) return;
  const displayName = mine.displayName || '';
  const username = mine.username || ui.me.username || '';
  const nameEffect = mine.nameEffect || '';
  const nameFont = mine.nameFont || '';
  const profileStyle = mine.profileStyle || 'gradient';
  const same = displayName === (ui.me.displayName || '')
    && username === (ui.me.username || '')
    && nameEffect === (ui.me.nameEffect || '')
    && nameFont === (ui.me.nameFont || '')
    && profileStyle === (ui.me.profileStyle || 'gradient')
    && (mine.customStatus || '') === (ui.me.customStatus || '')
    && (mine.bio || '') === (ui.me.bio || '')
    && (mine.aboutMe || '') === (ui.me.aboutMe || '')
    && (mine.songFile || '') === (ui.me.songFile || '')
    && (mine.songUrl || '') === (ui.me.songUrl || '')
    && (mine.songError || '') === (ui.me.songError || '')
    && Number(mine.songStart || 0) === Number(ui.me.songStart || 0)
    && !!mine.songAutoplay === !!ui.me.songAutoplay;
  if (same) return;
  ui.me = {
    ...ui.me,
    displayName,
    username,
    nameEffect,
    nameFont,
    profileStyle,
    profileColors: mine.profileColors?.length ? mine.profileColors : ui.me.profileColors,
    nameColors: mine.nameColors?.length ? mine.nameColors : ui.me.nameColors,
    customStatus: mine.customStatus || '',
    pronouns: mine.pronouns ?? ui.me.pronouns,
    bio: mine.bio ?? ui.me.bio,
    aboutMe: mine.aboutMe ?? ui.me.aboutMe,
    shownBadges: Array.isArray(mine.shownBadges) ? mine.shownBadges : ui.me.shownBadges,
    showcase: mine.showcase || ui.me.showcase || null,
    showcaseServerId: mine.showcaseServerId ?? ui.me.showcaseServerId,
    status: mine.status || ui.me.status,
    avatarColor: mine.avatarColor || ui.me.avatarColor,
    avatarUrl: String(ui.me.avatarUrl || '').startsWith('blob:') ? ui.me.avatarUrl : (mine.avatarUrl || ui.me.avatarUrl),
    songUrl: mine.songUrl || '',
    songFile: mine.songFile || '',
    songError: mine.songError || '',
    songStart: mine.songStart || 0,
    songAutoplay: !!mine.songAutoplay,
  };
  rememberAccount(ui.me, localStorage.getItem('dc_token') || '');
}

function applyMemberNames(members) {
  const byId = new Map((members || []).map((member) => [member.id, member]));
  if (!byId.size || !ui.messages.length) return;
  let changed = false;
  const next = ui.messages.map((msg) => {
    const member = msg.author && byId.get(msg.author.id);
    if (!member) return msg;
    const username = member.username || msg.author.username;
    const displayName = member.nick || member.displayName || msg.author.displayName;
    const avatarUrl = member.avatarUrl || msg.author.avatarUrl || '';
    const nameEffect = member.nameEffect || '';
    const nameFont = member.nameFont || '';
    const nameColors = member.nameColors && member.nameColors.length ? member.nameColors : (msg.author.nameColors || []);
    const sameColors = nameColors.join(',') === (msg.author.nameColors || []).join(',');
    if (username === msg.author.username && displayName === msg.author.displayName && avatarUrl === (msg.author.avatarUrl || '') && nameEffect === (msg.author.nameEffect || '') && nameFont === (msg.author.nameFont || '') && sameColors) return msg;
    changed = true;
    return {
      ...msg,
      author: {
        ...msg.author,
        username,
        displayName,
        avatarUrl,
        avatarColor: member.avatarColor || msg.author.avatarColor,
        nameEffect,
        nameFont,
        nameColors,
      },
    };
  });
  if (changed) ui.messages = next;
}

export async function loadMessages(quiet, live) {
  if (quiet && messagesBusy) return 'skip';
  const serial = ++pulseSerial;
  messagesBusy = true;
  const mode = ui.mode;
  const channelId = ui.channelId;
  const dmId = ui.dmUser?.id || '';
  try {
    let data;
    const signal = live && live.signal;
    const wait = live
      ? '&after=' + encodeURIComponent(live.after || '') + '&typing=' + encodeURIComponent(live.typing || '') + '&members=' + encodeURIComponent(live.members || '') + '&profiles=' + encodeURIComponent(live.profiles || '') + '&polls=' + encodeURIComponent(live.polls || '') + '&edits=' + encodeURIComponent(live.edits || '') + '&wait=1'
      : '';
    if (ui.mode === 'dm' && ui.dmUser) {
      data = await pullLive('dmUserId=' + encodeURIComponent(ui.dmUser.id) + wait, signal);
    } else if (ui.mode === 'group' && ui.group) {
      data = await pullLive('groupId=' + encodeURIComponent(ui.group.id) + wait, signal);
    } else if (ui.mode === 'thread' && ui.thread) {
      data = await pullLive('threadId=' + encodeURIComponent(ui.thread.id) + wait, signal);
    } else if (!ui.channelId) {
      ui.messages = [];
      ui.typers = [];
      return;
    } else {
      data = await pullLive('channelId=' + encodeURIComponent(ui.channelId) + '&serverId=' + encodeURIComponent(ui.serverId || '') + wait, signal);
    }
    if (serial !== pulseSerial) return 'skip';
    if (ui.mode !== mode || ui.channelId !== channelId || (ui.dmUser?.id || '') !== dmId) return 'skip';
    if (mode === 'chat' && data.members && data.members !== memberStamp) {
      memberStamp = data.members;
      loadMembers(true);
    }
    if (data.profiles && data.profiles !== profileStamp) {
      profileStamp = data.profiles;
      if (mode === 'chat') loadMembers(true);
    }
    if (typeof data.polls === 'string') pollStamp = data.polls;
    if (typeof data.edits === 'string') editStamp = data.edits;
    if (data.same) return 'same';
    if (!Array.isArray(data.messages)) {
      if (Array.isArray(data.typers)) acceptTypers(data.typers);
      return 'same';
    }
    const previousId = ui.messages.length ? ui.messages[ui.messages.length - 1].id : '';
    acceptTypers(data.typers || []);
    const list = data.messages;
    paintNames(list);
    const newest = list[list.length - 1];
    if (previousId && newest && newest.id !== previousId && newest.author && newest.author.id) {
      ui.typers = ui.typers.filter((row) => row.id !== newest.author.id);
    }
    const roomKey = currentRoom().replace(/^ch:/, '') || ui.channelId;
    const logKey = currentRoom();
    const hadReal = ui.messages.some((msg) => msg && !msg.pending && !msg.failed && !String(msg.id || '').startsWith('local-'));
    if (!list.length && hadReal) return 'same';
    if (newest && newest.id && ui.readHold !== roomKey) markSeen(roomKey, newest.id);
    const known = new Set(list.map((msg) => msg && msg.id));
    const local = ui.messages.filter((msg) => msg && String(msg.id || '').startsWith('local-') && !known.has(msg.id) && (msg.roomKey === roomKey || !msg.roomKey));
    const next = local.length ? [...list, ...local] : list;
    if (!sameLog(ui.messages, next)) ui.messages = next;
    rememberLog(logKey, next);
    ui.chatLoading = false;
    if (newest && newest.id) ui.seenMessageId = newest.id;
    announceFresh(list, roomKey);
    return 'changed';
  } catch (err) {
    if (serial !== pulseSerial) return 'skip';
    if (err && err.name === 'AbortError') throw err;
    if (!quiet) toast(err.message);
    return 'same';
  } finally {
    if (serial === pulseSerial) {
      messagesBusy = false;
      if (!live) ui.chatLoading = false;
    }
  }
}

let membersBusy = false;
let membersAgain = false;

export async function loadMembers(quiet) {
  if (membersBusy) {
    membersAgain = true;
    return;
  }
  membersBusy = true;
  try {
    do {
      membersAgain = false;
      const data = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
      ui.members = data.members || [];
      ui.badgeDefs = data.badges || {};
      adoptMe(ui.members);
      applyMemberNames(ui.members);
      warmMedia(ui.members.flatMap((m) => [m.avatarUrl, m.bannerUrl]));
    } while (membersAgain);
  } catch (_) {}
  finally { membersBusy = false; }
}

async function postMessage(payload, target) {
  const content = String(payload.content || '').trim();
  const files = payload.files || [];
  const poll = payload.poll || null;
  if (!content && !files.length && !poll) return;
  const where = target || { mode: ui.mode, channelId: ui.channelId, dmUserId: ui.dmUser?.id || '', groupId: ui.group?.id || '', threadId: ui.thread?.id || '' };
  const typingToken = stopTyping();
  const body = { content, typingToken };
  if (files.length) body.files = files;
  if (poll) body.poll = poll;
  const replies = (Array.isArray(payload.replies) ? payload.replies : (payload.reply ? [payload.reply] : []))
    .filter((row) => row && row.id)
    .slice(0, 5);
  if (replies.length) {
    body.replies = replies.map((row) => ({ id: row.id }));
    body.reply = { id: replies[0].id };
  }
  const data = where.mode === 'dm' && where.dmUserId
    ? await api('/api/dms/' + where.dmUserId + '/messages', { method: 'POST', body })
    : where.mode === 'group' && where.groupId
      ? await api('/api/groups/' + where.groupId + '/messages', { method: 'POST', body })
      : where.mode === 'thread' && where.threadId
        ? await api('/api/threads/' + where.threadId + '/messages', { method: 'POST', body })
        : await api('/api/channels/' + where.channelId + '/messages', { method: 'POST', body });
  const sameRoom = where.mode === ui.mode && (
    where.mode === 'dm' ? where.dmUserId === (ui.dmUser?.id || '')
      : where.mode === 'group' ? where.groupId === (ui.group?.id || '')
        : where.mode === 'thread' ? where.threadId === (ui.thread?.id || '')
          : where.channelId === ui.channelId
  );
  if (sameRoom && data.message) {
    lastSentId = data.message.id;
    const without = ui.messages.filter((msg) => msg.id !== data.message.id && msg.id !== payload.replaceId);
    ui.messages = [...without, data.message];
    paintNames(ui.messages);
  } else if (data.message) {
    lastSentId = data.message.id;
    if (payload.replaceId) ui.messages = ui.messages.filter((msg) => msg.id !== payload.replaceId);
  }
  dropLive();
  if (where.mode === 'dm') loadDms();
}

export async function sendMessage() {
  const content = ui.composer.trim();
  if (ui.editing) {
    if (!content) return;
    const id = ui.editing.id;
    const previous = ui.composer;
    ui.composer = '';
    ui.editing = null;
    try {
      const data = await api('/api/messages/' + encodeURIComponent(id), { method: 'PATCH', body: { content } });
      if (data.message) ui.messages = ui.messages.map((msg) => msg.id === id ? data.message : msg);
      dropLive();
    } catch (err) {
      ui.composer = previous;
      ui.editing = { id };
      toast(err.message);
    }
    return;
  }
  if (!content) return;
  const replies = (Array.isArray(ui.reply) ? ui.reply : (ui.reply ? [ui.reply] : [])).filter((row) => row && row.id).slice(0, 5);
  const roomKey = currentRoom() || ui.channelId;
  const tempId = 'local-' + Math.random().toString(36).slice(2, 10);
  ui.composer = '';
  ui.reply = null;
  ui.messages = [...ui.messages, {
    id: tempId,
    pending: true,
    roomKey,
    createdAt: new Date().toISOString(),
    author: ui.me,
    content,
    reply: replies[0] || null,
    replies,
  }];
  try {
    await postMessage({ content, replies, replaceId: tempId });
  } catch (err) {
    patchLocal(tempId, () => ({ pending: false, failed: true, error: err.message || 'Could not send' }));
    toast(err.message);
  }
}

export async function reactTo(messageId, emoji) {
  const data = await api('/api/messages/' + encodeURIComponent(messageId) + '/reactions', { method: 'POST', body: { emoji } });
  if (data.message) ui.messages = ui.messages.map((msg) => msg.id === messageId ? data.message : msg);
}

export async function removeMessage(messageId) {
  await api('/api/messages/' + encodeURIComponent(messageId), { method: 'DELETE' });
  const roomKey = currentRoom() || ui.channelId;
  ui.messages = ui.messages.filter((msg) => msg.id !== messageId);
  if (roomHeard[roomKey] === messageId) {
    const last = ui.messages[ui.messages.length - 1];
    roomHeard[roomKey] = last ? last.id : '';
  }
  dropLive();
}

export async function forwardMessage(messageId, target) {
  await api('/api/messages/' + encodeURIComponent(messageId) + '/forward', { method: 'POST', body: target });
  dropLive();
  if (target.userId) loadDms();
}

function patchLocal(id, change) {
  ui.messages = ui.messages.map((msg) => msg.id === id ? { ...msg, ...change(msg) } : msg);
}

export function dismissLocal(id) {
  ui.messages = ui.messages.filter((msg) => msg.id !== id);
}

export async function sendFiles(list) {
  const files = [...(list || [])].slice(0, 10).map((item) => {
    if (typeof File !== 'undefined' && item instanceof File) return { file: item, name: item.name || 'file', alt: '', spoiler: false };
    return {
      file: item.file,
      name: String(item.name || item.file?.name || 'file').slice(0, 80),
      alt: String(item.alt || '').slice(0, 300),
      spoiler: !!item.spoiler,
    };
  }).filter((item) => item.file);
  if (!files.length) return false;
  ui.attachOpen = false;
  const content = ui.composer.trim();
  const replies = (Array.isArray(ui.reply) ? ui.reply : (ui.reply ? [ui.reply] : [])).filter((row) => row && row.id).slice(0, 5);
  ui.composer = '';
  ui.reply = null;
  const roomKey = currentRoom() || ui.channelId;
  const target = { mode: ui.mode, channelId: ui.channelId, dmUserId: ui.dmUser?.id || '' };
  const tempId = 'local-' + Math.random().toString(36).slice(2, 10);
  const locals = files.map((item) => ({
    url: URL.createObjectURL(item.file),
    name: item.name,
    alt: item.alt,
    spoiler: item.spoiler,
    kind: fileKind(item.file),
    progress: 1,
  }));
  ui.messages = [...ui.messages, {
    id: tempId,
    pending: true,
    roomKey,
    createdAt: new Date().toISOString(),
    author: ui.me,
    content,
    reply: replies[0] || null,
    replies,
    files: locals,
  }];
  try {
    const saved = [];
    const report = (index, n) => {
      patchLocal(tempId, (msg) => ({ files: msg.files.map((row, at) => at === index ? { ...row, progress: Math.max(1, n) } : row) }));
    };
    for (let i = 0; i < files.length; i++) {
      const blob = files[i].file;
      const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
      const gif = /image\/gif/i.test(blob.type || '') || /\.gif$/i.test(files[i].name || '') || (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46);
      if (gif) {
        const data = await uploadFile(blob, (n) => report(i, n), files[i].name || 'animation.gif');
        if (!data.url) throw new Error('The file did not upload');
        pinMedia(data.url, blob);
        saved.push({ url: data.url, name: files[i].name || 'animation.gif', alt: files[i].alt, spoiler: files[i].spoiler });
        report(i, 100);
        continue;
      }
      const packed = await packUpload(blob);
      let poster = '';
      if (packed.poster) {
        const preview = await uploadFile(packed.poster, (n) => report(i, Math.round(n * 0.2)), packed.posterName);
        poster = preview.url || '';
        if (poster) pinMedia(poster, packed.poster);
      }
      const data = await uploadFile(packed.body, (n) => report(i, poster ? 20 + Math.round(n * 0.8) : n), packed.name);
      if (!data.url) throw new Error('The file did not upload');
      pinMedia(data.url, packed.body);
      const row = { url: data.url, name: files[i].name || data.name || packed.name || 'file', alt: files[i].alt, spoiler: files[i].spoiler };
      if (poster) row.poster = poster;
      saved.push(row);
      report(i, 100);
    }
    await postMessage({ content, files: saved, replies, replaceId: tempId }, target);
    return true;
  } catch (err) {
    patchLocal(tempId, () => ({ pending: false, failed: true, error: err.message || 'Could not send' }));
    toast(err.message || 'Could not send that file');
    return false;
  }
}

export async function sendPoll(poll) {
  ui.attachOpen = false;
  try {
    await postMessage({ poll });
  } catch (err) {
    toast(err.message);
  }
}

export async function votePoll(messageId, options) {
  const data = await api('/api/polls/' + encodeURIComponent(messageId) + '/vote', { method: 'POST', body: { options } });
  ui.messages = ui.messages.map((msg) => msg.id === messageId ? { ...msg, poll: data.poll } : msg);
}

export async function sendSticker(name) {
  ui.picker = '';
  ui.composer = '[[sticker:' + name + ']]';
  await sendMessage();
}

export async function sendGif(url) {
  if (!/^https:\/\//.test(String(url || ''))) return;
  ui.picker = '';
  ui.composer = '[[gif:' + url + ']]';
  await sendMessage();
}

export function insertEmoji(token) {
  const text = String(token || '');
  if (!text) return;
  ui.composer = (ui.composer ? ui.composer + text : text);
}

export async function loadPacks() {
  try {
    const data = await api('/api/media');
    ui.packs = data.packs || [];
  } catch (_) {}
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
let typingSerial = 0;
let typingLive = false;
let typingIdle = null;
let keysDown = 0;
const typerSeen = new Map();

function acceptTypers(list) {
  const now = Date.now();
  const rows = Array.isArray(list) ? list : [];
  const ids = new Set(rows.map((row) => row && row.id).filter(Boolean));
  for (const id of [...typerSeen.keys()]) if (!ids.has(id)) typerSeen.delete(id);
  for (const row of rows) if (row && row.id) typerSeen.set(row.id, now);
  ui.typers = rows;
}

setInterval(() => {
  if (!ui.typers.length) return;
  const now = Date.now();
  const next = ui.typers.filter((row) => now - (typerSeen.get(row.id) || 0) < 6500);
  if (next.length === ui.typers.length) return;
  for (const row of ui.typers) if (!next.includes(row)) typerSeen.delete(row.id);
  ui.typers = next;
}, 80);

const SKIP_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function typingBody() {
  if (ui.mode === 'dm') return { dmUserId: ui.dmUser?.id };
  if (ui.mode === 'group') return { groupId: ui.group?.id };
  if (ui.mode === 'thread') return { threadId: ui.thread?.id };
  return { channelId: ui.channelId, serverId: ui.serverId };
}

function postTyping(extra) {
  if (ui.mode === 'dm' && !ui.dmUser?.id) return;
  if (ui.mode === 'chat' && !ui.channelId) return;
  api('/api/typing', { method: 'POST', body: { ...typingBody(), ...extra } }).catch(() => {});
}

function stopTyping() {
  clearTimeout(typingIdle);
  keysDown = 0;
  const token = ++typingSerial;
  if (typingLive || lastTypingPing) postTyping({ stop: true, token });
  typingLive = false;
  lastTypingPing = 0;
  return token;
}

function pingTyping() {
  const now = Date.now();
  if (typingLive && now - lastTypingPing < 2500) return;
  lastTypingPing = now;
  typingLive = true;
  postTyping({ token: ++typingSerial });
}

function armTypingIdle() {
  clearTimeout(typingIdle);
  typingIdle = setTimeout(() => stopTyping(), 120);
}

export function noteKeyDown(event) {
  if (!event || event.isComposing) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (SKIP_KEYS.has(event.key)) return;
  if (event.key === 'Enter') return;
  if ((event.key === 'Backspace' || event.key === 'Delete') && !ui.composer.trim()) return;
  if (!event.repeat) keysDown += 1;
  pingTyping();
  armTypingIdle();
}

export function noteKeyUp(event) {
  if (event && !event.repeat) keysDown = Math.max(0, keysDown - 1);
  if (keysDown > 0) return;
  stopTyping();
}

export function noteTypingBlur() {
  stopTyping();
}

export function typingLine(list) {
  const names = (list || []).map((row) => row.name).filter(Boolean);
  if (!names.length) return '';
  if (names.length > 5) return '5+ are typing';
  if (names.length === 1) return names[0] + ' is typing';
  return names.slice(0, 5).map((name) => name + ' is typing').join(', ');
}

export function noteTyping() {
  if (!ui.composer.trim()) stopTyping();
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
    acceptTypers(data.typers || []);
  } catch (_) {}
  finally { typingBusy = false; }
}

let clocksStarted = false;
let activityReady = false;
let mentionSnap = 0;
let dmSnap = 0;
let lastSound = 0;
const heardHeads = {};
const heardIds = new Set();

export function soundEnabled() {
  return localStorage.getItem('nebula-sound') !== 'off';
}

function audioCtx() {
  if (!playPing.ctx) playPing.ctx = new AudioContext();
  return playPing.ctx;
}

function chimeWav() {
  const sampleRate = 22050;
  const samples = Math.floor(sampleRate * 0.32);
  const data = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 8);
    const wave = Math.sin(2 * Math.PI * 880 * Math.pow(0.55, t / 0.32) * t);
    data[i] = Math.max(-1, Math.min(1, wave * env)) * 0.5 * 32767;
  }
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + data.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, data.length * 2, true);
  let offset = 44;
  for (let i = 0; i < data.length; i++, offset += 2) view.setInt16(offset, data[i], true);
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

const pingAudio = typeof Audio !== 'undefined' ? new Audio(chimeWav()) : null;
if (pingAudio) pingAudio.preload = 'auto';

function siteTitle() {
  const mentions = Object.values(ui.activity?.channels || {}).reduce((sum, row) => sum + (Number(row?.mentions) || 0), 0);
  const dms = Object.values(ui.activity?.dms || {}).reduce((sum, row) => sum + (Number(row?.unread) || 0), 0);
  const n = mentions + dms;
  return n > 0 ? '(' + n + ') Nebula' : 'Nebula';
}

export function pinnedChats() {
  ui.pinTick;
  try { return JSON.parse(localStorage.getItem(accountKey('nebula-dm-pins')) || '[]'); }
  catch { return []; }
}

export function togglePin(key) {
  const current = pinnedChats();
  const next = current.includes(key) ? current.filter((id) => id !== key) : [key, ...current];
  localStorage.setItem(accountKey('nebula-dm-pins'), JSON.stringify(next));
  ui.pinTick += 1;
  ui.dmMenu = null;
}

let titleFlashing = false;
export function applySiteTitle() {
  if (typeof document === 'undefined' || titleFlashing) return;
  document.title = siteTitle();
}

function chime() {
  const ctx = audioCtx();
  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, start);
  osc.frequency.exponentialRampToValueAtTime(440, start + 0.18);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.44);
}

function spamChime() {
  const ctx = audioCtx();
  const start = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = start + i * 0.09;
    osc.type = 'square';
    osc.frequency.setValueAtTime(520 - i * 70, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.08);
  }
}

let askedAccess = false;

export async function askSiteAccess() {
  unlockSound();
  if (askedAccess) return;
  askedAccess = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) return;
    let state = 'prompt';
    if (navigator.permissions?.query) {
      const perm = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
      if (perm) state = perm.state;
    }
    if (state === 'granted') return;
    if (state === 'denied') {
      toast('Microphone is blocked. Click the lock icon in the address bar and allow Microphone and Sound.');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (_) {}
}

export function unlockSound() {
  try {
    const ctx = audioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch (_) {}
  if (pingAudio) {
    const volume = pingAudio.volume;
    pingAudio.volume = 0;
    pingAudio.play().then(() => {
      pingAudio.pause();
      pingAudio.currentTime = 0;
      pingAudio.volume = volume || 0.7;
    }).catch(() => { pingAudio.volume = volume || 0.7; });
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function tryWebChime() {
  try {
    const ctx = audioCtx();
    if (ctx.state === 'running') chime();
    else ctx.resume().then(() => { if (ctx.state === 'running') chime(); }).catch(() => {});
  } catch (_) {}
}

export function playPing(force) {
  if (!soundEnabled()) return;
  const now = Date.now();
  if (!force && now - lastSound < 350) return;
  lastSound = now;
  if (pingAudio) {
    try {
      pingAudio.volume = 0.7;
      pingAudio.currentTime = 0;
      const attempt = pingAudio.play();
      if (attempt && attempt.catch) {
        attempt.catch(() => tryWebChime());
        return;
      }
    } catch (_) {}
  }
  tryWebChime();
}

let lastSpam = 0;
const burstTimes = [];

function playSpam() {
  if (!soundEnabled()) return;
  const now = Date.now();
  if (now - lastSpam < 1800) return;
  lastSpam = now;
  lastSound = now;
  try {
    const ctx = audioCtx();
    if (ctx.state === 'running') spamChime();
    else ctx.resume().then(() => { if (ctx.state === 'running') spamChime(); }).catch(() => {});
  } catch (_) {}
}

function flashTitle() {
  if (!document.hidden) return;
  titleFlashing = true;
  document.title = 'New message · Nebula';
  setTimeout(() => {
    titleFlashing = false;
    applySiteTitle();
  }, 4000);
}

function deskNotice(title, body) {
  if (!document.hidden) return;
  flashTitle();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const note = new Notification(title || 'Nebula', { body: String(body || 'New message').slice(0, 140), silent: false });
    note.onclick = () => {
      window.focus();
      note.close();
    };
  } catch (_) {}
}

function noteArrival(id, title, body) {
  const key = String(id || '');
  if (!key || heardIds.has(key)) return;
  heardIds.add(key);
  if (heardIds.size > 500) heardIds.delete(heardIds.values().next().value);
  const now = Date.now();
  burstTimes.push(now);
  while (burstTimes.length && now - burstTimes[0] > 2500) burstTimes.shift();
  if (burstTimes.length >= 4) playSpam();
  else playPing();
  deskNotice(title, body);
}

const roomHeard = {};

function announceFresh(list, roomKey) {
  if (!roomKey) return;
  const rows = list || [];
  const newest = rows[rows.length - 1];
  const prev = roomHeard[roomKey];
  if (!prev) {
    if (newest && newest.id) roomHeard[roomKey] = newest.id;
    return;
  }
  if (!newest || newest.id === prev) return;
  const start = rows.findIndex((msg) => msg.id === prev);
  if (start < 0) {
    roomHeard[roomKey] = newest.id;
    return;
  }
  const fresh = rows.slice(start + 1);
  for (const msg of fresh) {
    if (!msg || isMine(msg)) continue;
    if (roomMuted(roomKey) || (ui.mode === 'chat' && serverMuted())) continue;
    if (ui.mode === 'chat') {
      const level = channelNotify(ui.channelId);
      if (level === 'nothing') continue;
      if (level === 'mentions' && !mentionsMessage(msg)) continue;
    }
    const who = (msg.author && (msg.author.displayName || msg.author.username)) || 'Someone';
    const mentioned = mentionsMessage(msg);
    const text = String(msg.content || '')
      .replace(/\[\[gif:[^\]]+\]\]/g, 'GIF')
      .replace(/\[\[sticker:[^\]]+\]\]/g, 'Sticker')
      .trim() || ((msg.files && msg.files.length) ? 'Sent a file' : 'New message');
    noteArrival(msg.id, mentioned ? who + ' mentioned you' : who, text);
  }
  roomHeard[roomKey] = newest.id;
}

function mentionsMessage(msg) {
  const mentions = msg && msg.mentions;
  const text = String(msg && msg.content || '');
  if (/(^|\s)@everyone(?![\w.])/i.test(text) && (!mentions || mentions.everyone)) return true;
  if (/(^|\s)@here(?![\w.])/i.test(text) && (!mentions || mentions.here)) return true;
  if (!mentions || typeof mentions !== 'object') return mentionsMe(text);
  if (mentions.everyone || mentions.here) return true;
  if ((mentions.users || []).some((id) => String(id) === String(ui.me && ui.me.id))) return true;
  const me = (ui.members || []).find((member) => member.id === (ui.me && ui.me.id));
  const mine = new Set((me && me.roles || []).map((role) => role.id));
  return (mentions.roles || []).some((id) => mine.has(id));
}

export function mentionsMe(text) {
  const body = String(text || '');
  if (/(^|\s)@(everyone|here)(?![\w.])/i.test(body)) return true;
  const names = [ui.me?.username, ui.me?.displayName].filter((name) => name && String(name).trim());
  return names.some((name) => {
    const safe = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|\\s)@' + safe + '(?![\\w.])', 'i').test(body);
  });
}

function accountKey(name) {
  const id = ui.me && ui.me.id;
  return id ? name + ':' + id : name;
}

function seenMap() {
  try { return JSON.parse(localStorage.getItem(accountKey('nebula-seen')) || '{}'); }
  catch { return {}; }
}

function saveSeen(map) {
  try { localStorage.setItem(accountKey('nebula-seen'), JSON.stringify(map)); } catch (_) {}
}

function forgetActivity(id) {
  if (String(id).startsWith('dm:')) {
    const userId = id.slice(3);
    if (!ui.activity.dms[userId]) return;
    const dms = { ...ui.activity.dms };
    delete dms[userId];
    ui.activity = { ...ui.activity, dms };
    return;
  }
  const note = ui.activity.channels[id];
  if (!note) return;
  const channels = { ...ui.activity.channels };
  delete channels[id];
  const servers = { ...ui.activity.servers };
  const srv = servers[note.serverId];
  if (srv) {
    const unread = Math.max(0, (srv.unread || 0) - (note.unread || 0));
    const mentions = Math.max(0, (srv.mentions || 0) - (note.mentions || 0));
    if (unread || mentions) servers[note.serverId] = { unread, mentions };
    else delete servers[note.serverId];
  }
  ui.activity = { ...ui.activity, channels, servers };
}

export function markSeen(id, messageId) {
  if (!id || !messageId) return;
  const map = seenMap();
  if (map[id] !== messageId) {
    map[id] = messageId;
    saveSeen(map);
  }
  forgetActivity(id);
}

let serverDmNotes = {};
let activityMissing = false;
let activitySerial = 0;

function sameNotes(prev, next) {
  const left = Object.keys(prev || {});
  const right = Object.keys(next || {});
  if (left.length !== right.length) return false;
  return right.every((id) => {
    const a = prev[id] || {};
    const b = next[id] || {};
    return a.unread === b.unread && a.mentions === b.mentions;
  });
}

async function pollActivity() {
  if (activityMissing) return;
  const serial = ++activitySerial;
  try {
    const data = await api('/api/activity', {
      method: 'POST',
      body: { seen: seenMap(), seeded: localStorage.getItem(accountKey('nebula-dm-baseline')) === '1' },
    });
    const calls = data.calls || {};
    ui.incomingCall = (calls.incoming || [])[0] || null;
    ui.missedCalls = calls.missed || [];
    const firstChannels = localStorage.getItem(accountKey('nebula-channel-baseline')) !== '1';
    if (firstChannels && data.heads) {
      const map = seenMap();
      for (const [id, messageId] of Object.entries(data.heads)) {
        if (String(id).startsWith('dm:') || map[id] || !messageId) continue;
        map[id] = messageId;
      }
      saveSeen(map);
      try { localStorage.setItem(accountKey('nebula-channel-baseline'), '1'); } catch (_) {}
      ui.activity = { ...ui.activity, servers: {}, channels: {} };
      return;
    }
    if (serial !== activitySerial) return;
    const servers = { ...(data.servers || {}) };
    const channels = { ...(data.channels || {}) };
    const dms = { ...(data.dms || {}) };
    if (ui.mode === 'chat' && ui.channelId && channels[ui.channelId] && ui.readHold !== ui.channelId) {
      const note = channels[ui.channelId];
      delete channels[ui.channelId];
      const srv = servers[note.serverId];
      if (srv) {
        const unread = Math.max(0, (srv.unread || 0) - (note.unread || 0));
        const mentionsLeft = Math.max(0, (srv.mentions || 0) - (note.mentions || 0));
        if (unread || mentionsLeft) servers[note.serverId] = { unread, mentions: mentionsLeft };
        else delete servers[note.serverId];
      }
    }
    if (ui.mode === 'dm' && ui.dmUser && ui.readHold !== 'dm:' + ui.dmUser.id) delete dms[ui.dmUser.id];
    serverDmNotes = dms;
    let mentions = 0;
    let dmUnread = 0;
    for (const row of Object.values(servers)) mentions += row.mentions || 0;
    for (const row of Object.values(dms)) dmUnread += row.unread || 0;
    if (data.heads) {
      for (const [id, messageId] of Object.entries(data.heads)) {
        if (!messageId || String(id).startsWith('dm:')) continue;
        if (!activityReady || heardHeads[id] === undefined) {
          heardHeads[id] = messageId;
          continue;
        }
        if (heardHeads[id] === messageId) continue;
        heardHeads[id] = messageId;
        const speaker = (data.speakers || {})[id];
        if (speaker && ui.me && String(speaker) === String(ui.me.id)) continue;
        const note = (data.channels || {})[id];
        noteArrival(messageId, 'Nebula', note && note.mentions ? 'You were mentioned' : 'New message');
      }
    }
    activityReady = true;
    mentionSnap = mentions;
    dmSnap = dmUnread;
    ui.mentions = Array.isArray(data.inbox) ? data.inbox : [];
    ui.heads = data.heads || {};
    if (!sameNotes(ui.activity.servers, servers) || !sameNotes(ui.activity.channels, channels)) {
      ui.activity = { ...ui.activity, servers, channels };
    }
  } catch (err) {
    if (err && err.status === 404) activityMissing = true;
  }
}

let presenceStarted = false;
let lastLocalActivity = Date.now();
let lastSeenPing = 0;

function applyPresence(status, lastSeen) {
  if (!ui.me || !status) return;
  const seen = lastSeen || ui.me.lastSeen;
  if (ui.me.status === status && ui.me.lastSeen === seen) return;
  ui.me = { ...ui.me, status, lastSeen: seen };
  ui.members = ui.members.map((member) => member.id === ui.me.id ? { ...member, status, lastSeen: ui.me.hideLastSeen ? null : seen } : member);
  if (ui.popout?.user?.id === ui.me.id) {
    ui.popout = { ...ui.popout, user: { ...ui.popout.user, status, lastSeen: ui.me.hideLastSeen ? null : seen } };
  }
}

async function pingSeen() {
  if (!localStorage.getItem('dc_token') || !ui.me) return;
  try {
    const data = await api('/api/seen', { method: 'POST', body: {} });
    applyPresence(data.status, data.lastSeen);
  } catch (_) {}
}

function noteActivity() {
  if (document.hidden) return;
  lastLocalActivity = Date.now();
}

function startPresence() {
  if (presenceStarted || typeof window === 'undefined') return;
  presenceStarted = true;
  lastLocalActivity = Date.now();
  for (const type of ['pointerdown', 'keydown', 'mousemove', 'touchstart']) {
    window.addEventListener(type, noteActivity, { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) noteActivity();
  });
  pingSeen();
  setInterval(() => {
    if (!ui.me || (ui.me.statusChoice || 'online') !== 'online') return;
    if (document.hidden && Date.now() - lastLocalActivity >= 10 * 60 * 1000) applyPresence('idle', ui.me.lastSeen);
    else if (!document.hidden) pingSeen();
  }, 20000);
}

function startClocks() {
  if (clocksStarted) return;
  clocksStarted = true;
  const watchInbox = () => {
    if (document.hidden || !localStorage.getItem('dc_token')) return;
    pollActivity().then(() => { loadDms(); loadGroups(); });
  };
  setInterval(watchInbox, 15000);
  watchInbox();
  watchAlerts();
  loadPacks();
}

let alertCursor = '';
let alertMissing = false;

async function watchAlerts() {
  while (true) {
    if (alertMissing || !localStorage.getItem('dc_token')) {
      await sleep(4000);
      continue;
    }
    try {
      const data = await api('/api/alert?wait=1&cursor=' + encodeURIComponent(alertCursor));
      const next = String(data.cursor || '');
      const changed = !!alertCursor && next !== alertCursor;
      alertCursor = next;
      if (changed) {
        await pollActivity();
        await loadDms();
        import('./voice.js').then((mod) => mod.pokeVoice()).catch(() => {});
      }
      await noteReports(changed || !localStorage.getItem('nebula-report-seen:' + (ui.me && ui.me.id)));
    } catch (err) {
      if (err && err.status === 404) alertMissing = true;
      else await sleep(1500);
    }
  }
}

export async function saveMe(body) {
  const previous = ui.me;
  const pending = { ...ui.me };
  for (const key of ['displayName', 'username', 'aliases', 'pronouns', 'bio', 'aboutMe', 'customStatus', 'status', 'nameEffect', 'nameFont', 'profileStyle', 'avatarColor', 'accentColor', 'showcaseServerId', 'showcaseBadge', 'songUrl', 'songStart', 'songAutoplay']) {
    if (body[key] !== undefined) pending[key] = body[key];
  }
  if (Array.isArray(body.shownBadges)) pending.shownBadges = body.shownBadges;
  if (body.nameColors) pending.nameColors = body.nameColors;
  if (Array.isArray(body.profileColors)) pending.profileColors = body.profileColors;
  ui.me = pending;
  let data;
  try {
    data = await api('/api/me', { method: 'PATCH', body });
  } catch (err) {
    ui.me = previous;
    throw err;
  }
  ui.me = {
    ...previous,
    ...data.user,
    displayName: data.user?.displayName ?? body.displayName ?? previous?.displayName ?? '',
    aboutMe: data.user?.aboutMe ?? body.aboutMe ?? previous?.aboutMe ?? '',
    showcaseBadge: data.user?.showcaseBadge ?? body.showcaseBadge ?? previous?.showcaseBadge ?? '',
    nameEffect: data.user?.nameEffect || body.nameEffect || '',
    nameFont: data.user?.nameFont ?? body.nameFont ?? previous?.nameFont ?? '',
    profileStyle: data.user?.profileStyle || body.profileStyle || previous?.profileStyle || 'gradient',
    nameColors: data.user?.nameColors?.length ? data.user.nameColors : (body.nameColors || previous?.nameColors || []),
  };
  ui.members = ui.members.map((member) => member.id === ui.me.id ? { ...member, ...ui.me } : member);
  if (ui.popout?.user?.id === ui.me.id) {
    ui.popout = { ...ui.popout, user: { ...ui.popout.user, ...ui.me, roles: ui.popout.user.roles || [] } };
  }
  rememberAccount(ui.me, localStorage.getItem('dc_token') || '');
  ui.userSettings = false;
  await loadMembers();
  dropLive();
  toast('Profile saved');
}

export function relation(id) {
  if (!id || !ui.me || id === ui.me.id) return 'self';
  if ((ui.blocked || []).some((x) => x.id === id)) return 'blocked';
  if (ui.friends.some((x) => x.id === id)) return 'friends';
  if (ui.incoming.some((x) => x.id === id)) return 'incoming';
  if (ui.outgoing.some((x) => x.id === id)) return 'outgoing';
  return 'none';
}

export function developerMode() {
  ui.devTick;
  return localStorage.getItem('nebula-dev') === '1';
}

export function setDeveloperMode(on) {
  localStorage.setItem('nebula-dev', on ? '1' : '0');
  ui.devTick += 1;
}

export function openMemberMenu(event, user) {
  if (!user) return;
  event.preventDefault();
  event.stopPropagation();
  ui.dmMenu = null;
  ui.idMenu = null;
  ui.memberMenu = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 196)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 120)),
    user,
  };
}

export function openIdMenu(event, items) {
  if (!developerMode() || !items || !items.length) return false;
  event.preventDefault();
  event.stopPropagation();
  ui.idMenu = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 40 - items.length * 36)),
    items,
  };
  return true;
}

export async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(String(value ?? ''));
    toast('Copied ' + (label || 'ID'));
  } catch (_) {
    toast('Could not copy');
  }
  ui.idMenu = null;
}

const REPORT_BASE = 'nebula-report-seen:';

async function noteReports(allowPopup) {
  if (!ui.me || !ui.me.canAdmin) return;
  try {
    const data = await api('/api/staff/reports');
    ui.staffReports = data.reports || [];
    const open = ui.staffReports.find((row) => row.status === 'open');
    const key = REPORT_BASE + ui.me.id;
    const seen = localStorage.getItem(key);
    if (seen == null) {
      localStorage.setItem(key, open ? open.id : '');
      return;
    }
    if (allowPopup && open && open.id !== seen) ui.reportPopup = open;
  } catch (_) {}
}

export async function staffReport(id, action) {
  const data = await api('/api/staff/reports/' + encodeURIComponent(id), { method: 'POST', body: { action } });
  if (ui.me) localStorage.setItem(REPORT_BASE + ui.me.id, id);
  ui.reportPopup = action === 'view' ? data.report : null;
  const list = await api('/api/staff/reports');
  ui.staffReports = list.reports || [];
  return data.report;
}

export async function friendAct(kind, body) {
  await api('/api/friends/' + kind, { method: 'POST', body });
  await loadFriends();
  await loadDms();
}

export async function loadProfile(id) {
  if (!id) return null;
  const data = await api('/api/users/' + encodeURIComponent(id));
  return data.user || null;
}

export async function openPopout(user, x, y) {
  const inServer = ui.mode === 'chat' && !!ui.serverId;
  const known = inServer ? ui.members.find((m) => m.id === user.id) : null;
  const seed = known
    ? { ...user, ...known, roles: known.roles || [] }
    : { ...user, roles: inServer ? (user.roles || []) : [] };
  ui.popout = { user: seed, x, y };
  warmMedia([seed.bannerUrl, seed.avatarUrl]);
  loadFriends().catch(() => {});
  loadProfile(user.id).then((fresh) => {
    if (!fresh || !ui.popout || ui.popout.user?.id !== user.id) return;
    ui.popout = { user: { ...ui.popout.user, ...fresh, roles: ui.popout.user.roles || [] }, x, y };
    warmMedia([fresh.bannerUrl, fresh.avatarUrl]);
    if (ui.dmUser && String(ui.dmUser.id) === String(fresh.id)) ui.dmUser = { ...ui.dmUser, ...fresh };
  }).catch(() => {});
  if (!inServer) return;
  try {
    const data = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
    if (!ui.popout || ui.popout.user?.id !== user.id || ui.mode !== 'chat') return;
    const fresh = (data.members || []).find((m) => m.id === user.id);
    ui.badgeDefs = data.badges || ui.badgeDefs;
    if (!fresh) return;
    ui.popout = { user: { ...seed, ...fresh, roles: fresh.roles || [] }, x, y };
    warmMedia([fresh.bannerUrl, fresh.avatarUrl]);
  } catch (_) {}
}

export const currentChannel = () => ui.channels.find((c) => c.id === ui.channelId) || null;
