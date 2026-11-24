<script>
  import { onMount } from 'svelte';
  import { Search, Shield, Users, Server, Activity, AlertTriangle, Bot, Ban, Clock, VolumeX, UserX, X, Copy, Download, Zap, Lock, Trash2, RefreshCw, BadgeCheck, Crown, Mail, Calendar, StickyNote, Settings, Gavel, FileText, Plus } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import { api } from '../api.js';
  import { toast, staffReport } from '../state.svelte.js';

  let people = $state([]);
  let counts = $state({ accounts: 0, people: 0, bots: 0, online: 0, disabled: 0, servers: 0, reports: 0 });
  let servers = $state([]);
  let audit = $state([]);
  let appeals = $state([]);
  let view = $state('users');
  let roleMenu = $state('');
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
    { action: 'global-ban', title: 'Ban user', blurb: 'Platform-wide', icon: Ban, tone: 'bad' },
    { action: 'suspend', title: 'Timeout user', blurb: 'Restrict for a period', icon: Clock, tone: 'warn' },
    { action: 'warn', title: 'Warn user', blurb: 'Send a warning', icon: AlertTriangle, tone: 'warn' },
    { action: 'mute', title: 'Mute user', blurb: 'Stop their messages', icon: VolumeX, tone: 'bad' },
    { action: 'kick', title: 'Kick user', blurb: 'Remove from a server', icon: UserX, tone: 'warn' },
    { action: 'delete-messages', title: 'Delete messages', blurb: 'Remove their posts', icon: Trash2, tone: 'bad' },
    { action: 'delete', title: 'Delete account', blurb: 'Can be restored', icon: Trash2, tone: 'bad' },
    { action: 'reset-username', title: 'Reset username', blurb: 'Set a spare name', icon: RefreshCw, tone: 'neutral' },
    { action: 'verify-email', title: 'Verify account', blurb: 'Mark email verified', icon: BadgeCheck, tone: 'good' },
  ];

  const moreTiles = [
    { action: 'server-ban', title: 'Server ban', blurb: 'One community', icon: Ban, tone: 'bad' },
    { action: 'lock', title: 'Lock account', blurb: 'No new messages', icon: Lock, tone: 'warn' },
    { action: 'logout', title: 'Force logout', blurb: 'Every session', icon: Lock, tone: 'neutral' },
    { action: 'unmute', title: 'Unmute', blurb: 'Allow messages', icon: VolumeX, tone: 'good' },
    { action: 'global-unban', title: 'Remove platform ban', blurb: 'Global only', icon: Shield, tone: 'good' },
    { action: 'unban', title: 'Remove server ban', blurb: 'One community', icon: Shield, tone: 'good' },
  ];

  const tabIcons = { actions: Zap, roles: Users, permissions: Shield, activity: Activity, reports: FileText, moderation: Gavel, notes: StickyNote, settings: Settings };

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
    if (!time) return '—';
    return new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function auditLine(row) {
    const staff = row.actorName || 'Staff';
    const name = row.targetName ? '@' + row.targetName : 'an account';
    const detail = String(row.detail || '').trim();
    const action = row.action || '';
    if (action === 'restrict') {
      const allowed = /allowed/i.test(detail);
      const feature = detail.replace(/ restricted| allowed/gi, '') || 'a feature';
      return staff + (allowed ? ' allowed ' : ' restricted ') + feature + ' for ' + name;
    }
    if (action === 'role') return staff + ' ' + (detail ? detail.charAt(0).toLowerCase() + detail.slice(1) : 'changed a role') + ' for ' + name;
    if (action === 'username' || action === 'reset-username') return staff + ' changed ' + name + ' to ' + (detail || 'a new username');
    if (action === 'display-name' || action === 'reset-display') return staff + ' set the display name for ' + name + ' to ' + (detail || 'their username');
    if (action === 'warn') return staff + ' warned ' + name + (detail ? ': ' + detail : '');
    if (action === 'case') return staff + ' opened a case on ' + name + (detail ? ': ' + detail : '');
    if (action === 'mute') return staff + ' muted ' + name;
    if (action === 'unmute') return staff + ' unmuted ' + name;
    if (action === 'kick') return staff + ' kicked ' + name + (detail ? ' · ' + detail : '');
    if (action === 'server-ban') return staff + ' banned ' + name + ' from a server' + (detail ? ' · ' + detail : '');
    if (action === 'global-ban') return staff + ' banned ' + name + ' from Nebula' + (detail ? ': ' + detail : '');
    if (action === 'global-unban') return staff + ' removed the platform ban on ' + name;
    if (action === 'unban') return staff + ' removed a server ban on ' + name;
    if (action === 'timeout') return staff + ' timed out ' + name + (detail ? ' · ' + detail : '');
    if (action === 'suspend') return staff + ' suspended ' + name + (detail ? ' · ' + detail : '');
    if (action === 'unsuspend') return staff + ' cleared the suspension on ' + name;
    if (action === 'disable') return staff + ' disabled ' + name + (detail ? ': ' + detail : '');
    if (action === 'enable' || action === 'unlock') return staff + ' enabled ' + name;
    if (action === 'lock') return staff + ' locked ' + name + (detail ? ': ' + detail : '');
    if (action === 'logout') return staff + ' signed ' + name + ' out of every device';
    if (action === 'delete') return staff + ' deleted ' + name + (detail ? ': ' + detail : '');
    if (action === 'restore') return staff + ' restored ' + name;
    if (action === 'purge') return staff + ' permanently deleted ' + name + (detail ? ': ' + detail : '');
    if (action === 'delete-messages') return staff + ' deleted messages from ' + name + (detail ? ' · ' + detail : '');
    if (action === 'note') return staff + ' added a staff note on ' + name;
    if (action === 'badge' || action === 'premium' || action === 'verify-email' || action === 'password' || action === 'email') return staff + ' · ' + (detail || action) + ' for ' + name;
    if (action === 'appeal-approve') return staff + ' approved the appeal from ' + name;
    if (action === 'appeal-deny') return staff + ' denied the appeal from ' + name;
    return staff + ' ' + action.replaceAll('-', ' ') + ' ' + name + (detail ? ' · ' + detail : '');
  }

  const openAppeals = $derived(appeals.filter((row) => row.status === 'open').length);

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
    appeals = data.appeals || [];
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

  async function decideAppeal(id, action) {
    busy = id;
    formError = '';
    try {
      apply(await api('/api/staff/appeals/' + encodeURIComponent(id), { method: 'POST', body: { action } }));
      toast(action === 'approve' ? 'Appeal approved' : 'Appeal denied');
    } catch (err) {
      formError = err.message || 'Could not update the appeal';
    } finally {
      busy = '';
    }
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
      <p>Manage your platform, users and server settings.</p>
    </div>
    <span class="adm-live"><i></i> All systems operational</span>
  </header>

  <div class="adm-filters">
    <button type="button" class:on={view === 'users'} onclick={() => (view = 'users')}>Users</button>
    <button type="button" class:on={view === 'appeals'} onclick={() => (view = 'appeals')}>Appeals{openAppeals ? ' ' + openAppeals : ''}</button>
  </div>

  {#if loadError}
    <p class="adm-error">{loadError}</p>
  {/if}

  <div class="adm-stats">
    <article>
      <span class="stat-ico"><Users size={16} /></span>
      <b>{counts.accounts.toLocaleString()}</b>
      <span>Total users</span>
      <small>{counts.people.toLocaleString()} people · {counts.bots.toLocaleString()} bots</small>
    </article>
    <article>
      <span class="stat-ico"><Server size={16} /></span>
      <b>{counts.servers.toLocaleString()}</b>
      <span>Total servers</span>
      <small>Communities on Nebula</small>
    </article>
    <article>
      <span class="stat-ico"><Activity size={16} /></span>
      <b>{counts.online.toLocaleString()}</b>
      <span>Online now</span>
      <small>Signed in right now</small>
    </article>
    <article>
      <span class="stat-ico warn"><AlertTriangle size={16} /></span>
      <b>{counts.reports.toLocaleString()}</b>
      <span>Reports</span>
      <small>{counts.disabled.toLocaleString()} restricted</small>
    </article>
  </div>

  {#if view === 'appeals'}
    <section class="adm-card">
      <div class="adm-card-top">
        <span class="stat-ico"><Gavel size={15} /></span>
        <div>
          <h3>Appeals</h3>
          <small>Accounts banned or disabled on Nebula.</small>
        </div>
      </div>
      {#if loadError}<p class="adm-error">{loadError}</p>{/if}
      {#if !appeals.length}
        <p class="adm-empty">No appeals yet.</p>
      {:else}
        {#each appeals as appeal (appeal.id)}
          <article class="adm-appeal">
            <div>
              <strong>@{appeal.username}</strong>
              <small>ID {appeal.uid || '—'} · {appeal.kind === 'disabled' ? 'Disabled' : appeal.kind === 'both' ? 'Banned and disabled' : 'Platform ban'} · {when(appeal.at)}</small>
              <p>{appeal.text}</p>
              {#if appeal.status !== 'open'}
                <small>{appeal.status === 'approved' ? 'Approved' : 'Denied'}{appeal.resolvedBy ? ' by ' + appeal.resolvedBy : ''}</small>
              {/if}
            </div>
            {#if appeal.status === 'open'}
              <div class="adm-inline">
                <button type="button" class="primary" disabled={!!busy} onclick={() => decideAppeal(appeal.id, 'approve')}>Approve</button>
                <button type="button" disabled={!!busy} onclick={() => decideAppeal(appeal.id, 'deny')}>Deny</button>
              </div>
            {/if}
          </article>
        {/each}
      {/if}
    </section>
  {:else}
  <div class="adm-grid">
    <section class="adm-card">
      <div class="adm-card-top">
        <span class="stat-ico"><Users size={15} /></span>
        <div>
          <h3>User management</h3>
          <small>Search and manage platform users.</small>
        </div>
      </div>
      <label class="adm-search"><Search size={15} /><input bind:value={q} placeholder="Search users by username, ID..." /></label>
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
              <Avatar {user} size={40} />
              <span class="who">
                <strong>{user.displayName || user.username}</strong>
                <small>@{user.username} · ID {user.uid || '—'}</small>
              </span>
              <i class="presence" class:off={user.status !== 'online'} class:held={user.globalBan || user.disabled || user.deleted}></i>
              <em class={tag[1]}>{tag[0]}</em>
            </button>
          {/each}
        {/if}
      </div>
    </section>

    <div class="adm-side">
      <section class="adm-card">
        <div class="adm-card-top">
          <span class="stat-ico"><Gavel size={15} /></span>
          <div>
            <h3>Moderation tools</h3>
            <small>Pick a user, then confirm.</small>
          </div>
        </div>
        <div class="adm-tools">
          <button type="button" onclick={() => arm('global-ban')}><Ban size={16} /><span>Ban</span></button>
          <button type="button" onclick={() => arm('kick')}><UserX size={16} /><span>Kick</span></button>
          <button type="button" onclick={() => arm('timeout')}><Clock size={16} /><span>Timeout</span></button>
          <button type="button" onclick={() => arm('delete-messages')}><Trash2 size={16} /><span>Messages</span></button>
          <button type="button" onclick={() => arm('warn')}><AlertTriangle size={16} /><span>Warn</span></button>
          <button type="button" onclick={() => arm('mute')}><VolumeX size={16} /><span>Mute</span></button>
        </div>
      </section>

      <section class="adm-card">
        <div class="adm-card-top">
          <span class="stat-ico"><FileText size={15} /></span>
          <div>
            <h3>Audit log</h3>
            <small>Recent staff actions.</small>
          </div>
        </div>
        {#if !audit.length}
          <p class="adm-empty">Staff actions will show up here.</p>
        {:else}
          {#each audit as row (row.id)}
            <div class="adm-audit">
              <span class="stat-ico"><Shield size={13} /></span>
              <span>{auditLine(row)}</span>
              <small>{when(row.at)}</small>
            </div>
          {/each}
        {/if}
      </section>

      <section class="adm-card adm-bot">
        <span class="stat-ico"><Bot size={16} /></span>
        <div>
          <strong>Nebula bot</strong>
          <small>{counts.bots.toLocaleString()} bot {counts.bots === 1 ? 'account' : 'accounts'}</small>
        </div>
      </section>
    </div>
  </div>
  {/if}

  {#if open && selected}
    {@const tag = pill(selected)}
    <div class="adm-shade" role="presentation" onclick={() => (open = false)} onkeydown={(event) => { if (event.key === 'Escape') open = false; }}>
      <div class="adm-modal" role="dialog" aria-label="User admin" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
        <header class="adm-modal-top">
          <div class="adm-tabs">
            {#each tabs as [id, label]}
              {@const Icon = tabIcons[id]}
              <button type="button" class:on={tab === id} onclick={() => (tab = id)}><Icon size={14} /> {label}</button>
            {/each}
          </div>
          <button type="button" class="adm-x" onclick={() => (open = false)} aria-label="Close"><X size={16} /></button>
        </header>

        <div class="adm-modal-body">
          <aside class="adm-profile">
            <Avatar user={selected} size={96} />
            <h3>{selected.displayName || selected.username}</h3>
            <p class="handle">@{selected.username}</p>
            <p class="uid">ID {selected.uid || '—'}</p>
            <div class="adm-pills">
              {#if selected.protected}<em class="warn">Protected</em>{/if}
              {#if selected.premium}<em class="premium"><Crown size={12} /> Premium</em>{/if}
              {#if selected.emailVerified}<em class="good"><BadgeCheck size={12} /> Verified</em>{/if}
              <em class={tag[1]}>{tag[0]}</em>
            </div>
            <div class="adm-facts">
              <div><Server size={14} /><span>Servers</span><b>{selected.servers.length}</b></div>
              <div><Activity size={14} /><span>Last seen</span><b>{stamp(selected.lastSeen)}</b></div>
              <div><Calendar size={14} /><span>Joined</span><b>{stamp(selected.createdAt)}</b></div>
            </div>
            {#if owner && selected.email}
              <p class="adm-mail"><Mail size={14} /> {selected.email}</p>
            {:else if Number(selected.uid) === 1}
              <p class="adm-mail"><Mail size={14} /> Email hidden</p>
            {/if}
          </aside>

          <div class="adm-main">
            {#if formError}<p class="adm-error">{formError}</p>{/if}
            {#if tempPassword}<p class="adm-pass">Temporary password <code>{tempPassword}</code></p>{/if}
            {#if pending}
              <form class="adm-confirm" onsubmit={(event) => { event.preventDefault(); run(pending); }}>
                <strong>{pending.replaceAll('-', ' ')}</strong>
                {#if pending === 'suspend'}
                  <label>Hours <input type="number" min="1" max="720" bind:value={hours} /></label>
                {/if}
                {#if pending === 'timeout'}
                  <label>Minutes <input type="number" min="1" max="10080" bind:value={minutes} /></label>
                {/if}
                {#if ['kick', 'server-ban', 'timeout', 'unban'].includes(pending)}
                  <label>Server
                    <select bind:value={serverId}>
                      {#each servers as server}<option value={server.id}>{server.name}</option>{/each}
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
                <div class="adm-inline">
                  <button type="submit" class="primary" disabled={!!busy}>Confirm</button>
                  <button type="button" class="ghost" onclick={() => (pending = '')}>Cancel</button>
                </div>
              </form>
            {/if}

            {#if tab === 'actions'}
              <div class="adm-section">
                <h3><Zap size={15} /> User actions</h3>
                <p>Perform actions on this account.</p>
                <div class="adm-tiles">
                  {#each tiles as tile}
                    {@const Icon = tile.icon}
                    <button type="button" class="adm-tile" disabled={!selected.canEdit || !!busy} onclick={() => ask(tile.action)}>
                      <span class="ico {tile.tone}"><Icon size={15} /></span>
                      <strong>{tile.title}</strong>
                      <small>{tile.blurb}</small>
                    </button>
                  {/each}
                </div>
              </div>
              <div class="adm-section">
                <h3><Settings size={15} /> Account options</h3>
                <div class="adm-optgrid">
                  <label>Display name
                    <span class="adm-field"><input bind:value={nextDisplay} disabled={!selected.canEdit} /><button type="button" disabled={!selected.canEdit || !!busy} onclick={() => run('display-name')}>Save</button></span>
                  </label>
                  <label>Username
                    <span class="adm-field"><input bind:value={nextName} disabled={!selected.canEdit} /><button type="button" disabled={!selected.canEdit || !!busy} onclick={() => run('username')}>Save</button></span>
                  </label>
                  <div class="adm-switch">
                    <div><strong>Disable account</strong><small>Stop them from signing in</small></div>
                    <button type="button" class="switch" class:on={selected.disabled} disabled={!selected.canModerate || !!busy} onclick={() => ask(selected.disabled ? 'enable' : 'disable')} aria-label="Disable account"></button>
                  </div>
                  <div class="adm-switch">
                    <div><strong>Force logout</strong><small>Sign them out of every device</small></div>
                    <button type="button" class="texty" disabled={!selected.canEdit || !!busy} onclick={() => ask('logout')}>Sign out</button>
                  </div>
                </div>
              </div>
              <div class="adm-section">
                <h3><Shield size={15} /> More actions</h3>
                <div class="adm-tiles">
                  {#each moreTiles as tile}
                    {@const Icon = tile.icon}
                    <button type="button" class="adm-tile" disabled={!selected.canEdit || !!busy} onclick={() => ask(tile.action)}>
                      <span class="ico {tile.tone}"><Icon size={15} /></span>
                      <strong>{tile.title}</strong>
                      <small>{tile.blurb}</small>
                    </button>
                  {/each}
                </div>
              </div>
            {:else if tab === 'roles'}
              {#if !selected.roles.length}<p class="adm-empty">Not in a server.</p>{/if}
              {#each selected.roles as membership (membership.id)}
                {@const catalog = (servers.find((server) => server.id === membership.id)?.roles || []).filter((role) => !membership.roles.some((have) => have.id === role.id))}
                <div class="adm-section">
                  <h3>{membership.name} {#if membership.banned}<em class="bad">Banned</em>{/if}</h3>
                  <div class="pop-role-list profile-roles">
                    {#each membership.roles as role (role.id)}
                      <em class="pop-role" class:can-drop={selected.canEdit && role.id !== 'everyone'}>
                        {#if selected.canEdit && role.id !== 'everyone'}
                          <button type="button" class="role-x" title={'Remove ' + role.name} aria-label={'Remove ' + role.name} disabled={!!busy} onclick={() => run('role', { serverId: membership.id, roleId: role.id, remove: true })}>
                            <i style="background:{role.color || '#99aab5'}"></i>
                            <X size={9} />
                          </button>
                        {:else}
                          <i style="background:{role.color || '#99aab5'}"></i>
                        {/if}
                        {role.name}
                      </em>
                    {/each}
                    {#if selected.canEdit}
                      <button type="button" class="role-add" title="Add role" aria-label="Add role" onclick={() => (roleMenu = roleMenu === membership.id ? '' : membership.id)}><Plus size={14} /></button>
                    {/if}
                  </div>
                  {#if roleMenu === membership.id}
                    <div class="role-add-menu">
                      {#each catalog as role (role.id)}
                        <button type="button" disabled={!!busy} onclick={() => { roleMenu = ''; run('role', { serverId: membership.id, roleId: role.id, remove: false }); }}>
                          <i style="background:{role.color || '#99aab5'}"></i>{role.name}
                        </button>
                      {:else}
                        <p>Every role is already on this profile.</p>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            {:else if tab === 'permissions'}
              <div class="adm-section">
                <h3><Shield size={15} /> Restrictions</h3>
                <p>A global ban covers every server. A server ban only removes them from the community you pick.</p>
                <div class="adm-tiles">
                  {#each [['messages', 'Messages', selected.restrictMessages], ['images', 'Images', selected.restrictImages], ['files', 'Files', selected.restrictFiles], ['voice', 'Voice', selected.restrictVoice]] as [flag, label, on]}
                    <button type="button" class="adm-tile" class:held={on} disabled={!selected.canEdit || !!busy} onclick={() => run('restrict', { flag })}>
                      <strong>{label}</strong>
                      <small>{on ? 'Restricted' : 'Allowed'}</small>
                    </button>
                  {/each}
                </div>
              </div>
            {:else if tab === 'activity'}
              <div class="adm-section">
                <h3>Previous usernames</h3>
                {#if !selected.nameHistory.length}<p class="adm-empty">None recorded.</p>{:else}
                  {#each selected.nameHistory as row}<p class="adm-line">@{row.name} <small>{when(row.at)}</small></p>{/each}
                {/if}
              </div>
              <div class="adm-section">
                <h3>Previous display names</h3>
                {#if !selected.displayHistory.length}<p class="adm-empty">None recorded.</p>{:else}
                  {#each selected.displayHistory as row}<p class="adm-line">{row.name} <small>{when(row.at)}</small></p>{/each}
                {/if}
              </div>
              <div class="adm-section">
                <h3>Servers</h3>
                {#each selected.servers as server}<p class="adm-line">{server.name}</p>{/each}
                {#if !selected.servers.length}<p class="adm-empty">None.</p>{/if}
              </div>
              {#if owner}
                <div class="adm-section">
                  <h3>Sessions</h3>
                  <p class="adm-empty">{selected.sessions} active. IP addresses are not stored.</p>
                  {#each selected.sessionList as row}<p class="adm-line">{(row.id || '').slice(0, 8)} <small>{stamp(row.lastSeen)}</small></p>{/each}
                </div>
              {/if}
            {:else if tab === 'reports'}
              {#if !selected.reports.length}<p class="adm-empty">No reports against this account.</p>{/if}
              {#each selected.reports as report (report.id)}
                <div class="adm-section">
                  <h3>{report.reason || 'Report'}</h3>
                  <p>{report.text}</p>
                  <small>{report.status} · {when(report.at)}</small>
                  {#if report.status !== 'closed' && report.status !== 'handled'}
                    <div class="adm-inline">
                      <button type="button" class="primary" disabled={!!busy} onclick={() => closeReport(report.id, 'handle')}>Resolve</button>
                      <button type="button" class="ghost" disabled={!!busy} onclick={() => closeReport(report.id, 'close')}>Dismiss</button>
                    </div>
                  {/if}
                </div>
              {/each}
            {:else if tab === 'moderation'}
              <div class="adm-inline">
                <button type="button" class="primary" disabled={!selected.canEdit} onclick={() => arm('warn')}>Warn</button>
                <button type="button" class="primary" disabled={!selected.canEdit} onclick={() => arm('case')}>Create case</button>
                <button type="button" disabled={!selected.canEdit} onclick={() => ask('unsuspend')}>Clear suspension</button>
              </div>
              <div class="adm-section">
                <h3>Warnings</h3>
                {#if !selected.warnings.length}<p class="adm-empty">None.</p>{/if}
                {#each selected.warnings as row}<p class="adm-line">{row.text} <small>{row.by} · {when(row.at)}</small></p>{/each}
              </div>
              <div class="adm-section">
                <h3>Cases</h3>
                {#if !selected.cases.length}<p class="adm-empty">None.</p>{/if}
                {#each selected.cases as row}<p class="adm-line">{row.text} <small>{row.by} · {when(row.at)}</small></p>{/each}
              </div>
            {:else if tab === 'notes'}
              <form class="adm-section" onsubmit={(event) => { event.preventDefault(); run('note'); }}>
                <h3>Private staff note</h3>
                <textarea bind:value={note} rows="3" placeholder="Only staff can see this"></textarea>
                <button type="submit" class="primary" disabled={!!busy || !selected.canEdit}>Add note</button>
              </form>
              {#each selected.notes as row (row.id)}
                <div class="adm-section"><p>{row.text}</p><small>{row.by} · {when(row.at)}</small></div>
              {/each}
            {:else}
              <div class="adm-section adm-settings">
                <h3>Profile</h3>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('reset-username')}>Reset username</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('reset-display')}>Reset display name</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('reset-avatar')}>Reset avatar</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('reset-banner')}>Reset banner</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('clear-status')}>Remove status</button>
                <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('clear-effects')}>Remove effects</button>
                {#if owner}
                  <h3>Account</h3>
                  <label>Email <input bind:value={nextEmail} disabled={!selected.canModerate} /></label>
                  <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => run('email')}>Change email</button>
                  <button type="button" disabled={!selected.canEdit || !!busy} onclick={() => ask('verify-email')}>{selected.emailVerified ? 'Unverify email' : 'Verify email'}</button>
                  <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask('password')}>Reset password</button>
                  <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask('badge')}>{selected.early ? 'Remove early badge' : 'Grant early badge'}</button>
                  <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask('premium')}>{selected.premium ? 'Revoke premium' : 'Grant premium'}</button>
                  <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask(selected.deleted ? 'restore' : 'delete')}>{selected.deleted ? 'Restore account' : 'Delete account'}</button>
                  <button type="button" disabled={!selected.canModerate || !!busy} onclick={() => ask('purge')}>Permanently delete</button>
                {/if}
              </div>
            {/if}
          </div>

          <aside class="adm-rail">
            <h4>User status</h4>
            <p class="adm-status"><i class="presence" class:off={selected.status !== 'online'} class:held={selected.globalBan || selected.disabled || selected.deleted}></i> {selected.globalBan ? 'Banned' : selected.deleted ? 'Deleted' : selected.disabled ? 'Disabled' : selected.status === 'online' ? 'Online' : 'Offline'}</p>
            <div class="adm-premium">
              <Crown size={16} />
              <div>
                <strong>{selected.premium ? 'Premium' : tag[0]}</strong>
                <small>{selected.premium ? 'Premium is on' : 'No premium'}</small>
              </div>
            </div>
            <h4>Account flags</h4>
            <div class="adm-flags">
              {#if selected.emailVerified}<em class="good">Verified</em>{/if}
              {#if selected.premium}<em class="premium">Premium</em>{/if}
              {#if selected.early}<em class="premium">Early</em>{/if}
              {#if selected.mfa}<em class="good">2FA</em>{/if}
              {#if selected.locked || selected.muted}<em class="warn">Restricted</em>{/if}
              {#if !selected.emailVerified && !selected.premium && !selected.early && !selected.mfa && !selected.locked && !selected.muted}<em class="neutral">None</em>{/if}
            </div>
            <h4>Quick tools</h4>
            <button type="button" onclick={copyId}><Copy size={14} /> Copy user ID</button>
            <button type="button" onclick={exportUser}><Download size={14} /> Export user data</button>
            <button type="button" onclick={() => (tab = 'notes')}><StickyNote size={14} /> Add note</button>
            <button type="button" onclick={() => arm('case')}><AlertTriangle size={14} /> Create case</button>
            <p>Destructive actions need a reason and are written to the audit log. Passwords are shown once and are not logged.</p>
          </aside>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .adm { display: flex; flex-direction: column; gap: 14px; min-width: 0; color: #f6edff; }
  .adm-head { display: flex; align-items: center; gap: 12px; }
  .adm-head h2, .adm h3, .adm h4 { margin: 0; font-weight: 650; }
  .adm-head p, .adm-card-top small, .adm-empty, .adm-section > p, .adm-rail p, .adm-mail, .adm-switch small { color: #b9a4cc; margin: 0; }
  .adm-mark, .stat-ico { width: 34px; height: 34px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(180deg, #c026d3, #7c3aed); color: white; flex: none; }
  .stat-ico.warn { background: linear-gradient(180deg, #e11d48, #9f1239); }
  .adm-live { margin-left: auto; color: #86efac; font-size: 13px; white-space: nowrap; }
  .adm-live i, .presence { width: 8px; height: 8px; border-radius: 99px; background: #4ade80; display: inline-block; }
  .adm-live i { margin-right: 6px; }
  .presence.off { background: #6b6280; }
  .presence.held { background: #fb7185; }
  .adm-stats, .adm-grid, .adm-tiles, .adm-tools, .adm-optgrid { display: grid; gap: 12px; }
  .adm-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .adm-stats article, .adm-card, .adm-modal, .adm-section, .adm-tile, .adm-confirm { background: #1a1028; border: 1px solid rgba(168, 85, 247, 0.28); border-radius: 18px; }
  .adm-stats article { padding: 14px 16px 16px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 118px; }
  .adm-stats b { font-size: 32px; line-height: 1.1; margin-top: 8px; }
  .adm-stats small, .adm-row small, .adm-audit small, .adm-tile small, .adm-bot small { color: #b9a4cc; }
  .adm-grid { grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.8fr); align-items: start; }
  .adm-card { padding: 14px; }
  .adm-card-top, .adm-audit, .adm-bot, .adm-row, .adm-inline, .adm-mail, .adm-premium, .adm-rail button { display: flex; align-items: center; gap: 10px; }
  .adm-card-top { margin-bottom: 12px; }
  .adm-card-top .stat-ico { width: 32px; height: 32px; }
  .adm-side { display: flex; flex-direction: column; gap: 12px; }
  .adm-search { display: flex; gap: 8px; align-items: center; background: #12091c; border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; }
  .adm-search input, .adm-confirm input, .adm-confirm select, .adm-section input, .adm-section textarea, .adm-field input { width: 100%; border: 0; background: transparent; color: inherit; outline: none; font: inherit; }
  .adm-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .adm-filters button, .adm-tabs button, .adm-inline button, .adm-rail button, .adm-settings button, .adm-field button, .texty { border: 0; border-radius: 999px; background: #241433; color: inherit; padding: 7px 12px; cursor: pointer; font: inherit; }
  .adm-filters button.on, .adm-tabs button.on, .primary, .adm-field button { background: #c026d3; }
  .adm-list { display: flex; flex-direction: column; gap: 4px; max-height: 520px; overflow: auto; }
  .adm-row { width: 100%; background: transparent; border: 0; color: inherit; border-radius: 14px; padding: 8px; cursor: pointer; text-align: left; }
  .adm-row.on, .adm-row:hover { background: rgba(192, 38, 211, 0.18); }
  .who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .who strong, .who small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .adm-row em, .adm-pills em, .adm-flags em { font-style: normal; font-size: 12px; border-radius: 999px; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px; }
  .good { background: rgba(74, 222, 128, 0.16); color: #86efac; }
  .bad { background: rgba(244, 63, 94, 0.18); color: #fda4af; }
  .warn { background: rgba(251, 191, 36, 0.16); color: #fde68a; }
  .premium { background: rgba(192, 38, 211, 0.22); color: #f0abfc; }
  .neutral { background: rgba(255, 255, 255, 0.08); color: #ddd; }
  .adm-tools { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .adm-tools button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 72px; border: 0; border-radius: 14px; background: #12091c; color: inherit; cursor: pointer; font: inherit; }
  .adm-tools button:hover, .adm-tile:hover { border-color: rgba(232, 121, 249, 0.7); }
  .adm-audit { justify-content: space-between; padding: 8px 0; }
  .adm-audit { gap: 8px; align-items: flex-start; }
  .adm-audit span { flex: 1; min-width: 0; color: #eadff5; white-space: normal; line-height: 1.35; }
  .adm-section .profile-roles { flex-wrap: wrap; justify-content: flex-start; }
  .adm-appeal { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 12px 0; border-top: 1px solid rgba(168, 85, 247, 0.16); }
  .adm-appeal p { margin: 6px 0; }
  .adm-appeal small { display: block; color: #b9a4cc; }
  .adm-audit .stat-ico, .adm-bot .stat-ico { width: 28px; height: 28px; border-radius: 9px; }
  .adm-shade { position: fixed; inset: 0; background: rgba(6, 2, 14, 0.72); display: grid; place-items: center; z-index: 120; padding: 28px; }
  .adm-modal { width: min(1140px, 100%); max-height: min(860px, 100%); overflow: auto; background: #140a20; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45); }
  .adm-modal-top { display: flex; align-items: center; gap: 12px; padding: 12px 14px; position: sticky; top: 0; z-index: 2; background: #140a20; border-bottom: 1px solid rgba(168, 85, 247, 0.18); }
  .adm-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
  .adm-tabs button { display: inline-flex; align-items: center; gap: 6px; }
  .adm-x { width: 34px; height: 34px; border-radius: 10px; border: 0; background: #241433; color: inherit; cursor: pointer; }
  .adm-modal-body { display: grid; grid-template-columns: 250px minmax(0, 1fr) 230px; gap: 16px; padding: 16px; }
  .adm-profile, .adm-rail { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
  .adm-profile h3, .handle, .uid { margin: 0; }
  .handle, .uid { color: #c4b0d6; }
  .adm-pills, .adm-flags { display: flex; flex-wrap: wrap; gap: 6px; }
  .adm-facts { width: 100%; display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
  .adm-facts div { display: grid; grid-template-columns: 16px minmax(72px, auto) minmax(0, 1fr); gap: 8px; align-items: center; font-size: 13px; }
  .adm-facts span { color: #b9a4cc; }
  .adm-facts b { font-weight: 600; text-align: right; white-space: nowrap; }
  .adm-mail { width: 100%; font-size: 13px; word-break: break-all; }
  .adm-section { padding: 14px; margin-bottom: 12px; }
  .adm-section h3 { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .adm-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .adm-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-height: 104px; padding: 14px; color: inherit; text-align: left; cursor: pointer; font: inherit; }
  .adm-tile.held { outline: 1px solid #c026d3; }
  .ico { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; margin-bottom: 6px; }
  .ico.bad { background: rgba(244, 63, 94, 0.16); color: #fb7185; }
  .ico.warn { background: rgba(251, 191, 36, 0.16); color: #fbbf24; }
  .ico.good { background: rgba(74, 222, 128, 0.16); color: #4ade80; }
  .ico.neutral { background: rgba(192, 132, 252, 0.16); color: #e9d5ff; }
  .adm-optgrid { grid-template-columns: 1fr 1fr; }
  .adm-optgrid label, .adm-confirm label, .adm-settings label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #c4b0d6; }
  .adm-field, .adm-confirm input, .adm-confirm select, .adm-settings input, .adm-section textarea { display: flex; align-items: center; gap: 8px; background: #12091c; border: 1px solid rgba(168, 85, 247, 0.22); border-radius: 12px; padding: 8px 10px; }
  .adm-switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #12091c; border-radius: 14px; padding: 12px; }
  .adm-switch strong, .adm-switch small { display: block; }
  .switch { width: 44px; height: 26px; border-radius: 99px; border: 0; background: #3b2a4d; position: relative; cursor: pointer; }
  .switch:after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 99px; background: white; transition: transform 0.15s ease; }
  .switch.on { background: #c026d3; }
  .switch.on:after { transform: translateX(18px); }
  .adm-confirm, .adm-settings { display: flex; flex-direction: column; gap: 8px; }
  .adm-line { display: flex; justify-content: space-between; gap: 12px; margin: 6px 0; }
  .adm-status { text-transform: capitalize; }
  .adm-premium { width: 100%; background: linear-gradient(90deg, #6d28d9, #c026d3); border-radius: 14px; padding: 12px; }
  .adm-premium small { color: #f3e8ff; }
  .adm-rail { gap: 8px; }
  .adm-rail h4 { margin-top: 8px; }
  .adm-rail button { width: 100%; justify-content: flex-start; border-radius: 12px; }
  .adm-error { color: #fda4af; margin: 0 0 8px; }
  .adm-pass { background: rgba(74, 222, 128, 0.12); padding: 8px 10px; border-radius: 10px; }
  .ghost { background: transparent !important; }
  button:disabled { opacity: 0.45; cursor: default; }
  @media (max-width: 980px) {
    .adm-stats, .adm-grid, .adm-modal-body, .adm-tiles, .adm-optgrid { grid-template-columns: 1fr; }
    .adm-live { display: none; }
  }
</style>

