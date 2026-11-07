const DEFAULT_BACKEND = "https://scowling-anthill-civil.ngrok-free.dev";

const TUNNEL_HEADERS = {
  'ngrok-skip-browser-warning': 'true',
  'bypass-tunnel-reminder': 'true',
};

function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("backend");
  if (fromQuery) {
    try { localStorage.setItem("dc_backend", fromQuery.replace(/\/$/, "")); } catch (e) {}
    return fromQuery.replace(/\/$/, "");
  }
  try {
    const saved = localStorage.getItem("dc_backend");
    if (saved) return saved.replace(/\/$/, "");
  } catch (e) {}
  if (window.location.protocol !== "file:" && window.location.port === "3850") {
    return window.location.origin;
  }
  return DEFAULT_BACKEND.replace(/\/$/, "");
}
let API = getApiBase();

const COLORS = ['#7c5cff','#57f287','#fee75c','#eb459e','#ed4245','#f47fff','#00d4ff','#faa61a','#9b59b6','#1abc9c','#e67e22','#3498db'];
let token = localStorage.getItem('dc_token') || null;
let me = null;
let channels = [];
let servers = [];
let currentServerId = 'nebula-official';
let serverPerms = 0;
let serverRoles = [];
let currentServerMeta = null;
const PERM = { VIEW: 1, SEND: 2, MANAGE_CHANNELS: 4, MANAGE_ROLES: 8, INVITE: 16, MANAGE_SERVER: 32, ADMIN: 128 };
function hasPerm(bit) {
  if (serverPerms & PERM.ADMIN) return true;
  return (serverPerms & bit) === bit;
}
let currentChannel = 'general';
let badgeDefs = {};
let pollTimer = null;
let chatMode = 'server';
let dmUserId = null;
let dmUser = null;

const $ = (id) => document.getElementById(id);

function networkError(err) {
  const msg = (err && err.message) || String(err);
  if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('fetch')) {
    return 'Cannot reach server at ' + API + '. Check connection.';
  }
  return msg;
}

function showAuthError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.classList.add('show');
  $('auth-ok').classList.remove('show');
}
function showAuthOk(msg) {
  const el = $('auth-ok');
  el.textContent = msg;
  el.classList.add('show');
  $('auth-error').classList.remove('show');
}
function clearAuthMsg() {
  $('auth-error').classList.remove('show');
  $('auth-ok').classList.remove('show');
}

function showPanel(name) {
  ['login','register','verify'].forEach(p => {
    $(`panel-${p}`).style.display = p === name ? 'block' : 'none';
  });
  clearAuthMsg();
}

$('goto-register').onclick = () => showPanel('register');
$('goto-login').onclick = () => showPanel('login');
$('goto-register-back').onclick = () => showPanel('register');

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Server returned non-JSON (is the backend running?)');
  }
}

$('btn-register').onclick = async () => {
  clearAuthMsg();
  const email = $('reg-email').value.trim();
  const username = $('reg-username').value.trim();
  const password = $('reg-password').value;
  $('btn-register').disabled = true;
  try {
    const res = await fetch(API + '/api/auth/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS },
      body: JSON.stringify({ email, username, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Failed');
    $('verify-email-label').textContent = email;
    window._pendingEmail = email;
    showAuthOk('Code sent! Check your inbox.');
    showPanel('verify');
  } catch (e) {
    showAuthError(networkError(e));
  } finally {
    $('btn-register').disabled = false;
  }
};

$('btn-verify').onclick = async () => {
  clearAuthMsg();
  const code = $('verify-code').value.trim();
  $('btn-verify').disabled = true;
  try {
    const res = await fetch(API + '/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS },
      body: JSON.stringify({ email: window._pendingEmail, code }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Failed');
    token = data.token;
    me = data.user;
    localStorage.setItem('dc_token', token);
    await enterApp();
  } catch (e) {
    showAuthError(networkError(e));
  } finally {
    $('btn-verify').disabled = false;
  }
};

$('btn-login').onclick = async () => {
  clearAuthMsg();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  $('btn-login').disabled = true;
  try {
    const res = await fetch(API + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS },
      body: JSON.stringify({ email, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Failed');
    token = data.token;
    me = data.user;
    localStorage.setItem('dc_token', token);
    await enterApp();
  } catch (e) {
    showAuthError(networkError(e));
  } finally {
    $('btn-login').disabled = false;
  }
};

async function api(path, opts = {}) {
  const headers = {
    ...TUNNEL_HEADERS,
    ...(opts.headers || {}),
    Authorization: 'Bearer ' + token,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
  if (opts.body && typeof opts.body === 'object') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  let url = API + path;
  if (!opts.method || opts.method === 'GET') {
    url += (path.includes('?') ? '&' : '?') + '_=' + Date.now();
  }
  const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  if (res.status === 413) {
    throw new Error('Image is too large. Use a smaller file or a shorter GIF.');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function logout() {
  token = null;
  me = null;
  localStorage.removeItem('dc_token');
  $('app').classList.remove('open');
  $('auth-screen').style.display = 'flex';
  showPanel('login');
  if (pollTimer) clearInterval(pollTimer);
}

$('btn-logout').onclick = logout;

function initial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

function memberSinceBlock(user) {
  const date = user && user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—';
  const id = user && user.uid != null ? String(user.uid) : '—';
  return `<div class="meta-split">
      <div><h4>Member Since</h4><p>${date}</p></div>
      <div><h4>User ID</h4><p>${escapeHtml(id)}</p></div>
    </div>`;
}

/** Safe CSS background for avatars/banners inside HTML style="..." attributes.
 *  Data-URL PFPs use double quotes in url("...") which terminate the attribute early
 *  and leave a blank circle + floating status dots in the members list. */
function cssBgImage(url, fallbackColor) {
  const color = fallbackColor || '#7c5cff';
  if (!url) return `background:${color}`;
  // Single quotes around the URL so data:image/...;base64,... never breaks style="..."
  const safe = String(url).replace(/'/g, '%27');
  return `background-image:url('${safe}');background-size:cover;background-position:center;background-color:${color}`;
}
function cssBannerImage(url, fallbackColor) {
  const color = fallbackColor || '#7c5cff';
  if (!url) return `background:${color}`;
  const safe = String(url).replace(/'/g, '%27');
  return `background-image:url('${safe}');background-size:cover;background-position:center`;
}

function renderMe() {
  if (!me) return;
  const name = me.displayName || me.username;
  const sub = me.customStatus || me.status || 'Online';
  const st = me.status || 'online';

  const av = $('me-avatar');
  const ini = $('me-initial');
  
  if (av && ini) {
    // 1. Set color fallback
    av.style.backgroundColor = me.avatarColor || '#7c5cff';
    
    // 2. Apply image URL or fallback to initial
    if (me.avatarUrl) {
      ini.style.display = 'none';
      av.style.backgroundImage = `url("${me.avatarUrl}")`;
    } else {
      ini.style.display = 'block';
      ini.textContent = initial(name);
      av.style.backgroundImage = 'none';
    }
  }
  
  if ($('me-name')) $('me-name').textContent = name;
  if ($('me-custom')) $('me-custom').textContent = sub;
  if ($('me-status-dot')) $('me-status-dot').className = 'status-dot ' + st;
}

function renderChannels() {
  const el = $('channel-list');
  if (!el) return;
  if (!channels || !channels.length) {
    el.innerHTML = '<div class="cat">Text Channels</div><div class="channel active" data-id="general"><span class="hash">#</span>general</div>';
    return;
  }
  const manage = hasPerm(PERM.MANAGE_CHANNELS);
  const gear = (c) => manage ? `<button type="button" class="ch-edit" data-edit="${c.id}" title="Edit channel">✎</button>` : '';
  const row = (c) => `<div class="channel ${c.id === currentChannel && chatMode === 'server' ? 'active' : ''}" data-id="${c.id}">
      <span class="hash">${c.type === 'voice' ? '🔊' : '#'}</span><span class="ch-label">${escapeHtml(c.name)}</span>${gear(c)}
    </div>`;
  const groups = [{ id: '', name: '' }].concat(serverCategories || []);
  let html = '';
  groups.forEach(cat => {
    const text = channels.filter(c => c.type === 'text' && (c.categoryId || '') === cat.id);
    const voice = channels.filter(c => c.type === 'voice' && (c.categoryId || '') === cat.id);
    if (cat.id && !text.length && !voice.length) return;
    if (cat.name) html += `<div class="cat">${escapeHtml(cat.name)}</div>`;
    if (text.length || !cat.id) {
      html += `<div class="cat cat-row"><span>${cat.name ? 'Text' : 'Text Channels'}</span>${!cat.id && manage ? '<button type="button" class="cat-plus" data-new="text" title="Create channel">+</button>' : ''}</div>`;
      text.forEach(c => { html += row(c); });
    }
    if (voice.length || (!cat.id && manage)) {
      html += `<div class="cat cat-row"><span>${cat.name ? 'Voice' : 'Voice Channels'}</span>${!cat.id && manage ? '<button type="button" class="cat-plus" data-new="voice" title="Create voice channel">+</button>' : ''}</div>`;
      voice.forEach(c => { html += row(c); });
    }
  });
  el.innerHTML = html;
  el.querySelectorAll('.cat-plus').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openCreateChannel(btn.dataset.new || 'text'); };
  });
  el.querySelectorAll('.ch-edit').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openEditChannel(btn.dataset.edit); };
  });
  el.querySelectorAll('.channel').forEach(node => {
    node.onclick = () => {
      const ch = channels.find(c => c.id === node.dataset.id);
      if (!ch || ch.type !== 'text') return;
      chatMode = 'server';
      dmUserId = null;
      dmUser = null;
      currentChannel = ch.id;
      seenMessageId = '';
      renderChannels();
      if ($('ch-icon')) $('ch-icon').textContent = '#';
      $('ch-name').textContent = ch.name;
      $('ch-topic').textContent = ch.topic || '';
      $('msg-input').placeholder = `Message #${ch.name}`;
      if ($('dm-profile')) { $('dm-profile').style.display = 'none'; }
      loadMessages();
    };
  });
}

function renderMessageList(list, emptyTitle, emptySub) {
  const box = $('messages');
  if (!list.length) {
    box.innerHTML = `<div class="welcome"><h2>${escapeHtml(emptyTitle)}</h2><p>${escapeHtml(emptySub)}</p></div>`;
    return;
  }
  box.innerHTML = list.map(m => {
    const a = m.author || {};
    const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const avStyle = cssBgImage(a.avatarUrl, a.avatarColor);
    const letter = a.avatarUrl ? '' : initial(a.displayName || a.username);

    return `<div class="msg">
      <div class="av" style="${avStyle}" data-uid="${a.id}">${letter}</div>
      <div class="msg-body">
        <div class="msg-head">
          <span class="msg-author" style="color:${a.accentColor || '#fff'}" data-uid="${a.id}">${escapeHtml(a.displayName || a.username)}</span>
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-content">${formatContent(m.content)}</div>
      </div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
  box.querySelectorAll('[data-uid]').forEach(el => {
    el.onclick = (e) => showPopout(el.dataset.uid, e);
  });
}

let seenMessageId = '';
async function loadMessages() {
  try {
    if (chatMode === 'dm' && dmUserId) {
      const data = await api(`/api/dms/${dmUserId}/messages`);
      const name = (data.other && (data.other.displayName || data.other.username)) || 'DM';
      renderMessageList(data.messages || [], name, 'Send a message to start the conversation.');
      return;
    }
    const data = await api(`/api/channels/${currentChannel}/messages`);
    const list = data.messages || [];
    renderMessageList(list, '#' + currentChannel, 'This is the start of the channel. Say hi!');
    const newest = list[list.length - 1];
    if (newest && newest.id && newest.id !== seenMessageId) {
      const firstLook = !seenMessageId;
      seenMessageId = newest.id;
      const mine = me && newest.author && newest.author.id === me.id;
      if (!firstLook && !mine && !serverMuted()) {
        const mode = notifyMode();
        const text = newest.content || '';
        const mention = me && (text.includes('@' + me.username) || text.includes('@everyone'));
        if (mode === 'all' || (mode === 'mentions' && mention)) {
          const oldTitle = document.title;
          document.title = 'New message · Nebula';
          setTimeout(() => { if (document.title === 'New message · Nebula') document.title = oldTitle; }, 2500);
        }
      }
    }
  } catch (e) {
    console.warn('loadMessages', e);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

$('msg-input').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const content = $('msg-input').value.trim();
  if (!content) return;
  $('msg-input').value = '';
  try {
    if (chatMode === 'dm' && dmUserId) {
      await api(`/api/dms/${dmUserId}/messages`, { method: 'POST', body: { content } });
    } else {
      await api(`/api/channels/${currentChannel}/messages`, { method: 'POST', body: { content } });
    }
    await loadMessages();
  } catch (err) {
    alert(err.message);
  }
});

let friendsCache = { friends: [], incoming: [], outgoing: [] };
let friendsTab = 'online';

function showMainView(name) {
  document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
  const el = $(name);
  if (el) el.classList.add('active');
}

function setRail(mode) {
  const ss = $('sidebar-server');
  const sd = $('sidebar-dm');
  if (ss) {
    ss.classList.toggle('active', mode === 'server');
    ss.style.display = '';
  }
  if (sd) {
    sd.classList.toggle('active', mode === 'home');
    sd.style.display = '';
  }

  if ($('members')) {
    if (mode === 'server') $('members').classList.remove('hidden');
    else $('members').classList.add('hidden');
  }

  document.querySelectorAll('.server-icon[data-server-id]').forEach(el => {
    el.classList.toggle('active', mode === 'server' && el.dataset.serverId === currentServerId);
  });
  if ($('nav-home')) $('nav-home').classList.toggle('active', mode === 'home');
}

if ($('nav-home')) $('nav-home').onclick = () => openFriendsHome('online');

function renderDmProfile(user) {
  const box = $('dm-profile');
  if (!box) return;
  if (!user) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  const badges = (user.badges || []).map(bid => {
    const b = badgeDefs[bid];
    if (!b) return '';
    return `<span class="badge-pill" style="background:${b.color}">${b.icon} ${b.label}</span>`;
  }).join('');

  const avStyle = cssBgImage(user.avatarUrl, user.avatarColor);
  const letter = user.avatarUrl ? '' : initial(user.displayName || user.username);

  const banStyle = cssBannerImage(user.bannerUrl, user.bannerColor || user.accentColor);

  box.innerHTML = `
    <div class="dm-profile-banner" style="${banStyle}"></div>
    <div class="dm-profile-body">
      <div class="dm-profile-av" style="${avStyle}">${letter}</div>
      <div class="dm-profile-name">${escapeHtml(user.displayName || user.username)}</div>
      ${badges ? `<div class="badge-list" style="margin-top:8px">${badges}</div>` : ''}
      ${user.bio ? `<div class="dm-profile-section"><h4>About Me</h4><p style="font-size:14px;color:var(--text-muted)">${escapeHtml(user.bio)}</p></div>` : ''}
      <div class="dm-profile-section">${memberSinceBlock(user)}</div>
    </div>`;
}

async function openDm(user) {
  if (!user || !user.id) return;
  setRail('home');
  chatMode = 'dm';
  dmUserId = user.id;
  dmUser = user;
  showMainView('view-chat');
  if ($('ch-icon')) $('ch-icon').textContent = '@';
  $('ch-name').textContent = user.displayName || user.username;
  $('ch-topic').textContent = (user.status === 'online' ? 'Online' : (user.status || ''));
  $('msg-input').placeholder = `Message @${user.username}`;
  renderDmProfile(user);
  document.querySelectorAll('.dm-nav-item').forEach(b => b.classList.remove('active'));
  await refreshDmList();
  await loadMessages();
}

async function refreshDmList() {
  const list = $('dm-list');
  if (!list) return;
  try {
    const data = await api('/api/dms');
    const items = data.dms || [];
    if (!items.length) {
      list.innerHTML = '<div style="padding:8px;color:var(--text-faint);font-size:13px">No direct messages yet.</div>';
      return;
    }
    list.innerHTML = items.map(d => {
      const u = d.other;
      if (!u) return '';
      const active = dmUserId === u.id ? 'active' : '';
      const avStyle = cssBgImage(u.avatarUrl, u.avatarColor);
      const letter = u.avatarUrl ? '' : initial(u.displayName || u.username);
      
      return `<div class="dm-item ${active}" data-dm-id="${u.id}">
        <div class="av" style="${avStyle}">${letter}</div>
        <span>${escapeHtml(u.displayName || u.username)}</span>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-dm-id]').forEach(el => {
      el.onclick = async () => {
        const id = el.dataset.dmId;
        let u = items.map(d => d.other).find(x => x && x.id === id);
        if (!u) {
          const mem = await api('/api/members');
          u = (mem.members || []).find(x => x.id === id);
        }
        if (u) openDm(u);
      };
    });
  } catch (e) {
    list.innerHTML = `<div style="padding:8px;color:var(--text-faint)">${escapeHtml(e.message)}</div>`;
  }
}

async function renderFriendsBody() {
  const body = $('friends-body');
  if (!body) return;
  const q = (($('friends-search') && $('friends-search').value) || '').trim().toLowerCase();
  if (friendsTab === 'pending') {
    const incoming = friendsCache.incoming || [];
    const outgoing = friendsCache.outgoing || [];
    if (!incoming.length && !outgoing.length) {
      body.innerHTML = '<div style="color:var(--text-faint);padding:16px">No pending requests.</div>';
      return;
    }
    let html = '';
    if (incoming.length) {
      html += `<div class="friends-cat">Incoming — ${incoming.length}</div>`;
      incoming.forEach(u => { html += friendListRow(u, 'pending-in'); });
    }
    if (outgoing.length) {
      html += `<div class="friends-cat">Outgoing — ${outgoing.length}</div>`;
      outgoing.forEach(u => { html += friendListRow(u, 'pending-out'); });
    }
    body.innerHTML = html;
    bindFriendRowActions(body);
    return;
  }
  let list = friendsCache.friends || [];
  if (friendsTab === 'online') list = list.filter(u => u.status !== 'offline');
  if (q) list = list.filter(u => (u.username + ' ' + (u.displayName || '')).toLowerCase().includes(q));
  const label = friendsTab === 'online' ? 'Online' : 'All friends';
  if (!list.length) {
    body.innerHTML = `<div class="friends-cat">${label} — 0</div><div style="color:var(--text-faint);padding:16px">No friends here. Click Add Friend.</div>`;
    return;
  }
  body.innerHTML = `<div class="friends-cat">${label} — ${list.length}</div>` + list.map(u => friendListRow(u, 'friend')).join('');
  bindFriendRowActions(body);
}

function friendListRow(u, kind) {
  const status = u.status === 'online' ? 'Online' : (u.status || 'Offline');
  let actions = '';
  if (kind === 'friend') {
    actions = `<div class="friend-list-actions"><button type="button" title="Message" data-msg="${u.id}">💬</button></div>`;
  } else if (kind === 'pending-in') {
    actions = `<div class="friend-list-actions">
      <button type="button" class="ok" title="Accept" data-accept="${u.id}">✓</button>
      <button type="button" class="no" title="Ignore" data-decline="${u.id}">✕</button>
    </div>`;
  } else if (kind === 'pending-out') {
    actions = `<div class="friend-list-actions">
      <button type="button" class="no" title="Cancel request" data-cancel="${u.id}">✕</button>
    </div>`;
  } else {
    actions = `<div class="friend-list-actions"><span style="font-size:12px;color:var(--text-faint)">Pending</span></div>`;
  }

  const avStyle = cssBgImage(u.avatarUrl, u.avatarColor);
  const letter = u.avatarUrl ? '' : initial(u.displayName || u.username);

  return `<div class="friend-list-row" data-user="${u.id}">
    <div class="av" style="${avStyle}">${letter}
      <span class="status-dot ${u.status || 'offline'}" style="width:12px;height:12px;border-width:2px"></span>
    </div>
    <div class="friend-list-meta">
      <div class="friend-list-name">${escapeHtml(u.displayName || u.username)}</div>
      <div class="friend-list-sub">@${escapeHtml(u.username)} • ${status}</div>
    </div>
    ${actions}
  </div>`;
}

function bindFriendRowActions(root) {
  root.querySelectorAll('[data-msg]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const u = (friendsCache.friends || []).find(x => x.id === btn.dataset.msg);
      if (u) openDm(u);
    };
  });
  root.querySelectorAll('[data-accept]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await api('/api/friends/accept', { method: 'POST', body: { userId: btn.dataset.accept } });
        await loadFriendsData();
      } catch (err) { alert(err.message); }
    };
  });
  root.querySelectorAll('[data-decline]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await api('/api/friends/decline', { method: 'POST', body: { userId: btn.dataset.decline } });
        await loadFriendsData();
      } catch (err) { alert(err.message); }
    };
  });
  root.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await api('/api/friends/cancel', { method: 'POST', body: { userId: btn.dataset.cancel } });
        await loadFriendsData();
      } catch (err) { alert(err.message); }
    };
  });
  root.querySelectorAll('.friend-list-row[data-user]').forEach(row => {
    row.onclick = async (e) => {
      if (e.target.closest('button')) return;
      const u = (friendsCache.friends || []).find(x => x.id === row.dataset.user);
      if (u) openDm(u);
    };
  });
}

