<script>
  import { X } from '@lucide/svelte';
  import { ui, guildAction, openServer, toast, notifyMode, serverMuted, loadMembers } from '../state.svelte.js';
  import { api } from '../api.js';
  import { PERM } from '../format.js';
  import { hasPerm } from '../state.svelte.js';

  let name = $state('');
  let extra = $state('');
  let when = $state('');
  let code = $state('');
  let invites = $state([]);
  let events = $state([]);
  let pingRoles = $state([]);
  let mine = $state(new Set());
  let busy = $state(false);

  const kind = $derived(ui.dialog?.kind);
  const channel = $derived(ui.dialog?.channel);

  $effect(() => {
    if (kind === 'invite') loadInvites();
    if (kind === 'events') loadEvents();
    if (kind === 'pings') loadPings();
    if (kind === 'edit-channel' && channel) {
      name = channel.name || '';
      extra = channel.topic || '';
    }
  });

  async function saveChannel() {
    const roles = ui.roles || [];
    const viewOff = [];
    const sendOff = [];
    for (const r of roles) {
      const v = document.querySelector(`[data-view="${r.id}"]`);
      const s = document.querySelector(`[data-send="${r.id}"]`);
      if (v && !v.checked) viewOff.push(r.id);
      if (s && !s.checked) sendOff.push(r.id);
    }
    const map = {};
    const touch = (id) => { if (!map[id]) map[id] = { roleId: id, allow: 0, deny: 0 }; return map[id]; };
    if (viewOff.length) roles.forEach((r) => { const ow = touch(r.id); if (viewOff.includes(r.id)) ow.deny |= PERM.VIEW; else ow.allow |= PERM.VIEW; });
    if (sendOff.length) roles.forEach((r) => { const ow = touch(r.id); if (sendOff.includes(r.id)) ow.deny |= PERM.SEND; else ow.allow |= PERM.SEND; });
    const ch = ui.dialog.channel;
    await api('/api/servers/' + ui.serverId + '/channels/' + ch.id, {
      method: 'PATCH',
      body: { name: name || ch.name, topic: extra, overwrites: Object.values(map) },
    });
    ui.dialog = null;
    await openServer(ui.serverId, { keepDialog: true });
  }

  async function deleteChannel() {
    const ch = ui.dialog.channel;
    if (!confirm('Delete this channel?')) return;
    await api('/api/servers/' + ui.serverId + '/channels/' + ch.id, { method: 'DELETE' });
    if (ui.channelId === ch.id) ui.channelId = '';
    ui.dialog = null;
    await openServer(ui.serverId, { keepDialog: true });
  }

  async function loadInvites() {
    try {
      const data = await api('/api/servers/' + ui.serverId + '/invites');
      invites = data.invites || [];
    } catch (err) { toast(err.message); ui.dialog = null; }
  }
  async function loadEvents() {
    try {
      const data = await api('/api/servers/' + ui.serverId + '/settings');
      events = data.settings?.events || [];
    } catch (err) { toast(err.message); }
  }
  async function loadPings() {
    try {
      const data = await api('/api/servers/' + ui.serverId + '/settings');
      const ids = new Set(data.settings?.pingRoleIds || []);
      pingRoles = (data.settings?.roles || []).filter((r) => ids.has(r.id));
      const mem = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
      const me = (mem.members || []).find((m) => m.id === ui.me?.id);
      mine = new Set((me?.roles || []).map((r) => r.id));
    } catch (err) { toast(err.message); }
  }

  function close() { ui.dialog = null; name = ''; extra = ''; when = ''; code = ''; }

  async function go(fn) {
    busy = true;
    try { await fn(); }
    catch (err) { toast(err.message); }
    finally { busy = false; }
  }
</script>

