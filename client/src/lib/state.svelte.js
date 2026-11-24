import { api, getApiBase, pinMedia, warmMedia, primeMedia, uploadFile, setUnauthorizedHandler } from './api.js';
import { connectGateway, disconnectGateway, gatewayReady, gatewayStale, onGateway, reconnectGateway, subscribeGateway } from './gateway.js';
import { getPasskey } from './webauthn.js';
import { fileKind } from './media.js';
import { PERM, hasBit, inviteCodeFromUrl, inviteLink, stripInviteText } from './format.js';
import { rememberServer } from './serverface.js';
import { playEvent, unlockAudio, notifySounds } from './sounds.js';
import { applyLook } from './look.svelte.js';
import { ensureBox, localKeys, saveKeys } from './seal.js';
import {
  createVault, forgetVault, isSealedText, keyInLink, loadSecret, loadVault, lockSecret, newRoomKey,
  openText, openVault, rememberSecret, rememberVault, sealFile, sealText, unwrapKey, vaultCheck, wrapKeyFor, wrapVault,
} from './vault.js';

export const nowClock = $state({ t: Date.now() });
if (typeof window !== 'undefined') setInterval(() => { nowClock.t = Date.now(); }, 1000);

export const ui = $state({
  booting: true,
  me: null,
  auth: 'login',
  mfa: null,
  authError: '',
  authOk: '',
  pending: null,
  pendingVault: null,
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
  channelMenu: null,
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
  links: [],
  events: [],
  rulesChannelId: '',
  emoji: [],
  stickers: [],
  onboarding: null,
  messages: [],
  chatLoading: false,
  members: [],
  badgeDefs: {},
  menuOpen: false,
  serverPick: false,
  phone: 'browse',
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
  dmTyping: {},
  voice: null,
  voiceStage: null,
  voiceRooms: {},
  screen: null,
  streamUi: { view: 'auto', watching: false, hideChat: false },
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
  switchPrompt: false,
  switchHold: null,
  quickOpen: false,
  quickUser: null,
});

let pollTimer = null;

export function hasPerm(flag) {
  if (hasBit(ui.serverPerms, PERM.ADMIN)) return true;
  return hasBit(ui.serverPerms, flag);
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

function takeMe(user) {
  if (!user) return user;
  const next = { ...user };
  delete next.boxRing;
  return next;
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
  if (id) {
    writeAccounts(savedAccounts().filter((row) => row.id !== id));
    forgetVault(id);
  }
  localStorage.removeItem('dc_token');
  disconnectGateway();
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
  ui.switchPrompt = false;
  ui.switchHold = null;
  ui.mfa = null;
  ui.auth = 'login';
  if (pollTimer) clearInterval(pollTimer);
  loggingOut = false;
}
setUnauthorizedHandler(logout);

function applyTheme() {
  applyLook();
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
    if (!loadVault(data.user.id)) {
      localStorage.removeItem('dc_token');
      ui.me = null;
      ui.booting = false;
      return;
    }
    ui.me = takeMe(data.user);
    rememberAccount(data.user, token);
    publishBox().catch(() => {});
    warmMedia([data.user?.avatarUrl, data.user?.bannerUrl]);
    primeMedia([data.user?.avatarUrl, data.user?.bannerUrl]);
    await enterApp();
  } catch {
    forgetToken(token);
    logout();
  } finally {
    ui.booting = false;
  }
}

async function enterApp() {
  publishBox().catch(() => {});
  try {
    const ch = await api('/api/channels');
    ui.channels = ch.channels || [];
    ui.servers = ch.servers || [];
    for (const server of ui.servers) if (server.roomKey) keepServerKey(server.id, server.roomKey);
  } catch (_) {}
  await Promise.all([
    loadFriends(),
    loadDms(),
    openServer(ui.serverId || 'nebula-official'),
  ]);
  await consumeInvite();
  await openSharedLink();
  if (pollTimer) clearInterval(pollTimer);
  let dmPollBusy = false;
  let quietSkips = 0;
  pollTimer = setInterval(() => {
    if (dmPollBusy || !localStorage.getItem('dc_token') || document.hidden) return;
    // New messages, typing, and calls already arrive on the gateway. This timer is only a backup.
    if (gatewayReady()) {
      quietSkips += 1;
      if (quietSkips < 5) return;
    }
    quietSkips = 0;
    dmPollBusy = true;
    const live = gatewayReady();
    pollActivity().then((changed) => { if (!live || changed) return loadDms(); }).finally(() => { dmPollBusy = false; });
  }, 4000);
  watchChat();
  startClocks();
  startPresence();
}

async function finishLogin(data) {
  if (!data || !data.token) throw new Error('Sign-in did not finish. Try again.');
  rememberAccount(data.user, data.token);
  localStorage.setItem('dc_token', data.token);
  ui.me = takeMe(data.user);
  ui.addingAccount = false;
  ui.mfa = null;
  ui.auth = 'login';
  ui.booting = false;
  ui.activity = { servers: {}, channels: {}, dms: {} };
  await reconnectGateway();
  await enterApp();
}

let holdTicket = '';
let holdVault = null;

function keepUnlock(data) {
  if (data.setup) {
    holdTicket = data.ticket;
    ui.auth = 'setup';
    ui.authOk = 'Choose a recovery code or a passphrase. You need it every time you sign in.';
    return true;
  }
  if (data.locked) {
    holdTicket = data.ticket;
    holdVault = data.vault;
    ui.auth = 'locked';
    ui.authOk = '';
    return true;
  }
  return false;
}

export async function login(email, password) {
  ui.authError = '';
  const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  if (data.mfa) {
    ui.mfa = { ticket: data.ticket, methods: data.methods || ['totp'], email };
    ui.auth = 'mfa';
    return;
  }
  if (keepUnlock(data)) return;
  await finishLogin(data);
}

export async function unlockAccount(secret) {
  const vault = await openVault(holdVault?.wrapped, holdVault?.salt, secret);
  if (!vault) throw new Error('That recovery code or passphrase is wrong');
  const check = await vaultCheck(vault);
  const data = await api('/api/auth/unlock', { method: 'POST', body: { ticket: holdTicket, check } });
  const local = loadVault(data.user.id);
  if (local) {
    vault.servers = { ...vault.servers, ...local.servers };
    vault.dms = { ...vault.dms, ...local.dms };
    vault.groups = { ...vault.groups, ...local.groups };
  }
  rememberVault(data.user.id, vault);
  rememberSecret(data.user.id, secret);
  await finishLogin(data);
  pushVault().catch(() => {});
}

export async function finishSetup(secret, kind, password) {
  const made = await createVault(secret);
  const view = password ? await lockSecret(password, secret) : null;
  const data = await api('/api/auth/setup', {
    method: 'POST',
    body: { ticket: holdTicket, wrapped: made.wrapped, salt: made.salt, check: made.check, pub: made.pub, kind, view },
  });
  rememberVault(data.user.id, made.vault);
  rememberSecret(data.user.id, secret);
  await finishLogin(data);
}

export async function saveRecovery(secret, kind, password) {
  const vault = loadVault(ui.me?.id);
  const previous = vault ? await vaultCheck(vault) : '';
  const packed = await wrapVault(vault, secret);
  const check = await vaultCheck(vault);
  const view = password ? await lockSecret(password, secret) : null;
  const data = await api('/api/me/recovery', {
    method: 'POST',
    body: { ...packed, check, pub: vault.pub, kind, previous, view, password },
  });
  rememberSecret(ui.me.id, secret);
  if (data.user) ui.me = takeMe({ ...ui.me, ...data.user });
}

export async function submitMfa(code) {
  ui.authError = '';
  const data = await api('/api/auth/mfa', { method: 'POST', body: { ticket: ui.mfa?.ticket, code } });
  if (keepUnlock(data)) return;
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
  if (keepUnlock(data)) return;
  await finishLogin(data);
}

export async function requestCode(email, username, password, secret, kind) {
  ui.authError = '';
  const cleanUser = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._]/g, '');
  if (cleanUser.endsWith('_bot')) throw new Error('Usernames cannot end with _bot');
  const made = await createVault(secret);
  const view = await lockSecret(password, secret);
  ui.pendingVault = { vault: made.vault, secret, wrapped: made.wrapped, salt: made.salt, check: made.check, pub: made.pub, kind, view };
  const data = await api('/api/auth/request-code', {
    method: 'POST',
    body: { email, username, password, wrapped: made.wrapped, salt: made.salt, check: made.check, pub: made.pub, kind, view },
  });
  if (data.token) {
    rememberVault(data.user.id, made.vault);
    rememberSecret(data.user.id, secret);
    await finishLogin(data);
    return;
  }
  ui.pending = { email, username, password };
  ui.auth = 'verify';
  ui.authOk = 'Code sent to ' + email;
}

export async function verify(code) {
  ui.authError = '';
  const made = ui.pendingVault;
  const data = await api('/api/auth/verify', {
    method: 'POST',
    body: {
      email: ui.pending.email,
      code,
      username: ui.pending.username,
      password: ui.pending.password,
      wrapped: made?.wrapped,
      salt: made?.salt,
      check: made?.check,
      pub: made?.pub,
      kind: made?.kind,
      view: made?.view,
    },
  });
  if (made) {
    rememberVault(data.user.id, made.vault);
    rememberSecret(data.user.id, made.secret);
  }
  rememberAccount(data.user, data.token);
  localStorage.setItem('dc_token', data.token);
  ui.me = takeMe(data.user);
  ui.addingAccount = false;
  ui.pending = null;
  await reconnectGateway();
  await enterApp();
}

function resetSession() {
  stopTyping();
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
  ui.dmTyping = {};
  ui.voice = null;
  ui.voiceRooms = {};
  ui.activity = { servers: {}, channels: {}, dms: {} };
  ui.mode = 'friends';
  ui.chatLoading = true;
}