async function loadFriendsData() {
  try {
    const data = await api('/api/friends');
    friendsCache = {
      friends: Array.isArray(data.friends) ? data.friends : [],
      incoming: Array.isArray(data.incoming) ? data.incoming : [],
      outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
    };
    const pendingCount = (friendsCache.incoming || []).length;
    document.querySelectorAll('.ftab[data-ftab="pending"]').forEach(t => {
      t.textContent = pendingCount > 0 ? `Pending (${pendingCount})` : 'Pending';
    });
    await renderFriendsBody();
    await refreshDmList();
  } catch (e) {
    if ($('friends-body')) $('friends-body').innerHTML = `<div style="color:var(--text-faint)">${escapeHtml(e.message)}</div>`;
  }
}

function openFriendsHome(tab) {
  setRail('home');
  chatMode = 'home';
  dmUserId = null;
  friendsTab = tab || 'online';
  showMainView('view-friends-home');
  renderDmProfile(null);
  document.querySelectorAll('#view-friends-home .ftab').forEach(t => {
    if (t.classList.contains('add')) return;
    t.classList.toggle('active', t.dataset.ftab === friendsTab);
  });
  document.querySelectorAll('.dm-nav-item').forEach(b => b.classList.remove('active'));
  if ($('btn-friends-page')) $('btn-friends-page').classList.add('active');
  loadFriendsData();
}

function openAddFriendPage() {
  setRail('home');
  chatMode = 'home';
  dmUserId = null;
  showMainView('view-add-friend');
  renderDmProfile(null);
  document.querySelectorAll('.dm-nav-item').forEach(b => b.classList.remove('active'));
  if ($('btn-add-friend-page')) $('btn-add-friend-page').classList.add('active');
  if ($('add-friend-hint')) {
    $('add-friend-hint').textContent = '';
    $('add-friend-hint').className = 'add-friend-hint';
  }
}

