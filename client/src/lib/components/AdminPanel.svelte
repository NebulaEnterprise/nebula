<script>
  import { onMount } from 'svelte';
  import { Search, Shield, Users, Server, Activity, AlertTriangle, Bot, Ban, Clock, VolumeX, MessageSquareWarning, UserX, X, Copy, Download } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import { api } from '../api.js';
  import { toast, staffReport } from '../state.svelte.js';

  let people = $state([]);
  let counts = $state({ accounts: 0, people: 0, bots: 0, online: 0, disabled: 0, servers: 0, reports: 0 });
  let servers = $state([]);
  let audit = $state([]);
  let owner = $state(false);
  let loading = $state(true);
  let loadError = $state('');
  let q = $state('');
  let filter = $state('all');
  let selectedId = $state('');
  let open = $state(false);
  let tab = $state('actions');
  let busy = $state('');
  let pending = $state('');
  let reason = $state('');
  let hours = $state(24);
  let minutes = $state(60);
  let serverId = $state('');
  let roleId = $state('');
  let since = $state('');
  let note = $state('');
  let nextName = $state('');
  let nextDisplay = $state('');
  let nextEmail = $state('');
  let deleteText = $state('');
  let tempPassword = $state('');
  let formError = $state('');

  const tabs = [
    ['actions', 'Actions'],
    ['roles', 'Roles'],
    ['permissions', 'Permissions'],
    ['activity', 'Activity'],
    ['reports', 'Reports'],
    ['moderation', 'Moderation'],
    ['notes', 'Notes'],
    ['settings', 'Settings'],
  ];

  const tiles = [
    ['global-ban', 'Ban user', 'Platform-wide', true],
    ['suspend', 'Suspend', 'Timed lockout', true],
    ['warn', 'Warn user', 'Add a warning', true],
    ['mute', 'Mute user', 'Stop their messages', false],
    ['kick', 'Kick', 'One server', true],
    ['server-ban', 'Server ban', 'One community', true],
    ['delete-messages', 'Delete messages', 'Their posts', true],
    ['lock', 'Lock account', 'No new messages', true],
    ['logout', 'Force logout', 'Every session', false],
  ];

  const selected = $derived(people.find((user) => user.id === selectedId) || null);
  const shown = $derived.by(() => {
    const query = q.trim().toLowerCase();
    return people.filter((user) => {
      if (filter === 'people' && user.bot) return false;
      if (filter === 'bots' && !user.bot) return false;
      if (filter === 'online' && user.status !== 'online') return false;
      if (filter === 'held' && !(user.disabled || user.globalBan || user.deleted || user.locked)) return false;
      if (!query) return true;
      return [user.username, user.displayName, user.uid, user.id, user.email].join(' ').toLowerCase().includes(query);
    });
  });

  function when(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return 'Unknown';
    const delta = Date.now() - time;
    if (delta < 60000) return 'Just now';
    if (delta < 3600000) return Math.floor(delta / 60000) + 'm ago';
    if (delta < 86400000) return Math.floor(delta / 3600000) + 'h ago';
    return new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function stamp(value) {
    const time = typeof value === 'number' ? value : Date.parse(value || '');
    if (!time) return 'Not recorded';
    return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function pill(user) {
    if (user.deleted) return ['Deleted', 'bad'];
    if (user.globalBan) return ['Banned', 'bad'];
    if (user.disabled) return ['Disabled', 'bad'];
    if (user.locked || user.muted) return ['Restricted', 'warn'];
    if (user.premium) return ['Premium', 'good'];
    if (user.bot) return ['Bot', 'neutral'];
    return ['Member', 'good'];
  }

  function apply(data) {
    people = data.users || [];
    counts = { ...counts, ...(data.counts || {}) };
    servers = data.servers || [];
    audit = data.audit || [];
    owner = !!data.owner;
    if (selectedId && !people.some((user) => user.id === selectedId)) {
      selectedId = '';
      open = false;
    }
  }

  async function load() {
    loading = true;
    loadError = '';
    try {
      apply(await api('/api/staff/directory'));
    } catch (err) {
      loadError = err.message || 'Could not load admin';
    } finally {
      loading = false;
    }
  }

  function choose(user, nextTab = 'actions') {
    selectedId = user.id;
    open = true;
    tab = nextTab;
    pending = '';
    reason = '';
    formError = '';
    tempPassword = '';
    nextName = user.username || '';
    nextDisplay = user.displayName || '';
    nextEmail = user.email || '';
    deleteText = '';
    note = '';
    serverId = (user.roles && user.roles[0] && user.roles[0].id) || (servers[0] && servers[0].id) || '';
  }

  function arm(action) {
    if (!selected) {
      toast('Pick a user first');
      return;
    }
    pending = action;
    reason = '';
    formError = '';
    open = true;
    tab = action === 'note' ? 'notes' : action === 'case' || action === 'warn' ? 'moderation' : 'actions';
  }

  const reasonActions = ['global-ban', 'suspend', 'disable', 'delete', 'purge', 'kick', 'server-ban', 'delete-messages', 'lock', 'warn', 'case', 'timeout'];

  async function run(action, extra = {}) {
    if (!selected) return;
    if (reasonActions.includes(action) && reason.trim().length < 3) {
      formError = 'Add a reason';
      pending = action;
      return;
    }
    if (action === 'purge' && deleteText.trim() !== selected.username) {
      formError = 'Type their username to confirm';
      pending = action;
      return;
    }
    busy = action;
    formError = '';
    try {
      const data = await api('/api/staff/users/' + encodeURIComponent(selected.id), {
        method: 'POST',
        body: { action, reason: reason.trim(), hours: Number(hours) || 24, minutes: Number(minutes) || 60, serverId, roleId, since, text: note, email: nextEmail, username: nextName, displayName: nextDisplay, ...extra },
      });
      apply(data);
      tempPassword = data.temporaryPassword || '';
      pending = '';
      reason = '';
      note = '';
      toast('Saved');
      if (action === 'purge') open = false;
    } catch (err) {
      formError = err.message || 'Could not save';
    } finally {
      busy = '';
    }
  }

  function ask(action) {
    pending = action;
    formError = '';
    reason = '';
  }

  async function copyId() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(String(selected.uid || selected.id));
      toast('Copied');
    } catch (_) {
      toast(String(selected.uid || selected.id));
    }
  }

  function exportUser() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (selected.username || 'user') + '.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function closeReport(id, action) {
    busy = id;
    try {
      await staffReport(id, action);
      await load();
    } catch (err) {
      formError = err.message || 'Could not update the report';
    } finally {
      busy = '';
    }
  }

  onMount(load);