<div class="overlay" role="presentation" onclick={close}>
  <div class="sheet" role="dialog" onclick={(e) => e.stopPropagation()}>
    <div class="sheet-h">
      <h3>
        {#if kind === 'add-server'}Add a server
        {:else if kind === 'invite'}Invite people
        {:else if kind === 'events'}Events
        {:else if kind === 'channel'}{ui.dialog.voice ? 'Voice channel' : 'Create channel'}
        {:else if kind === 'category'}Create category
        {:else if kind === 'lock'}Lock server
        {:else if kind === 'notify'}Notifications
        {:else if kind === 'nick'}Nickname
        {:else if kind === 'mute'}Mute server
        {:else if kind === 'report'}Report a member
        {:else if kind === 'pings'}Ping roles
        {:else if kind === 'edit-channel'}Edit #{channel?.name}
        {:else if kind === 'onboarding'}Before you chat
        {:else}Server{/if}
      </h3>
      <button class="btn icon" onclick={close}><X size={16} /></button>
    </div>
    <div class="body">
      {#if kind === 'add-server'}
        <div class="field"><label>Server name</label><input bind:value={name} maxlength="40" placeholder="A name people will remember" /></div>
        <button class="btn brand" disabled={busy} onclick={() => go(async () => {
          const data = await api('/api/servers', { method: 'POST', body: { name } });
          try { await navigator.clipboard.writeText(data.invite); } catch (_) {}
          close();
          toast('Server created. Invite ' + data.invite + ' copied.');
          await openServer(data.server.id);
        })}>Create</button>
        <div class="field" style="margin-top:18px"><label>Join with an invite</label><input bind:value={code} maxlength="16" placeholder="Invite code" /></div>
        <button class="btn" disabled={busy} onclick={() => go(async () => {
          const data = await api('/api/invites/' + encodeURIComponent(code.trim()) + '/join', { method: 'POST', body: {} });
          if (data.pending) { toast('Request sent. An owner has to accept you.'); return; }
          close();
          await openServer(data.server.id);
        })}>Join</button>

      {:else if kind === 'invite'}
        <p class="hint">Share a code. They open + and choose Join with an invite.</p>
        {#each invites as inv}
          <div class="row"><code>{inv.code}</code><span class="hint">{inv.uses || 0} uses</span></div>
        {:else}<p class="hint">No invites yet.</p>{/each}
        <button class="btn brand" style="width:auto;margin-top:12px" onclick={() => go(async () => {
          const data = await api('/api/servers/' + ui.serverId + '/invites', { method: 'POST', body: {} });
          try { await navigator.clipboard.writeText(data.code); } catch (_) {}
          toast('Invite ' + data.code + ' copied');
          await loadInvites();
        })}>Create invite</button>

      {:else if kind === 'promote'}
        <p class="hint">This creates an invite and copies a line you can send anywhere.</p>
        <button class="btn brand" style="width:auto" onclick={() => go(async () => {
          const data = await api('/api/servers/' + ui.serverId + '/invites', { method: 'POST', body: {} });
          const text = 'Join ' + (ui.serverMeta?.name || 'my server') + ' on Nebula. Invite code: ' + data.code;
          try { await navigator.clipboard.writeText(text); } catch (_) {}
          toast('Copied');
          close();
        })}>Copy invite</button>

      {:else if kind === 'events'}
        {#each events as ev}
          <div class="row">
            <div class="grow"><strong>{ev.title}</strong><div class="hint">{ev.when} {ev.description}</div></div>
            {#if hasPerm(PERM.MANAGE_SERVER)}
              <button class="btn sm" onclick={() => go(async () => { await guildAction({ type: 'event', remove: true, id: ev.id }); await loadEvents(); })}>Remove</button>
            {/if}
          </div>
        {:else}<p class="hint">No events yet.</p>{/each}
        {#if hasPerm(PERM.MANAGE_SERVER)}
          <div class="field"><label>Name</label><input bind:value={name} maxlength="80" /></div>
          <div class="field"><label>When</label><input bind:value={when} maxlength="40" placeholder="Friday 8pm" /></div>
          <div class="field"><label>Details</label><input bind:value={extra} maxlength="400" /></div>
          <button class="btn brand" style="width:auto" onclick={() => go(async () => {
            await guildAction({ type: 'event', title: name, when, description: extra });
            name = ''; when = ''; extra = '';
            await loadEvents();
          })}>Create event</button>
        {/if}

      {:else if kind === 'channel'}
        <div class="field"><label>Name</label><input bind:value={name} maxlength="32" placeholder="new-channel" /></div>
        <div class="field"><label>Topic</label><input bind:value={extra} maxlength="200" /></div>
        <button class="btn brand" style="width:auto" onclick={() => go(async () => {
          await api('/api/servers/' + ui.serverId + '/channels', { method: 'POST', body: { name, topic: extra, type: ui.dialog.voice ? 'voice' : 'text' } });
          close();
          await openServer(ui.serverId, { keepDialog: true });
        })}>Create</button>

      {:else if kind === 'category'}
        <div class="field"><label>Name</label><input bind:value={name} maxlength="40" placeholder="Community" /></div>
        <button class="btn brand" style="width:auto" onclick={() => go(async () => {
          await guildAction({ type: 'category', name });
          close();
          await openServer(ui.serverId, { keepDialog: true });
        })}>Create</button>

      {:else if kind === 'lock'}
        <p class="hint">Nobody new can join, and only people who manage the server can post.</p>
        <div class="actions">
          {#each [[15, '15 minutes'], [60, '1 hour'], [1440, '1 day'], [0, 'Unlock']] as [min, label]}
            <button class="btn sm" onclick={() => go(async () => { await guildAction({ type: 'lock', minutes: min }); toast(min ? 'Server locked' : 'Server unlocked'); close(); })}>{label}</button>
          {/each}
        </div>

      {:else if kind === 'notify'}
        {#each [['all', 'All messages', 'Ping me for every message'], ['mentions', 'Only @mentions', 'Pings for @you and @everyone'], ['nothing', 'Nothing', 'Stay quiet']] as [id, title, sub]}
          <button class="btn" style="width:100%;margin-bottom:8px;justify-content:flex-start" class:brand={notifyMode() === id} onclick={() => { localStorage.setItem('nebula-notify-' + ui.serverId, id); close(); }}>
            <span><strong>{title}</strong><br /><span class="hint">{sub}</span></span>
          </button>
        {/each}

      {:else if kind === 'nick'}
        <div class="field"><label>Nickname on this server</label><input bind:value={name} maxlength="32" /></div>
        <button class="btn brand" style="width:auto" onclick={() => go(async () => { await guildAction({ type: 'nick', nick: name }); close(); await loadMembers(); })}>Save</button>

      {:else if kind === 'mute'}
        <div class="stack">
          {#each [[900000, '15 minutes'], [3600000, '1 hour'], [28800000, '8 hours'], [86400000, '24 hours'], [31536000000, 'Until I turn it back on'], [0, 'Unmute']] as [ms, label]}
            <button class="btn" onclick={() => { localStorage.setItem('nebula-mute-' + ui.serverId, ms ? String(Date.now() + ms) : '0'); close(); }}>{label}{serverMuted() && ms === 0 ? '' : ''}</button>
          {/each}
        </div>

      {:else if kind === 'report'}
        <div class="field"><label>Their user id</label><input bind:value={name} placeholder="4" /></div>
        <div class="field"><label>What happened</label><input bind:value={extra} maxlength="400" /></div>
        <button class="btn brand" style="width:auto" onclick={() => go(async () => {
          const mem = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
          const user = (mem.members || []).find((m) => String(m.uid) === name.trim());
          if (!user) throw new Error('No member with that id');
          await guildAction({ type: 'report', userId: user.id, text: extra });
          close();
          toast('Report sent');
        })}>Send report</button>

      {:else if kind === 'pings'}
        {#if !pingRoles.length}<p class="hint">This server has no roles you can pick yet.</p>{/if}
        {#each pingRoles as r}
          <label class="check">
            <input type="checkbox" checked={mine.has(r.id)} onchange={async (e) => {
              try { await guildAction({ type: 'ping-toggle', roleId: r.id }); if (e.target.checked) mine.add(r.id); else mine.delete(r.id); mine = new Set(mine); }
              catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
            }} />
            {r.name}
          </label>
        {/each}
        <p class="hint">Picking a role never gives you extra permissions.</p>

      {:else if kind === 'edit-channel'}
        <div class="field"><label>Name</label><input bind:value={name} placeholder={channel?.name} /></div>
        <div class="field"><label>Topic</label><input bind:value={extra} placeholder={channel?.topic || ''} /></div>
        <p class="label">Who can use this channel</p>
        {#each ui.roles as r}
          {@const deny = (channel?.overwrites || []).find((o) => o.roleId === r.id)}
          <label class="check">
            <input type="checkbox" data-view={r.id} checked={!(deny && (deny.deny & PERM.VIEW))} /> View
            <input type="checkbox" data-send={r.id} checked={!(deny && (deny.deny & PERM.SEND))} /> Send
            <span>{r.name}</span>
          </label>
        {/each}
        <div class="actions" style="margin-top:12px">
          <button class="btn brand" style="width:auto" onclick={() => go(saveChannel)}>Save</button>
          <button class="btn danger" onclick={() => go(deleteChannel)}>Delete</button>
        </div>

      {:else if kind === 'onboarding'}
        <p class="hint">Answer so you land in the right place.</p>
        {#each (ui.onboarding?.questions || []).filter((q) => q.q) as q}
          <label class="check"><input type="checkbox" data-role={q.roleId} /> {q.q}</label>
        {:else}<p class="hint">Nothing to pick. You can finish now.</p>{/each}
        <button class="btn brand" style="width:auto;margin-top:12px" onclick={() => go(async () => {
          const roleIds = [...document.querySelectorAll('[data-role]')].filter((el) => el.checked && el.dataset.role).map((el) => el.dataset.role);
          await guildAction({ type: 'onboard', roleIds });
          ui.onboarding = null;
          close();
          await loadMembers();
        })}>Finish</button>

      {:else if kind === 'delete'}
        <p class="hint">Delete {ui.serverMeta?.name}? This cannot be undone.</p>
        <button class="btn danger" onclick={() => go(async () => {
          await guildAction({ type: 'delete' });
          close();
          await openServer('nebula-official');
        })}>Delete server</button>
      {/if}
    </div>
  </div>
</div>