async function openServer(serverId) {
  if (typeof serverId === 'string' && serverId) currentServerId = serverId;
  setRail('server');
  chatMode = 'server';
  dmUserId = null;
  dmUser = null;
  showMainView('view-chat');
  renderDmProfile(null);
  try {
    const chData = await api('/api/channels?serverId=' + encodeURIComponent(currentServerId));
    channels = chData.channels || [];
    if (chData.servers) servers = chData.servers;
    serverPerms = chData.permissions || 0;
    serverRoles = chData.roles || [];
    serverCategories = chData.categories || [];
    pendingOnboarding = chData.onboarding || null;
    currentServerMeta = chData.server || null;
    serverEmoji = chData.emoji || [];
    serverStickers = chData.stickers || [];
    applyServerLook(chData);
    const lobby = $('lobby-card');
    if (lobby) {
      if (chData.showLobby && chData.about) {
        lobby.hidden = false;
        lobby.innerHTML = `<strong>${escapeHtml((chData.server && chData.server.name) || 'This server')}</strong><p>${escapeHtml(chData.about)}</p>`;
      } else lobby.hidden = true;
    }
  } catch (e) {
    console.warn(e);
    if (!channels.length) {
      channels = [
        { id: 'general', name: 'general', type: 'text', topic: 'Welcome' },
        { id: 'announcements', name: 'announcements', type: 'text', topic: '' },
        { id: 'random', name: 'random', type: 'text', topic: '' },
      ];
    }
  }
  if ($('server-title')) {
    const muted = serverMuted();
    $('server-title').textContent = ((currentServerMeta && currentServerMeta.name) || 'Server') + (muted ? '  · muted' : '');
  }
  renderServerRail();
  renderChannels();
  if ($('ch-icon')) $('ch-icon').textContent = '#';
  const ch = channels.find(c => c.id === currentChannel) || channels.find(c => c.type === 'text') || channels[0];
  if (ch) {
    currentChannel = ch.id;
    $('ch-name').textContent = ch.name;
    $('ch-topic').textContent = ch.topic || '';
    $('msg-input').placeholder = `Message #${ch.name}`;
  }
  if ($('members')) $('members').classList.remove('hidden');
  seenMessageId = '';
  await loadMessages();
  await loadMembers();
  if (pendingOnboarding) showOnboarding(pendingOnboarding);
  if ($('msg-input')) $('msg-input').disabled = !!(pendingOnboarding && pendingOnboarding.mustFinish);
}

if ($('btn-friends-page')) $('btn-friends-page').onclick = () => openFriendsHome(friendsTab || 'online');
if ($('btn-add-friend-page')) $('btn-add-friend-page').onclick = () => openAddFriendPage();
if ($('btn-dm-plus')) $('btn-dm-plus').onclick = () => openAddFriendPage();
if ($('btn-open-add-friend')) $('btn-open-add-friend').onclick = () => openAddFriendPage();

document.querySelectorAll('.ftab[data-ftab]').forEach(btn => {
  btn.onclick = async () => {
    if (btn.classList.contains('add')) return;
    friendsTab = btn.dataset.ftab;
    document.querySelectorAll('#view-friends-home .ftab').forEach(t => {
      if (!t.classList.contains('add')) t.classList.toggle('active', t.dataset.ftab === friendsTab);
    });
    showMainView('view-friends-home');
    await loadFriendsData();
  };
});

document.querySelectorAll('#view-add-friend .ftab[data-ftab]').forEach(btn => {
  btn.onclick = () => openFriendsHome(btn.dataset.ftab);
});

if ($('friends-search')) {
  $('friends-search').oninput = () => renderFriendsBody();
}

if ($('btn-add-friend')) {
  $('btn-add-friend').onclick = async () => {
    const raw = ($('friend-input').value || '').trim();
    const hint = $('add-friend-hint');
    const btn = $('btn-add-friend');
    if (!raw) {
      if (hint) { hint.textContent = 'Enter a username or #ID'; hint.className = 'add-friend-hint err'; }
      return;
    }
    const body = /^\d+$/.test(raw) || raw.startsWith('#')
      ? { uid: String(raw).replace(/^#/, '').trim() }
      : { username: String(raw).replace(/^@/, '').trim().toLowerCase() };
    btn.disabled = true;
    try {
      const data = await api('/api/friends/request', { method: 'POST', body });
      $('friend-input').value = '';
      if (hint) {
        if (data.status === 'accepted') hint.textContent = 'You are now friends!';
        else hint.textContent = 'Friend request sent to ' + (data.user && (data.user.displayName || data.user.username) || 'user') + '.';
        hint.className = 'add-friend-hint ok';
      }
      await loadFriendsData();
    } catch (e) {
      if (hint) {
        hint.textContent = e.message || 'Request failed';
        hint.className = 'add-friend-hint err';
      } else alert(e.message);
    } finally {
      btn.disabled = false;
    }
  };
  if ($('friend-input')) {
    $('friend-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btn-add-friend').click();
    });
  }
}

async function loadMembers() {
  const el = $('members');
  if (!el) return;
  el.classList.remove('hidden');
  el.style.display = 'block';
  try {
    const data = await api('/api/members?serverId=' + encodeURIComponent(currentServerId));
    badgeDefs = data.badges || {};
    const members = data.members || [];
    const online = members.filter(m => m.status !== 'offline');
    const offline = members.filter(m => m.status === 'offline');
    let html = `<div class="members-cat">Online — ${online.length}</div>`;
    if (!online.length) {
      html += `<div style="padding:8px;color:var(--text-faint);font-size:13px">No one online</div>`;
    }
    online.forEach(m => { html += memberRow(m); });
    if (offline.length) {
      html += `<div class="members-cat">Offline — ${offline.length}</div>`;
      offline.forEach(m => { html += memberRow(m); });
    }
    el.innerHTML = html;
    paintMemberAvatars(el, members);
    el.querySelectorAll('[data-uid]').forEach(node => {
      node.onclick = (e) => showPopout(node.dataset.uid, e);
    });
  } catch (e) {
    console.warn('loadMembers', e);
    el.innerHTML = `<div class="members-cat">Members</div><div style="padding:8px;color:var(--text-faint);font-size:13px">Could not load</div>`;
  }
}

function memberRow(m) {
  const letter = m.avatarUrl ? '' : initial(m.displayName || m.username);
  const color = m.avatarColor || '#7c5cff';
  return `<div class="member" data-uid="${m.id}">
    <div class="av" style="background-color:${color}">
      ${letter}
      <span class="status-dot ${m.status || 'online'}" style="width:12px;height:12px;border-width:2px"></span>
    </div>
    <div>
      <div class="member-name" style="color:${m.roleColor || m.accentColor || ''}">${escapeHtml(m.nick || m.displayName || m.username)}</div>
      ${m.customStatus ? `<div class="member-status">${escapeHtml(m.customStatus)}</div>` : ''}
    </div>
  </div>`;
}

/** Custom photos are applied after HTML insert, same idea as the mini profile.
 *  Data-URL pictures cannot go in a style attribute or the member circle stays blank. */
function paintMemberAvatars(root, members) {
  const byId = new Map((members || []).map(m => [String(m.id), m]));
  root.querySelectorAll('.member').forEach(row => {
    const m = byId.get(String(row.dataset.uid));
    const av = row.querySelector('.av');
    if (!m || !av || !m.avatarUrl) return;
    const img = document.createElement('img');
    img.className = 'pfp';
    img.alt = '';
    img.src = m.avatarUrl;
    const dot = av.querySelector('.status-dot');
    av.insertBefore(img, dot || null);
  });
}

function friendRelation(uid) {
  if (!uid || !me || uid === me.id) return 'self';
  const f = friendsCache.friends || [];
  const inc = friendsCache.incoming || [];
  const out = friendsCache.outgoing || [];
  if (f.some(x => x.id === uid)) return 'friends';
  if (inc.some(x => x.id === uid)) return 'incoming';
  if (out.some(x => x.id === uid)) return 'outgoing';
  return 'none';
}