</script>

<section class="adm">
  <header class="adm-head">
    <div class="adm-mark"><Shield size={18} /></div>
    <div>
      <h2>Admin Panel</h2>
      <p>Manage accounts, roles, and the official server.</p>
    </div>
    <span class="adm-live"><i></i> All systems operational</span>
  </header>

  {#if loadError}
    <p class="adm-error">{loadError}</p>
  {/if}

  <div class="adm-stats">
    <article><Users size={16} /><b>{counts.accounts.toLocaleString()}</b><span>Accounts</span><small>{counts.people.toLocaleString()} people</small></article>
    <article><Server size={16} /><b>{counts.servers.toLocaleString()}</b><span>Servers</span><small>Communities on Nebula</small></article>
    <article><Activity size={16} /><b>{counts.online.toLocaleString()}</b><span>Online now</span><small>From the directory</small></article>
    <article><AlertTriangle size={16} /><b>{counts.reports.toLocaleString()}</b><span>Open reports</span><small>{counts.disabled.toLocaleString()} restricted</small></article>
  </div>

  <div class="adm-grid">
    <section class="adm-card adm-users">
      <div class="adm-card-top">
        <h3>User management</h3>
        <span>{shown.length}</span>
      </div>
      <label class="adm-search"><Search size={14} /><input bind:value={q} placeholder="Search username or id" /></label>
      <div class="adm-filters">
        {#each [['all', 'All'], ['people', 'People'], ['online', 'Online'], ['held', 'Restricted'], ['bots', 'Bots']] as [id, label]}
          <button type="button" class:on={filter === id} onclick={() => (filter = id)}>{label}</button>
        {/each}
      </div>
      <div class="adm-list">
        {#if loading}
          <p class="adm-empty">Loading accounts…</p>
        {:else if !shown.length}
          <p class="adm-empty">No accounts match.</p>
        {:else}
          {#each shown as user (user.id)}
            {@const tag = pill(user)}
            <button type="button" class="adm-row" class:on={selectedId === user.id} onclick={() => choose(user)}>
              <Avatar {user} size={36} />
              <span>
                <strong>{user.displayName || user.username}</strong>
                <small>@{user.username} · id {user.uid || '—'}</small>
              </span>
              <em class={tag[1]}>{tag[0]}</em>
            </button>
          {/each}
        {/if}
      </div>
    </section>

    <div class="adm-side">
      <section class="adm-card">
        <div class="adm-card-top"><h3>Servers</h3></div>
        {#if !servers.length}
          <p class="adm-empty">No servers yet.</p>
        {:else}
          {#each servers as server (server.id)}
            <div class="adm-server">
              <strong>{server.name}</strong>
              <small>{server.members.toLocaleString()} members</small>
            </div>
          {/each}
        {/if}
      </section>
      <section class="adm-card">
        <div class="adm-card-top"><h3>Moderation</h3><small>Pick a user, then confirm</small></div>
        <div class="adm-tools">
          <button type="button" onclick={() => arm('global-ban')}><Ban size={15} /> Global ban</button>
          <button type="button" onclick={() => arm('server-ban')}><Ban size={15} /> Server ban</button>
          <button type="button" onclick={() => arm('kick')}><UserX size={15} /> Kick</button>
          <button type="button" onclick={() => arm('timeout')}><Clock size={15} /> Timeout</button>
          <button type="button" onclick={() => arm('warn')}><MessageSquareWarning size={15} /> Warn</button>
          <button type="button" onclick={() => arm('mute')}><VolumeX size={15} /> Mute</button>
        </div>
      </section>
      <section class="adm-card">
        <div class="adm-card-top"><h3>Audit log</h3></div>
        {#if !audit.length}
          <p class="adm-empty">Staff actions will show up here.</p>
        {:else}
          {#each audit as row (row.id)}
            <div class="adm-audit">
              <strong>{row.actorName}</strong>
              <span>{row.action}{row.targetName ? ' · ' + row.targetName : ''}</span>
              <small>{when(row.at)}</small>
            </div>
          {/each}
        {/if}
      </section>
      <section class="adm-card adm-bot">
        <Bot size={22} />
        <div>
          <strong>Nebula bot</strong>
          <small>{counts.bots.toLocaleString()} bot {counts.bots === 1 ? 'account' : 'accounts'}</small>
        </div>
      </section>
    </div>
  </div>

  {#if open && selected}
    <div class="adm-shade" role="presentation" onclick={() => (open = false)}>
      <div class="adm-modal" role="dialog" aria-label="User admin" onclick={(event) => event.stopPropagation()}>
        <header class="adm-modal-top">
          <strong>{selected.displayName || selected.username}</strong>
          <div class="adm-tabs">
            {#each tabs as [id, label]}
              <button type="button" class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
            {/each}
          </div>
          <button type="button" class="adm-x" onclick={() => (open = false)} aria-label="Close"><X size={16} /></button>
        </header>
        <div class="adm-modal-body">
          <aside>
            <Avatar user={selected} size={84} />
            <h3>{selected.displayName || selected.username}</h3>
            <p>@{selected.username}</p>
            <p>ID {selected.uid || '—'}</p>
            {#if selected.protected}
              <em class="warn">Permissions do not apply</em>
            {:else}
              {@const tag = pill(selected)}
              <em class={tag[1]}>{tag[0]}</em>
            {/if}
            <dl>
              <div><dt>Servers</dt><dd>{selected.servers.length}</dd></div>
              <div><dt>Last seen</dt><dd>{stamp(selected.lastSeen)}</dd></div>
              <div><dt>Joined</dt><dd>{stamp(selected.createdAt)}</dd></div>
            </dl>
            {#if owner && selected.email}
              <p class="adm-mail">{selected.email}</p>
            {:else if Number(selected.uid) === 1}
              <p class="adm-mail">Email hidden</p>
            {/if}
          </aside>
          <div class="adm-main">
            {#if formError}<p class="adm-error">{formError}</p>{/if}
            {#if tempPassword}
              <p class="adm-pass">Temporary password: <code>{tempPassword}</code></p>
            {/if}
            {#if pending}
              <form class="adm-confirm" onsubmit={(event) => { event.preventDefault(); run(pending); }}>
                <strong>{pending.replace('-', ' ')}</strong>
                {#if pending === 'suspend'}
                  <label>Hours <input type="number" min="1" max="720" bind:value={hours} /></label>
                {/if}
                {#if pending === 'timeout'}
                  <label>Minutes <input type="number" min="1" max="10080" bind:value={minutes} /></label>
                {/if}
                {#if ['kick', 'server-ban', 'timeout', 'unban'].includes(pending)}
                  <label>Server
                    <select bind:value={serverId}>
                      {#each servers as server}
                        <option value={server.id}>{server.name}</option>
                      {/each}
                    </select>
                  </label>
                {/if}
                {#if pending === 'delete-messages'}
                  <label>Since <input type="date" bind:value={since} /></label>
                {/if}
                {#if pending === 'purge'}
                  <label>Type @{selected.username} <input bind:value={deleteText} /></label>
                {/if}
                <label>Reason <input bind:value={reason} placeholder="Why this is happening" /></label>
                <div>
                  <button type="submit" disabled={!!busy}>Confirm</button>
                  <button type="button" class="ghost" onclick={() => (pending = '')}>Cancel</button>
                </div>
              </form>
            {/if}

            {#if tab === 'actions'}
              <div class="adm-tiles">
                {#each tiles as [action, title, blurb]}
                  <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask(action)}>
                    <strong>{title}</strong><small>{blurb}</small>
                  </button>
                {/each}
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('unmute') }><strong>Unmute</strong><small>Allow messages</small></button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('global-unban')}><strong>Remove platform ban</strong><small>Global only</small></button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('unban')}><strong>Remove server ban</strong><small>One community</small></button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('logout')}><strong>Revoke sessions</strong><small>Sign out everywhere</small></button>
              </div>
            {:else if tab === 'roles'}
              {#if !selected.roles.length}
                <p class="adm-empty">Not in a server.</p>
              {/if}
              {#each selected.roles as membership (membership.id)}
                <div class="adm-block">
                  <strong>{membership.name}</strong>
                  {#if membership.banned}<em class="bad">Banned</em>{/if}
                  <div class="adm-chips">
                    {#each membership.roles as role (role.id)}
                      <button type="button" disabled={!selected.canEdit || role.id === 'everyone' || !!busy} onclick={() => run('role', { serverId: membership.id, roleId: role.id, remove: true })}>{role.name} ×</button>
                    {/each}
                  </div>
                  <label>Add role
                    <select bind:value={roleId} onchange={() => roleId && run('role', { serverId: membership.id, roleId, remove: false })}>
                      <option value="">Select</option>
                      {#each (servers.find((server) => server.id === membership.id)?.roles || []) as role}
                        <option value={role.id}>{role.name}</option>
                      {/each}
                    </select>
                  </label>
                </div>
              {/each}
            {:else if tab === 'permissions'}
              <div class="adm-tiles">
                {#each [['messages', 'Messages', selected.restrictMessages], ['images', 'Images', selected.restrictImages], ['files', 'Files', selected.restrictFiles], ['voice', 'Voice', selected.restrictVoice]] as [flag, label, on]}
                  <button type="button" class:on disabled={!selected.canEdit || !!busy} onclick={() => run('restrict', { flag })}>
                    <strong>{label}</strong><small>{on ? 'Restricted' : 'Allowed'}</small>
                  </button>
                {/each}
              </div>
              <p class="adm-note">A global ban covers every server. A server ban only removes them from the community you pick.</p>
            {:else if tab === 'activity'}
              <div class="adm-block">
                <strong>Previous usernames</strong>
                {#if !selected.nameHistory.length}<p>None recorded.</p>{:else}
                  {#each selected.nameHistory as row}<p>@{row.name} · {when(row.at)}</p>{/each}
                {/if}
              </div>
              <div class="adm-block">
                <strong>Previous display names</strong>
                {#if !selected.displayHistory.length}<p>None recorded.</p>{:else}
                  {#each selected.displayHistory as row}<p>{row.name} · {when(row.at)}</p>{/each}
                {/if}
              </div>
              <div class="adm-block">
                <strong>Servers</strong>
                {#each selected.servers as server}<p>{server.name}</p>{/each}
                {#if !selected.servers.length}<p>None.</p>{/if}
              </div>
              {#if owner}
                <div class="adm-block">
                  <strong>Sessions</strong>
                  <p>{selected.sessions} active. IP addresses are not stored.</p>
                  {#each selected.sessionList as row}<p>{(row.id || '').slice(0, 8)} · seen {stamp(row.lastSeen)}</p>{/each}
                </div>
              {/if}
            {:else if tab === 'reports'}
              {#if !selected.reports.length}
                <p class="adm-empty">No reports against this account.</p>
              {/if}
              {#each selected.reports as report (report.id)}
                <div class="adm-block">
                  <strong>{report.reason || 'Report'}</strong>
                  <p>{report.text}</p>
                  <small>{report.status} · {when(report.at)}</small>
                  {#if report.status !== 'closed' && report.status !== 'handled'}
                    <div class="adm-inline">
                      <button type="button" disabled={!!busy} onclick={() => closeReport(report.id, 'handle')}>Resolve</button>
                      <button type="button" class="ghost" disabled={!!busy} onclick={() => closeReport(report.id, 'close')}>Dismiss</button>
                    </div>
                  {/if}
                </div>
              {/each}
            {:else if tab === 'moderation'}
              <div class="adm-inline">
                <button type="button" disabled={!selected.canEdit} onclick={() => arm('warn')}>Warn</button>
                <button type="button" disabled={!selected.canEdit} onclick={() => arm('case')}>Create case</button>
                <button type="button" disabled={!selected.canEdit} onclick={() => ask('unsuspend')}>Clear suspension</button>
              </div>
              <div class="adm-block">
                <strong>Warnings</strong>
                {#if !selected.warnings.length}<p>None.</p>{/if}
                {#each selected.warnings as row}<p>{row.text} · {row.by} · {when(row.at)}</p>{/each}
              </div>
              <div class="adm-block">
                <strong>Cases</strong>
                {#if !selected.cases.length}<p>None.</p>{/if}
                {#each selected.cases as row}<p>{row.text} · {row.by} · {when(row.at)}</p>{/each}
              </div>
            {:else if tab === 'notes'}
              <form class="adm-confirm" onsubmit={(event) => { event.preventDefault(); run('note'); }}>
                <label>Private staff note <textarea bind:value={note} rows="3" placeholder="Only staff can see this"></textarea></label>
                <button type="submit" disabled={!!busy || !selected.canEdit}>Add note</button>
              </form>
              {#each selected.notes as row (row.id)}
                <div class="adm-block"><p>{row.text}</p><small>{row.by} · {when(row.at)}</small></div>
              {/each}
            {:else}
              <div class="adm-fields">
                <label>Username <input bind:value={nextName} disabled={!selected.canEdit} /></label>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => run('username')}>Save username</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('reset-username')}>Reset username</button>
                <label>Display name <input bind:value={nextDisplay} disabled={!selected.canEdit} /></label>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => run('display-name')}>Save display name</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('reset-display')}>Reset display name</button>
                {#if owner}
                  <label>Email <input bind:value={nextEmail} disabled={!selected.canModerate} /></label>
                  <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => run('email')}>Change email</button>
                  <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('verify-email')}>{selected.emailVerified ? 'Unverify email' : 'Verify email'}</button>
                  <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask('password')}>Reset password</button>
                {/if}
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('reset-avatar')}>Reset avatar</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('reset-banner')}>Reset banner</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('clear-status')}>Remove status</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('clear-effects')}>Remove effects</button>
                <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask('badge')}>{selected.early ? 'Remove early badge' : 'Grant early badge'}</button>
                <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask('premium')}>{selected.premium ? 'Revoke premium' : 'Grant premium'}</button>
                <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask(selected.disabled ? 'enable' : 'disable')}>{selected.disabled ? 'Enable account' : 'Disable account'}</button>
                <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask(selected.deleted ? 'restore' : 'delete')}>{selected.deleted ? 'Restore account' : 'Delete account'}</button>
                <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask('purge')}>Permanently delete</button>
              </div>
            {/if}
          </div>
          <aside class="adm-quick">
            <h4>Quick tools</h4>
            <button type="button" onclick={copyId}><Copy size={14} /> Copy user id</button>
            <button type="button" onclick={exportUser}><Download size={14} /> Export user data</button>
            <button type="button" onclick={() => (tab = 'notes')}>Add staff note</button>
            <button type="button" onclick={() => arm('case')}>Create case</button>
            <p>Destructive actions need a reason and are written to the audit log. Passwords are shown once and are not logged.</p>
          </aside>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .adm { display: flex; flex-direction: column; gap: 16px; min-width: 0; color: #f4e9ff; }
  .adm-head, .adm-card-top, .adm-modal-top, .adm-inline, .adm-quick button, .adm-tools button, .adm-row, .adm-server, .adm-audit, .adm-bot { display: flex; align-items: center; gap: 10px; }
  .adm-head h2, .adm h3, .adm h4 { margin: 0; }
  .adm-head p, .adm-card-top small, .adm-empty, .adm-note, .adm-quick p, .adm-mail { color: #c4b5d4; margin: 0; }
  .adm-mark { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(180deg, #c026d3, #7c3aed); }
  .adm-live { margin-left: auto; color: #86efac; font-size: 13px; }
  .adm-live i { width: 8px; height: 8px; border-radius: 99px; background: #4ade80; display: inline-block; margin-right: 6px; }
  .adm-stats, .adm-grid, .adm-tiles, .adm-tools { display: grid; gap: 12px; }
  .adm-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .adm-stats article, .adm-card, .adm-modal { background: rgba(28, 10, 48, 0.72); border: 1px solid rgba(192, 132, 252, 0.28); border-radius: 18px; }
  .adm-stats article { padding: 14px; display: flex; flex-direction: column; gap: 4px; }
  .adm-stats b { font-size: 28px; }
  .adm-stats small, .adm-row small, .adm-server small, .adm-audit small, .adm-tiles small, .adm-bot small { color: #b9a6cc; }
  .adm-grid { grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.8fr); }
  .adm-card { padding: 14px; }
  .adm-side { display: flex; flex-direction: column; gap: 12px; }
  .adm-search { display: flex; gap: 8px; align-items: center; background: rgba(0, 0, 0, 0.25); border-radius: 12px; padding: 8px 10px; margin: 10px 0; }
  .adm-search input, .adm-confirm input, .adm-confirm select, .adm-confirm textarea, .adm-fields input, .adm-block select { width: 100%; border: 0; background: transparent; color: inherit; outline: none; }
  .adm-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .adm-filters button, .adm-tabs button, .adm-inline button, .adm-fields button, .adm-confirm button, .adm-chips button, .adm-quick button, .adm-tools button { border: 0; border-radius: 999px; background: rgba(255, 255, 255, 0.06); color: inherit; padding: 6px 10px; cursor: pointer; }
  .adm-filters button.on, .adm-tabs button.on, .adm-tiles button.on { background: #c026d3; }
  .adm-list { display: flex; flex-direction: column; gap: 6px; max-height: 460px; overflow: auto; }
  .adm-row, .adm-tools button, .adm-tiles button, .adm-fields button, .adm-quick button { text-align: left; }
  .adm-row { width: 100%; background: transparent; border: 0; color: inherit; border-radius: 12px; padding: 6px; cursor: pointer; }
  .adm-row.on, .adm-row:hover { background: rgba(192, 38, 211, 0.16); }
  .adm-row span, .adm-tiles button, .adm-bot div { display: flex; flex-direction: column; min-width: 0; }
  .adm-row strong, .adm-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .adm-row em, aside em { margin-left: auto; font-style: normal; font-size: 12px; border-radius: 999px; padding: 3px 8px; }
  .good { background: rgba(74, 222, 128, 0.16); color: #86efac; }
  .bad { background: rgba(244, 63, 94, 0.16); color: #fda4af; }
  .warn { background: rgba(251, 191, 36, 0.16); color: #fde68a; }
  .neutral { background: rgba(255, 255, 255, 0.08); }
  .adm-tools { grid-template-columns: 1fr 1fr; }
  .adm-server, .adm-audit { justify-content: space-between; padding: 7px 0; }
  .adm-audit span { color: #d8c4ea; flex: 1; }
  .adm-shade { position: fixed; inset: 0; background: rgba(8, 2, 16, 0.62); display: grid; place-items: center; z-index: 40; padding: 24px; }
  .adm-modal { width: min(1080px, 100%); max-height: min(820px, 100%); overflow: auto; }
  .adm-modal-top { padding: 12px 14px; gap: 12px; position: sticky; top: 0; background: rgba(28, 10, 48, 0.96); }
  .adm-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
  .adm-x { margin-left: auto; }
  .adm-modal-body { display: grid; grid-template-columns: 220px minmax(0, 1fr) 200px; gap: 14px; padding: 14px; }
  aside { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  aside h3, aside p { margin: 0; }
  dl { margin: 8px 0 0; width: 100%; }
  dl div { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
  dt { color: #b9a6cc; }
  .adm-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .adm-tiles button, .adm-block, .adm-confirm, .adm-fields { background: rgba(0, 0, 0, 0.22); border-radius: 14px; }
  .adm-tiles button { padding: 12px; }
  .adm-block, .adm-confirm, .adm-fields { padding: 12px; margin-bottom: 10px; }
  .adm-fields, .adm-confirm { display: flex; flex-direction: column; gap: 8px; }
  .adm-confirm input, .adm-confirm select, .adm-confirm textarea, .adm-fields input, .adm-block select { background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 8px; }
  .adm-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
  .adm-error { color: #fda4af; }
  .adm-pass { background: rgba(74, 222, 128, 0.12); padding: 8px 10px; border-radius: 10px; }
  .adm-quick { gap: 8px; }
  .ghost { background: transparent !important; }
  button:disabled { opacity: 0.45; cursor: default; }
  @media (max-width: 900px) {
    .adm-stats, .adm-grid, .adm-modal-body, .adm-tiles { grid-template-columns: 1fr; }
    .adm-live { display: none; }
  }
</style>
