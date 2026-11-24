<script>
  import { onMount } from 'svelte';
  import { Search } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import { api } from '../api.js';
  import { ui, toast, staffReport } from '../state.svelte.js';

  const reasons = {
    harassment: 'Harassment or bullying',
    hate: 'Hate speech or slurs',
    sexual: 'Sexual content',
    child: 'Child safety',
    threats: 'Threats or violence',
    'self-harm': 'Self-harm or suicide',
    spam: 'Spam or scams',
    illegal: 'Something illegal',
    other: 'Something else',
  };

  let people = $state([]);
  let counts = $state({ accounts: 0, people: 0, bots: 0, online: 0, disabled: 0 });
  let loading = $state(true);
  let loadError = $state('');
  let q = $state('');
  let filter = $state('all');
  let sort = $state('new');
  let tab = $state('accounts');
  let selectedId = $state('');
  let busy = $state('');
  let nextName = $state('');
  let nextDisplay = $state('');
  let deleteText = $state('');
  let viewing = $state(null);

  const filters = [
    ['all', 'All'],
    ['people', 'People'],
    ['bots', 'Bots'],
    ['online', 'Online'],
    ['disabled', 'Disabled'],
  ];

  const selected = $derived(people.find((user) => user.id === selectedId) || null);
  const shown = $derived.by(() => {
    const query = q.trim().toLowerCase();
    let list = people.filter((user) => {
      if (filter === 'people' && user.bot) return false;
      if (filter === 'bots' && !user.bot) return false;
      if (filter === 'online' && user.status !== 'online') return false;
      if (filter === 'disabled' && !user.disabled) return false;
      if (!query) return true;
      const blob = [user.username, user.displayName, user.email, user.uid, user.id].join(' ').toLowerCase();
      return blob.includes(query);
    });
    list.sort((a, b) => {
      if (sort === 'old') return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
      if (sort === 'id') return (Number(a.uid) || 9999) - (Number(b.uid) || 9999);
      if (sort === 'name') return String(a.username || '').localeCompare(String(b.username || ''));
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    });
    return list;
  });

  function opened(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return 'Unknown';
    return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function seen(value) {
    const time = Number(value) || 0;
    if (!time) return 'No visit yet';
    return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function pick(user) {
    selectedId = user.id;
    nextName = user.username || '';
    nextDisplay = user.displayName || '';
    deleteText = '';
  }

  async function load() {
    loading = true;
    loadError = '';
    try {
      const data = await api('/api/staff/directory');
      people = data.users || [];
      counts = data.counts || counts;
      if (selectedId && !people.some((user) => user.id === selectedId)) selectedId = '';
      const current = people.find((user) => user.id === selectedId);
      if (current) {
        nextName = current.username || '';
        nextDisplay = current.displayName || '';
      }
    } catch (err) {
      loadError = err.message || 'Could not load accounts';
    } finally {
      loading = false;
    }
  }

  async function act(user, action, extra = {}) {
    if (!user || busy) return;
    busy = action;
    try {
      const data = await api('/api/staff/users/' + encodeURIComponent(user.id), { method: 'POST', body: { action, ...extra } });
      people = data.users || [];
      counts = data.counts || counts;
      if (action === 'delete') {
        selectedId = '';
        deleteText = '';
        toast('Account deleted');
        return;
      }
      const row = people.find((item) => item.id === user.id);
      if (row) {
        nextName = row.username || '';
        nextDisplay = row.displayName || '';
      }
      if (action === 'reset-username' || action === 'username') toast('Username is now @' + (row?.username || nextName));
      else if (action === 'disable') toast('Account disabled');
      else if (action === 'enable') toast('Account enabled');
      else if (action === 'logout') toast('Signed out everywhere');
      else toast('Saved');
    } catch (err) {
      toast(err.message);
    } finally {
      busy = '';
    }
  }

  onMount(load);
</script>

<div class="admin">
  <div class="stats">
    <div><strong>{counts.accounts}</strong><span>Accounts</span></div>
    <div><strong>{counts.people}</strong><span>People</span></div>
    <div><strong>{counts.bots}</strong><span>Bots</span></div>
    <div><strong>{counts.online}</strong><span>Online</span></div>
    <div><strong>{counts.disabled}</strong><span>Disabled</span></div>
  </div>

  <div class="tabs">
    <button type="button" class:on={tab === 'accounts'} onclick={() => (tab = 'accounts')}>Accounts</button>
    <button type="button" class:on={tab === 'reports'} onclick={() => (tab = 'reports')}>Reports</button>
  </div>

  {#if tab === 'reports'}
    <div class="report-list">
      {#each ui.staffReports.filter((report) => report.status !== 'closed') as report (report.id)}
        <article class="report-row">
          <div>
            <strong>@{report.target?.username || 'unknown'}</strong>
            <span>{reasons[report.reason] || report.reason || 'Report'} · {report.status}</span>
            {#if report.excerpt}<p>Message: {report.excerpt}</p>{/if}
            {#if report.text}<p>{report.text}</p>{/if}
          </div>
          <div class="report-acts">
            <button type="button" class="btn sm" onclick={() => (viewing = report)}>View</button>
            {#if report.status !== 'handled'}<button type="button" class="btn sm" onclick={() => staffReport(report.id, 'handle')}>Handle</button>{/if}
            <button type="button" class="btn sm" onclick={() => { staffReport(report.id, 'close'); if (viewing?.id === report.id) viewing = null; }}>Close</button>
          </div>
        </article>
      {:else}
        <p class="hint">No open reports.</p>
      {/each}
    </div>
    {#if viewing}
      <div class="report-view">
        <strong>Report on @{viewing.target?.username}</strong>
        <p>{reasons[viewing.reason] || 'Report'}</p>
        {#if viewing.excerpt}<p>Message: {viewing.excerpt}</p>{/if}
        <p>{viewing.text || 'No extra details.'}</p>
        <p class="hint">From @{viewing.reporter?.username || 'someone'} · {viewing.status}</p>
        <div class="report-acts">
          <button type="button" class="btn sm" onclick={() => staffReport(viewing.id, 'view')}>Mark viewed</button>
          <button type="button" class="btn sm" onclick={() => staffReport(viewing.id, 'handle')}>Handle</button>
          <button type="button" class="btn sm" onclick={() => { const id = viewing.id; viewing = null; staffReport(id, 'close'); }}>Close</button>
          <button type="button" class="btn sm" onclick={() => (viewing = null)}>Back</button>
        </div>
      </div>
    {/if}
  {:else if loading}
    <p class="hint">Loading accounts…</p>
  {:else if loadError}
    <div class="empty">
      <p>{loadError}</p>
      <button type="button" class="btn" onclick={load}>Try again</button>
    </div>
  {:else}
    <div class="toolbar">
      <label class="find">
        <Search size={16} />
        <input placeholder="Search name, id, or email" bind:value={q} />
      </label>
      <div class="chips">
        {#each filters as [id, label]}
          <button type="button" class:on={filter === id} onclick={() => (filter = id)}>{label}</button>
        {/each}
      </div>
      <select bind:value={sort} aria-label="Sort accounts">
        <option value="new">Newest first</option>
        <option value="old">Oldest first</option>
        <option value="id">User id</option>
        <option value="name">Username</option>
      </select>
    </div>
    <p class="hint">Created is when the account was made. Reset username replaces a bad name with user and their id.</p>

    <div class="board">
      <div class="list">
        {#each shown as user (user.id)}
          <button type="button" class="row" class:on={selectedId === user.id} onclick={() => pick(user)}>
            <Avatar user={user} size={36} />
            <span class="who">
              <strong>{user.displayName || user.username} {#if user.bot}<em>BOT</em>{/if} {#if user.disabled}<em class="off">Disabled</em>{/if}</strong>
              <small>@{user.username} · id {user.uid ?? '—'}</small>
            </span>
            <span class="when">{opened(user.createdAt)}</span>
          </button>
        {:else}
          <p class="hint">No accounts match.</p>
        {/each}
      </div>

      {#if selected}
        <aside class="detail">
          <div class="detail-head">
            <Avatar user={selected} size={48} />
            <div>
              <strong>{selected.displayName || selected.username}</strong>
              <small>@{selected.username}</small>
            </div>
          </div>
          <dl>
            <div><dt>User id</dt><dd>{selected.uid ?? '—'}</dd></div>
            <div><dt>Created</dt><dd>{opened(selected.createdAt)}</dd></div>
            <div><dt>Last seen</dt><dd>{seen(selected.lastSeen)}</dd></div>
            <div><dt>Status</dt><dd>{selected.disabled ? 'Disabled' : selected.status}</dd></div>
            {#if selected.email && Number(selected.uid) !== 1}<div><dt>Email</dt><dd>{selected.email}</dd></div>{/if}
            <div><dt>Sessions</dt><dd>{selected.sessions}{selected.mfa ? ' · authenticator on' : ''}</dd></div>
            <div><dt>Servers</dt><dd>{selected.servers.length ? selected.servers.map((server) => server.name).join(', ') : 'None'}</dd></div>
            {#if selected.bots}<div><dt>Bots</dt><dd>{selected.bots}</dd></div>{/if}
          </dl>

          {#if selected.canEdit}
            <label class="field">Username
              <input bind:value={nextName} maxlength="32" />
            </label>
            <div class="acts">
              <button type="button" class="btn brand" disabled={!!busy} onclick={() => act(selected, 'username', { username: nextName })}>Save username</button>
              <button type="button" class="btn" disabled={!!busy} onclick={() => act(selected, 'reset-username')}>Reset username</button>
            </div>
            <label class="field">Display name
              <input bind:value={nextDisplay} maxlength="32" />
            </label>
            <div class="acts">
              <button type="button" class="btn" disabled={!!busy} onclick={() => act(selected, 'display-name', { displayName: nextDisplay })}>Save display name</button>
              <button type="button" class="btn" disabled={!!busy} onclick={() => act(selected, 'reset-display')}>Reset display name</button>
            </div>
          {:else}
            <p class="hint">{selected.protected ? 'This owner account cannot be changed here.' : 'You cannot change this account.'}</p>
          {/if}

          {#if selected.canModerate}
            <div class="acts">
              {#if selected.disabled}
                <button type="button" class="btn" disabled={!!busy} onclick={() => act(selected, 'enable')}>Enable account</button>
              {:else}
                <button type="button" class="btn" disabled={!!busy} onclick={() => act(selected, 'disable')}>Disable account</button>
              {/if}
              <button type="button" class="btn" disabled={!!busy} onclick={() => act(selected, 'logout')}>Sign out everywhere</button>
              <button type="button" class="btn" disabled={!!busy} onclick={() => act(selected, 'badge')}>{selected.early ? 'Remove early badge' : 'Give early badge'}</button>
            </div>
            <label class="field">Delete account
              <input bind:value={deleteText} placeholder={'Type ' + selected.username} />
            </label>
            <button type="button" class="btn danger" disabled={!!busy || deleteText.trim().toLowerCase() !== String(selected.username || '').toLowerCase()} onclick={() => act(selected, 'delete')}>Delete account</button>
          {/if}
        </aside>
      {:else}
        <aside class="detail quiet">
          <p>Select an account to see when it was created and to reset the username.</p>
        </aside>
      {/if}
    </div>
  {/if}
</div>

<style>
  .admin { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  .stats div, .detail, .empty {
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
  }
  .stats div { padding: 12px; }
  .stats strong, .stats span { display: block; }
  .stats strong { font-size: 20px; }
  .stats span, .who small, .when, .detail small, dt { color: var(--faint); font-size: 12px; }
  .tabs, .chips, .acts { display: flex; flex-wrap: wrap; gap: 8px; }
  .tabs button, .chips button {
    border: 0; background: transparent; color: var(--muted); font-weight: 700; padding: 8px 2px;
  }
  .tabs button.on { color: var(--brand); box-shadow: inset 0 -2px 0 var(--brand); }
  .chips button { border-radius: 999px; padding: 6px 10px; background: rgba(255, 255, 255, 0.04); }
  .chips button.on { background: rgba(255, 79, 154, 0.18); color: white; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .find {
    flex: 1; min-width: 180px; display: flex; align-items: center; gap: 8px;
    background: #111218; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 0 10px;
  }
  .find input, .detail input, .toolbar select {
    width: 100%; background: transparent; border: 0; outline: none; color: white; padding: 8px 0;
  }
  .toolbar select {
    width: auto; background: #111218; border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px; padding: 8px 10px;
  }
  .board { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr); gap: 12px; align-items: start; }
  .list { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .row {
    width: 100%; display: flex; align-items: center; gap: 10px; text-align: left;
    background: rgba(255, 255, 255, 0.03); border: 1px solid transparent; border-radius: 12px; padding: 8px;
  }
  .row.on { border-color: rgba(255, 79, 154, 0.45); background: rgba(255, 79, 154, 0.08); }
  .who { flex: 1; min-width: 0; }
  .who strong, .who small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who em, .off { font-style: normal; font-size: 10px; font-weight: 800; margin-left: 4px; }
  .who em { color: #8eb6ff; }
  .off { color: #f0a0a2; }
  .when { flex-shrink: 0; }
  .detail { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .detail.quiet { color: var(--muted); }
  .detail-head { display: flex; align-items: center; gap: 10px; }
  .detail-head strong, .detail-head small { display: block; }
  dl { display: grid; gap: 8px; margin: 0; }
  dl div { display: flex; justify-content: space-between; gap: 12px; }
  dd { margin: 0; text-align: right; }
  .field { display: grid; gap: 4px; color: var(--faint); font-size: 12px; font-weight: 700; }
  .field input { background: #111218; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; }
  .empty { padding: 16px; display: grid; gap: 10px; }
  .btn.danger { color: #f06a6a; }
  @media (max-width: 800px) {
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .board { grid-template-columns: 1fr; }
    .when { display: none; }
  }
</style>