async function showPopout(uid, ev) {
  try {
    try {
      const fr = await api('/api/friends');
      friendsCache = {
        friends: Array.isArray(fr.friends) ? fr.friends : [],
        incoming: Array.isArray(fr.incoming) ? fr.incoming : [],
        outgoing: Array.isArray(fr.outgoing) ? fr.outgoing : [],
      };
    } catch (_) {}

    const data = await api('/api/members');
    const u = data.members.find(m => m.id === uid);
    if (!u) return;
    const badges = (u.badges || []).map(bid => {
      const b = badgeDefs[bid];
      if (!b) return '';
      return `<span class="badge-pill" style="background:${b.color}">${b.icon} ${b.label}</span>`;
    }).join('');

    const bannerStyle = cssBannerImage(u.bannerUrl, u.bannerColor || u.accentColor);
    const avStyle = cssBgImage(u.avatarUrl, u.avatarColor);
    const letter = u.avatarUrl ? '' : initial(u.displayName || u.username);
    const rel = friendRelation(u.id);
    const isSelf = rel === 'self';

    let actionHtml = '';
    if (!isSelf) {
      if (rel === 'friends') {
        actionHtml = `
          <button type="button" class="popout-full-btn popout-primary" id="popout-msg">Message</button>
          <button type="button" class="popout-full-btn" id="popout-unfriend">Remove Friend</button>`;
      } else if (rel === 'incoming') {
        actionHtml = `
          <button type="button" class="popout-full-btn popout-primary" id="popout-accept">Accept Friend Request</button>
          <button type="button" class="popout-full-btn" id="popout-decline">Ignore</button>`;
      } else if (rel === 'outgoing') {
        actionHtml = `<button type="button" class="popout-full-btn" id="popout-cancel-req">Cancel Request</button>`;
      }
    }

    const showAddIcon = !isSelf && rel === 'none';

    const pop = $('popout');
    pop.innerHTML = `
      <div class="popout-banner" style="${bannerStyle}"></div>
      <div class="popout-body">
        <div class="popout-av" style="${avStyle}">${letter}</div>
        <div class="popout-head">
          <div class="popout-id">
            <div class="popout-name">${escapeHtml(u.displayName || u.username)}</div>
            <div class="popout-user">@${escapeHtml(u.username)}${u.pronouns ? ' · ' + escapeHtml(u.pronouns) : ''}</div>
          </div>
          ${showAddIcon ? `<button type="button" class="popout-friend-icon" id="popout-add-friend" title="Add Friend" aria-label="Add Friend"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8" r="3.2"/><path d="M4.5 19.2c.6-3 3-4.7 5.5-4.7s4.9 1.7 5.5 4.7"/><path d="M19 8v6M16 11h6"/></svg></button>` : ''}
        </div>
        ${badges ? `<div class="badge-list" style="margin-top:8px">${badges}</div>` : ''}
        ${u.bio ? `<div class="popout-section"><h4>About Me</h4><p style="font-size:14px;color:var(--text-muted)">${escapeHtml(u.bio)}</p></div>` : ''}
        ${u.customStatus ? `<div class="popout-section"><h4>Status</h4><p style="font-size:14px">${escapeHtml(u.customStatus)}</p></div>` : ''}
        <div class="popout-section">${memberSinceBlock(u)}</div>
        <div class="popout-actions">
          ${actionHtml}
          <button type="button" class="popout-full-btn" id="popout-view-full">View full profile</button>
        </div>
      </div>`;
    pop.classList.add('open');

    const stop = (e) => e.stopPropagation();

    const addBtn = $('popout-add-friend');
    if (addBtn) {
      addBtn.onclick = async (e) => {
        stop(e);
        addBtn.disabled = true;
        addBtn.title = 'Sending…';
        try {
          await api('/api/friends/request', { method: 'POST', body: { username: u.username } });
          await loadFriendsData();
          setTimeout(() => showPopout(uid, ev), 400);
        } catch (err) {
          addBtn.disabled = false;
          addBtn.title = 'Add Friend';
          alert(err.message);
        }
      };
    }
    const acceptBtn = $('popout-accept');
    if (acceptBtn) {
      acceptBtn.onclick = async (e) => {
        stop(e);
        try {
          await api('/api/friends/accept', { method: 'POST', body: { userId: u.id } });
          await loadFriendsData();
          showPopout(uid, ev);
        } catch (err) { alert(err.message); }
      };
    }
    const declineBtn = $('popout-decline');
    if (declineBtn) {
      declineBtn.onclick = async (e) => {
        stop(e);
        try {
          await api('/api/friends/decline', { method: 'POST', body: { userId: u.id } });
          await loadFriendsData();
          showPopout(uid, ev);
        } catch (err) { alert(err.message); }
      };
    }
    const msgBtn = $('popout-msg');
    if (msgBtn) {
      msgBtn.onclick = (e) => {
        stop(e);
        pop.classList.remove('open');
        openDm(u);
      };
    }
    const unfriendBtn = $('popout-unfriend');
    if (unfriendBtn) {
      unfriendBtn.onclick = async (e) => {
        stop(e);
        if (!confirm('Remove ' + (u.displayName || u.username) + ' as a friend?')) return;
        try {
          await api('/api/friends/remove', { method: 'POST', body: { userId: u.id } });
          await loadFriendsData();
          showPopout(uid, ev);
        } catch (err) { alert(err.message); }
      };
    }
    const cancelReqBtn = $('popout-cancel-req');
    if (cancelReqBtn) {
      cancelReqBtn.onclick = async (e) => {
        stop(e);
        try {
          await api('/api/friends/cancel', { method: 'POST', body: { userId: u.id } });
          await loadFriendsData();
          showPopout(uid, ev);
        } catch (err) { alert(err.message); }
      };
    }
    const fullBtn = $('popout-view-full');
    if (fullBtn) {
      fullBtn.onclick = (e) => {
        stop(e);
        showPopout(uid, ev);
      };
    }

    const rect = (ev && (ev.target || ev).getBoundingClientRect) ? (ev.target || ev).getBoundingClientRect() : { left: 100, top: 100, width: 0 };
    let left = rect.left + rect.width + 8;
    let top = rect.top;
    if (left + 320 > window.innerWidth) left = rect.left - 328;
    if (top + 480 > window.innerHeight) top = window.innerHeight - 500;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  } catch (e) {
    console.warn('showPopout', e);
  }
}

document.addEventListener('click', (e) => {
  if (!$('popout').contains(e.target) && !e.target.closest('[data-uid]')) {
    $('popout').classList.remove('open');
  }
});

const COLORS_HTML = (id, selected) => COLORS.map(c =>
  `<div class="color-swatch ${c === selected ? 'active' : ''}" data-color="${c}" style="background:${c}" data-group="${id}"></div>`
).join('');

function badgeHtml(list) {
  return (list || []).map(bid => {
    const b = badgeDefs[bid];
    if (!b) return '';
    return `<span class="badge-pill" style="background:${b.color}">${b.icon} ${b.label}</span>`;
  }).join('');
}

function refreshPreview() {
  if (!$('preview-name')) return;
  const display = ($('set-display') && $('set-display').value.trim()) || (me && me.displayName) || (me && me.username) || 'User';
  const username = ($('set-username') && $('set-username').value.trim()) || (me && me.username) || 'user';
  $('preview-name').textContent = display;
  $('preview-user').textContent = '@' + username;
  if ($('preview-pronouns')) $('preview-pronouns').textContent = ($('set-pronouns') && $('set-pronouns').value.trim()) || '';
  if ($('preview-bio')) $('preview-bio').textContent = ($('set-bio') && $('set-bio').value.trim()) || '';
  const avColor = document.querySelector('#avatar-colors .color-swatch.active')?.dataset.color || (me && me.avatarColor) || '#7c5cff';
  const accent = document.querySelector('#accent-colors .color-swatch.active')?.dataset.color || (me && me.accentColor) || '#7c5cff';
  const avUrl = ($('set-avatar-url') && $('set-avatar-url').value.trim()) || (me && me.avatarUrl) || '';
  const banUrl = ($('set-banner-url') && $('set-banner-url').value.trim()) || (me && me.bannerUrl) || '';
  const av = $('preview-av');
  if (avUrl) {
    av.textContent = '';
    av.style.backgroundImage = `url("${avUrl}")`;
    av.style.backgroundSize = 'cover';
    av.style.backgroundColor = avColor;
  } else {
    av.style.backgroundImage = '';
    av.textContent = initial(display);
    av.style.background = avColor;
  }
  const ban = $('preview-banner');
  if (ban) {
    if (banUrl) {
      ban.style.backgroundImage = `url("${banUrl}")`;
      ban.style.backgroundSize = 'cover';
      ban.style.backgroundPosition = 'center';
    } else {
      ban.style.backgroundImage = '';
      ban.style.background = accent;
    }
  }
}

function showSettingsPanel(name) {
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.settings-nav-item[data-panel]').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
  const panel = $('panel-' + name);
  if (panel) panel.classList.add('active');
}

document.querySelectorAll('.settings-nav-item[data-panel]').forEach(btn => {
  btn.onclick = () => showSettingsPanel(btn.dataset.panel);
});

// Compress / resize image to data URL so PATCH stays under body limit
function fileToDataUrl(file, opts) {
  return new Promise((resolve, reject) => {
    const maxW = opts.maxW || 512;
    const maxH = opts.maxH || 512;
    const quality = opts.quality || 0.82;
    const maxBytes = opts.maxBytes || 8 * 1024 * 1024;
    const isGif = /image\/gif/i.test(file.type) || /\.gif$/i.test(file.name || '');

    // Animated GIFs: keep as-is (canvas would kill animation)
    if (isGif) {
      if (file.size > maxBytes) {
        reject(new Error('GIF is too large (max ~8MB). Try a shorter or smaller GIF.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('Could not read GIF'));
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const out = canvas.toDataURL('image/jpeg', quality);
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

$('upload-avatar').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file, { maxW: 256, maxH: 256, quality: 0.85, maxBytes: 8 * 1024 * 1024 });
    $('set-avatar-url').value = dataUrl;
    refreshPreview();
  } catch (err) {
    alert(err.message || 'Avatar upload failed');
  }
};

$('upload-banner').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file, { maxW: 960, maxH: 360, quality: 0.8, maxBytes: 8 * 1024 * 1024 });
    $('set-banner-url').value = dataUrl;
    refreshPreview();
  } catch (err) {
    alert(err.message || 'Banner upload failed');
  }
};

$('btn-settings').onclick = () => {
  if ($('set-uid')) $('set-uid').value = me.uid != null ? String(me.uid) : '—';
  if ($('set-username')) $('set-username').value = me.username || '';
  $('set-display').value = me.displayName || '';
  if ($('set-pronouns')) $('set-pronouns').value = me.pronouns || '';
  $('set-bio').value = me.bio || '';
  $('set-custom').value = me.customStatus || '';
  $('set-status').value = me.status || 'online';
  if ($('set-avatar-url')) $('set-avatar-url').value = me.avatarUrl || '';
  if ($('set-banner-url')) $('set-banner-url').value = me.bannerUrl || '';
  $('avatar-colors').innerHTML = COLORS_HTML('avatar', me.avatarColor);
  $('accent-colors').innerHTML = COLORS_HTML('accent', me.accentColor || me.bannerColor);
  $('settings-badges').innerHTML = badgeHtml(me.badges) || '<span style="color:var(--text-faint);font-size:14px">No badges yet</span>';
  $('preview-badges').innerHTML = badgeHtml(me.badges);
  bindColorClicks();
  showSettingsPanel('identity');
  refreshPreview();
  ['set-display','set-username','set-pronouns','set-bio','set-avatar-url','set-banner-url'].forEach(id => {
    const el = $(id);
    if (el) el.oninput = refreshPreview;
  });
  $('settings-overlay').classList.add('open');
};

function bindColorClicks() {
  document.querySelectorAll('.color-swatch').forEach(el => {
    el.onclick = () => {
      const group = el.dataset.group;
      document.querySelectorAll(`.color-swatch[data-group="${group}"]`).forEach(s => s.classList.remove('active'));
      el.classList.add('active');
      refreshPreview();
    };
  });
}

$('settings-close').onclick = $('settings-cancel').onclick = () => {
  $('settings-overlay').classList.remove('open');
};

if ($('settings-logout-nav')) {
  $('settings-logout-nav').onclick = () => {
    $('settings-overlay').classList.remove('open');
    logout();
  };
}

$('settings-save').onclick = async () => {
  const avatarColor = document.querySelector('#avatar-colors .color-swatch.active')?.dataset.color;
  const accentColor = document.querySelector('#accent-colors .color-swatch.active')?.dataset.color;
  try {
    const data = await api('/api/me', {
      method: 'PATCH',
      body: {
        username: $('set-username') ? $('set-username').value.trim() : undefined,
        displayName: $('set-display').value.trim(),
        bio: $('set-bio').value.trim(),
        pronouns: $('set-pronouns') ? $('set-pronouns').value.trim() : '',
        customStatus: $('set-custom').value.trim(),
        status: $('set-status').value,
        avatarColor,
        accentColor,
        bannerColor: accentColor,
        avatarUrl: $('set-avatar-url') ? $('set-avatar-url').value.trim() : '',
        bannerUrl: $('set-banner-url') ? $('set-banner-url').value.trim() : '',
      },
    });
    me = data.user;
    renderMe();
    loadMembers();
    $('settings-overlay').classList.remove('open');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/too large|PayloadTooLarge|entity too large|413/i.test(msg)) {
      alert('Image is too large. Try a smaller file or a shorter GIF (under ~1.5MB).');
    } else {
      alert(msg);
    }
  }
};

function renderServerRail() {
  const box = $('server-icons');
  if (!box) return;
  box.innerHTML = (servers || []).map(s => {
    const active = s.id === currentServerId && chatMode === 'server' ? ' active' : '';
    const icon = escapeHtml(s.icon || (s.name || 'S').charAt(0));
    return `<div class="server-icon${active}" data-server-id="${s.id}" title="${escapeHtml(s.name || 'Server')}" style="--icon:${s.color || '#7c5cff'}">${icon}</div>`;
  }).join('');
  box.querySelectorAll('[data-server-id]').forEach(el => {
    el.onclick = () => openServer(el.dataset.serverId);
  });
}

let serverCategories = [];
let pendingOnboarding = null;
let serverEmoji = [];
let serverStickers = [];

function formatContent(text) {
  let html = escapeHtml(text || '');
  (serverStickers || []).forEach((e) => {
    if (!e.name || !e.url) return;
    html = html.split('[[sticker:' + e.name + ']]').join('<img class="sticker" alt="" src="' + String(e.url).replace(/"/g, '') + '">');
  });
  (serverEmoji || []).forEach((e) => {
    if (!e.name || !e.url) return;
    html = html.split(':' + e.name + ':').join('<img class="emoji" alt="" src="' + String(e.url).replace(/"/g, '') + '">');
  });
  return html;
}

function notifyMode() {
  return localStorage.getItem('nebula-notify-' + currentServerId) || 'mentions';
}
function muteUntil() {
  return Number(localStorage.getItem('nebula-mute-' + currentServerId) || 0);
}
function serverMuted() {
  return muteUntil() > Date.now();
}

function openModal(title, html, bind, wide) {
  const modal = $('guild-modal');
  if (!modal) return;
  $('guild-modal-title').textContent = title;
  $('guild-modal-body').innerHTML = html;
  modal.classList.toggle('wide', !!wide);
  modal.classList.add('open');
  const menu = $('server-menu');
  if (menu) menu.hidden = true;
  if (bind) bind($('guild-modal-body'));
}
function closeModal() {
  const modal = $('guild-modal');
  if (modal) modal.classList.remove('open');
}

function applyServerLook(data) {
  const theme = (data && data.theme) || {};
  const root = document.documentElement;
  if (theme.accent) root.style.setProperty('--brand', theme.accent);
  else root.style.removeProperty('--brand');
  if (theme.tint) root.style.setProperty('--bg-main', theme.tint);
  else root.style.removeProperty('--bg-main');
  const side = $('sidebar-server');
  if (side) side.style.backgroundImage = data && data.bannerUrl ? 'linear-gradient(rgba(19,19,26,0.72), rgba(19,19,26,0.92)), url("' + data.bannerUrl.replace(/"/g, '') + '")' : '';
}

function toggleServerMenu() {
  const menu = $('server-menu');
  if (!menu) return;
  if (!menu.hidden) { menu.hidden = true; return; }
  const items = [];
  const manage = hasPerm(PERM.MANAGE_SERVER);
  const channels = hasPerm(PERM.MANAGE_CHANNELS);
  if (hasPerm(PERM.INVITE)) items.push(['invite', 'Invite people']);
  items.push(['events', 'Events']);
  if (manage) items.push(['settings', 'Server settings']);
  if (hasPerm(PERM.INVITE)) items.push(['promote', 'Promote server']);
  if (channels) items.push(['channel', 'Create channel']);
  if (channels) items.push(['category', 'Create category']);
  if (manage) items.push(['lock', 'Lock server']);
  items.push(['pings', 'Ping roles']);
  items.push(['notify', 'Notification settings']);
  items.push(['nick', 'Change nickname']);
  items.push(['mute', 'Mute server']);
  items.push(['report', 'Report a member']);
  if (currentServerMeta && currentServerMeta.owner && currentServerId !== 'nebula-official') items.push(['delete', 'Delete server', 'danger']);
  menu.innerHTML = items.map(([act, label, cls]) => `<button type="button" data-act="${act}" class="${cls || ''}">${label}</button>`).join('');
  menu.hidden = false;
  menu.querySelectorAll('[data-act]').forEach(btn => {
    btn.onclick = () => {
      menu.hidden = true;
      const act = btn.dataset.act;
      if (act === 'invite') openInviteModal();
      else if (act === 'settings') openServerSettings();
      else if (act === 'channel') openCreateChannel('text');
      else if (act === 'events') openEventsModal();
      else if (act === 'category') openCategoryModal();
      else if (act === 'lock') openLockModal();
      else if (act === 'notify') openNotifyModal();
      else if (act === 'nick') openNickModal();
      else if (act === 'mute') openMuteModal();
      else if (act === 'promote') promoteServer();
      else if (act === 'delete') deleteThisServer();
      else if (act === 'pings') openPingPicker();
      else if (act === 'report') openReportModal();
    };
  });
}

async function guildAction(body) {
  return api('/api/servers/' + currentServerId + '/action', { method: 'POST', body });
}

async function promoteServer() {
  try {
    const data = await api('/api/servers/' + currentServerId + '/invites', { method: 'POST', body: {} });
    const name = (currentServerMeta && currentServerMeta.name) || 'my server';
    const text = 'Join ' + name + ' on Nebula. Invite code: ' + data.code;
    try { await navigator.clipboard.writeText(text); } catch (_) {}
    alert(text + '\n\nCopied.');
  } catch (err) { alert(err.message); }
}

function openCategoryModal() {
  openModal('Create category', `
    <div class="form-row"><label>Name</label><input id="cat-name" maxlength="40" placeholder="Community" /></div>
    <button type="button" class="btn-primary" id="do-cat">Create</button>
  `, (root) => {
    root.querySelector('#do-cat').onclick = async () => {
      try {
        await guildAction({ type: 'category', name: root.querySelector('#cat-name').value });
        closeModal();
        await openServer(currentServerId);
      } catch (err) { alert(err.message); }
    };
  });
}

function openLockModal() {
  openModal('Lock server', `
    <p class="field-hint">Nobody new can join, and only people who manage the server can post.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button type="button" class="btn-secondary" data-min="15">15 minutes</button>
      <button type="button" class="btn-secondary" data-min="60">1 hour</button>
      <button type="button" class="btn-secondary" data-min="1440">1 day</button>
      <button type="button" class="btn-primary" data-min="0">Unlock</button>
    </div>
  `, (root) => {
    root.querySelectorAll('[data-min]').forEach(btn => {
      btn.onclick = async () => {
        try {
          await guildAction({ type: 'lock', minutes: Number(btn.dataset.min) });
          closeModal();
          alert(btn.dataset.min === '0' ? 'Server unlocked.' : 'Server locked.');
        } catch (err) { alert(err.message); }
      };
    });
  });
}

function openNotifyModal() {
  const current = notifyMode();
  const row = (id, title, sub) => `<button type="button" class="settings-choice ${current === id ? 'on' : ''}" data-mode="${id}"><strong>${title}</strong><span>${sub}</span></button>`;
  openModal('Notifications', `
    ${row('all', 'All messages', 'Ping me for every message')}
    ${row('mentions', 'Only @mentions', 'Pings for @you, your roles and replies')}
    ${row('nothing', 'Nothing', 'No pings. A direct @you still shows in the channel')}
  `, (root) => {
    root.querySelectorAll('[data-mode]').forEach(btn => {
      btn.onclick = () => {
        localStorage.setItem('nebula-notify-' + currentServerId, btn.dataset.mode);
        closeModal();
      };
    });
  });
}

function openNickModal() {
  openModal('Change nickname', `
    <div class="form-row"><label>Nickname on this server</label><input id="nick-input" maxlength="32" placeholder="Shown instead of your name" /></div>
    <button type="button" class="btn-primary" id="do-nick">Save</button>
  `, (root) => {
    root.querySelector('#do-nick').onclick = async () => {
      try {
        await guildAction({ type: 'nick', nick: root.querySelector('#nick-input').value });
        closeModal();
        await loadMembers();
      } catch (err) { alert(err.message); }
    };
  });
}

function openMuteModal() {
  openModal('Mute server', `
    <div style="display:flex;flex-direction:column;gap:8px">
      <button type="button" class="btn-secondary" data-ms="900000">For 15 minutes</button>
      <button type="button" class="btn-secondary" data-ms="3600000">For 1 hour</button>
      <button type="button" class="btn-secondary" data-ms="28800000">For 8 hours</button>
      <button type="button" class="btn-secondary" data-ms="86400000">For 24 hours</button>
      <button type="button" class="btn-secondary" data-ms="31536000000">Until I turn it back on</button>
      <button type="button" class="btn-primary" data-ms="0">Unmute</button>
    </div>
  `, (root) => {
    root.querySelectorAll('[data-ms]').forEach(btn => {
      btn.onclick = async () => {
        const ms = Number(btn.dataset.ms);
        localStorage.setItem('nebula-mute-' + currentServerId, ms ? String(Date.now() + ms) : '0');
        closeModal();
        if ($('server-title')) {
          const name = (currentServerMeta && currentServerMeta.name) || 'Server';
          $('server-title').textContent = name + (serverMuted() ? '  · muted' : '');
        }
      };
    });
  });
}

async function deleteThisServer() {
  const name = (currentServerMeta && currentServerMeta.name) || 'this server';
  if (!confirm('Delete ' + name + '? This cannot be undone.')) return;
  try {
    await guildAction({ type: 'delete' });
    currentServerId = 'nebula-official';
    await openServer('nebula-official');
  } catch (err) { alert(err.message); }
}

async function openEventsModal() {
  let events = [];
  try {
    const data = await api('/api/servers/' + currentServerId + '/settings');
    events = (data.settings && data.settings.events) || [];
  } catch (err) { alert(err.message); return; }
  const list = events.map(e => `<div class="settings-row"><div><strong>${escapeHtml(e.title)}</strong><div class="field-hint">${escapeHtml(e.when || '')} ${escapeHtml(e.description || '')}</div></div>${hasPerm(PERM.MANAGE_SERVER) ? `<button type="button" class="btn-secondary" data-del="${e.id}">Remove</button>` : ''}</div>`).join('') || '<p class="field-hint">No events yet.</p>';
  openModal('Events', `
    <div>${list}</div>
    ${hasPerm(PERM.MANAGE_SERVER) ? `
      <div class="form-row" style="margin-top:16px"><label>Name</label><input id="ev-title" maxlength="80" /></div>
      <div class="form-row"><label>When</label><input id="ev-when" maxlength="40" placeholder="Friday 8pm" /></div>
      <div class="form-row"><label>Details</label><input id="ev-desc" maxlength="400" /></div>
      <button type="button" class="btn-primary" id="do-event">Create event</button>
    ` : ''}
  `, (root) => {
    root.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        try { await guildAction({ type: 'event', remove: true, id: btn.dataset.del }); closeModal(); openEventsModal(); }
        catch (err) { alert(err.message); }
      };
    });
    const create = root.querySelector('#do-event');
    if (create) create.onclick = async () => {
      try {
        await guildAction({
          type: 'event',
          title: root.querySelector('#ev-title').value,
          when: root.querySelector('#ev-when').value,
          description: root.querySelector('#ev-desc').value,
        });
        closeModal();
        openEventsModal();
      } catch (err) { alert(err.message); }
    };
  });
}

async function openPingPicker() {
  try {
    const data = await api('/api/servers/' + currentServerId + '/settings');
    const ids = new Set((data.settings && data.settings.pingRoleIds) || []);
    const roles = ((data.settings && data.settings.roles) || []).filter(r => ids.has(r.id));
    const mine = await api('/api/members?serverId=' + encodeURIComponent(currentServerId));
    const meRow = (mine.members || []).find(m => me && m.id === me.id);
    const have = new Set(((meRow && meRow.roles) || []).map(r => r.id));
    if (!roles.length) {
      openModal('Ping roles', '<p class="field-hint">This server has no roles you can pick yet.</p>');
      return;
    }
    openModal('Ping roles', roles.map(r => `<label class="settings-row"><span>${escapeHtml(r.name)}</span><input type="checkbox" data-role="${r.id}" ${have.has(r.id) ? 'checked' : ''} /></label>`).join('') + '<p class="field-hint">Picking a role never gives you extra permissions.</p>', (root) => {
      root.querySelectorAll('[data-role]').forEach(box => {
        box.onchange = async () => {
          try { await guildAction({ type: 'ping-toggle', roleId: box.dataset.role }); }
          catch (err) { alert(err.message); box.checked = !box.checked; }
        };
      });
    });
  } catch (err) { alert(err.message); }
}

function openReportModal() {
  openModal('Report a member', `
    <div class="form-row"><label>Their user id</label><input id="rep-uid" placeholder="4" /></div>
    <div class="form-row"><label>What happened</label><input id="rep-text" maxlength="400" /></div>
    <button type="button" class="btn-primary" id="do-report">Send report</button>
  `, (root) => {
    root.querySelector('#do-report').onclick = async () => {
      try {
        const uid = root.querySelector('#rep-uid').value.trim();
        const mem = await api('/api/members?serverId=' + encodeURIComponent(currentServerId));
        const user = (mem.members || []).find(m => String(m.uid) === uid);
        if (!user) throw new Error('No member with that id');
        await guildAction({ type: 'report', userId: user.id, text: root.querySelector('#rep-text').value });
        closeModal();
        alert('Report sent.');
      } catch (err) { alert(err.message); }
    };
  });
}

function showOnboarding(ob) {
  const questions = (ob.questions || []).filter(q => q && q.q);
  openModal('Before you chat', `
    <p class="field-hint">Answer so you land in the right channels.</p>
    ${questions.map(q => `<label class="settings-row"><span>${escapeHtml(q.q)}</span><input type="checkbox" data-role="${escapeHtml(q.roleId || '')}" /></label>`).join('') || '<p class="field-hint">Nothing to pick. You can finish now.</p>'}
    <button type="button" class="btn-primary" id="do-onboard" style="margin-top:16px">Finish</button>
  `, (root) => {
    root.querySelector('#do-onboard').onclick = async () => {
      const roleIds = [];
      root.querySelectorAll('[data-role]').forEach(box => { if (box.checked && box.dataset.role) roleIds.push(box.dataset.role); });
      try {
        await guildAction({ type: 'onboard', roleIds });
        pendingOnboarding = null;
        if ($('msg-input')) $('msg-input').disabled = false;
        closeModal();
        await loadMembers();
      } catch (err) { alert(err.message); }
    };
  });
}

function openAddServerModal() {
  openModal('Add a server', `
    <div class="form-row"><label>Create a server</label><input id="new-server-name" maxlength="40" placeholder="Server name" /></div>
    <button type="button" class="btn-primary" id="do-create-server">Create</button>
    <div class="form-row" style="margin-top:24px"><label>Join with an invite</label><input id="join-code" maxlength="16" placeholder="Invite code" /></div>
    <button type="button" class="btn-secondary" id="do-join-server">Join</button>
    <p class="field-hint" id="add-server-hint"></p>
  `, (root) => {
    root.querySelector('#do-create-server').onclick = async () => {
      const name = root.querySelector('#new-server-name').value.trim();
      const hint = root.querySelector('#add-server-hint');
      try {
        const data = await api('/api/servers', { method: 'POST', body: { name } });
        closeModal();
        if (data.invite) {
          try { await navigator.clipboard.writeText(data.invite); } catch (_) {}
        }
        await openServer(data.server.id);
        alert('Server created. Invite code ' + data.invite + ' copied.');
      } catch (err) {
        hint.textContent = err.message;
        hint.className = 'field-hint err';
      }
    };
    root.querySelector('#do-join-server').onclick = async () => {
      const code = root.querySelector('#join-code').value.trim();
      const hint = root.querySelector('#add-server-hint');
      try {
        const data = await api('/api/invites/' + encodeURIComponent(code) + '/join', { method: 'POST', body: {} });
        if (data.pending) {
          hint.textContent = 'Request sent. Someone who runs the server has to accept you.';
          hint.className = 'field-hint';
          return;
        }
        closeModal();
        await openServer(data.server.id);
      } catch (err) {
        hint.textContent = err.message;
        hint.className = 'field-hint err';
      }
    };
  });
}

async function openInviteModal() {
  let invites = [];
  try {
    const data = await api('/api/servers/' + currentServerId + '/invites');
    invites = data.invites || [];
  } catch (err) {
    alert(err.message);
    return;
  }
  const list = invites.length
    ? invites.map(i => `<div class="invite-row"><code>${escapeHtml(i.code)}</code><span>${i.uses || 0} uses</span></div>`).join('')
    : '<p class="field-hint">No invites yet.</p>';
  openModal('Invite people', `
    <p class="field-hint">Share a code. They open + and choose Join with an invite.</p>
    <div id="invite-list">${list}</div>
    <button type="button" class="btn-primary" id="do-new-invite" style="margin-top:16px">Create invite</button>
  `, (root) => {
    root.querySelector('#do-new-invite').onclick = async () => {
      try {
        const data = await api('/api/servers/' + currentServerId + '/invites', { method: 'POST', body: {} });
        try { await navigator.clipboard.writeText(data.code); } catch (_) {}
        closeModal();
        alert('Invite ' + data.code + ' copied.');
      } catch (err) { alert(err.message); }
    };
  });
}

function openCreateChannel(type) {
  openModal(type === 'voice' ? 'Create voice channel' : 'Create channel', `
    <div class="form-row"><label>Name</label><input id="ch-new-name" maxlength="32" placeholder="new-channel" /></div>
    <div class="form-row"><label>Topic</label><input id="ch-new-topic" maxlength="200" placeholder="What's this channel for?" /></div>
    <button type="button" class="btn-primary" id="do-create-ch">Create</button>
  `, (root) => {
    root.querySelector('#do-create-ch').onclick = async () => {
      try {
        await api('/api/servers/' + currentServerId + '/channels', {
          method: 'POST',
          body: {
            name: root.querySelector('#ch-new-name').value,
            topic: root.querySelector('#ch-new-topic').value,
            type: type === 'voice' ? 'voice' : 'text',
          },
        });
        closeModal();
        await openServer(currentServerId);
      } catch (err) { alert(err.message); }
    };
  });
}

function roleAccessFields(channel) {
  const denies = {};
  (channel.overwrites || []).forEach(ow => {
    denies[ow.roleId] = denies[ow.roleId] || { view: false, send: false };
    if (ow.deny & PERM.VIEW) denies[ow.roleId].view = true;
    if (ow.deny & PERM.SEND) denies[ow.roleId].send = true;
  });
  return (serverRoles || []).map(r => {
    const d = denies[r.id] || {};
    const viewOn = d.view ? '' : 'checked';
    const sendOn = d.send ? '' : 'checked';
    return `<label class="role-access"><span class="role-dot" style="background:${r.color || '#99aab5'}"></span>${escapeHtml(r.name)}
      <span class="role-access-flags"><input type="checkbox" data-view="${r.id}" ${viewOn} /> View <input type="checkbox" data-send="${r.id}" ${sendOn} /> Send</span>
    </label>`;
  }).join('');
}

function overwritesFrom(root) {
  const roles = serverRoles || [];
  const viewOff = [];
  const sendOff = [];
  roles.forEach(r => {
    const v = root.querySelector(`[data-view="${r.id}"]`);
    const s = root.querySelector(`[data-send="${r.id}"]`);
    if (v && !v.checked) viewOff.push(r.id);
    if (s && !s.checked) sendOff.push(r.id);
  });
  if (!viewOff.length && !sendOff.length) return [];
  const map = {};
  const touch = (id) => { if (!map[id]) map[id] = { roleId: id, allow: 0, deny: 0 }; return map[id]; };
  if (viewOff.length) {
    roles.forEach(r => {
      const ow = touch(r.id);
      if (viewOff.includes(r.id)) ow.deny |= PERM.VIEW;
      else ow.allow |= PERM.VIEW;
    });
  }
  if (sendOff.length) {
    roles.forEach(r => {
      const ow = touch(r.id);
      if (sendOff.includes(r.id)) ow.deny |= PERM.SEND;
      else ow.allow |= PERM.SEND;
    });
  }
  return Object.values(map).sort((a, b) => (a.allow - a.deny) - (b.allow - b.deny));
}

function openEditChannel(channelId) {
  const ch = (channels || []).find(c => c.id === channelId);
  if (!ch) return;
  openModal('Edit #' + ch.name, `
    <div class="form-row"><label>Name</label><input id="ch-edit-name" maxlength="32" value="${escapeHtml(ch.name)}" /></div>
    <div class="form-row"><label>Topic</label><input id="ch-edit-topic" maxlength="200" value="${escapeHtml(ch.topic || '')}" /></div>
    <div class="form-section-label">Who can use this channel</div>
    <div class="role-access-list">${roleAccessFields(ch)}</div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button type="button" class="btn-primary" id="do-save-ch">Save</button>
      <button type="button" class="btn-secondary" id="do-del-ch" style="color:var(--red)">Delete</button>
    </div>
  `, (root) => {
    root.querySelector('#do-save-ch').onclick = async () => {
      try {
        await api('/api/servers/' + currentServerId + '/channels/' + channelId, {
          method: 'PATCH',
          body: {
            name: root.querySelector('#ch-edit-name').value,
            topic: root.querySelector('#ch-edit-topic').value,
            overwrites: overwritesFrom(root),
          },
        });
        closeModal();
        await openServer(currentServerId);
      } catch (err) { alert(err.message); }
    };
    root.querySelector('#do-del-ch').onclick = async () => {
      if (!confirm('Delete this channel?')) return;
      try {
        await api('/api/servers/' + currentServerId + '/channels/' + channelId, { method: 'DELETE' });
        if (currentChannel === channelId) currentChannel = '';
        closeModal();
        await openServer(currentServerId);
      } catch (err) { alert(err.message); }
    };
  });
}

const ROLE_FLAGS = [
  ['View channels', PERM.VIEW],
  ['Send messages', PERM.SEND],
  ['Create invite', PERM.INVITE],
  ['Manage channels', PERM.MANAGE_CHANNELS],
  ['Manage roles', PERM.MANAGE_ROLES],
  ['Manage server', PERM.MANAGE_SERVER],
  ['Administrator', PERM.ADMIN],
];

function openRolesModal() {
  const rows = (serverRoles || []).map(r => `<div class="role-line"><span class="role-dot" style="background:${r.color || '#99aab5'}"></span>${escapeHtml(r.name)}</div>`).join('');
  openModal('Roles', `
    <div class="role-line-list">${rows || '<p class="field-hint">No roles yet.</p>'}</div>
    <div class="form-section-label" style="margin-top:16px">New role</div>
    <div class="form-row"><label>Name</label><input id="role-name" maxlength="32" placeholder="Moderator" /></div>
    <div class="form-row"><label>Color</label><input id="role-color" value="#7c5cff" /></div>
    <div class="role-flag-list">${ROLE_FLAGS.map(([label, bit]) => `<label><input type="checkbox" data-bit="${bit}" ${bit === PERM.VIEW || bit === PERM.SEND ? 'checked' : ''}/> ${label}</label>`).join('')}</div>
    <button type="button" class="btn-primary" id="do-add-role">Add role</button>
    <div class="form-section-label" style="margin-top:20px">Give a role</div>
    <div class="form-row"><label>Member user id (#)</label><input id="role-uid" placeholder="2" /></div>
    <div class="form-row"><label>Role</label><select id="role-pick">${(serverRoles || []).filter(r => r.id !== 'everyone').map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px">
      <button type="button" class="btn-primary" id="do-give-role">Give</button>
      <button type="button" class="btn-secondary" id="do-take-role">Remove</button>
    </div>
  `, (root) => {
    root.querySelector('#do-add-role').onclick = async () => {
      let permissions = 0;
      root.querySelectorAll('[data-bit]').forEach(box => { if (box.checked) permissions |= Number(box.dataset.bit); });
      try {
        await api('/api/servers/' + currentServerId + '/roles', {
          method: 'POST',
          body: { name: root.querySelector('#role-name').value, color: root.querySelector('#role-color').value, permissions },
        });
        closeModal();
        await openServer(currentServerId);
        openRolesModal();
      } catch (err) { alert(err.message); }
    };
    const assign = async (action) => {
      const uid = root.querySelector('#role-uid').value.trim().replace(/^#/, '');
      const roleId = root.querySelector('#role-pick').value;
      try {
        const mem = await api('/api/members?serverId=' + encodeURIComponent(currentServerId));
        const user = (mem.members || []).find(m => String(m.uid) === uid);
        if (!user) throw new Error('No member with that id');
        await api('/api/servers/' + currentServerId + '/members/' + user.id + '/roles', {
          method: 'POST',
          body: { roleId, action },
        });
        closeModal();
        await openServer(currentServerId);
      } catch (err) { alert(err.message); }
    };
    root.querySelector('#do-give-role').onclick = () => assign('add');
    root.querySelector('#do-take-role').onclick = () => assign('remove');
  });
}

const SETTINGS_PAGES = [
  ['overview', 'Overview'],
  ['theme', 'Theme'],
  ['channels', 'Channels'],
  ['lobby', 'Lobby'],
  ['emoji', 'Emoji'],
  ['stickers', 'Stickers'],
  ['onboarding', 'Onboarding'],
  ['pings', 'Ping roles'],
  ['safety', 'Safety'],
  ['reports', 'Reports'],
  ['audit', 'Audit log'],
  ['members', 'Members'],
  ['requests', 'Join requests'],
  ['roles', 'Roles'],
  ['bans', 'Bans'],
];
const COLOR_SWATCHES = ['#7c5cff', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#00b0f4', '#f47fff', '#ffffff'];

function swatchRow(name, current) {
  return `<div class="swatches" data-swatch="${name}">${COLOR_SWATCHES.map(c => `<button type="button" class="swatch ${c === current ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</div><input data-hex="${name}" value="${escapeHtml(current || '')}" maxlength="20" />`;
}

async function readImageFile(file) {
  if (!file) throw new Error('Choose an image');
  if (file.size > 300000) throw new Error('Keep the image under 300 KB');
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
  if (typeof url !== 'string' || url.length > 400000) throw new Error('That image is too large');
  return url;
}

function settingsHtml(page, s) {
  if (page === 'overview') {
    return `<h3>Server profile</h3>
      <div class="form-row"><label>Server icon</label><input type="file" id="up-icon" accept="image/*" /></div>
      ${s.iconUrl ? '<img class="preview-img" alt="" src="' + String(s.iconUrl).replace(/"/g, '') + '">' : ''}
      <div class="form-row"><label>Banner</label><input type="file" id="up-banner" accept="image/*" /></div>
      <div class="form-row"><label>Server name</label><input id="set-name" maxlength="40" value="${escapeHtml(s.name || '')}" /></div>
      <div class="form-row"><label>Server tag (2–4 letters)</label><input id="set-tag" maxlength="4" value="${escapeHtml(s.tag || '')}" /></div>
      <div class="form-row"><label>Accent</label>${swatchRow('accent', (s.theme && s.theme.accent) || s.color || '#7c5cff')}</div>
      <button type="button" class="btn-primary" id="save-overview">Save</button>`;
  }
  if (page === 'theme') {
    return `<h3>Theme</h3>
      <p class="field-hint">Everyone sees these colours while they are in this server.</p>
      <div class="form-row"><label>Accent colour</label>${swatchRow('accent', (s.theme && s.theme.accent) || '#7c5cff')}</div>
      <div class="form-row"><label>Background tint</label>${swatchRow('tint', (s.theme && s.theme.tint) || '#313338')}</div>
      <button type="button" class="btn-primary" id="save-theme">Save</button>
      <button type="button" class="btn-secondary" id="clear-theme">Remove theme</button>`;
  }
  if (page === 'channels') {
    const cats = s.categories || [];
    const opts = (id) => `<option value="">No category</option>` + cats.map(c => `<option value="${c.id}" ${id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    return `<h3>Channels</h3>
      <button type="button" class="btn-primary" id="add-cat">Create category</button>
      ${(cats).map(c => `<div class="settings-row"><span>${escapeHtml(c.name)}</span><button type="button" class="btn-secondary" data-delcat="${c.id}">Delete</button></div>`).join('')}
      ${(s.channels || []).map(c => `<div class="settings-row"><span>${c.type === 'voice' ? '🔊' : '#'} ${escapeHtml(c.name)}</span><select data-catch="${c.id}">${opts(c.categoryId || '')}</select><button type="button" data-up="${c.id}">Up</button><button type="button" data-down="${c.id}">Down</button></div>`).join('')}`;
  }
  if (page === 'lobby') {
    return `<h3>Lobby</h3>
      <p class="field-hint">Shown above the message box for everyone in this server.</p>
      <label class="settings-row"><span>Show the lobby</span><input type="checkbox" id="lobby-on" ${s.showLobby ? 'checked' : ''} /></label>
      <div class="form-row"><label>About</label><textarea id="lobby-about" maxlength="2000" rows="5">${escapeHtml(s.about || '')}</textarea></div>
      <button type="button" class="btn-primary" id="save-lobby">Save</button>`;
  }
  if (page === 'emoji' || page === 'stickers') {
    const list = page === 'emoji' ? (s.emoji || []) : (s.stickers || []);
    const cap = page === 'emoji' ? 50 : 30;
    return `<h3>${page === 'emoji' ? 'Emoji' : 'Stickers'}</h3>
      <p class="field-hint">${list.length} / ${cap}. ${page === 'emoji' ? 'Type :name: in chat.' : 'They show in the sticker button next to the message box.'} PNG under 300 KB.</p>
      <div class="form-row"><label>Name</label><input id="asset-name" maxlength="32" placeholder="wave" /></div>
      <input type="file" id="asset-file" accept="image/*" />
      <button type="button" class="btn-primary" id="upload-asset">Upload</button>
      ${list.map(e => `<div class="settings-row"><img class="preview-img" alt="" src="${String(e.url).replace(/"/g, '')}"><span>:${escapeHtml(e.name)}:</span><button type="button" class="btn-secondary" data-delasset="${e.id}">Remove</button></div>`).join('') || '<p class="field-hint">Nothing here yet.</p>'}`;
  }
  if (page === 'onboarding') {
    const ob = s.onboarding || { enabled: false, mustFinish: false, questions: [] };
    return `<h3>Onboarding</h3>
      <label class="settings-row"><span>Turn on onboarding</span><input type="checkbox" id="ob-on" ${ob.enabled ? 'checked' : ''} /></label>
      <label class="settings-row"><span>Must finish before chatting</span><input type="checkbox" id="ob-must" ${ob.mustFinish ? 'checked' : ''} /></label>
      <div id="ob-qs">${(ob.questions || []).map((q, i) => `<div class="settings-row"><input data-oq="${i}" value="${escapeHtml(q.q || '')}" placeholder="Question" /><select data-orole="${i}">${(s.roles || []).filter(r => r.id !== 'everyone' && r.id !== 'owner').map(r => `<option value="${r.id}" ${q.roleId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}</select></div>`).join('')}</div>
      <button type="button" class="btn-secondary" id="ob-add">Add question</button>
      <button type="button" class="btn-primary" id="save-ob">Save</button>`;
  }
  if (page === 'pings') {
    const roles = (s.roles || []).filter(r => r.id !== 'everyone' && r.id !== 'owner');
    const picked = new Set(s.pingRoleIds || []);
    return `<h3>Ping roles</h3>
      <p class="field-hint">People pick these themselves from the server menu. A ping role never includes manage permissions.</p>
      <button type="button" class="btn-primary" id="ping-template">Add Announcements, Giveaways, Updates, Events, Polls</button>
      ${roles.map(r => `<label class="settings-row"><span>${escapeHtml(r.name)}</span><input type="checkbox" data-ping="${r.id}" ${picked.has(r.id) ? 'checked' : ''} /></label>`).join('') || '<p class="field-hint">Create a role first.</p>'}
      <button type="button" class="btn-primary" id="save-pings">Save</button>`;
  }
  if (page === 'safety') {
    const raid = s.raid || {};
    return `<h3>Safety</h3>
      <div class="form-section-label">Raid protection</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-secondary" data-lock="15">Lock 15 min</button>
        <button type="button" class="btn-secondary" data-lock="60">Lock 1 hour</button>
        <button type="button" class="btn-secondary" data-lock="1440">Lock 1 day</button>
        <button type="button" class="btn-primary" data-lock="0">Unlock</button>
      </div>
      <div class="form-section-label" style="margin-top:16px">Raid mode</div>
      <label class="settings-row"><span>On</span><input type="checkbox" id="raid-on" ${raid.on ? 'checked' : ''} /></label>
      <div class="form-row"><label>Block accounts younger than (days)</label><input id="raid-days" type="number" min="0" value="${Number(raid.accountDays) || 3}" /></div>
      <div class="form-row"><label>Verification</label>
        <select id="verify">${['none', 'low', 'medium', 'high'].map(v => `<option ${s.verification === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="form-row"><label>Who can join</label>
        <select id="join-mode"><option value="open" ${s.joinMode !== 'apply' ? 'selected' : ''}>Open invite</option><option value="apply" ${s.joinMode === 'apply' ? 'selected' : ''}>They apply, you approve</option></select>
      </div>
      <div class="form-row"><label>Question on the form</label><input id="join-q" maxlength="120" value="${escapeHtml((s.joinQuestions || [])[0] || '')}" /></div>
      <button type="button" class="btn-primary" id="save-safety">Save safety</button>`;
  }
  if (page === 'reports') {
    const rows = (s.reports || []).map(r => `<div class="settings-row"><div><strong>${escapeHtml(r.status)}</strong> ${escapeHtml(r.text || '')}</div>${r.status === 'open' ? `<button type="button" class="btn-secondary" data-report="${r.id}">Handled</button>` : ''}</div>`).join('');
    return `<h3>Reports</h3>${rows || '<p class="field-hint">Nothing to review.</p>'}`;
  }
  if (page === 'audit') {
    const rows = (s.audit || []).map(a => `<div class="settings-row"><div><strong>${escapeHtml(a.name || '')}</strong> ${escapeHtml(a.text || '')}<div class="field-hint">${escapeHtml(a.at || '')}</div></div></div>`).join('');
    return `<h3>Audit log</h3>${rows || '<p class="field-hint">No changes yet.</p>'}`;
  }
  if (page === 'members') {
    const rows = (s.members || []).map(m => `<div class="settings-row" data-member="${m.id}">
      <div><strong>${escapeHtml(m.nick || m.displayName || m.username)}</strong><div class="field-hint">@${escapeHtml(m.username || '')} · ${escapeHtml(String(m.uid || ''))}</div></div>
      <div class="member-tools">
        <button type="button" data-copy="${m.uid || ''}">Copy id</button>
        <button type="button" data-nick="${m.id}">Nickname</button>
        <button type="button" data-timeout="${m.id}">Time out</button>
        <button type="button" data-kick="${m.id}">Kick</button>
        <button type="button" data-ban="${m.id}">Ban</button>
      </div>
    </div>`).join('');
    return `<h3>Members</h3><input id="member-filter" placeholder="Search by name" /><div id="member-rows">${rows || '<p class="field-hint">No members.</p>'}</div>`;
  }
  if (page === 'requests') {
    const rows = (s.requests || []).map(r => `<div class="settings-row"><div>${escapeHtml((r.user && (r.user.displayName || r.user.username)) || 'Someone')}<div class="field-hint">${escapeHtml(r.message || '')}</div></div><button type="button" class="btn-primary" data-accept="${r.id}">Accept</button><button type="button" class="btn-secondary" data-decline="${r.id}">Decline</button></div>`).join('');
    return `<h3>Join requests</h3>${rows || '<p class="field-hint">Nobody is waiting.</p>'}`;
  }
  if (page === 'roles') {
    return `<h3>Roles</h3>
      ${(s.roles || []).map(r => `<div class="role-line"><span class="role-dot" style="background:${r.color || '#99aab5'}"></span>${escapeHtml(r.name)}</div>`).join('')}
      <div class="form-row"><label>New role</label><input id="role-name" maxlength="32" placeholder="Moderator" /></div>
      <div class="form-row"><label>Color</label><input id="role-color" value="#7c5cff" /></div>
      <div class="role-flag-list">${ROLE_FLAGS.map(([label, bit]) => `<label><input type="checkbox" data-bit="${bit}" ${bit === PERM.VIEW || bit === PERM.SEND ? 'checked' : ''}/> ${label}</label>`).join('')}</div>
      <button type="button" class="btn-primary" id="do-add-role">Add role</button>
      <div class="form-row" style="margin-top:16px"><label>Member user id</label><input id="role-uid" placeholder="2" /></div>
      <div class="form-row"><label>Role</label><select id="role-pick">${(s.roles || []).filter(r => r.id !== 'everyone').map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select></div>
      <button type="button" class="btn-primary" id="do-give-role">Give</button>
      <button type="button" class="btn-secondary" id="do-take-role">Remove</button>`;
  }
  if (page === 'bans') {
    const rows = (s.bans || []).map(b => `<div class="settings-row"><span>${escapeHtml((b.user && (b.user.displayName || b.user.username)) || b.userId)} ${escapeHtml(b.reason || '')}</span><button type="button" class="btn-secondary" data-unban="${b.userId}">Unban</button></div>`).join('');
    return `<h3>Bans</h3>${rows || '<p class="field-hint">No bans.</p>'}
      <div class="form-row"><label>Ban by user id</label><input id="ban-uid" placeholder="4" /></div>
      <div class="form-row"><label>Reason</label><input id="ban-reason" maxlength="200" /></div>
      <button type="button" class="btn-primary" id="do-ban">Ban</button>`;
  }
  return '';
}

function bindSwatches(root) {
  root.querySelectorAll('.swatch').forEach(btn => {
    btn.onclick = () => {
      const wrap = btn.closest('[data-swatch]');
      wrap.querySelectorAll('.swatch').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      const hex = root.querySelector(`[data-hex="${wrap.dataset.swatch}"]`);
      if (hex) hex.value = btn.dataset.color;
    };
  });
}

async function openServerSettings(startPage) {
  let settings;
  try {
    settings = (await api('/api/servers/' + currentServerId + '/settings')).settings;
  } catch (err) { alert(err.message); return; }
  openModal('Server settings', `
    <div class="settings-layout">
      <nav class="settings-nav">${SETTINGS_PAGES.map(([id, label]) => `<button type="button" data-page="${id}">${label}</button>`).join('')}</nav>
      <div class="settings-page" id="settings-page"></div>
    </div>
  `, (root) => {
    const pageEl = () => root.querySelector('#settings-page');
    const show = (id) => {
      root.querySelectorAll('.settings-nav button').forEach(b => b.classList.toggle('on', b.dataset.page === id));
      pageEl().innerHTML = settingsHtml(id, settings);
      bindSwatches(pageEl());
      wireSettings(pageEl(), id, settings, async () => {
        settings = (await api('/api/servers/' + currentServerId + '/settings')).settings;
        show(id);
        await openServer(currentServerId);
      });
    };
    root.querySelectorAll('.settings-nav button').forEach(b => { b.onclick = () => show(b.dataset.page); });
    show(startPage || 'overview');
  }, true);
}

function wireSettings(root, page, settings, refresh) {
  const save = async (body) => {
    await guildAction(Object.assign({ type: 'settings' }, body));
    await refresh();
  };
  const hex = (name) => { const el = root.querySelector(`[data-hex="${name}"]`); return el ? el.value : ''; };
  if (page === 'overview') {
    root.querySelector('#save-overview').onclick = async () => {
      try {
        const body = { name: root.querySelector('#set-name').value, tag: root.querySelector('#set-tag').value, color: hex('accent'), theme: { accent: hex('accent'), tint: (settings.theme && settings.theme.tint) || '' } };
        const icon = root.querySelector('#up-icon').files[0];
        const banner = root.querySelector('#up-banner').files[0];
        if (icon) body.iconUrl = await readImageFile(icon);
        if (banner) body.bannerUrl = await readImageFile(banner);
        await save(body);
      } catch (err) { alert(err.message); }
    };
  }
  if (page === 'theme') {
    root.querySelector('#save-theme').onclick = async () => {
      try { await save({ theme: { accent: hex('accent'), tint: hex('tint') }, color: hex('accent') }); }
      catch (err) { alert(err.message); }
    };
    root.querySelector('#clear-theme').onclick = async () => {
      try { await save({ theme: { accent: '#7c5cff', tint: '' } }); }
      catch (err) { alert(err.message); }
    };
  }
  if (page === 'channels') {
    root.querySelector('#add-cat').onclick = () => { closeModal(); openCategoryModal(); };
    root.querySelectorAll('[data-delcat]').forEach(btn => btn.onclick = async () => {
      try { await guildAction({ type: 'category-delete', categoryId: btn.dataset.delcat }); await refresh(); }
      catch (err) { alert(err.message); }
    });
    root.querySelectorAll('[data-catch]').forEach(sel => sel.onchange = async () => {
      try { await guildAction({ type: 'set-category', channelId: sel.dataset.catch, categoryId: sel.value }); await refresh(); }
      catch (err) { alert(err.message); }
    });
    root.querySelectorAll('[data-up], [data-down]').forEach(btn => btn.onclick = async () => {
      try { await guildAction({ type: 'move-channel', channelId: btn.dataset.up || btn.dataset.down, dir: btn.dataset.up ? 'up' : 'down' }); await refresh(); }
      catch (err) { alert(err.message); }
    });
  }
  if (page === 'lobby') {
    root.querySelector('#save-lobby').onclick = async () => {
      try { await save({ about: root.querySelector('#lobby-about').value, showLobby: root.querySelector('#lobby-on').checked }); }
      catch (err) { alert(err.message); }
    };
  }
  if (page === 'emoji' || page === 'stickers') {
    root.querySelector('#upload-asset').onclick = async () => {
      try {
        const url = await readImageFile(root.querySelector('#asset-file').files[0]);
        await guildAction({ type: page === 'emoji' ? 'emoji' : 'sticker', name: root.querySelector('#asset-name').value, url });
        await refresh();
      } catch (err) { alert(err.message); }
    };
    root.querySelectorAll('[data-delasset]').forEach(btn => btn.onclick = async () => {
      try { await guildAction({ type: page === 'emoji' ? 'emoji' : 'sticker', remove: true, id: btn.dataset.delasset }); await refresh(); }
      catch (err) { alert(err.message); }
    });
  }
  if (page === 'onboarding') {
    root.querySelector('#ob-add').onclick = () => {
      const box = root.querySelector('#ob-qs');
      const i = box.querySelectorAll('[data-oq]').length;
      const roles = (settings.roles || []).filter(r => r.id !== 'everyone' && r.id !== 'owner');
      box.insertAdjacentHTML('beforeend', `<div class="settings-row"><input data-oq="${i}" placeholder="Question" /><select data-orole="${i}">${roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select></div>`);
    };
    root.querySelector('#save-ob').onclick = async () => {
      const questions = [];
      root.querySelectorAll('[data-oq]').forEach(input => {
        const role = root.querySelector(`[data-orole="${input.dataset.oq}"]`);
        questions.push({ q: input.value, roleId: role ? role.value : '' });
      });
      try {
        await save({ onboarding: { enabled: root.querySelector('#ob-on').checked, mustFinish: root.querySelector('#ob-must').checked, questions } });
      } catch (err) { alert(err.message); }
    };
  }
  if (page === 'pings') {
    root.querySelector('#ping-template').onclick = async () => {
      try {
        const names = ['Announcements', 'Giveaways', 'Updates', 'Events', 'Polls'];
        for (const name of names) {
          if ((settings.roles || []).some(r => r.name === name)) continue;
          await api('/api/servers/' + currentServerId + '/roles', { method: 'POST', body: { name, color: '#7c5cff', permissions: PERM.VIEW } });
        }
        const fresh = (await api('/api/servers/' + currentServerId + '/settings')).settings;
        const ids = (fresh.roles || []).filter(r => names.includes(r.name)).map(r => r.id);
        await guildAction({ type: 'settings', pingRoleIds: ids.concat(fresh.pingRoleIds || []) });
        await refresh();
      } catch (err) { alert(err.message); }
    };
    root.querySelector('#save-pings').onclick = async () => {
      const pingRoleIds = [];
      root.querySelectorAll('[data-ping]').forEach(box => { if (box.checked) pingRoleIds.push(box.dataset.ping); });
      try { await save({ pingRoleIds }); } catch (err) { alert(err.message); }
    };
  }
  if (page === 'safety') {
    root.querySelectorAll('[data-lock]').forEach(btn => btn.onclick = async () => {
      try { await guildAction({ type: 'lock', minutes: Number(btn.dataset.lock) }); alert(btn.dataset.lock === '0' ? 'Unlocked.' : 'Locked.'); }
      catch (err) { alert(err.message); }
    });
    root.querySelector('#save-safety').onclick = async () => {
      try {
        await save({
          raid: { on: root.querySelector('#raid-on').checked, accountDays: Number(root.querySelector('#raid-days').value) || 0, joinHours: 1, durationHours: 6 },
          verification: root.querySelector('#verify').value,
          joinMode: root.querySelector('#join-mode').value,
          joinQuestions: [root.querySelector('#join-q').value].filter(Boolean),
        });
      } catch (err) { alert(err.message); }
    };
  }
  if (page === 'reports') {
    root.querySelectorAll('[data-report]').forEach(btn => btn.onclick = async () => {
      try { await guildAction({ type: 'report-handle', reportId: btn.dataset.report }); await refresh(); }
      catch (err) { alert(err.message); }
    });
  }
  if (page === 'members') {
    const filter = root.querySelector('#member-filter');
    filter.oninput = () => {
      const q = filter.value.toLowerCase();
      root.querySelectorAll('[data-member]').forEach(row => {
        row.hidden = q && !row.textContent.toLowerCase().includes(q);
      });
    };
    root.querySelectorAll('[data-copy]').forEach(btn => btn.onclick = () => navigator.clipboard.writeText(btn.dataset.copy).catch(() => {}));
    root.querySelectorAll('[data-nick]').forEach(btn => btn.onclick = async () => {
      const nick = prompt('Nickname', '') ;
      if (nick == null) return;
      try { await guildAction({ type: 'nick-other', userId: btn.dataset.nick, nick }); await refresh(); }
      catch (err) { alert(err.message); }
    });
    root.querySelectorAll('[data-timeout]').forEach(btn => btn.onclick = async () => {
      const minutes = Number(prompt('Time out for how many minutes? 0 clears it.', '10'));
      if (Number.isNaN(minutes)) return;
      try { await guildAction({ type: 'timeout', userId: btn.dataset.timeout, minutes }); await refresh(); }
      catch (err) { alert(err.message); }
    });
    root.querySelectorAll('[data-kick]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Kick this member?')) return;
      try { await guildAction({ type: 'kick', userId: btn.dataset.kick }); await refresh(); }
      catch (err) { alert(err.message); }
    });
    root.querySelectorAll('[data-ban]').forEach(btn => btn.onclick = async () => {
      const reason = prompt('Ban reason', '') || '';
      try { await guildAction({ type: 'ban', userId: btn.dataset.ban, reason }); await refresh(); }
      catch (err) { alert(err.message); }
    });
  }
  if (page === 'requests') {
    root.querySelectorAll('[data-accept], [data-decline]').forEach(btn => btn.onclick = async () => {
      try { await guildAction({ type: 'request', requestId: btn.dataset.accept || btn.dataset.decline, accept: !!btn.dataset.accept }); await refresh(); }
      catch (err) { alert(err.message); }
    });
  }
  if (page === 'roles') {
    root.querySelector('#do-add-role').onclick = async () => {
      let permissions = 0;
      root.querySelectorAll('[data-bit]').forEach(box => { if (box.checked) permissions |= Number(box.dataset.bit); });
      try {
        await api('/api/servers/' + currentServerId + '/roles', { method: 'POST', body: { name: root.querySelector('#role-name').value, color: root.querySelector('#role-color').value, permissions } });
        await refresh();
      } catch (err) { alert(err.message); }
    };
    const assign = async (action) => {
      const uid = root.querySelector('#role-uid').value.trim().replace(/^#/, '');
      const roleId = root.querySelector('#role-pick').value;
      try {
        const mem = await api('/api/members?serverId=' + encodeURIComponent(currentServerId));
        const user = (mem.members || []).find(m => String(m.uid) === uid);
        if (!user) throw new Error('No member with that id');
        await api('/api/servers/' + currentServerId + '/members/' + user.id + '/roles', { method: 'POST', body: { roleId, action } });
        await refresh();
      } catch (err) { alert(err.message); }
    };
    root.querySelector('#do-give-role').onclick = () => assign('add');
    root.querySelector('#do-take-role').onclick = () => assign('remove');
  }
  if (page === 'bans') {
    root.querySelectorAll('[data-unban]').forEach(btn => btn.onclick = async () => {
      try { await guildAction({ type: 'unban', userId: btn.dataset.unban }); await refresh(); }
      catch (err) { alert(err.message); }
    });
    root.querySelector('#do-ban').onclick = async () => {
      const uid = root.querySelector('#ban-uid').value.trim();
      try {
        const mem = await api('/api/members?serverId=' + encodeURIComponent(currentServerId));
        const user = (mem.members || []).find(m => String(m.uid) === uid);
        if (!user) throw new Error('No member with that id');
        await guildAction({ type: 'ban', userId: user.id, reason: root.querySelector('#ban-reason').value });
        await refresh();
      } catch (err) { alert(err.message); }
    };
  }
}

if ($('btn-stickers')) $('btn-stickers').onclick = async () => {
  const pop = $('sticker-pop');
  if (!pop) return;
  if (!pop.hidden) { pop.hidden = true; return; }
  if (!serverStickers.length) {
    pop.hidden = false;
    pop.innerHTML = '<p class="field-hint">No stickers on this server yet.</p>';
    return;
  }
  pop.innerHTML = serverStickers.map(s => `<button type="button" data-sticker="${escapeHtml(s.name)}"><img alt="" src="${String(s.url).replace(/"/g, '')}"></button>`).join('');
  pop.hidden = false;
  pop.querySelectorAll('[data-sticker]').forEach(btn => {
    btn.onclick = async () => {
      pop.hidden = true;
      try {
        await api('/api/channels/' + currentChannel + '/messages', { method: 'POST', body: { content: '[[sticker:' + btn.dataset.sticker + ']]' } });
        await loadMessages();
      } catch (err) { alert(err.message); }
    };
  });
};
if ($('server-title')) $('server-title').onclick = () => toggleServerMenu();
if ($('nav-add-server')) $('nav-add-server').onclick = () => openAddServerModal();
if ($('guild-modal-close')) $('guild-modal-close').onclick = () => closeModal();
document.addEventListener('click', (e) => {
  const menu = $('server-menu');
  if (!menu || menu.hidden) return;
  if (e.target.closest('#server-menu') || e.target.closest('#server-title')) return;
  menu.hidden = true;
});

async function enterApp() {
  $('auth-screen').style.display = 'none';
  $('app').classList.add('open');
  renderMe();
  try {
    const chData = await api('/api/channels');
    channels = chData.channels || [];
    servers = chData.servers || servers || [];
  } catch (e) {
    console.warn(e);
  }
  await openServer();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadMessages();
    if (chatMode === 'server') loadMembers();
    if (chatMode === 'home' || chatMode === 'dm') {
      refreshDmList();
      // Keep friend requests in sync for both users
      loadFriendsData();
    }
  }, 5000);
}

(async () => {
  if (!token) return;
  try {
    const data = await api('/api/me');
    me = data.user;
    await enterApp();
  } catch {
    logout();
  }
})();
