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
  const st = me.status || 'online';

  // avatar
  const av = $('me-avatar');
  const ini = $('me-initial');
  if (av && ini) {
    // Reset both first so background shorthand never wipes the image
    av.style.backgroundColor = me.avatarColor || '#7c5cff';
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
      ? `background-image:url("${a.avatarUrl}");background-size:cover;background-position:center;background-color:${a.avatarColor || '#7c5cff'}` 
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
    ? `background-image:url("${user.avatarUrl}");background-size:cover;background-position:center;background-color:${user.avatarColor || '#7c5cff'}` 
    : `background:${user.avatarColor || '#7c5cff'}`;
  const letter = user.avatarUrl ? '' : initial(user.displayName || user.username);

  const banStyle = user.bannerUrl 
    ? `background-image:url("${user.bannerUrl}");background-size:cover;background-position:center;` 
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
        ? `background-image:url("${u.avatarUrl}");background-size:cover;background-position:center;background-color:${u.avatarColor || '#7c5cff'}` 
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
  let list = friends
