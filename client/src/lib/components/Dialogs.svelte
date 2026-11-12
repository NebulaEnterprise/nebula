<script>
  import { X } from '@lucide/svelte';
  import { ui, guildAction, openServer, toast, notifyMode, serverMuted, loadMembers, openDm, openGroup, relation, friendAct } from '../state.svelte.js';
  import { api, uploadFile } from '../api.js';
  import { PERM, inviteLink, inviteSlug } from '../format.js';
  import { hasPerm } from '../state.svelte.js';

  let name = $state('');
  let extra = $state('');
  let when = $state('');
  let code = $state('');
  let invites = $state([]);
  let vanity = $state('');
  let events = $state([]);
  let pingRoles = $state([]);
  let mine = $state(new Set());
  let busy = $state(false);
  let picked = $state([]);
  let groupStep = $state(1);
  let groupQuery = $state('');
  let iconUrl = $state('');
  let reportToken = '';

  const friendChoices = $derived((ui.friends || []).filter((person) => {
    const q = groupQuery.trim().toLowerCase();
    if (!q) return true;
    return ((person.username || '') + ' ' + (person.displayName || '')).toLowerCase().includes(q);
  }));

  function togglePick(id) {
    if (picked.includes(id)) picked = picked.filter((row) => row !== id);
    else if (picked.length < 9) picked = [...picked, id];
  }

  async function nextGroup() {
    if (picked.length === 1) {
      const friend = (ui.friends || []).find((row) => row.id === picked[0]);
      close();
      if (friend) await openDm(friend);
      return;
    }
    groupStep = 2;
  }

  async function setGroupIcon(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const uploaded = await uploadFile(file);
    iconUrl = uploaded.url || '';
  }

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
    if (kind === 'user-report') {
      const token = (ui.dialog?.user?.id || '') + ':' + (ui.dialog?.message?.id || '');
      if (token && token !== reportToken) {
        reportToken = token;
        name = '';
        extra = '';
      }
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
      vanity = data.vanity || '';
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

  async function sendCallFriend() {
    const user = ui.dialog?.user;
    if (!user) return;
    const rel = relation(user.id);
    if (rel === 'blocked') {
      await friendAct('unblock', { userId: user.id });
      close();
      return;
    }
    if (rel === 'incoming') {
      await friendAct('accept', { userId: user.id });
      close();
      return;
    }
    await friendAct('request', { username: user.username });
    close();
    toast('Friend request sent');
  }

  async function go(fn) {
    busy = true;
    try { await fn(); }
    catch (err) { toast(err.message); }
    finally { busy = false; }
  }
</script>

{#if kind === 'start-call'}
  {@const person = ui.dialog.user}
  {@const rel = relation(person?.id)}
  <div class="overlay" role="presentation" onclick={close}>
    <div class="call-gate" role="dialog" aria-labelledby="start-call-title" onclick={(e) => e.stopPropagation()}>
      <div class="call-gate-h">
        <h3 id="start-call-title">Start Call</h3>
        <button type="button" class="btn icon" title="Close" onclick={close}><X size={18} /></button>
      </div>
      {#if ui.dialog.tone === 'closed'}
        <p>They are not accepting calls.</p>
        <button type="button" class="btn call-ok" onclick={close}>Okay</button>
      {:else}
        <p>You need to be friends with <strong>{person?.displayName || person?.username || 'them'}</strong> to start a call</p>
        <button type="button" class="btn call-ok" onclick={close}>Okay</button>
        <button type="button" class="btn brand" disabled={busy || rel === 'outgoing'} onclick={() => go(sendCallFriend)}>
          {rel === 'outgoing' ? 'Friend Request Sent' : rel === 'incoming' ? 'Accept Friend Request' : rel === 'blocked' ? 'Unblock' : 'Send Friend Request'}
        </button>
      {/if}
    </div>
  </div>
{:else}
<div class="overlay" role="presentation" onclick={close}>
  <div class="sheet" class:wide-sheet={kind === 'group'} class:report-sheet={kind === 'user-report'} role="dialog" onclick={(e) => e.stopPropagation()}>
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
        {:else if kind === 'group'}{groupStep === 1 ? 'Select friends' : 'Customize your group'}
        {:else if kind === 'user-report'}Report {ui.dialog.user?.displayName || ui.dialog.user?.username || 'user'}
        {:else if kind === 'leave'}Leave Nebula
        {:else if kind === 'leave-server'}Leave server
        {:else}Server{/if}
      </h3>
      {#if kind !== 'user-report'}<button class="btn icon" onclick={close}><X size={16} /></button>{/if}
    </div>
    <div class="body">
      {#if kind === 'group'}
        {#if groupStep === 1}
          <p class="hint">Pick one to DM, or a few to make a group.</p>
          <input class="search group-search" placeholder="Type the username of a friend" bind:value={groupQuery} />
          <p class="hint">You can add {Math.max(0, 9 - picked.length)} more</p>
          <div class="group-picks">
            {#each friendChoices as friend (friend.id)}
              <label class="pick-row">
                <input type="checkbox" checked={picked.includes(friend.id)} onchange={() => togglePick(friend.id)} />
                <span>{friend.displayName || friend.username}</span>
                <em>@{friend.username}</em>
              </label>
            {:else}
              <p class="hint">No friends match.</p>
            {/each}
          </div>
          <div class="group-actions">
            <button class="btn" type="button" onclick={close}>Cancel</button>
            <button class="btn brand" type="button" disabled={!picked.length} onclick={nextGroup}>Next</button>
          </div>
        {:else}
          <p class="hint">You can always change these later.</p>
          <label class="group-icon">
            {#if iconUrl}<img src={iconUrl} alt="" />{:else}<span>Icon</span>{/if}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange={setGroupIcon} />
          </label>
          <div class="field"><label>Group name</label><input bind:value={name} maxlength="80" placeholder="My group" /></div>
          <div class="group-actions">
            <button class="btn" type="button" onclick={() => (groupStep = 1)}>Back</button>
            <button class="btn brand" type="button" disabled={busy} onclick={() => go(async () => {
              const data = await api('/api/groups', { method: 'POST', body: { name: name.trim() || 'Group', memberIds: picked, iconUrl } });
              close();
              if (data.group) await openGroup(data.group);
            })}>Create group</button>
          </div>
        {/if}
      {:else if kind === 'add-server'}
        <div class="field"><label>Server name</label><input bind:value={name} maxlength="40" placeholder="A name people will remember" /></div>
        <button class="btn brand" disabled={busy} onclick={() => go(async () => {
          const data = await api('/api/servers', { method: 'POST', body: { name } });
          const link = inviteLink(data.slug || data.invite);
          try { await navigator.clipboard.writeText(link); } catch (_) {}
          close();
          toast('Server created. Invite link copied.');
          await openServer(data.server.id);
        })}>Create</button>
        <div class="field" style="margin-top:18px"><label>Join with an invite link</label><input bind:value={code} maxlength="120" placeholder="https://…/invite/nebula" /></div>
        <button class="btn" disabled={busy} onclick={() => go(async () => {
          const slug = inviteSlug(code);
          if (!slug) throw new Error('Paste an invite link');
          const data = await api('/api/invites/' + encodeURIComponent(slug) + '/join', { method: 'POST', body: {} });
          if (data.pending) { toast('Request sent. An owner has to accept you.'); return; }
          close();
          await openServer(data.server.id);
        })}>Join</button>

      {:else if kind === 'invite'}
        {#if vanity}
          <p class="hint">Share this link. Anyone with it can join.</p>
          <div class="row"><code>{inviteLink(vanity)}</code></div>
          <button class="btn brand" style="width:auto;margin-top:12px" onclick={() => go(async () => {
            try { await navigator.clipboard.writeText(inviteLink(vanity)); } catch (_) {}
            toast('Invite link copied');
          })}>Copy link</button>
        {:else}
          <p class="hint">This server has fewer than 5 members, so each invite is a random link.</p>
          {#each invites as inv}
            <div class="row"><code>{inviteLink(inv.slug || inv.code)}</code><span class="hint">{inv.uses || 0} uses</span></div>
          {:else}<p class="hint">No links yet.</p>{/each}
          <button class="btn brand" style="width:auto;margin-top:12px" onclick={() => go(async () => {
            const data = await api('/api/servers/' + ui.serverId + '/invites', { method: 'POST', body: {} });
            const link = inviteLink(data.slug);
            try { await navigator.clipboard.writeText(link); } catch (_) {}
            toast('Invite link copied');
            await loadInvites();
          })}>Create invite link</button>
        {/if}

      {:else if kind === 'promote'}
        <p class="hint">Copies an invite link you can send anywhere.</p>
        <button class="btn brand" style="width:auto" onclick={() => go(async () => {
          const data = await api('/api/servers/' + ui.serverId + '/invites', { method: 'POST', body: {} });
          const link = inviteLink(data.slug);
          const text = 'Join ' + (ui.serverMeta?.name || 'my server') + ' on Nebula: ' + link;
          try { await navigator.clipboard.writeText(text); } catch (_) {}
          toast('Copied');
          close();
        })}>Copy invite link</button>

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

      {:else if kind === 'user-report'}
        <p class="hint report-lead">Only Nebula's admins see reports. They won't know who sent it.</p>
        <div class="report-reasons">
          {#each [['harassment', 'Harassment or bullying'], ['hate', 'Hate speech or slurs'], ['sexual', 'Sexual content'], ['child', 'Child safety (someone may be a minor at risk)'], ['threats', 'Threats or violence'], ['self-harm', 'Self-harm or suicide'], ['spam', 'Spam or scams'], ['illegal', 'Something illegal'], ['other', 'Something else']] as [id, label]}
            <label class="report-choice"><input type="radio" name="report-reason" value={id} bind:group={name} /> {label}</label>
          {/each}
        </div>
        <div class="field"><label>Anything else? (optional)</label><textarea bind:value={extra} maxlength="500" rows="3" placeholder="Links, context, what happened..."></textarea></div>
        <div class="group-actions">
          <button class="btn report-cancel" type="button" onclick={close}>Cancel</button>
          <button class="btn report-send" type="button" disabled={busy || !name} onclick={() => go(async () => {
            await api('/api/reports', { method: 'POST', body: { userId: ui.dialog.user?.id, reason: name, text: extra, messageId: ui.dialog.message?.id || '', excerpt: String(ui.dialog.message?.content || '').slice(0, 240) } });
            close();
            toast('Report sent');
          })}>Send report</button>
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

      {:else if kind === 'leave'}
        <p class="hint">This link will make you leave Nebula. Do you wish to proceed?</p>
        <p class="leave-url">{ui.dialog.url}</p>
        <div class="leave-actions">
          <button class="btn" type="button" onclick={close}>No</button>
          <button class="btn brand" type="button" onclick={() => {
            const url = ui.dialog?.url;
            close();
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          }}>Yes</button>
        </div>

      {:else if kind === 'leave-server'}
        <p class="hint">Leave {ui.serverMeta?.name || 'this server'}? You will need a new invite to come back.</p>
        <button class="btn danger" onclick={() => go(async () => {
          await guildAction({ type: 'leave' });
          close();
          await openServer('nebula-official');
        })}>Leave server</button>

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
{/if}