async function apiAs(token, path) {
  const res = await fetch(getApiBase() + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      'ngrok-skip-browser-warning': 'true',
      'bypass-tunnel-reminder': 'true',
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Session expired');
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function activateSaved(row) {
  try {
    const mod = await import('./voice.js');
    await mod.leaveVoice();
  } catch (_) {}
  resetSession();
  localStorage.setItem('dc_token', row.token);
  ui.booting = true;
  ui.addingAccount = false;
  ui.switchPrompt = false;
  ui.switchHold = null;
  await reconnectGateway();
  try {
    const data = await api('/api/me');
    ui.me = takeMe(data.user);
    rememberAccount(data.user, row.token);
    warmMedia([data.user?.avatarUrl, data.user?.bannerUrl]);
    primeMedia([data.user?.avatarUrl, data.user?.bannerUrl]);
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

export async function switchAccount(id) {
  const row = savedAccounts().find((item) => item.id === id);
  if (!row) throw new Error('That account is not saved');
  if (ui.me && row.id === ui.me.id) return;
  let data;
  try {
    data = await apiAs(row.token, '/api/me/vault');
  } catch (err) {
    throw new Error(err.message === 'Session expired' ? 'That account needs to log in again' : err.message);
  }
  const vault = data && data.vault;
  if (!vault || !vault.wrapped || !vault.salt) {
    await activateSaved(row);
    return;
  }
  ui.switchHold = {
    id: row.id,
    token: row.token,
    name: row.displayName || row.username || 'this account',
    wrapped: vault.wrapped,
    salt: vault.salt,
  };
  ui.authError = '';
  ui.authOk = '';
  if (ui.me) ui.switchPrompt = true;
  else ui.auth = 'locked';
}

export async function confirmSwitch(secret) {
  const hold = ui.switchHold;
  if (!hold) throw new Error('Pick an account first');
  const opened = await openVault(hold.wrapped, hold.salt, secret);
  if (!opened) throw new Error('That recovery code or passphrase is wrong');
  const local = loadVault(hold.id);
  if (local) {
    opened.servers = { ...opened.servers, ...local.servers };
    opened.dms = { ...opened.dms, ...local.dms };
    opened.groups = { ...opened.groups, ...local.groups };
  }
  rememberVault(hold.id, opened);
  rememberSecret(hold.id, secret);
  await activateSaved(hold);
}

export function cancelSwitch() {
  ui.switchPrompt = false;
  ui.switchHold = null;
  ui.authError = '';
  if (!ui.me && ui.auth === 'locked') ui.auth = 'login';
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
  disconnectGateway();
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
  return (inviteCodeFromUrl(window.location.href) || '').toLowerCase();
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
  queueRead(roomKey, prev, true);
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
  const secret = keyInLink(window.location.href);
  if (!slug || !ui.me) return;
  try {
    const data = await api('/api/invites/' + encodeURIComponent(slug) + '/join', { method: 'POST', body: {} });
    if (secret && data.server) keepServerKey(data.server.id, secret);
    const clean = new URL(window.location.href);
    clean.searchParams.delete('invite');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
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
    const nextIncoming = data.incoming || [];
    if (friendsReady && nextIncoming.length > (ui.incoming || []).length) playEvent('friend');
    friendsReady = true;
    ui.friends = data.friends || [];
    ui.incoming = nextIncoming;
    ui.outgoing = data.outgoing || [];
    ui.blocked = data.blocked || [];
    ui.suggested = data.suggested || [];
  } catch (_) {}
}

const heardDm = {};
const ackedDm = {};
const pendingDm = new Map();
let inboxReady = false;
let friendsReady = false;
let lastSentId = '';
let dmSerial = 0;

const dmSnippets = new Map();

function lineOf(msg) {
  if (!msg || msg.failed || msg.kind === 'clyde') return '';
  if (msg.kind === 'call') {
    if (msg.callMissed || msg.callToken === 'missed') return String(msg.authorId || msg.author?.id || '') === String(ui.me?.id) ? 'Call not answered' : 'Missed call';
    if (msg.callDeclined || msg.callToken === 'declined') return 'Call declined';
    if (Number(msg.callSeconds) > 0) return 'Call ended';
    return 'Call';
  }
  if (msg.locked) return 'Encrypted message';
  const text = String(msg.content || '').replace(/\[\[(?:gif|sticker|call):[^\]]+\]\]/g, '').trim();
  if (text) return text.slice(0, 140);
  if (msg.files && msg.files.length) return msg.files[0].name || 'Attachment';
  if (msg.poll) return msg.poll.question || 'Poll';
  return '';
}

function lastChatLine(list) {
  const rows = list || [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const msg = rows[i];
    if (!msg || msg.failed || msg.kind === 'clyde') continue;
    const preview = lineOf(msg);
    if (!preview) continue;
    const at = Date.parse(msg.createdAt);
    const local = String(msg.id || '').startsWith('local-');
    return {
      preview,
      updatedAt: Number.isFinite(at) ? at : Date.now(),
      lastId: local ? '' : (msg.id || ''),
    };
  }
  return null;
}

function noteOpenDm(list) {
  if (ui.mode !== 'dm' || !ui.dmUser || !ui.dmUser.id) return;
  const snap = lastChatLine(list);
  if (!snap) return;
  const id = String(ui.dmUser.id);
  dmSnippets.set(id, snap);
  const current = ui.dms || [];
  const row = current.find((dm) => dm.other && String(dm.other.id) === id);
  if (!row) return;
  if (row.preview === snap.preview && Number(row.updatedAt) === snap.updatedAt && (!snap.lastId || row.lastId === snap.lastId)) return;
  ui.dms = current.map((dm) => {
    if (!dm.other || String(dm.other.id) !== id) return dm;
    return { ...dm, preview: snap.preview, updatedAt: snap.updatedAt || dm.updatedAt, lastId: snap.lastId || dm.lastId };
  });
}

function applyDmSnippets(list) {
  return (list || []).map((row) => {
    const id = row.other && String(row.other.id || '');
    const snap = id && dmSnippets.get(id);
    if (!snap || !snap.preview) return row;
    const serverAt = Number(row.updatedAt) || 0;
    const newer = snap.updatedAt >= serverAt - 1500;
    const placeholder = !row.preview || row.preview === 'Encrypted message' || row.preview === 'Encrypted file';
    const same = snap.lastId && row.lastId && String(snap.lastId) === String(row.lastId);
    if (!newer && !(placeholder && (same || !row.lastId))) return row;
    return {
      ...row,
      preview: snap.preview,
      updatedAt: newer ? (snap.updatedAt || row.updatedAt) : row.updatedAt,
      lastId: snap.lastId || row.lastId,
    };
  });
}

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

function unseenInLog(userId, lastId) {
  const log = roomLogs.get('dm:' + userId);
  if (!lastId || !log || !log.length || !log[log.length - 1] || log[log.length - 1].id !== lastId) return null;
  const seenId = seenMap()['dm:' + userId];
  if (!seenId || seenId === lastId) return seenId === lastId ? 0 : null;
  const idx = log.findIndex((msg) => msg && msg.id === seenId);
  if (idx < 0) return null;
  let total = 0;
  for (let i = idx + 1; i < log.length; i += 1) {
    const msg = log[i];
    if (!msg || msg.failed || isMine(msg)) continue;
    total += 1;
  }
  return total;
}

export async function loadGroups() {
  try {
    const data = await api('/api/groups');
    ui.groups = data.groups || [];
  } catch (_) {}
}

let seenUploaded = '';
let activityListSig = '';

function seenStamp() {
  try { return localStorage.getItem(accountKey('nebula-seen')) || '{}'; }
  catch { return '{}'; }
}

export async function loadDms() {
  const serial = ++dmSerial;
  hydrateClosed();
  try {
    const seen = seenMap();
    const stamp = seenStamp();
    const seeded = localStorage.getItem(accountKey('nebula-dm-baseline')) === '1';
    let data;
    try {
      if (stamp === seenUploaded) data = await api('/api/dms');
      else {
        data = await api('/api/dms', { method: 'POST', body: { seen, seeded, client: readClientId } });
        seenUploaded = stamp;
      }
    } catch (_) {
      data = await api('/api/dms');
    }
    if (serial !== dmSerial) return;
    adoptRemoteSeen(seen, data.seen);
    const next = applyDmSnippets(mergeOpened(data.dms || []));
    if (!sameDms(ui.dms, next)) ui.dms = next;
    const warmIds = next.slice(0, 6).map((row) => row.other && row.other.id).filter(Boolean);
    setTimeout(() => { for (const id of warmIds) warmDm(id); }, 1200);
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
    const unread = {};
    for (const row of next) {
      const id = row.other && row.other.id;
      if (!id) continue;
      const key = 'dm:' + id;
      const stamp = String(row.lastId || headForDm(ui.heads, id) || '');
      const viewing = dmOpen(id);
      const own = (row.lastFrom && ui.me && String(row.lastFrom) === String(ui.me.id)) || (stamp && stamp === String(lastSentId || ''));
      const pendingCount = pendingDm.get(String(id)) ? pendingDm.get(String(id)).size : 0;
      if (viewing || own) {
        if (viewing && currentRoom() === key) {
          const newest = [...ui.messages].reverse().find((msg) => msg && msg.id && !msg.pending && !msg.failed && !String(msg.id).startsWith('local-'));
          if (newest) {
            advanceDmSeen(id, newest.id, true);
            rememberCaught(id, newest.id);
          }
        }
        if (stamp) {
          advanceDmSeen(id, stamp, true);
          rememberCaught(id, stamp);
        }
        pendingDm.delete(String(id));
        rememberDm(id, row.updatedAt || Date.now());
        heardDm[id] = stamp || seenForDm(seenMap(), id);
        ackedDm[id] = heardDm[id];
        continue;
      }
      if (dmIsRead(id, stamp) && pendingCount === 0) {
        heardDm[id] = stamp || heardDm[id];
        continue;
      }
      const fromList = row.unread != null && row.unread !== '' ? Number(row.unread) || 0 : 0;
      const fromActivity = Number(serverDmNotes[id] && serverDmNotes[id].unread) || 0;
      const exact = unseenInLog(id, row.lastId || '');
      const count = Math.max(fromList, fromActivity, pendingCount, exact || 0, stamp ? 1 : 0);
      if (count > 0) {
        unread[id] = { unread: count };
        if (inboxReady && stamp && heardDm[id] !== stamp) {
          const who = (row.other && (row.other.displayName || row.other.username)) || 'Someone';
          if (!roomMuted('dm:' + id)) noteArrival(stamp || key, who, 'New direct message', 'dm');
        }
      }
      if (stamp) heardDm[id] = stamp;
    }
    if (!sameNotes(ui.activity.dms, unread)) ui.activity = { ...ui.activity, dms: unread };
    if (ui.dmUser) {
      const row = next.find((dm) => dm.other && String(dm.other.id) === String(ui.dmUser.id));
      if (row && row.other) ui.dmUser = { ...ui.dmUser, ...row.other };
    }
    inboxReady = true;
  } catch (_) {}
}

function onDmSide() {
  return ui.mode === 'friends' || ui.mode === 'add' || ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'messages' || ui.mode === 'servers' || ui.mode === 'discover' || !!ui.quickOpen;
}

function refreshVoiceList() {
  import('./voice.js').then((mod) => mod.refreshVoiceRooms()).catch(() => {});
}

export function showFriends(tab) {
  const entering = !onDmSide();
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
  if (entering) {
    loadGroups();
    refreshVoiceList();
  }
  phoneChat();
}

export function showMessages() {
  leaveChat();
  ui.readHold = '';
  ui.mode = 'messages';
  ui.dmUser = null;
  ui.group = null;
  ui.thread = null;
  ui.dock = '';
  ui.menuOpen = false;
  applyTheme();
  phoneBrowse();
}

export function showServers() {
  leaveChat();
  ui.readHold = '';
  ui.mode = 'servers';
  ui.dmUser = null;
  ui.group = null;
  ui.thread = null;
  ui.dock = '';
  ui.menuOpen = false;
  applyTheme();
  phoneChat();
}

export function showDiscover() {
  leaveChat();
  ui.readHold = '';
  ui.mode = 'discover';
  ui.dmUser = null;
  ui.group = null;
  ui.thread = null;
  ui.dock = '';
  ui.menuOpen = false;
  applyTheme();
  phoneChat();
}

export function showAddFriend() {
  const entering = !onDmSide();
  leaveChat();
  ui.mode = 'add';
  ui.dmUser = null;
  applyTheme();
  if (entering) {
    loadDms();
    loadGroups();
    refreshVoiceList();
  }
  phoneChat();
}

function clearDmUnread(userId, lastId) {
  if (!userId) return;
  const id = String(userId);
  const row = (ui.dms || []).find((dm) => dm.other && String(dm.other.id) === id);
  const stamp = lastId || (row && row.lastId) || headForDm(ui.heads, id) || '';
  pendingDm.delete(id);
  if (stamp) {
    advanceDmSeen(id, stamp, true);
    rememberCaught(id, stamp);
  }
  const cursor = seenForDm(seenMap(), id) || stamp;
  if (cursor) {
    heardDm[id] = cursor;
    ackedDm[id] = cursor;
  }
  rememberDm(id, Date.now());
  if (ui.activity.dms[id]) {
    const dms = { ...ui.activity.dms };
    delete dms[id];
    ui.activity = { ...ui.activity, dms };
  }
  if (serverDmNotes[id]) {
    const notes = { ...serverDmNotes };
    delete notes[id];
    serverDmNotes = notes;
  }
  if (row && Number(row.unread)) {
    ui.dms = (ui.dms || []).map((dm) => dm.other && String(dm.other.id) === id ? { ...dm, unread: 0 } : dm);
  }
}

export function openQuick(user) {
  if (!user || !user.id) return;
  const same = ui.quickUser && String(ui.quickUser.id) === String(user.id);
  ui.quickUser = same ? { ...ui.quickUser, ...user } : user;
  ui.quickOpen = true;
  clearDmUnread(user.id);
}

export function closeQuick() {
  ui.quickOpen = false;
}

function openedDmStore() {
  try { return JSON.parse(localStorage.getItem(accountKey('nebula-open-dms')) || '[]'); }
  catch { return []; }
}

function pinOpenedDm(user) {
  if (!user || !user.id || (ui.me && String(user.id) === String(ui.me.id))) return;
  const slim = {
    id: user.id,
    username: user.username || '',
    displayName: user.displayName || user.username || '',
    avatarUrl: user.avatarUrl || '',
    avatarColor: user.avatarColor || '',
    bannerUrl: user.bannerUrl || '',
    status: user.status || '',
    canMessage: user.canMessage,
    canCall: user.canCall,
  };
  const rows = openedDmStore().filter((row) => row && String(row.id) !== String(user.id));
  rows.unshift(slim);
  try { localStorage.setItem(accountKey('nebula-open-dms'), JSON.stringify(rows.slice(0, 40))); } catch (_) {}
  if ((ui.dms || []).some((row) => row.other && String(row.other.id) === String(user.id))) return;
  ui.dms = [{ id: 'open:' + user.id, other: slim, updatedAt: Date.now(), preview: '', lastId: '', unread: 0 }, ...(ui.dms || [])];
}

function mergeOpened(list) {
  const extra = [];
  for (const user of openedDmStore()) {
    if (!user || !user.id) continue;
    if ((list || []).some((row) => row.other && String(row.other.id) === String(user.id))) continue;
    extra.push({ id: 'open:' + user.id, other: user, updatedAt: 0, preview: '', lastId: '', unread: 0 });
  }
  return extra.length ? [...(list || []), ...extra] : (list || []);
}

export function gateCall(person) {
  if (!person || person.canCall !== false) return false;
  ui.dialog = { kind: 'start-call', user: person, tone: relation(person.id) === 'friends' ? 'closed' : 'friends' };
  return true;
}

export async function openDm(user) {
  if (!user || !user.id) return;
  phoneChat();
  pinOpenedDm(user);
  const entering = !onDmSide();
  ui.readHold = '';
  const prev = currentRoom();
  const same = ui.mode === 'dm' && ui.dmUser && user && String(ui.dmUser.id) === String(user.id);
  if (!same) stopTyping();
  parkStream();
  ui.mode = 'dm';
  ui.dmUser = user;
  ui.dock = 'profile';
  if (user && user.id) {
    loadProfile(user.id).then((fresh) => {
      if (fresh && ui.dmUser && String(ui.dmUser.id) === String(fresh.id)) ui.dmUser = { ...ui.dmUser, ...fresh };
    }).catch(() => {});
  }
  ui.group = null;
  ui.thread = null;
  if (user && user.id) revealChat('dm:' + user.id);
  if (user && user.id) clearDmUnread(user.id);
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
  if (entering) {
    loadDms();
    loadGroups();
    refreshVoiceList();
  }
}

export async function openGroup(group) {
  phoneChat();
  if (!group || !group.id) return;
  const entering = !onDmSide();
  ui.readHold = '';
  const prev = currentRoom();
  const same = ui.mode === 'group' && ui.group && String(ui.group.id) === String(group.id);
  if (!same) stopTyping();
  parkStream();
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
  if (entering) {
    loadGroups();
    loadDms();
    refreshVoiceList();
  }
}

export async function openThread(thread) {
  if (!thread || !thread.id) return;
  phoneChat();
  const prev = currentRoom();
  const same = ui.mode === 'thread' && ui.thread && String(ui.thread.id) === String(thread.id);
  if (!same) stopTyping();
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
  stopTyping();
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
  if (leavingRoom) stopTyping();
  if (ui.mode === 'chat') snapServer(fromServer);
  if (leavingRoom) stashRoom(prev);
  if (id) ui.serverId = id;
  ui.mode = 'chat';
  if (!opts.keepDialog) phoneBrowse();
  ui.dmUser = null;
  ui.group = null;
  ui.thread = null;
  ui.dock = '';
  ui.menuOpen = false;
  ui.channelMenu = null;
  ui.picker = '';
  ui.reply = null;
  ui.editing = null;
  if (leavingRoom) {
    const known = restoreServer(target) || (target === fromServer ? fromChannel : '');
    if (known) ui.channelId = known;
    showCached(known ? 'ch:' + known : '');
  }
  if (voiceLeave) import('./voice.js').then((mod) => mod.leaveVoice()).catch(() => {});
  rememberServer(ui.serverId);
  const data = await api('/api/channels?serverId=' + encodeURIComponent(ui.serverId));
  ui.channels = data.channels || [];
  if (data.servers) ui.servers = data.servers;
  for (const server of data.servers || []) if (server.roomKey) keepServerKey(server.id, server.roomKey);
  if (data.server?.roomKey) keepServerKey(data.server.id, data.server.roomKey);
  ui.serverPerms = data.permissions || 0;
  ui.roles = data.roles || [];
  ui.categories = data.categories || [];
  ui.serverMeta = data.server || null;
  ui.theme = data.theme || null;
  ui.bannerUrl = data.bannerUrl || '';
  ui.about = data.about || '';
  ui.showLobby = !!data.showLobby;
  ui.links = data.links || [];
  ui.events = data.events || [];
  ui.rulesChannelId = data.rulesChannelId || '';
  ui.emoji = data.emoji || [];
  ui.stickers = data.stickers || [];
  ui.onboarding = data.onboarding || null;
  applyTheme();
  const current = ui.channels.find((c) => c.id === ui.channelId && c.type === 'text');
  const ch = current || ui.channels.find((c) => c.type === 'text' && !isVoiceRoom(c)) || ui.channels.find((c) => c.type === 'text') || ui.channels[0];
  const nextId = ch ? ch.id : '';
  if (nextId !== ui.channelId) {
    ui.channelId = nextId;
    showCached(nextId ? 'ch:' + nextId : '');
  }
  snapServer(ui.serverId);
  ui.seenMessageId = '';
  memberStamp = '';
  dropLive();
  const warming = (ui.channels || []).slice();
  const warmServer = ui.serverId;
  await Promise.all([loadMessages(), loadMembers()]);
  setTimeout(() => warmServerChannels(warming, warmServer), 1200);
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
    links: (ui.links || []).slice(),
    events: (ui.events || []).slice(),
    rulesChannelId: ui.rulesChannelId,
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
  ui.links = (snap.links || []).slice();
  ui.events = (snap.events || []).slice();
  ui.rulesChannelId = snap.rulesChannelId || '';
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
  for (const ch of (channels || []).filter((row) => row && row.type === 'text' && row.id !== ui.channelId).slice(0, 4)) warmChannel(ch.id, serverId);
}

function warmRoom(key, path) {
  if (!key || roomLogs.has(key) || warmSeen.has(key)) return;
  warmSeen.add(key);
  warmTail = warmTail.then(async () => {
    if (roomLogs.has(key)) return;
    try {
      const data = await api(path);
      if (!roomLogs.has(key)) roomLogs.set(key, data.messages || []);
      for (const msg of (data.messages || []).slice(-15)) {
        if (msg && (msg.kind === 'call' || isSealedText(msg.content))) revealMessage(msg).catch(() => {});
      }
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
  dismissCalls((ui.missedCalls || []).map((call) => call.id));
  ui.missedCalls = [];
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

export function parkStream() {
  if (!ui.voice || !ui.streamUi || ui.streamUi.view === 'off') return;
  const live = !!(ui.voice.sharing || ui.screen?.local || ui.screen?.remote);
  if (!live) return;
  if (ui.streamUi.view !== 'mini') ui.streamUi = { ...ui.streamUi, view: 'mini', watching: true };
}

export function phoneChat() {
  ui.phone = 'chat';
}

export function phoneBrowse() {
  ui.phone = 'browse';
}

export function isVoiceRoom(ch) {
  return String(ch?.topic || '').startsWith('voice-chat:');
}

function voiceRoomName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 32);
}

export async function openVoiceRoom(voiceChannel) {
  if (!voiceChannel || !ui.serverId) return;
  const marker = 'voice-chat:' + voiceChannel.id;
  let room = (ui.channels || []).find((row) => row.type === 'text' && row.topic === marker);
  if (!room) {
    const base = voiceRoomName(voiceChannel.name) || 'general';
    const taken = new Set((ui.channels || []).filter((row) => row.type === 'text').map((row) => row.name));
    let name = base;
    if (taken.has(name)) {
      const short = String(voiceChannel.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'voice';
      name = (base + '-' + short).slice(0, 32);
      if (taken.has(name)) name = ('voice-' + short).slice(0, 32);
    }
    const data = await api('/api/servers/' + encodeURIComponent(ui.serverId) + '/channels', {
      method: 'POST',
      body: { name, topic: marker, type: 'text' },
    });
    room = data.channel;
    if (room && !(ui.channels || []).some((row) => row.id === room.id)) ui.channels = [...ui.channels, room];
  }
  if (!room) throw new Error('Could not open that voice chat');
  ui.voiceStage = { id: voiceChannel.id, name: voiceChannel.name };
  ui.streamUi = { ...(ui.streamUi || {}), view: 'wide', hideChat: false };
  if (room.id === ui.channelId && ui.mode === 'chat') return;
  stopTyping();
  const prev = currentRoom();
  if (ui.mode === 'chat') snapServer(ui.serverId);
  stashRoom(prev);
  ui.mode = 'chat';
  ui.dmUser = null;
  ui.channelId = room.id;
  ui.seenMessageId = '';
  ui.picker = '';
  ui.reply = null;
  ui.editing = null;
  showCached('ch:' + room.id);
  snapServer(ui.serverId);
  dropLive();
  await loadMessages();
}

export function pickChannel(ch) {
  if (!ch || ch.type !== 'text') return;
  ui.voiceStage = null;
  phoneChat();
  if (ch.id === ui.channelId && ui.mode === 'chat') return;
  stopTyping();
  parkStream();
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

function roomWatch() {
  if (ui.mode === 'dm' && ui.dmUser) return { dmUserId: ui.dmUser.id };
  if (ui.mode === 'group' && ui.group) return { groupId: ui.group.id };
  if (ui.mode === 'thread' && ui.thread) return { threadId: ui.thread.id };
  if (ui.mode === 'chat' && ui.channelId) return { channelId: ui.channelId, serverId: ui.serverId || '' };
  return {};
}

function viewingRoom(roomId) {
  if (!roomId || !ui.me) return false;
  if (ui.mode === 'chat') return roomId === ui.channelId;
  if (ui.mode === 'dm' && ui.dmUser) return roomId === 'dm:' + [ui.me.id, ui.dmUser.id].sort().join(':');
  if (ui.mode === 'group' && ui.group) return roomId === 'group:' + ui.group.id;
  if (ui.mode === 'thread' && ui.thread) return roomId === 'thread:' + ui.thread.id;
  return false;
}

function typingHere(data) {
  const roomId = String((data && data.roomId) || '');
  if (viewingRoom(roomId)) return true;
  if (ui.mode === 'dm' && ui.dmUser) {
    const id = String(ui.dmUser.id || '');
    if (id && roomId.split(':').includes(id)) return true;
    if ((data.typers || []).some((row) => row && String(row.id) === id)) return true;
  }
  return false;
}

function noteTypingEvent(data) {
  const roomId = String((data && data.roomId) || '');
  const rows = Array.isArray(data && data.typers) ? data.typers : [];
  if (roomId.startsWith('dm:') && ui.me) {
    const otherId = roomId.split(':').slice(1).find((id) => id && id !== String(ui.me.id));
    if (otherId) {
      const hit = rows.find((row) => row && String(row.id) === String(otherId));
      const book = { ...(ui.dmTyping || {}) };
      if (hit) book[otherId] = { name: hit.name || 'Someone', until: Date.now() + 10000 };
      else delete book[otherId];
      ui.dmTyping = book;
    }
  }
  if (!typingHere(data)) return;
  acceptTypers(rows);
}

let dmCountTimer = 0;
function refreshDmCounts() {
  if (dmCountTimer) clearTimeout(dmCountTimer);
  dmCountTimer = setTimeout(() => {
    dmCountTimer = 0;
    pollActivity().then(() => loadDms());
  }, 250);
}

function pingDm(roomId, author, messageId) {
  const channel = String(roomId || '');
  if (!channel.startsWith('dm:') || !ui.me) return;
  if (viewingRoom(channel)) return;
  const otherId = channel.split(':').slice(1).find((id) => id && String(id) !== String(ui.me.id));
  if (!otherId || (author && String(author.id) === String(ui.me.id))) return;
  const stamp = String(messageId || '');
  if (stamp && ackedDm[otherId] === stamp) return;
  const bag = pendingDm.get(String(otherId)) || new Set();
  bag.add(stamp || ('tick:' + Date.now()));
  pendingDm.set(String(otherId), bag);
  const unread = Math.max(Number(ui.activity.dms?.[otherId]?.unread) || 0, bag.size);
  ui.activity = { ...ui.activity, dms: { ...ui.activity.dms, [otherId]: { unread } } };
  if (stamp && heardDm[otherId] !== stamp && !roomMuted(channel)) {
    const who = (author && (author.displayName || author.username)) || 'Someone';
    noteArrival(stamp, who, 'New direct message', 'dm');
    heardDm[otherId] = stamp;
  }
  warmDm(otherId);
  refreshDmCounts();
}

async function applySocketMessage(type, data) {
  if (type === 'TYPING') {
    noteTypingEvent(data);
    return;
  }
  if (data && data.message) revealMessage(data.message).catch(() => {});
  if (!viewingRoom(data && data.roomId)) {
    if (type === 'MESSAGE_CREATE') pingDm(data && (data.roomId || data.message?.channelId), data && data.message && data.message.author, data && data.message && data.message.id);
    return;
  }
  const roomKey = currentRoom().replace(/^ch:/, '') || ui.channelId;
  const logKey = currentRoom();
  if (type === 'MESSAGE_DELETE') {
    ui.messages = ui.messages.filter((msg) => msg && msg.id !== data.id);
    rememberLog(logKey, ui.messages);
    noteOpenDm(ui.messages);
    return;
  }
  const message = await revealMessage(data.message);
  if (!message || !message.id) return;
  const idx = ui.messages.findIndex((msg) => msg && msg.id === message.id);
  if (type === 'MESSAGE_UPDATE') {
    if (idx < 0) return;
    const next = ui.messages.slice();
    next[idx] = keepLocalMedia(ui.messages[idx], message);
    ui.messages = repairReplies(next);
    rememberLog(logKey, ui.messages);
    noteOpenDm(ui.messages);
    return;
  }
  const mine = ui.me && message.author && message.author.id === ui.me.id;
  let localIdx = idx;
  if (localIdx < 0 && mine) {
    localIdx = ui.messages.findIndex((msg) => msg && msg.pending && msg.author && msg.author.id === ui.me.id && String(msg.content || '') === String(message.content || ''));
  }
  if (localIdx >= 0) {
    const prev = ui.messages[localIdx];
    const next = ui.messages.slice();
    next[localIdx] = { ...keepLocalMedia(prev, carryLook(prev, message)), clientKey: prev.clientKey || prev.id, pending: false, failed: false };
    ui.messages = next.filter((msg, i) => i === localIdx || msg.id !== message.id);
    if (mine) {
      if (message.author && message.author.id) ui.typers = ui.typers.filter((row) => String(row.id) !== String(message.author.id));
      if (ui.readHold !== roomKey) markSeen(roomKey, message.id);
      ui.seenMessageId = message.id;
    }
  } else {
    ui.messages = [...ui.messages, message];
    paintNames([message]);
    if (message.author && message.author.id) ui.typers = ui.typers.filter((row) => String(row.id) !== String(message.author.id));
    if (ui.readHold !== roomKey) markSeen(roomKey, message.id);
    ui.seenMessageId = message.id;
    announceFresh(ui.messages, roomKey);
  }
  ui.messages = repairReplies(ui.messages);
  rememberLog(logKey, ui.messages);
  noteOpenDm(ui.messages);
  ui.chatLoading = false;
}

let alertTask = null;
let alertPending = false;
function noteSocketAlert(data) {
  const next = String((data && data.cursor) || '');
  const changed = !!alertCursor && next !== alertCursor;
  if (next) alertCursor = next;
  if (!changed) return;
  alertPending = true;
  if (alertTask) return;
  alertTask = (async () => {
    try {
      while (alertPending) {
        alertPending = false;
        if (document.hidden) break;
        await pollActivity();
        loadDms();
        loadGroups();
      }
    } finally {
      alertTask = null;
    }
  })();
}

function applySocket(packet) {
  const type = packet && packet.t;
  const data = (packet && packet.d) || {};
  if (type === 'READY' || type === 'RESUMED') {
    if (data.cursor) alertCursor = String(data.cursor);
    if (data.voice) import('./voice.js').then((mod) => mod.applyVoiceSnapshot(data.voice)).catch(() => {});
    return;
  }
  if (type === 'DISCONNECT') {
    import('./voice.js').then((mod) => mod.resetVoiceClock()).catch(() => {});
    return;
  }
  if (type === 'RESYNC') {
    const looking = ui.mode === 'chat' || ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'thread';
    if (looking) loadMessages();
    pollActivity();
    import('./voice.js').then((mod) => {
      mod.resetVoiceClock();
      return mod.pokeVoice();
    }).catch(() => {});
    return;
  }
  if (type === 'MESSAGE_CREATE' || type === 'MESSAGE_UPDATE' || type === 'MESSAGE_DELETE' || type === 'TYPING') {
    applySocketMessage(type, data);
    return;
  }
  if (type === 'MEMBERS') {
    if (ui.mode === 'chat' && data.serverId === ui.serverId) loadMembers(true);
    return;
  }
  if (type === 'PROFILES') {
    if (ui.mode === 'chat') loadMembers(true);
    else if (ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'thread') loadMessages(true);
    return;
  }
  if (type === 'ALERT') {
    noteSocketAlert(data);
    return;
  }
  if (type === 'READ') {
    noteRemoteRead(data);
    return;
  }
  if (type === 'VOICE') {
    import('./voice.js').then((mod) => mod.applyVoiceSnapshot(data)).catch(() => {});
    return;
  }
  if (type === 'PRESENCE') applyRemotePresence(data);
}

async function watchChat() {
  if (watchStarted) return;
  watchStarted = true;
  connectGateway();
  onGateway(applySocket);
  let followed = '';
  while (true) {
    const looking = !!localStorage.getItem('dc_token') && (ui.mode === 'chat' || ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'thread');
    if (gatewayReady()) {
      if (liveCtrl) {
        liveCtrl.abort();
        liveCtrl = null;
      }
      const query = looking ? roomWatch() : {};
      const key = JSON.stringify(query);
      if (key !== followed) {
        followed = key;
        subscribeGateway(query);
      }
      await sleep(400);
      continue;
    }
    followed = '';
    if (!looking || !gatewayStale()) {
      await sleep(400);
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
  const nameEffect = mine.nameEffect || ui.me.nameEffect || '';
  const nameFont = mine.nameFont || ui.me.nameFont || '';
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
    const nameEffect = member.nameEffect || msg.author.nameEffect || '';
    const nameFont = member.nameFont || msg.author.nameFont || '';
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
    if (ui.mode === 'dm') {
      if (!ui.dmUser || !ui.dmUser.id) {
        ui.messages = [];
        ui.typers = [];
        ui.chatLoading = false;
        return;
      }
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
    const list = await revealList(data.messages);
    paintNames(list);
    const newest = list[list.length - 1];
    if (previousId && newest && newest.id !== previousId && newest.author && newest.author.id) {
      ui.typers = ui.typers.filter((row) => String(row.id) !== String(newest.author.id));
    }
    const roomKey = currentRoom().replace(/^ch:/, '') || ui.channelId;
    const logKey = currentRoom();
    const hadReal = ui.messages.some((msg) => msg && !msg.pending && !msg.failed && !String(msg.id || '').startsWith('local-'));
    if (!list.length && hadReal) return 'same';
    if (newest && newest.id && ui.readHold !== roomKey) markSeen(roomKey, newest.id);
    const next = stitchLog(list, logKey);
    if (!sameLog(ui.messages, next)) ui.messages = next;
    rememberLog(logKey, next);
    noteOpenDm(next);
    ui.chatLoading = false;
    if (newest && newest.id) ui.seenMessageId = newest.id;
    announceFresh(list, roomKey);
    return 'changed';
  } catch (err) {
    if (serial !== pulseSerial) return 'skip';
    if (err && err.name === 'AbortError') throw err;
    if (!quiet && !deliveryTone(err.message) && !callTone(err.message)) toast(err.message);
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

export function deliveryTone(message) {
  const text = String(message || '');
  if (text.startsWith('They only accept links') || text.startsWith('They are not accepting links') || text === 'You cannot send links to this person') return 'links';
  if (text.startsWith('They only accept media') || text.startsWith('They are not accepting media') || text === 'You cannot send media to this person') return 'media';
  if (text.startsWith('They only accept messages')) return 'friends';
  if (text === 'You cannot message this person' || /cannot message|blocked/i.test(text)) return 'plain';
  return '';
}

export function callTone(message) {
  const text = String(message || '');
  if (text.startsWith('They are not accepting')) return 'closed';
  if (text.startsWith('They only accept calls') || text === 'You cannot call this person' || /cannot call/i.test(text)) return 'friends';
  return '';
}

export function showUndelivered(tone) {
  ui.messages = [...ui.messages, {
    id: 'local-clyde-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    clientKey: 'local-clyde-' + Math.random().toString(36).slice(2),
    kind: 'clyde',
    tone: tone === 'friends' || tone === 'links' || tone === 'media' ? tone : 'plain',
    roomKey: currentRoom(),
    createdAt: new Date().toISOString(),
  }];
}

function stitchLog(list, roomKey) {
  const pending = ui.messages.filter((msg) => msg && String(msg.id || '').startsWith('local-') && (msg.roomKey === roomKey || !msg.roomKey));
  const used = new Set();
  const stitched = list.map((msg) => {
    const saved = ui.messages.find((row) => row && row.clientKey && row.id === msg.id);
    if (saved) return { ...carryLook(saved, msg), clientKey: saved.clientKey };
    const local = pending.find((row) => !used.has(row.clientKey) && row.author && msg.author && row.author.id === msg.author.id && String(row.content || '') === String(msg.content || ''));
    if (!local) return msg;
    used.add(local.clientKey);
    return { ...carryLook(local, msg), clientKey: local.clientKey };
  });
  const leftover = pending.filter((row) => row.clientKey && !used.has(row.clientKey) && !stitched.some((msg) => msg.id === row.id));
  return leftover.length ? [...stitched, ...leftover] : stitched;
}

function messageAuthor(user) {
  if (!user) return user;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || '',
    avatarColor: user.avatarColor || '',
    nameEffect: user.nameEffect || '',
    nameFont: user.nameFont || '',
    nameColors: user.nameColors || [],
    badges: user.badges,
    staff: user.staff || '',
    developer: !!user.developer,
    showcase: user.showcase || null,
    showcaseBadge: user.showcaseBadge || '',
  };
}

function carryLook(prev, message) {
  const before = prev && prev.author;
  const after = message && message.author;
  if (!before || !after) return message;
  return {
    ...message,
    author: {
      ...after,
      nameEffect: after.nameEffect || before.nameEffect || '',
      nameFont: after.nameFont || before.nameFont || '',
      nameColors: after.nameColors && after.nameColors.length ? after.nameColors : (before.nameColors || []),
    },
  };
}

function keepLocalMedia(prev, message) {
  if (!prev || !message) return message;
  const prevFiles = Array.isArray(prev.files) ? prev.files : [];
  const nextFiles = Array.isArray(message.files) ? message.files : [];
  if (!nextFiles.length) return prevFiles.length ? { ...message, files: prevFiles } : message;
  const files = nextFiles.map((file, index) => {
    const local = prevFiles[index];
    if (!local) return file;
    const voice = !!(local.voice || local.kind === 'audio' || file.voice || file.kind === 'audio');
    const next = { ...file };
    if (String(local.url || '').startsWith('blob:')) next.localUrl = local.localUrl || local.url;
    else if (local.localUrl) next.localUrl = local.localUrl;
    if (voice) {
      next.kind = 'audio';
      next.voice = 1;
      next.name = 'Voice message';
    }
    return next;
  });
  return { ...message, files };
}

function settleSent(tempId, message) {
  const next = ui.messages.slice();
  let idx = next.findIndex((msg) => msg && (msg.id === tempId || msg.clientKey === tempId || msg.id === message.id));
  if (idx < 0) {
    ui.messages = [...next.filter((msg) => msg.id !== message.id), { ...message, clientKey: tempId || message.id }];
  } else {
    const prev = next[idx];
    const key = prev.clientKey || tempId || prev.id;
    next[idx] = { ...keepLocalMedia(prev, carryLook(prev, message)), clientKey: key, pending: false, failed: false };
    ui.messages = next.filter((msg, i) => i === idx || (msg.id !== message.id && msg.id !== tempId && msg.clientKey !== key));
  }
  ui.messages = repairReplies(ui.messages);
  rememberLog(currentRoom(), ui.messages);
  noteOpenDm(ui.messages);
}

function looksLikeLink(content) {
  const text = String(content || '').replace(/\[\[(?:gif|sticker):[^\]]+\]\]/gi, ' ');
  if (/(?:https?:\/\/|www\.)\S+/i.test(text)) return true;
  return /(?:^|[\s(])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/i.test(text);
}

function withoutInvites(content) {
  return stripInviteText(content);
}

function shareProblem(content, files, people, where) {
  const inChannel = where && (where.mode === 'chat' || where.mode === 'thread');
  const link = looksLikeLink(inChannel ? withoutInvites(content) : content);
  const media = (files && files.length) || /\[\[(?:gif|sticker):/i.test(String(content || ''));
  for (const person of people || []) {
    if (!person || !ui.me || String(person.id) === String(ui.me.id)) continue;
    if (media && person.canSendMedia === false) return 'They are not accepting media';
    if (link && person.canSendLinks === false) return 'They are not accepting links';
  }
  return '';
}

function peopleFor(where) {
  if (where && Array.isArray(where.people) && where.people.length) {
    const picked = where.people.filter(Boolean);
    if (ui.me && !picked.some((person) => String(person.id) === String(ui.me.id))) picked.unshift(ui.me);
    return picked;
  }
  const people = [];
  const add = (person) => {
    if (!person?.id || people.some((row) => String(row.id) === String(person.id))) return;
    people.push(person);
  };
  add(ui.me);
  if (where.mode === 'dm') {
    const other = ui.dmUser && String(ui.dmUser.id) === String(where.dmUserId)
      ? ui.dmUser
      : (ui.dms || []).map((dm) => dm && dm.other).find((person) => person && String(person.id) === String(where.dmUserId));
    add(other);
  } else if (where.mode === 'group') {
    for (const member of ui.group?.members || []) add(member);
  } else {
    for (const member of ui.members || []) add(member);
  }
  return people;
}

let boxSync = null;

function sameRing(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((row, index) => row?.pub && row.pub === right[index]?.pub && row?.priv?.d && row.priv.d === right[index]?.priv?.d);
}

export async function publishBox() {
  if (!ui.me?.id) return;
  if (boxSync) return boxSync;
  boxSync = syncBox().finally(() => { boxSync = null; });
  return boxSync;
}

async function syncBox() {
  const id = ui.me.id;
  let remote = [];
  let supports = false;
  try {
    const data = await api('/api/me');
    if (data.user) {
      supports = Array.isArray(data.user.boxRing);
      remote = supports ? data.user.boxRing : [];
      ui.me = takeMe({ ...ui.me, ...data.user });
    }
  } catch (_) {}
  if (!ui.me?.id) return;
  const currentPub = ui.me.boxKey || '';
  const merged = [];
  const push = (row) => {
    if (!row?.priv || !row?.pub || merged.some((item) => item.pub === row.pub)) return;
    merged.push({ priv: row.priv, pub: row.pub });
  };
  remote.forEach(push);
  localKeys(id).forEach(push);
  if (!merged.length) {
    if (currentPub) return;
    await ensureBox(id);
    localKeys(id).forEach(push);
  }
  if (!merged.length) return;
  const match = merged.find((row) => row.pub === currentPub);
  const ordered = match ? [match, ...merged.filter((row) => row.pub !== currentPub)] : merged;
  saveKeys(id, ordered);
  const pub = ordered[0].pub;
  if (!supports) {
    if (currentPub) {
      ui.me = { ...ui.me, boxKey: currentPub };
      return;
    }
    const data = await api('/api/me', { method: 'PATCH', body: { boxKey: pub } });
    if (data.user) ui.me = takeMe({ ...ui.me, ...data.user, boxKey: data.user.boxKey || pub });
    else ui.me = { ...ui.me, boxKey: pub };
    return;
  }
  ui.me = { ...ui.me, boxKey: pub };
  const body = {};
  if (!sameRing(remote, ordered)) body.boxRing = ordered;
  if (currentPub !== pub) body.boxKey = pub;
  if (!Object.keys(body).length) return;
  const data = await api('/api/me', { method: 'PATCH', body });
  const ring = Array.isArray(data.user?.boxRing) ? data.user.boxRing : ordered;
  const kept = [];
  const keep = (row) => {
    if (!row?.priv || !row?.pub || kept.some((item) => item.pub === row.pub)) return;
    kept.push({ priv: row.priv, pub: row.pub });
  };
  ring.forEach(keep);
  ordered.forEach(keep);
  const nextPub = data.user?.boxKey || pub;
  const nextMatch = kept.find((row) => row.pub === nextPub);
  const next = nextMatch ? [nextMatch, ...kept.filter((row) => row.pub !== nextPub)] : kept;
  saveKeys(id, next);
  if (data.user) ui.me = takeMe({ ...ui.me, ...data.user, boxKey: nextPub });
}

function liveVault() {
  return ui.me?.id ? loadVault(ui.me.id) : null;
}

async function pushVault() {
  const vault = liveVault();
  const secret = ui.me?.id ? loadSecret(ui.me.id) : '';
  if (!vault || !secret) return;
  const packed = await wrapVault(vault, secret);
  const check = await vaultCheck(vault);
  await api('/api/me/recovery', {
    method: 'POST',
    body: { ...packed, check, pub: vault.pub, kind: ui.me.recovery || 'pass', previous: check },
  });
}

export function keepServerKey(serverId, roomKey) {
  const vault = liveVault();
  if (!vault || !serverId || !roomKey || vault.servers[serverId] === roomKey) return;
  vault.servers[serverId] = roomKey;
  rememberVault(ui.me.id, vault);
  pushVault().catch(() => {});
}

export function serverInvite(slug, serverId) {
  const id = serverId || ui.serverId;
  const listed = ui.settings && ui.settings.id === id && ui.settings.discover ? ui.settings.roomKey : '';
  const saved = liveVault()?.servers?.[id] || '';
  return inviteLink(slug, listed || saved);
}

async function keepWrap(bucket, id, pack) {
  const vault = liveVault();
  if (!vault || !pack || vault[bucket][id]) return vault?.[bucket]?.[id] || '';
  try {
    vault[bucket][id] = await unwrapKey(pack, vault.priv);
    rememberVault(ui.me.id, vault);
    pushVault().catch(() => {});
  } catch (_) {}
  return vault[bucket][id] || '';
}

async function roomMaster(where) {
  const vault = liveVault();
  if (!vault) throw new Error('Sign in with your recovery code or passphrase');
  const mode = where?.mode || ui.mode;
  if (mode === 'dm') {
    const otherId = where?.dmUserId || ui.dmUser?.id || '';
    const id = [ui.me.id, otherId].sort().join(':');
    if (vault.dms[id]) return vault.dms[id];
    const other = ui.dmUser && String(ui.dmUser.id) === String(otherId) ? ui.dmUser : null;
    const data = await api('/api/dms/' + encodeURIComponent(otherId) + '/messages');
    if (data.wraps && data.wraps[ui.me.id]) {
      const key = await keepWrap('dms', id, data.wraps[ui.me.id]);
      if (key) return key;
    }
    const pub = other?.vaultPub || data.other?.vaultPub || '';
    if (!pub) throw new Error('They need to set a recovery code before this chat can be encrypted');
    const key = newRoomKey();
    const wraps = {};
    wraps[ui.me.id] = await wrapKeyFor(key, vault.pub);
    wraps[otherId] = await wrapKeyFor(key, pub);
    vault.dms[id] = key;
    rememberVault(ui.me.id, vault);
    pushVault().catch(() => {});
    return { key, wraps };
  }
  if (mode === 'group') {
    const groupId = where?.groupId || ui.group?.id || '';
    if (vault.groups[groupId]) return vault.groups[groupId];
    const data = await api('/api/groups/' + encodeURIComponent(groupId) + '/messages');
    if (data.wraps && data.wraps[ui.me.id]) {
      const key = await keepWrap('groups', groupId, data.wraps[ui.me.id]);
      if (key) return key;
    }
    const members = data.group?.members || ui.group?.members || [];
    const key = newRoomKey();
    const wraps = {};
    wraps[ui.me.id] = await wrapKeyFor(key, vault.pub);
    for (const member of members) {
      if (member?.vaultPub && member.id !== ui.me.id) wraps[member.id] = await wrapKeyFor(key, member.vaultPub);
    }
    vault.groups[groupId] = key;
    rememberVault(ui.me.id, vault);
    pushVault().catch(() => {});
    return { key, wraps };
  }
  const serverId = where?.serverId || ui.serverId;
  if (vault.servers[serverId]) return vault.servers[serverId];
  const known = (ui.servers || []).find((server) => server.id === serverId);
  if (known?.roomKey) {
    keepServerKey(serverId, known.roomKey);
    return known.roomKey;
  }
  throw new Error('Open the invite link that contains this server’s key');
}

function masterOf(value) {
  return value && typeof value === 'object' ? value.key : value;
}

export async function roomKey(where) {
  return masterOf(await roomMaster(where));
}

export async function prepareRoom(where) {
  try { await roomMaster(where); } catch (_) {}
}

export async function sealRoomText(where, text) {
  const packed = await roomMaster(where);
  return {
    content: await sealText(masterOf(packed), text),
    wraps: packed && packed.wraps,
  };
}

const CALL_NOTE = /^\[\[call:(ring|missed|declined|\d{1,6})\]\]$/;
const closedCallNotes = new Set();

function dismissedCalls() {
  try { return new Set(JSON.parse(localStorage.getItem(accountKey('nebula-call-seen')) || '[]')); }
  catch { return new Set(); }
}

function dismissCalls(ids) {
  const set = dismissedCalls();
  for (const id of ids || []) if (id) set.add(String(id));
  try { localStorage.setItem(accountKey('nebula-call-seen'), JSON.stringify([...set].slice(-200))); } catch (_) {}
}

const seenCallNotes = [];

function rememberCall(message) {
  if (!message || message.kind !== 'call' || !message.id) return;
  const idx = seenCallNotes.findIndex((row) => row.id === message.id);
  if (idx >= 0) seenCallNotes[idx] = message;
  else seenCallNotes.push(message);
  refreshMissed();
}

function refreshMissed() {
  const hidden = dismissedCalls();
  const now = Date.now();
  ui.missedCalls = seenCallNotes.filter((msg) => {
    if (!msg || hidden.has(String(msg.id))) return false;
    if (String(msg.authorId || msg.author?.id || '') === String(ui.me?.id || '')) return false;
    if (msg.callMissed || msg.callToken === 'missed') return true;
    return msg.callToken === 'ring' && now - Date.parse(msg.createdAt || '') > 30000;
  }).slice(-20).reverse().map((msg) => ({
    id: msg.id,
    at: msg.createdAt,
    from: msg.author,
    channelId: msg.channelId,
  }));
}

function decorateCall(message, content) {
  const match = String(content || '').match(CALL_NOTE);
  if (!match) return null;
  const token = match[1];
  const next = {
    ...message,
    content: '',
    kind: 'call',
    callToken: token,
    callSeconds: /^\d+$/.test(token) ? Number(token) : 0,
    callMissed: token === 'missed',
    callDeclined: token === 'declined',
    locked: false,
  };
  rememberCall(next);
  return next;
}

function callWhere(channelId) {
  const channel = String(channelId || '');
  if (channel.startsWith('dm:')) {
    const other = channel.slice(3).split(':').find((id) => id && id !== String(ui.me?.id || ''));
    return other ? { mode: 'dm', dmUserId: other } : null;
  }
  if (channel.startsWith('group:')) return { mode: 'group', groupId: channel.slice(6) };
  return null;
}

export async function postCallNote(where, text) {
  const packed = await roomMaster(where);
  const body = { content: await sealText(masterOf(packed), text) };
  if (packed && packed.wraps) body.wraps = packed.wraps;
  const data = where.mode === 'group'
    ? await api('/api/groups/' + encodeURIComponent(where.groupId) + '/messages', { method: 'POST', body })
    : await api('/api/dms/' + encodeURIComponent(where.dmUserId) + '/messages', { method: 'POST', body });
  return (data.message && data.message.id) || '';
}

export async function writeCallNote(where, text, messageId) {
  if (!messageId || closedCallNotes.has(messageId)) return;
  closedCallNotes.add(messageId);
  try {
    const packed = await roomMaster(where);
    const content = await sealText(masterOf(packed), text);
    await api('/api/messages/' + encodeURIComponent(messageId), { method: 'PATCH', body: { content } });
  } catch (err) {
    closedCallNotes.delete(messageId);
    throw err;
  }
}

export async function sealCallStart(where) {
  const packed = await roomMaster(where);
  return {
    content: await sealText(masterOf(packed), '[[call:ring]]'),
    wraps: packed && packed.wraps,
  };
}

async function revealMessage(message) {
  if (!message) return message;
  if (message.seal && !String(message.content || '').trim()) return null;
  let content = message.content || '';
  if (!isSealedText(content)) {
    if (message.kind === 'call') rememberCall(message);
    return { ...message, locked: false };
  }
  try {
    const channel = String(message.channelId || '');
    let where = null;
    if (channel.startsWith('dm:')) where = { mode: 'dm', dmUserId: channel.slice(3).split(':').find((id) => id !== ui.me?.id) || '' };
    else if (channel.startsWith('group:')) where = { mode: 'group', groupId: channel.slice(6) };
    else where = { mode: 'chat', serverId: ui.serverId };
    const key = masterOf(await roomMaster(where));
    content = await openText(key, content);
    return decorateCall(message, content) || { ...message, content, locked: false };
  } catch (_) {
    return { ...message, content: '', locked: true };
  }
}

function previewText(content) {
  const text = String(content || '').replace(/\[\[(?:gif|sticker):[^\]]+\]\]/g, '').trim();
  if (!text || isSealedText(text)) return '';
  return text.slice(0, 140);
}

function repairReplies(list) {
  const byId = new Map((list || []).map((msg) => [msg && msg.id, msg]));
  return (list || []).map((msg) => {
    if (!msg || (!msg.replies && !msg.reply)) return msg;
    const rows = Array.isArray(msg.replies) && msg.replies.length ? msg.replies : (msg.reply ? [msg.reply] : []);
    const replies = rows.map((reply) => {
      if (!reply) return reply;
      const src = byId.get(reply.id);
      const fromSrc = src && !src.locked ? previewText(src.content) : '';
      if (fromSrc) return { ...reply, preview: fromSrc };
      if (!isSealedText(reply.preview)) return reply;
      if (src && src.files && src.files.length) {
        return { ...reply, preview: src.files.some((file) => file && file.kind === 'audio') ? 'Voice message' : 'Attachment' };
      }
      return { ...reply, preview: 'Message' };
    });
    return { ...msg, replies, reply: replies[0] || null };
  });
}

export async function revealList(list) {
  const opened = [];
  for (const msg of list || []) {
    const next = await revealMessage(msg);
    if (next) opened.push(next);
  }
  return repairReplies(opened);
}

async function postMessage(payload, target) {
  const content = String(payload.content || '').trim();
  const files = payload.files || [];
  const poll = payload.poll || null;
  if (!content && !files.length && !poll) return;
  const where = target || { mode: ui.mode, channelId: ui.channelId, dmUserId: ui.dmUser?.id || '', groupId: ui.group?.id || '', threadId: ui.thread?.id || '' };
  const typingToken = stopTyping(false);
  const body = { typingToken };
  if (where.serverId) body.serverId = where.serverId;
  if (content) {
    const blocked = shareProblem(content, files, peopleFor(where), where);
    if (blocked) throw new Error(blocked);
  }
  if (content || files.some((file) => file && file.enc)) {
    const packed = await roomMaster(where);
    if (content) body.content = await sealText(masterOf(packed), content);
    if (packed && packed.wraps) body.wraps = packed.wraps;
  }
  if (files.length) body.files = files;
  if (poll) body.poll = poll;
  if (payload.forwardName) body.forwardName = payload.forwardName;
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
    settleSent(payload.replaceId, await revealMessage(data.message));
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
      const packed = await roomMaster();
      const data = await api('/api/messages/' + encodeURIComponent(id), { method: 'PATCH', body: { content: await sealText(masterOf(packed), content) } });
      const opened = data.message ? await revealMessage(data.message) : null;
      if (opened) ui.messages = ui.messages.map((msg) => msg.id === id ? opened : msg);
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
    clientKey: tempId,
    pending: true,
    roomKey,
    createdAt: new Date().toISOString(),
    author: messageAuthor(ui.me),
    content,
    reply: replies[0] || null,
    replies,
  }];
  noteOpenDm(ui.messages);
  try {
    await postMessage({ content, replies, replaceId: tempId });
  } catch (err) {
    const tone = deliveryTone(err.message);
    if (tone) {
      patchLocal(tempId, () => ({ pending: false, failed: false }));
      showUndelivered(tone);
      return;
    }
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
  noteOpenDm(ui.messages);
  if (roomHeard[roomKey] === messageId) {
    const last = ui.messages[ui.messages.length - 1];
    roomHeard[roomKey] = last ? last.id : '';
  }
  dropLive();
}

export async function forwardMessage(messageId, target) {
  const src = ui.messages.find((msg) => msg.id === messageId);
  if (src && src.content) {
    let people = null;
    let where = null;
    if (target.userId) {
      people = [{ id: ui.me.id, canSendLinks: true, canSendMedia: true }, { id: target.userId, canSendLinks: target.canSendLinks, canSendMedia: target.canSendMedia }];
      where = { mode: 'dm', dmUserId: target.userId, channelId: '', groupId: '', threadId: '', people };
    } else if (target.channelId) {
      const data = await api('/api/members?serverId=' + encodeURIComponent(target.serverId || ''));
      people = data.members || [];
      where = { mode: 'chat', channelId: target.channelId, dmUserId: '', groupId: '', threadId: '', people };
    }
    if (where) {
      await postMessage({ content: src.content, files: src.files || [], forwardName: src.author?.displayName || src.author?.username || '' }, where);
      if (target.userId) loadDms();
      return;
    }
  }
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
      voice: !!item.voice || item.name === 'Voice message',
    };
  }).filter((item) => item.file);
  if (!files.length) return false;
  ui.attachOpen = false;
  const content = ui.composer.trim();
  const replies = (Array.isArray(ui.reply) ? ui.reply : (ui.reply ? [ui.reply] : [])).filter((row) => row && row.id).slice(0, 5);
  ui.composer = '';
  ui.reply = null;
  const roomKey = currentRoom() || ui.channelId;
  const target = { mode: ui.mode, channelId: ui.channelId, dmUserId: ui.dmUser?.id || '', groupId: ui.group?.id || '', serverId: ui.serverId || '' };
  const tempId = 'local-' + Math.random().toString(36).slice(2, 10);
  const locals = files.map((item) => ({
    url: URL.createObjectURL(item.file),
    name: item.name,
    alt: item.alt,
    spoiler: item.spoiler,
    kind: item.voice || item.name === 'Voice message' || fileKind(item.file) === 'audio' ? 'audio' : fileKind(item.file),
    voice: item.voice || item.name === 'Voice message' || fileKind(item.file) === 'audio' ? 1 : undefined,
    progress: 1,
  }));
  ui.messages = [...ui.messages, {
    id: tempId,
    clientKey: tempId,
    pending: true,
    roomKey,
    createdAt: new Date().toISOString(),
    author: messageAuthor(ui.me),
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
      if (blob.size > 25 * 1024 * 1024) throw new Error('Files can be up to 25 MB');
      report(i, 5);
      const kind = fileKind(blob);
      const voice = kind === 'audio' || files[i].voice || files[i].name === 'Voice message' || /^voice-message\./i.test(blob.name || '');
      const voiceType = /mp4|m4a|aac/i.test(blob.type || blob.name || '') ? 'audio/mp4' : 'audio/webm';
      const label = voice ? (voiceType === 'audio/mp4' ? 'voice-message.m4a' : 'voice-message.webm') : (files[i].name || blob.name || 'file');
      const packed = await roomMaster(target);
      const sealed = await sealFile(masterOf(packed), await blob.arrayBuffer(), label, voice ? voiceType : (blob.type || ''));
      const data = await uploadFile(new Blob([sealed], { type: 'application/octet-stream' }), (n) => report(i, Math.max(5, n)), 'file', '/api/upload?slot=file&chat=1&name=file');
      if (!data.url) throw new Error('The file did not upload');
      saved.push({
        url: data.url,
        name: voice ? 'Voice message' : 'file',
        enc: 1,
        spoiler: files[i].spoiler,
        kind: voice ? 'audio' : (kind === 'image' || kind === 'video' ? kind : 'file'),
        voice: voice ? 1 : undefined,
      });
      report(i, 100);
    }
    await postMessage({ content, files: saved, replies, replaceId: tempId }, target);
    return true;
  } catch (err) {
    const tone = deliveryTone(err.message);
    if (tone) {
      patchLocal(tempId, () => ({ pending: false, failed: false }));
      showUndelivered(tone);
      return false;
    }
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
    const tone = deliveryTone(err.message);
    if (tone) {
      showUndelivered(tone);
      return;
    }
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
  noteTyping();
}

export async function loadPacks() {
  try {
    const data = await api('/api/media');
    ui.packs = data.packs || [];
  } catch (_) {}
}

export async function moveChannel(channelId, dir) {
  const ch = (ui.channels || []).find((row) => row.id === channelId);
  if (!ch) return;
  const list = ui.channels.filter((row) => row.type === ch.type && (row.categoryId || '') === (ch.categoryId || ''));
  const at = list.findIndex((row) => row.id === ch.id);
  const target = dir === 'up' ? list[at - 1] : list[at + 1];
  if (!target) return;
  await placeChannel(ch, target);
}

export async function placeChannel(ch, target) {
  if (!ch || !target || ch.id === target.id) return;
  if (ch.type !== target.type || (ch.categoryId || '') !== (target.categoryId || '')) return;
  const from = ui.channels.findIndex((row) => row.id === ch.id);
  const to = ui.channels.findIndex((row) => row.id === target.id);
  if (from < 0 || to < 0 || from === to) return;
  const previous = ui.channels.slice();
  const next = ui.channels.slice();
  const [row] = next.splice(from, 1);
  let dest = next.findIndex((item) => item.id === target.id);
  if (from < to) dest += 1;
  next.splice(dest, 0, row);
  ui.channels = next;
  ui.channelMenu = null;
  const steps = Math.abs(to - from);
  const way = to > from ? 'down' : 'up';
  try {
    for (let i = 0; i < steps; i += 1) {
      await guildAction({ type: 'move-channel', channelId: ch.id, dir: way });
    }
  } catch (err) {
    toast(err.message);
    try {
      const data = await api('/api/channels?serverId=' + encodeURIComponent(ui.serverId));
      ui.channels = data.channels || previous;
    } catch (_) {
      ui.channels = previous;
    }
  }
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
let typingStopTimer = 0;

function typingTokenNow() {
  const now = Date.now();
  typingSerial = now > typingSerial ? now : typingSerial + 1;
  return typingSerial;
}
const typerSeen = new Map();

setInterval(() => {
  const now = Date.now();
  if (ui.typers.length) {
    const next = ui.typers.filter((row) => now - (typerSeen.get(row.id) || 0) < 12000);
    if (next.length !== ui.typers.length) {
      for (const row of ui.typers) if (!next.includes(row)) typerSeen.delete(row.id);
      ui.typers = next;
    }
  }
  const book = ui.dmTyping || {};
  let changed = false;
  const kept = {};
  for (const [id, row] of Object.entries(book)) {
    if (row && row.until > now) kept[id] = row;
    else changed = true;
  }
  if (changed) ui.dmTyping = kept;
}, 400);

function typingBody() {
  if (ui.mode === 'dm') return { dmUserId: ui.dmUser?.id };
  if (ui.mode === 'group') return { groupId: ui.group?.id };
  if (ui.mode === 'thread') return { threadId: ui.thread?.id };
  return { channelId: ui.channelId, serverId: ui.serverId };
}

function postTyping(extra) {
  if (ui.mode === 'dm' && !ui.dmUser?.id) return;
  if (ui.mode === 'group' && !ui.group?.id) return;
  if (ui.mode === 'thread' && !ui.thread?.id) return;
  if (ui.mode === 'chat' && !ui.channelId) return;
  api('/api/typing', { method: 'POST', body: { ...typingBody(), ...extra } }).catch(() => {});
}

function stopTyping(notify = false) {
  if (typingStopTimer) {
    clearTimeout(typingStopTimer);
    typingStopTimer = 0;
  }
  const token = typingTokenNow();
  if (notify && typingLive) postTyping({ stop: true, token });
  typingLive = false;
  lastTypingPing = 0;
  return token;
}

function markTyping() {
  if (typingStopTimer) {
    clearTimeout(typingStopTimer);
    typingStopTimer = 0;
  }
  const now = Date.now();
  if (typingLive && now - lastTypingPing < 8000) return;
  lastTypingPing = now;
  typingLive = true;
  postTyping({ token: typingTokenNow() });
}

export function noteKeyDown(event) {
  if (!event || event.isComposing) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Enter') return;
  const edits = event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete';
  if (!edits) return;
  if ((event.key === 'Backspace' || event.key === 'Delete') && !String(ui.composer || '').trim()) return;
  markTyping();
}

export function noteKeyUp() {}

export function noteTypingBlur() {}

export function typingLine(list) {
  const names = (list || []).map((row) => row && row.name).filter(Boolean);
  if (names.length === 1) return { kind: 'one', names };
  if (names.length === 2) return { kind: 'two', names };
  if (names.length > 2) return { kind: 'many', names };
  return { kind: '', names: [] };
}

export function noteTyping(text) {
  const value = text == null ? ui.composer : text;
  if (String(value || '').trim()) markTyping();
}

function acceptTypers(list) {
  const now = Date.now();
  const me = ui.me ? String(ui.me.id) : '';
  const rows = (Array.isArray(list) ? list : []).filter((row) => row && String(row.id) !== me);
  const ids = new Set(rows.map((row) => row && row.id).filter(Boolean));
  for (const id of [...typerSeen.keys()]) if (!ids.has(id)) typerSeen.delete(id);
  for (const row of rows) if (row && row.id) typerSeen.set(row.id, now);
  const prev = ui.typers;
  const same = rows.length === prev.length && rows.every((row, index) => prev[index] && prev[index].id === row.id && prev[index].name === row.name);
  if (!same) ui.typers = rows;
}

let clocksStarted = false;
let activityReady = false;
let mentionSnap = 0;
let dmSnap = 0;
let lastSound = 0;
const heardHeads = {};
const heardIds = new Set();

export function soundEnabled() {
  return notifySounds();
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
  unlockAudio();
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
  playEvent('message', { preview: !!force });
}

let lastSpam = 0;
const burstTimes = [];

function playSpam() {
  playEvent('message');
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

function noteArrival(id, title, body, kind) {
  const key = String(id || '');
  if (!key || heardIds.has(key)) return;
  heardIds.add(key);
  if (heardIds.size > 500) heardIds.delete(heardIds.values().next().value);
  const now = Date.now();
  burstTimes.push(now);
  while (burstTimes.length && now - burstTimes[0] > 2500) burstTimes.shift();
  const event = kind || 'message';
  if (burstTimes.length >= 4) playEvent('message');
  else playEvent(event);
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
    const kind = mentioned ? 'mention' : (ui.mode === 'dm' ? 'dm' : ui.mode === 'group' ? 'group' : 'message');
    noteArrival(msg.id, mentioned ? who + ' mentioned you' : who, text, kind);
  }
  roomHeard[roomKey] = newest.id;
}

export function mentionsMessage(msg) {
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

const readClientId = Math.random().toString(36).slice(2);
const readQueue = new Map();
let readTimer = 0;

function queueRead(id, messageId, rewind) {
  if (!id) return;
  readQueue.set(id, { messageId: messageId || '', rewind: !!rewind });
  if (readTimer) return;
  readTimer = setTimeout(flushReads, 350);
}

function flushReads() {
  readTimer = 0;
  if (!readQueue.size) return;
  const reads = [];
  for (const [roomId, row] of readQueue) reads.push({ roomId, messageId: row.messageId, rewind: row.rewind });
  readQueue.clear();
  api('/api/read', { method: 'POST', body: { client: readClientId, reads } }).catch(() => {
    for (const row of reads) readAck.delete(row.roomId + '\n' + row.messageId);
  });
}

function dmPairKey(userId) {
  const me = ui.me && ui.me.id;
  if (!me || !userId) return '';
  return 'dm:' + [String(me), String(userId)].sort().join(':');
}

function dmKeys(userId) {
  const keys = ['dm:' + String(userId)];
  const pair = dmPairKey(userId);
  if (pair && pair !== keys[0]) keys.push(pair);
  return keys;
}

function seenForDm(map, userId) {
  if (!map || !userId) return '';
  const pair = dmPairKey(userId);
  return String(map['dm:' + userId] || (pair && map[pair]) || '');
}

function headForDm(heads, userId) {
  if (!heads || !userId) return '';
  const pair = dmPairKey(userId);
  return String(heads['dm:' + userId] || (pair && heads[pair]) || '');
}

function logForDm(userId) {
  const key = 'dm:' + String(userId);
  if (currentRoom() === key && ui.messages && ui.messages.length) return ui.messages;
  return roomLogs.get(key) || [];
}

function dmCovers(userId, seenId, latest) {
  const seen = String(seenId || '');
  const head = String(latest || '');
  if (!seen || !head) return false;
  if (seen === head) return true;
  const list = logForDm(userId);
  const atSeen = list.findIndex((msg) => msg && String(msg.id) === seen);
  const atHead = list.findIndex((msg) => msg && String(msg.id) === head);
  if (atSeen === -1 || atHead === -1) return false;
  return atSeen >= atHead;
}

const readAck = new Set();

function caughtMap() {
  try { return JSON.parse(localStorage.getItem(accountKey('nebula-dm-caught')) || '{}'); }
  catch { return {}; }
}

function rememberCaught(userId, stamp) {
  if (!userId || !stamp) return;
  const map = caughtMap();
  const id = String(userId);
  const next = String(stamp);
  const prev = Array.isArray(map[id]) ? map[id].map(String) : (map[id] ? [String(map[id])] : []);
  if (prev.includes(next)) return;
  map[id] = [...prev, next].slice(-8);
  try { localStorage.setItem(accountKey('nebula-dm-caught'), JSON.stringify(map)); } catch (_) {}
}

function wasCaught(userId, stamp) {
  const head = String(stamp || '');
  if (!head) return false;
  const row = caughtMap()[String(userId)];
  if (Array.isArray(row)) return row.map(String).includes(head);
  return String(row || '') === head;
}

function dmIsRead(userId, stamp) {
  const head = String(stamp || '');
  if (!head) return false;
  if (dmCovers(userId, seenForDm(seenMap(), userId), head)) return true;
  if (wasCaught(userId, head)) return true;
  if (ackedDm[userId] && String(ackedDm[userId]) === head) return true;
  return false;
}

function dmOpen(userId) {
  if (!userId) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  if (ui.userSettings || ui.serverSettings) return false;
  if (ui.phone === 'browse') return false;
  const id = String(userId);
  if (ui.mode === 'dm' && ui.dmUser && String(ui.dmUser.id) === id) return true;
  if (ui.quickOpen && ui.quickUser && String(ui.quickUser.id) === id) return true;
  return false;
}

function advanceDmSeen(userId, messageId, force) {
  if (!userId || !messageId) return;
  const id = String(userId);
  const map = seenMap();
  const current = seenForDm(map, id);
  const candidate = String(messageId);
  let next = candidate;
  if (current && current !== candidate) {
    if (dmCovers(id, current, candidate) || (!force && !dmCovers(id, candidate, current))) next = current;
  }
  let changed = false;
  for (const key of dmKeys(id)) {
    if (String(map[key] || '') !== next) {
      map[key] = next;
      changed = true;
    }
  }
  if (changed) saveSeen(map);
  heardDm[id] = next;
  ackedDm[id] = next;
  for (const key of dmKeys(id)) {
    const token = key + '\n' + next;
    if (readAck.has(token)) continue;
    readAck.add(token);
    queueRead(key, next, false);
  }
}

function readIsFurther(roomKey, current, next) {
  if (!current) return true;
  if (!next || current === next) return false;
  const logKey = roomKey.startsWith('dm:') || roomKey.startsWith('group:') || roomKey.startsWith('thread:') ? roomKey : 'ch:' + roomKey;
  const open = currentRoom() === logKey ? ui.messages : null;
  const list = open && open.length ? open : (roomLogs.get(logKey) || []);
  const from = list.findIndex((msg) => msg && msg.id === current);
  const to = list.findIndex((msg) => msg && msg.id === next);
  if (from === -1 || to === -1) return true;
  return to > from;
}

function adoptRemoteSeen(sent, remote) {
  if (!remote || typeof remote !== 'object') return;
  const map = seenMap();
  let changed = false;
  for (const [id, messageId] of Object.entries(remote)) {
    if (!messageId || map[id] === messageId) continue;
    if (map[id] !== (sent && sent[id])) continue;
    if (map[id] && !readIsFurther(id, map[id], messageId)) continue;
    map[id] = messageId;
    changed = true;
  }
  if (changed) saveSeen(map);
}

function noteRemoteRead(data) {
  const rows = data && Array.isArray(data.reads) ? data.reads : [];
  const map = seenMap();
  let changed = false;
  for (const row of rows) {
    if (!row || !row.roomId || (row.client && row.client === readClientId)) continue;
    const id = String(row.roomId);
    const messageId = String(row.messageId || '');
    if (row.rewind) {
      if (messageId) map[id] = messageId;
      else delete map[id];
      changed = true;
      continue;
    }
    if (!messageId || map[id] === messageId) continue;
    if (map[id] && !readIsFurther(id, map[id], messageId)) continue;
    map[id] = messageId;
    changed = true;
  }
  if (!changed) return;
  saveSeen(map);
  pollActivity();
  loadDms();
}

export async function deleteChannel(ch) {
  if (!ch) return;
  const label = ch.type === 'voice' ? ch.name : '#' + ch.name;
  if (!confirm('Delete ' + label + '?')) return;
  await api('/api/servers/' + ui.serverId + '/channels/' + ch.id, { method: 'DELETE' });
  if (ui.channelId === ch.id) ui.channelId = '';
  ui.channelMenu = null;
  await openServer(ui.serverId);
}

export function markChannelRead(id) {
  if (!id) return;
  const head = (ui.heads || {})[id];
  if (head) markSeen(id, head);
  else forgetActivity(id);
  ui.channelMenu = null;
}

function textChannels() {
  return (ui.channels || []).filter((ch) => ch && ch.type === 'text' && !isVoiceRoom(ch));
}

export function stepTextChannel(dir, unreadOnly) {
  if (ui.mode !== 'chat') return;
  const list = textChannels();
  const unread = list.filter((ch) => {
    const note = ui.activity?.channels?.[ch.id];
    return note && (note.unread || note.mentions) && ch.id !== ui.channelId;
  });
  const pool = unreadOnly ? unread : list;
  if (!pool.length) return;
  const idx = pool.findIndex((ch) => ch.id === ui.channelId);
  const at = idx < 0 ? (dir > 0 ? 0 : pool.length - 1) : (idx + dir + pool.length) % pool.length;
  const next = pool[at];
  if (next && next.id !== ui.channelId) pickChannel(next);
}

export function markServerRead() {
  if (ui.mode !== 'chat') return;
  for (const ch of textChannels()) markChannelRead(ch.id);
}

function chatInFront() {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState !== 'visible') return false;
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  if (ui.userSettings || ui.serverSettings) return false;
  if (ui.phone === 'browse') return false;
  return ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'chat' || ui.mode === 'thread';
}

export function catchUpRead() {
  if (!chatInFront()) return;
  const roomKey = currentRoom().replace(/^ch:/, '') || ui.channelId;
  if (!roomKey) return;
  const newest = [...(ui.messages || [])].reverse().find((msg) => msg && msg.id && !msg.pending && !msg.failed && !String(msg.id).startsWith('local-'));
  if (newest) markSeen(roomKey, newest.id);
}

export function markSeen(id, messageId) {
  if (!id || !messageId) return;
  if (String(id).startsWith('dm:')) {
    const userId = String(id).slice(3).split(':').find((part) => part && String(part) !== String(ui.me && ui.me.id)) || String(id).slice(3);
    if (!dmOpen(userId)) return;
    advanceDmSeen(userId, messageId, true);
    rememberCaught(userId, messageId);
    const row = (ui.dms || []).find((dm) => dm.other && String(dm.other.id) === String(userId));
    if (row && row.lastId) rememberCaught(userId, row.lastId);
    heardDm[userId] = String(messageId);
    ackedDm[userId] = String(messageId);
    pendingDm.delete(String(userId));
    if (serverDmNotes[userId]) {
      const notes = { ...serverDmNotes };
      delete notes[userId];
      serverDmNotes = notes;
    }
    forgetActivity('dm:' + userId);
    return;
  }
  if (!chatInFront()) return;
  const here = currentRoom().replace(/^ch:/, '') || ui.channelId;
  if (String(here || '') !== String(id) && currentRoom() !== String(id)) return;
  const map = seenMap();
  if (String(map[id] || '') !== String(messageId)) {
    map[id] = messageId;
    saveSeen(map);
    queueRead(id, messageId, false);
  }
  forgetActivity(id);
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', catchUpRead);
  document.addEventListener('visibilitychange', catchUpRead);
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

export async function pollActivity() {
  if (activityMissing) return;
  const serial = ++activitySerial;
  try {
    const sentSeen = seenMap();
    const stamp = seenStamp();
    const body = { seeded: localStorage.getItem(accountKey('nebula-dm-baseline')) === '1', client: readClientId };
    if (stamp !== seenUploaded) body.seen = sentSeen;
    const data = await api('/api/activity', { method: 'POST', body });
    if (body.seen) seenUploaded = stamp;
    const calls = data.calls || {};
    const ringing = (calls.incoming || []).filter((call) => !call.at || Date.now() - Number(call.at) < 22000);
    const nextRing = ringing[0] || null;
    if (nextRing && nextRing.id !== ui.incomingCall?.id) playEvent('call-in');
    else if (!nextRing && ui.incomingCall) playEvent('call-end');
    ui.incomingCall = nextRing;
    refreshMissed();
    for (const row of calls.outgoing || []) {
      if (row.status !== 'declined' || !row.messageId) continue;
      const where = callWhere(row.channelId);
      if (where) writeCallNote(where, '[[call:declined]]', row.messageId).catch(() => {});
    }
    const firstChannels = localStorage.getItem(accountKey('nebula-channel-baseline')) !== '1';
    if (firstChannels && data.heads) {
      const map = seenMap();
      const remote = data.seen && typeof data.seen === 'object' ? data.seen : {};
      const know = Object.keys(remote).length > 0;
      for (const [id, messageId] of Object.entries(remote)) {
        if (messageId) map[id] = messageId;
      }
      if (!know) {
        for (const [id, messageId] of Object.entries(data.heads)) {
          if (String(id).startsWith('dm:') || map[id] || !messageId) continue;
          map[id] = messageId;
        }
      }
      saveSeen(map);
      try { localStorage.setItem(accountKey('nebula-channel-baseline'), '1'); } catch (_) {}
      if (!know) {
        ui.activity = { ...ui.activity, servers: {}, channels: {} };
        return;
      }
    }
    adoptRemoteSeen(sentSeen, data.seen);
    if (serial !== activitySerial) return;
    const servers = { ...(data.servers || {}) };
    const channels = { ...(data.channels || {}) };
    const dms = { ...(data.dms || {}) };
    const headsIn = data.heads || {};
    const readNow = new Set();
    const dmHeads = {};
    for (const [roomKey, messageId] of Object.entries(headsIn)) {
      if (!String(roomKey).startsWith('dm:') || !messageId) continue;
      const other = String(roomKey).slice(3).split(':').find((part) => part && String(part) !== String(ui.me && ui.me.id));
      if (other) dmHeads[other] = String(messageId);
    }
    for (const userId of new Set([...Object.keys(dms), ...Object.keys(dmHeads)])) {
      const row = (ui.dms || []).find((dm) => dm.other && String(dm.other.id) === String(userId));
      const head = dmHeads[userId] || headForDm(headsIn, userId) || (row && row.lastId ? String(row.lastId) : '');
      const openHere = dmOpen(userId);
      const mine = !!(head && (String(lastSentId || '') === String(head) || (row && String(row.lastId || '') === String(head) && row.lastFrom && ui.me && String(row.lastFrom) === String(ui.me.id))));
      if (openHere || mine || dmIsRead(userId, head)) {
        if ((openHere || mine) && head) {
          advanceDmSeen(userId, head, true);
          rememberCaught(userId, head);
        }
        delete dms[userId];
        readNow.add(String(userId));
        if (head) heardDm[userId] = head;
      } else if (head) {
        const note = dms[userId];
        const count = Math.max(Number(note && note.unread) || 0, 1);
        dms[userId] = { ...(note || {}), unread: count };
        if (activityReady && heardDm[userId] !== head) {
          const who = (row && row.other && (row.other.displayName || row.other.username)) || 'Someone';
          if (!roomMuted('dm:' + userId)) noteArrival(head, who, 'New direct message', 'dm');
        }
        heardDm[userId] = head;
      }
    }
    if (chatInFront() && ui.mode === 'chat' && ui.channelId && channels[ui.channelId] && ui.readHold !== ui.channelId) {
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
    if (chatInFront() && ui.mode === 'dm' && ui.dmUser && ui.readHold !== 'dm:' + ui.dmUser.id) {
      delete dms[ui.dmUser.id];
      readNow.add(String(ui.dmUser.id));
    }
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
        noteArrival(messageId, 'Nebula', note && note.mentions ? 'You were mentioned' : 'New message', note && note.mentions ? 'mention' : 'message');
      }
    }
    activityReady = true;
    mentionSnap = mentions;
    dmSnap = dmUnread;
    ui.mentions = Array.isArray(data.inbox) ? data.inbox : [];
    ui.heads = data.heads || {};
    const mergedDms = { ...(ui.activity.dms || {}) };
    let dmChanged = false;
    for (const id of readNow) {
      if (mergedDms[id]) {
        delete mergedDms[id];
        dmChanged = true;
      }
    }
    for (const [id, note] of Object.entries(dms)) {
      const n = Number(note && note.unread) || 0;
      if (n > 0 && (!mergedDms[id] || mergedDms[id].unread !== n)) {
        mergedDms[id] = { unread: n };
        dmChanged = true;
      }
    }
    if (!sameNotes(ui.activity.servers, servers) || !sameNotes(ui.activity.channels, channels) || dmChanged) {
      ui.activity = { ...ui.activity, servers, channels, ...(dmChanged ? { dms: mergedDms } : {}) };
    }
    const heads = data.heads || {};
    for (const [id, note] of Object.entries(channels)) {
      if (!note || !note.unread) continue;
      const key = 'ch:' + id;
      const cached = roomLogs.get(key);
      if (!cached || !cached.length || (heads[id] && cached[cached.length - 1]?.id !== heads[id])) {
        roomLogs.delete(key);
        warmSeen.delete(key);
        warmChannel(id, note.serverId);
      }
    }
    for (const id of Object.keys(dms)) {
      const key = 'dm:' + id;
      const head = heads['dm:' + id];
      const cached = roomLogs.get(key);
      if (!cached || !cached.length || (head && cached[cached.length - 1]?.id !== head)) {
        roomLogs.delete(key);
        warmSeen.delete(key);
        warmDm(id);
      }
    }
    const listSig = JSON.stringify({ heads: data.heads || {}, dms: data.dms || {} });
    const listChanged = listSig !== activityListSig;
    activityListSig = listSig;
    return listChanged;
  } catch (err) {
    if (err && err.status === 404) activityMissing = true;
    return false;
  }
}

let presenceStarted = false;

function patchPerson(person, row) {
  if (!person || String(person.id) !== String(row.id)) return person;
  return { ...person, status: row.status, lastSeen: row.lastSeen, seen: row.seen, onlineUntil: row.onlineUntil };
}

function applyRemotePresence(row) {
  if (!row || !row.id) return;
  if (ui.me && String(ui.me.id) === String(row.id)) ui.me = patchPerson(ui.me, row);
  if (ui.dmUser) ui.dmUser = patchPerson(ui.dmUser, row);
  if (ui.popout?.user) ui.popout = { ...ui.popout, user: patchPerson(ui.popout.user, row) };
  if (ui.quickUser) ui.quickUser = patchPerson(ui.quickUser, row);
  ui.members = (ui.members || []).map((member) => patchPerson(member, row));
  ui.friends = (ui.friends || []).map((member) => patchPerson(member, row));
  ui.incoming = (ui.incoming || []).map((member) => patchPerson(member, row));
  ui.outgoing = (ui.outgoing || []).map((member) => patchPerson(member, row));
  ui.dms = (ui.dms || []).map((dm) => dm && dm.other ? { ...dm, other: patchPerson(dm.other, row) } : dm);
  if (ui.group && Array.isArray(ui.group.members)) {
    ui.group = { ...ui.group, members: ui.group.members.map((member) => patchPerson(member, row)) };
  }
}

function startPresence() {
  if (presenceStarted || typeof window === 'undefined') return;
  presenceStarted = true;
}

function startClocks() {
  if (clocksStarted) return;
  clocksStarted = true;
  pollActivity();
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
    if (gatewayReady()) {
      await sleep(1000);
      continue;
    }
    try {
      const data = await api('/api/alert?wait=1&cursor=' + encodeURIComponent(alertCursor));
      const voiceMod = await import('./voice.js').catch(() => null);
      if (voiceMod && data.voice) voiceMod.applyVoiceSnapshot(data.voice);
      const next = String(data.cursor || '');
      const changed = !!alertCursor && next !== alertCursor;
      alertCursor = next;
      if (changed && voiceMod && ui.voice) voiceMod.syncCall();
      if (changed && !document.hidden) {
        if (voiceMod && !ui.voice && !data.voice && (ui.mode === 'chat' || onDmSide())) voiceMod.refreshVoiceRooms();
        await pollActivity();
        loadDms();
        loadGroups();
      }
    } catch (err) {
      if (err && err.status === 404) alertMissing = true;
      else await sleep(1500);
    }
  }
}

export async function saveMe(body) {
  const previous = ui.me;
  const pending = { ...ui.me };
  for (const key of ['displayName', 'username', 'aliases', 'pronouns', 'bio', 'aboutMe', 'customStatus', 'status', 'nameEffect', 'nameFont', 'profileStyle', 'avatarColor', 'accentColor', 'showcaseServerId', 'showcaseBadge', 'songUrl', 'songStart', 'songAutoplay', 'timezone']) {
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
  ui.me = takeMe({
    ...previous,
    ...data.user,
    displayName: data.user?.displayName ?? body.displayName ?? previous?.displayName ?? '',
    aboutMe: data.user?.aboutMe ?? body.aboutMe ?? previous?.aboutMe ?? '',
    showcaseBadge: data.user?.showcaseBadge ?? body.showcaseBadge ?? previous?.showcaseBadge ?? '',
    nameEffect: data.user?.nameEffect || body.nameEffect || '',
    nameFont: data.user?.nameFont ?? body.nameFont ?? previous?.nameFont ?? '',
    profileStyle: data.user?.profileStyle || body.profileStyle || previous?.profileStyle || 'gradient',
    nameColors: data.user?.nameColors?.length ? data.user.nameColors : (body.nameColors || previous?.nameColors || []),
  });
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

const STAFF_ROLES = new Set(['owner', 'admin', 'manager', 'moderator', 'developer']);

export function canModerateMembers() {
  if (!ui.serverId || (ui.mode !== 'chat' && ui.mode !== 'thread')) return false;
  if (ui.serverMeta?.owner || hasPerm(PERM.ADMIN)) return true;
  const me = (ui.members || []).find((member) => ui.me && String(member.id) === String(ui.me.id));
  const ids = [...(me?.roles || []), ...(me?.roleIds || [])].map((role) => (typeof role === 'string' ? role : role?.id));
  return ids.some((id) => STAFF_ROLES.has(id));
}

export function openMemberMenu(event, user) {
  if (!user) return;
  event.preventDefault();
  event.stopPropagation();
  ui.dmMenu = null;
  ui.idMenu = null;
  const self = ui.me && String(user.id) === String(ui.me.id);
  const rows = self ? 1 : (canModerateMembers() ? 8 : 3);
  ui.memberMenu = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 248)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 16 - rows * 36)),
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

const profileLoads = new Map();
let profileRevision = 0;

export function touchProfileMedia() {
  profileRevision += 1;
}

function mediaList(incoming, local) {
  if (Array.isArray(incoming)) return incoming;
  return Array.isArray(local) ? local : [];
}

export function peekProfile(user) {
  if (!user || !user.id) return Promise.resolve(null);
  primeMedia([user.bannerUrl, user.avatarUrl]);
  if (profileLoads.has(user.id)) return profileLoads.get(user.id);
  const job = loadProfile(user.id).then((fresh) => {
    profileLoads.delete(user.id);
    if (fresh) primeMedia([fresh.bannerUrl, fresh.avatarUrl]);
    return fresh;
  }).catch(() => {
    profileLoads.delete(user.id);
    return null;
  });
  profileLoads.set(user.id, job);
  return job;
}

export async function openPopout(user, x, y) {
  const inServer = ui.mode === 'chat' && !!ui.serverId;
  const known = inServer ? ui.members.find((m) => m.id === user.id) : null;
  const seed = known
    ? { ...user, ...known, roles: known.roles || [] }
    : { ...user, roles: inServer ? (user.roles || []) : [] };
  if (ui.me && String(ui.me.id) === String(user.id)) {
    seed.gallery = mediaList(ui.me.gallery, seed.gallery);
    seed.stories = mediaList(ui.me.stories, seed.stories);
  }
  ui.popout = { user: seed, x, y };
  const opened = profileRevision;
  warmMedia([seed.bannerUrl, seed.avatarUrl]);
  primeMedia([seed.bannerUrl, seed.avatarUrl]);
  loadFriends().catch(() => {});
  peekProfile(user).then((fresh) => {
    if (opened !== profileRevision) return;
    if (!fresh || !ui.popout || ui.popout.user?.id !== user.id) return;
    const gallery = mediaList(fresh.gallery, ui.popout.user.gallery);
    const stories = mediaList(fresh.stories, ui.popout.user.stories);
    ui.popout = { user: { ...ui.popout.user, ...fresh, gallery, stories, roles: ui.popout.user.roles || [] }, x, y };
    if (ui.me && String(ui.me.id) === String(fresh.id)) ui.me = { ...ui.me, gallery, stories };
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
    if (opened !== profileRevision) return;
    const gallery = mediaList(fresh.gallery, ui.popout?.user?.gallery);
    const stories = mediaList(fresh.stories, ui.popout?.user?.stories);
    ui.popout = { user: { ...seed, ...fresh, gallery, stories, roles: fresh.roles || [] }, x, y };
    if (ui.me && String(ui.me.id) === String(fresh.id)) ui.me = { ...ui.me, gallery, stories };
    warmMedia([fresh.bannerUrl, fresh.avatarUrl]);
    primeMedia([fresh.bannerUrl, fresh.avatarUrl]);
  } catch (_) {}
}

export const currentChannel = () => ui.channels.find((c) => c.id === ui.channelId) || null;
