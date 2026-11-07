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
  // Bust any intermediary caches (ngrok / browser) on GET
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

function renderMe() {
  if (!me) return;
  const name = me.displayName || me.username;
  const sub = me.customStatus || me.status || 'Online';
  const color = me.avatarColor || '#7c5cff';
  const st = me.status || 'online';
  
  if ($('me-initial')) {
    if (me.avatarUrl) {
      $('me-initial').style.display = 'none';
      $('me-avatar').style.backgroundImage = `url(${me.avatarUrl})`;
    } else {
      $('me-initial').style.display = 'block';
      $('me-avatar').style.backgroundImage = 'none';
      $('me-initial').textContent = initial(name);
    }
  }
  if ($('me-avatar')) $('me-avatar').style.background = color;
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
  const text = channels.filter(c => c.type === 'text');
  const voice = channels.filter(c => c.type === 'voice');
  let html = '<div class="cat">Text Channels</div>';
  text.forEach(c => {
    html += `<div class="channel ${c.id === currentChannel && chatMode === 'server' ? 'active' : ''}" data-id="${c.id}">
      <span class="hash">#</span>${c.name}
    </div>`;
  });
  if (voice.length) {
    html += '<div class="cat" style="margin-top:16px">Voice Channels</div>';
    voice.forEach(c => {
      html += `<div class="channel voice" data-id="${c.id}">
        <span class="hash">🔊</span>${c.name}
      </div>`;
    });
  }
  el.innerHTML = html;
  el.querySelectorAll('.channel').forEach(node => {
    node.onclick = () => {
      const ch = channels.find(c => c.id === node.dataset.id);
      if (!ch || ch.type !== 'text') return;
      chatMode = 'server';
      dmUserId = null;
      dmUser = null;
      currentChannel = ch.id;
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
    const avStyle = a.avatarUrl 
      ? `background-image:url(${a.avatarUrl});background-size:cover;background-position:center;` 
      : `background:${a.avatarColor || '#7c5cff'}`;
    const letter = a.avatarUrl ? '' : initial(a.displayName || a.username);

    return `<div class="msg">
      <div class="av" style="${avStyle}" data-uid="${a.id}">${letter}</div>
      <div class="msg-body">
        <div class="msg-head">
          <span class="msg-author" style="color:${a.accentColor || '#fff'}" data-uid="${a.id}">${escapeHtml(a.displayName || a.username)}</span>
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-content">${escapeHtml(m.content)}</div>
      </div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
  box.querySelectorAll('[data-uid]').forEach(el => {
    el.onclick = (e) => showPopout(el.dataset.uid, e);
  });
}

async function loadMessages() {
  try {
    if (chatMode === 'dm' && dmUserId) {
      const data = await api(`/api/dms/${dmUserId}/messages`);
      const name = (data.other && (data.other.displayName || data.other.username)) || 'DM';
      renderMessageList(data.messages || [], name, 'Send a message to start the conversation.');
      return;
    }
    const data = await api(`/api/channels/${currentChannel}/messages`);
    renderMessageList(data.messages || [], '#' + currentChannel, 'This is the start of the channel. Say hi!');
  } catch (e) {
    console.warn('loadMessages', e);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  // mode: 'server' | 'home'
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

  // Server rail active states
  document.querySelectorAll('.server-icon[data-server-id], #nav-server').forEach(el => {
    el.classList.toggle('active', mode === 'server');
  });
  if ($('nav-home')) $('nav-home').classList.toggle('active', mode === 'home');
}

if ($('nav-server')) $('nav-server').onclick = () => openServer();
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

  const avStyle = user.avatarUrl 
    ? `background-image:url(${user.avatarUrl});background-size:cover;background-position:center;` 
    : `background:${user.avatarColor || '#7c5cff'}`;
  const letter = user.avatarUrl ? '' : initial(user.displayName || user.username);

  const banStyle = user.bannerUrl 
    ? `background-image:url(${user.bannerUrl});background-size:cover;background-position:center;` 
    : `background:${user.bannerColor || user.accentColor || '#7c5cff'}`;

  box.innerHTML = `
    <div class="dm-profile-banner" style="${banStyle}"></div>
    <div class="dm-profile-body">
      <div class="dm-profile-av" style="${avStyle}">${letter}</div>
      <div class="dm-profile-name">${escapeHtml(user.displayName || user.username)}</div>
      ${badges ? `<div class="badge-list" style="margin-top:8px">${badges}</div>` : ''}
      ${user.bio ? `<div class="dm-profile-section"><h4>About Me</h4><p style="font-size:14px;color:var(--text-muted)">${escapeHtml(user.bio)}</p></div>` : ''}
      <div class="dm-profile-section"><h4>User ID</h4><p style="font-size:14px;color:var(--text-muted)">#${user.uid != null ? user.uid : '—'}</p></div>
      <div class="dm-profile-section"><h4>Member Since</h4><p style="font-size:14px;color:var(--text-muted)">${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</p></div>
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
      const avStyle = u.avatarUrl 
        ? `background-image:url(${u.avatarUrl});background-size:cover;background-position:center;` 
        : `background:${u.avatarColor || '#7c5cff'}`;
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

  const avStyle = u.avatarUrl 
    ? `background-image:url(${u.avatarUrl});background-size:cover;background-position:center;` 
    : `background:${u.avatarColor || '#7c5cff'}`;
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
        // Cancel outgoing request (clears your outgoing + their incoming)
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
    // Only real friends — never mix in server members
    friendsCache = {
      friends: Array.isArray(data.friends) ? data.friends : [],
      incoming: Array.isArray(data.incoming) ? data.incoming : [],
      outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
    };
    // Show incoming count on Pending tab
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

async function openServer() {
  setRail('server');
  chatMode = 'server';
  dmUserId = null;
  dmUser = null;
  showMainView('view-chat');
  renderDmProfile(null);
  try {
    const chData = await api('/api/channels');
    channels = chData.channels || [];
    if (chData.servers) servers = chData.servers;
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
  await loadMessages();
  await loadMembers();
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
    // Always refetch so the other user sees new incoming requests
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
  // Enter key on input
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
    const data = await api('/api/members');
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
    el.querySelectorAll('[data-uid]').forEach(node => {
      node.onclick = (e) => showPopout(node.dataset.uid, e);
    });
  } catch (e) {
    console.warn('loadMembers', e);
    el.innerHTML = `<div class="members-cat">Members</div><div style="padding:8px;color:var(--text-faint);font-size:13px">Could not load</div>`;
  }
}

function memberRow(m) {
  const avStyle = m.avatarUrl
    ? `background-image:url(${m.avatarUrl});background-size:cover;background-position:center;background-color:${m.avatarColor || '#7c5cff'}`
    : `background:${m.avatarColor || '#7c5cff'}`;
  const letter = m.avatarUrl ? '' : initial(m.displayName || m.username);
  return `<div class="member" data-uid="${m.id}">
    <div class="av" style="${avStyle}">
      ${letter}
      <span class="status-dot ${m.status || 'online'}" style="width:12px;height:12px;border-width:2px"></span>
    </div>
    <div>
      <div class="member-name" style="color:${m.accentColor || ''}">${escapeHtml(m.displayName || m.username)}</div>
      ${m.customStatus ? `<div class="member-status">${escapeHtml(m.customStatus)}</div>` : ''}
    </div>
  </div>`;
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
    // Refresh friends so Add Friend state is accurate
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

    const bannerStyle = u.bannerUrl
      ? `background-image:url(${u.bannerUrl});background-size:cover;background-position:center`
      : `background:${u.bannerColor || u.accentColor || '#7c5cff'}`;
    const avStyle = u.avatarUrl
      ? `background-image:url(${u.avatarUrl});background-size:cover;background-position:center;background-color:${u.avatarColor || '#7c5cff'}`
      : `background:${u.avatarColor || '#7c5cff'}`;
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
      } else {
        actionHtml = `<button type="button" class="popout-full-btn popout-primary" id="popout-add-friend">Add Friend</button>`;
      }
    }

    const pop = $('popout');
    pop.innerHTML = `
      <div class="popout-banner" style="${bannerStyle}"></div>
      <div class="popout-body">
        <div class="popout-av" style="${avStyle}">${letter}</div>
        <div class="popout-name">${escapeHtml(u.displayName || u.username)}</div>
        <div class="popout-user">@${escapeHtml(u.username)}${u.uid != null ? ' · #' + u.uid : ''}${u.pronouns ? ' · ' + escapeHtml(u.pronouns) : ''}</div>
        ${badges ? `<div class="badge-list" style="margin-top:8px">${badges}</div>` : ''}
        ${u.bio ? `<div class="popout-section"><h4>About Me</h4><p style="font-size:14px;color:var(--text-muted)">${escapeHtml(u.bio)}</p></div>` : ''}
        ${u.customStatus ? `<div class="popout-section"><h4>Status</h4><p style="font-size:14px">${escapeHtml(u.customStatus)}</p></div>` : ''}
        <div class="popout-section"><h4>Member Since</h4><p style="font-size:14px;color:var(--text-muted)">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</p></div>
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
        addBtn.textContent = 'Sending…';
        try {
          const data = await api('/api/friends/request', { method: 'POST', body: { username: u.username } });
          addBtn.textContent = data.status === 'accepted' ? 'Friends!' : 'Request Sent';
          await loadFriendsData();
          setTimeout(() => showPopout(uid, ev), 400);
        } catch (err) {
          addBtn.disabled = false;
          addBtn.textContent = 'Add Friend';
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
    av.style.backgroundImage = `url(${avUrl})`;
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
      ban.style.backgroundImage = `url(${banUrl})`;
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
