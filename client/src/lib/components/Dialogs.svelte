<script>
  import { Hash, Lock, MessageSquare, Volume2, VolumeX, X } from '@lucide/svelte';
  import ChannelEditor from './ChannelEditor.svelte';
  import { ui, guildAction, openServer, toast, notifyMode, serverMuted, loadMembers, openDm, openGroup, relation, friendAct, keepServerKey, serverInvite, openThread, channelNotify, setChannelNotify } from '../state.svelte.js';
  import { api, uploadFile } from '../api.js';
  import { PERM, inviteSlug } from '../format.js';
  import { keyInLink, newRoomKey } from '../vault.js';
  import { hasPerm } from '../state.svelte.js';

  let name = $state('');
  let extra = $state('');
  let when = $state('');
  let code = $state('');
  let invites = $state([]);
  let vanity = $state('');
  let pingRoles = $state([]);
  let mine = $state(new Set());
  let busy = $state(false);
  let picked = $state([]);
  let groupStep = $state(1);
  let groupQuery = $state('');
  let iconUrl = $state('');
  let reportToken = '';
  let channelKind = $state('text');
  let channelToken = '';
  let channelPrivate = $state(false);
  let channelReadOnly = $state(false);
  let channelSlow = $state(0);
  let channelStage = $state(false);
  const SLOW = [
    [0, 'Off'],
    [5, '5 seconds'],
    [10, '10 seconds'],
    [15, '15 seconds'],
    [30, '30 seconds'],
    [60, '1 minute'],
    [120, '2 minutes'],
    [300, '5 minutes'],
    [600, '10 minutes'],
    [900, '15 minutes'],
    [1800, '30 minutes'],
    [3600, '1 hour'],
    [7200, '2 hours'],
    [21600, '6 hours'],
  ];
  const channelPlace = $derived.by(() => {
    const cat = (ui.categories || []).find((row) => row && row.id === ui.dialog?.categoryId);
    if (cat && cat.name) return cat.name;
    return channelKind === 'voice' ? 'Voice Channels' : 'Text Channels';
  });

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

  $effect(() => {
    if (kind === 'invite') loadInvites();
    if (kind === 'pings') loadPings();
    if ((kind === 'channel' || kind === 'discussion')) {
      const token = kind + ':' + (ui.dialog?.voice ? 'voice' : 'text') + ':' + (ui.dialog?.channelId || '');
      if (token !== channelToken) {
        channelToken = token;
        channelKind = kind === 'discussion' ? 'discussion' : (ui.dialog?.voice ? 'voice' : 'text');
        name = '';
        extra = '';
        channelPrivate = false;
        channelReadOnly = false;
        channelSlow = 0;
        channelStage = false;
      }
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

  async function loadInvites() {
    try {
      const data = await api('/api/servers/' + ui.serverId + '/invites');
      invites = data.invites || [];
      vanity = data.vanity || '';
    } catch (err) { toast(err.message); ui.dialog = null; }
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

  function pickChannelKind(next) {
    channelKind = next;
    channelReadOnly = false;
    channelSlow = 0;
    channelStage = false;
    if (next !== 'discussion') name = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  }

  function onChannelName(event) {
    const value = event.currentTarget.value;
    if (channelKind === 'discussion') {
      name = value.slice(0, 100);
      event.currentTarget.value = name;
      return;
    }
    const next = value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    name = next;
    event.currentTarget.value = next;
  }

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
  <div class="sheet" class:wide-sheet={kind === 'group'} class:channel-sheet={kind === 'edit-channel'} class:create-channel={kind === 'channel' || kind === 'discussion'} class:report-sheet={kind === 'user-report'} role="dialog" onclick={(e) => e.stopPropagation()}>
    <div class="sheet-h">
      <h3>
        {#if kind === 'add-server'}Add a server
        {:else if kind === 'invite'}Invite people
        {:else if kind === 'channel' || kind === 'discussion'}Create channel
        {:else if kind === 'category'}Create category
        {:else if kind === 'lock'}Lock server
        {:else if kind === 'notify'}Notification settings
        {:else if kind === 'channel-notify'}Notifications
        {:else if kind === 'voice-log'}Voice log
        {:else if kind === 'report-server'}Report server
        {:else if kind === 'nick'}Nickname
        {:else if kind === 'mute'}Mute server
        {:else if kind === 'report'}Report a member
        {:else if kind === 'pings'}Ping roles
        {:else if kind === 'edit-channel'}Edit channel
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
          const roomKey = newRoomKey();
          const data = await api('/api/servers', { method: 'POST', body: { name, discover: false } });
          if (data.server) keepServerKey(data.server.id, roomKey);
          const link = serverInvite(data.slug || data.invite, data.server?.id);
          try { await navigator.clipboard.writeText(link); } catch (_) {}
          close();
          toast('Server created. Invite link copied.');
          await openServer(data.server.id);
        })}>Create</button>
        <div class="field" style="margin-top:18px"><label>Join with an invite link</label><input bind:value={code} maxlength="120" placeholder="https://nebulaapp.space/nebula" /></div>
        <button class="btn" disabled={busy} onclick={() => go(async () => {
          const slug = inviteSlug(code);
          if (!slug) throw new Error('Paste an invite link');
          const data = await api('/api/invites/' + encodeURIComponent(slug) + '/join', { method: 'POST', body: {} });
          const secret = keyInLink(code);
          if (secret && data.server) keepServerKey(data.server.id, secret);
          if (data.pending) { toast('Request sent. An owner has to accept you.'); return; }
          close();
          await openServer(data.server.id);
        })}>Join</button>

      {:else if kind === 'invite'}
        {#if vanity}
          <p class="hint">Share this link. Anyone with it can join.</p>
          <div class="row"><code>{serverInvite(vanity)}</code></div>
          <button class="btn brand" style="width:auto;margin-top:12px" onclick={() => go(async () => {
            try { await navigator.clipboard.writeText(serverInvite(vanity)); } catch (_) {}
            toast('Invite link copied');
          })}>Copy link</button>
        {:else}
          <p class="hint">This server has fewer than 5 members, so each invite is a random link.</p>
          {#each invites as inv}
            <div class="row"><code>{serverInvite(inv.slug || inv.code)}</code><span class="hint">{inv.uses || 0} uses</span></div>
          {:else}<p class="hint">No links yet.</p>{/each}
          <button class="btn brand" style="width:auto;margin-top:12px" onclick={() => go(async () => {
            const data = await api('/api/servers/' + ui.serverId + '/invites', { method: 'POST', body: {} });
            const link = serverInvite(data.slug);
            try { await navigator.clipboard.writeText(link); } catch (_) {}
            toast('Invite link copied');
            await loadInvites();
          })}>Create invite link</button>
        {/if}

      {:else if kind === 'promote'}
        <p class="hint">Copies an invite link you can send anywhere.</p>
        <button class="btn brand" style="width:auto" onclick={() => go(async () => {
          const data = await api('/api/servers/' + ui.serverId + '/invites', { method: 'POST', body: {} });
          const link = serverInvite(data.slug);
          const text = 'Join ' + (ui.serverMeta?.name || 'my server') + ' on Nebula: ' + link;
          try { await navigator.clipboard.writeText(text); } catch (_) {}
          toast('Copied');
          close();
        })}>Copy invite link</button>

      {:else if kind === 'channel' || kind === 'discussion'}
        <p class="create-where">in {channelPlace}</p>
        <p class="create-label">Type</p>
        <div class="create-types">
          <button type="button" class:on={channelKind === 'text'} onclick={() => pickChannelKind('text')}><Hash size={16} /> Text</button>
          <button type="button" class:on={channelKind === 'voice'} onclick={() => pickChannelKind('voice')}><Volume2 size={16} /> Voice</button>
          <button type="button" class:on={channelKind === 'discussion'} onclick={() => pickChannelKind('discussion')}><MessageSquare size={16} /> Discussion</button>
        </div>
        <p class="create-label">Channel name</p>
        <label class="create-name">
          <span aria-hidden="true">{#if channelKind === 'voice'}<Volume2 size={18} />{:else}<Hash size={18} />{/if}</span>
          <input value={name} maxlength={channelKind === 'discussion' ? 100 : 32} placeholder={channelKind === 'voice' ? 'Gaming Lounge' : channelKind === 'discussion' ? 'A short title' : 'new-channel'} oninput={onChannelName} />
        </label>
        {#if channelKind === 'discussion'}
          <p class="create-label">First message</p>
          <label class="create-name">
            <input bind:value={extra} maxlength="2000" placeholder="Start the conversation" />
          </label>
        {/if}
        <div class="create-rule"></div>
        <div class="create-row">
          <div>
            <strong>Private Channel <Lock size={15} /></strong>
            <p>Only the roles you pick (plus the owner and server managers) can see and use it.</p>
          </div>
          <button type="button" class="switch" class:on={channelPrivate} role="switch" aria-checked={channelPrivate} onclick={() => (channelPrivate = !channelPrivate)}><i></i></button>
        </div>
        {#if channelKind === 'text'}
          <div class="create-rule"></div>
          <div class="create-row">
            <div>
              <strong>Read-only <VolumeX size={15} /></strong>
              <p>Everyone can read and react, but only the roles you pick (plus managers) can post. Great for #announcements.</p>
            </div>
            <button type="button" class="switch" class:on={channelReadOnly} role="switch" aria-checked={channelReadOnly} onclick={() => (channelReadOnly = !channelReadOnly)}><i></i></button>
          </div>
          <div class="create-rule"></div>
          <div class="create-row">
            <div>
              <strong>Slowmode</strong>
              <p>How long people wait between messages. Moderators aren’t affected.</p>
            </div>
            <select class="create-slow" value={String(channelSlow)} onchange={(e) => (channelSlow = Number(e.currentTarget.value) || 0)}>
              {#each SLOW as [value, label]}<option value={String(value)}>{label}</option>{/each}
            </select>
          </div>
        {:else if channelKind === 'voice'}
          <div class="create-rule"></div>
          <div class="create-row">
            <div>
              <strong>Stage</strong>
              <p>For Q&amp;As and events. People join as listeners and can’t unmute. People with Mute Members can always talk.</p>
            </div>
            <button type="button" class="switch" class:on={channelStage} role="switch" aria-checked={channelStage} onclick={() => (channelStage = !channelStage)}><i></i></button>
          </div>
        {/if}
        <div class="create-foot">
          <button type="button" class="create-cancel" onclick={close}>Cancel</button>
          <button class="btn brand" type="button" disabled={busy} onclick={() => go(async () => {
            if (channelKind === 'discussion') {
              const channelId = ui.dialog.channelId || ui.channelId || (ui.channels || []).find((row) => row.type === 'text')?.id;
              if (!channelId) throw new Error('Add a text channel first');
              const title = name.trim();
              const content = extra.trim();
              if (!title) throw new Error('Give the discussion a name');
              if (!content) throw new Error('Write the first message');
              const data = await api('/api/channels/' + encodeURIComponent(channelId) + '/threads', {
                method: 'POST',
                body: { serverId: ui.serverId, name: title, content, private: channelPrivate },
              });
              const channelName = (ui.channels || []).find((row) => row.id === channelId)?.name || 'channel';
              close();
              if (data.thread) await openThread({ ...data.thread, channelName });
              return;
            }
            const data = await api('/api/servers/' + ui.serverId + '/channels', {
              method: 'POST',
              body: {
                name,
                type: channelKind === 'voice' ? 'voice' : 'text',
                private: channelPrivate,
                readOnly: channelKind === 'text' && channelReadOnly,
                slowmode: channelKind === 'text' ? channelSlow : 0,
                stage: channelKind === 'voice' && channelStage,
              },
            });
            if (ui.dialog.categoryId && data.channel?.id && hasPerm(PERM.MANAGE_SERVER)) {
              await guildAction({ type: 'set-category', channelId: data.channel.id, categoryId: ui.dialog.categoryId });
            }
            close();
            await openServer(ui.serverId, { keepDialog: true });
          })}>Create channel</button>
        </div>

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

      {:else if kind === 'channel-notify'}
        {#each [['all', 'All messages'], ['mentions', 'Only @mentions'], ['nothing', 'Nothing']] as [id, title]}
          <button class="btn" style="width:100%;margin-bottom:8px;justify-content:flex-start" class:brand={channelNotify(ui.dialog.channel?.id) === id || (id === 'all' && channelNotify(ui.dialog.channel?.id) === 'default')} onclick={() => { setChannelNotify(ui.dialog.channel?.id, id); close(); }}>{title}</button>
        {/each}

      {:else if kind === 'voice-log'}
        {@const people = ui.voiceRooms[ui.dialog.channel?.id] || []}
        {#if people.length}
          {#each people as person (person.id)}
            <div class="row"><strong>{person.displayName || person.username}</strong></div>
          {/each}
        {:else}
          <p class="hint">No one is in this voice channel.</p>
        {/if}

      {:else if kind === 'report-server'}
        <p class="hint">This report goes to Nebula's admins.</p>
        <div class="field"><label>What happened</label><input bind:value={extra} maxlength="400" placeholder="What should they look at?" /></div>
        <button class="btn brand" style="width:auto" onclick={() => go(async () => {
          const mem = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
          const owner = (mem.members || []).find((person) => person.serverOwner && String(person.id) !== String(ui.me?.id));
          if (!owner) throw new Error('Could not send that report');
          await api('/api/reports', { method: 'POST', body: { userId: owner.id, reason: 'other', text: 'Server ' + (ui.serverMeta?.name || '') + (extra ? ': ' + extra : '') } });
          close();
          toast('Report sent');
        })}>Send report</button>

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
        <ChannelEditor />

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
