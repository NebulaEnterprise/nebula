<script>
  import { Copy, Lock, Plus, Trash2 } from '@lucide/svelte';
  import { api, webhookUrl } from '../api.js';
  import { PERM, hasBit, setBit } from '../format.js';
  import { openServer, toast, ui } from '../state.svelte.js';

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

  const GROUPS = [
    { title: 'General', items: [
      ['View Channel', PERM.VIEW, 'See this channel and read what’s in it.'],
    ]},
    { title: 'Text', items: [
      ['Send Messages', PERM.SEND, 'Post here.'],
      ['Add Reactions', PERM.REACT, 'Add new reactions. Without it people can still click ones already there.'],
      ['Attach Files', PERM.ATTACH, 'Upload pictures, videos and audio.'],
      ['Send Voice Messages', PERM.VOICE_MSG, 'Record and send voice messages here.'],
      ['Embed Links', PERM.EMBED, 'Post links.'],
      ['Use Big Text', PERM.BIG_TEXT, 'Post headings (# text) here.'],
      ['Mention @everyone', PERM.MENTION_EVERYONE, 'Ping everyone who can see this channel.'],
      ['Manage Messages', PERM.MANAGE_MESSAGES, 'Delete and pin anyone’s messages here, and skip slowmode.'],
      ['Create Threads', PERM.CREATE_THREADS, 'Start threads from this channel.'],
      ['Send Messages in Threads', PERM.SEND_THREADS, 'Reply in this channel’s threads (or this forum’s posts).'],
      ['Manage Threads', PERM.MANAGE_THREADS, 'Close, lock, pin, rename, move and delete threads here.'],
    ]},
  ];

  let tab = $state('overview');
  let loaded = '';
  let channelName = $state('');
  let topic = $state('');
  let isPrivate = $state(false);
  let textOnly = $state(false);
  let noGifs = $state(false);
  let readOnly = $state(false);
  let slowmode = $state(0);
  let overwrites = $state([]);
  let roleId = $state('everyone');
  let permQuery = $state('');
  let addOpen = $state(false);
  let hooks = $state([]);
  let hookNote = $state('');
  let postingId = $state('');
  let postText = $state('');
  let renameId = $state('');
  let renameValue = $state('');
  let busy = $state(false);

  const channel = $derived(ui.dialog?.channel);
  const textChannel = $derived(!channel || channel.type !== 'voice');
  const roles = $derived((ui.roles || []).filter((role) => role && role.id !== 'here' && role.id !== 'owner'));
  const shownRoles = $derived.by(() => {
    const ids = new Set(['everyone', ...overwrites.map((row) => row.roleId)]);
    return roles.filter((role) => ids.has(role.id));
  });
  const spareRoles = $derived(roles.filter((role) => role.id !== 'everyone' && !shownRoles.some((row) => row.id === role.id)));
  const permRows = $derived.by(() => {
    const q = permQuery.trim().toLowerCase();
    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => !q || item[0].toLowerCase().includes(q) || item[2].toLowerCase().includes(q)),
    })).filter((group) => group.items.length);
  });

  $effect(() => {
    const ch = channel;
    if (!ch) return;
    if (loaded === ch.id) return;
    loaded = ch.id;
    channelName = ch.name || '';
    topic = ch.topic || '';
    textOnly = !!ch.textOnly;
    noGifs = !!ch.noGifs;
    readOnly = !!ch.readOnly;
    slowmode = Number(ch.slowmode) || 0;
    overwrites = (ch.overwrites || []).map((row) => ({
      roleId: row.roleId,
      allow: Number(row.allow) || 0,
      deny: Number(row.deny) || 0,
    }));
    const everyone = overwrites.find((row) => row.roleId === 'everyone');
    isPrivate = !!(ch.private || (everyone && hasBit(everyone.deny, PERM.VIEW)));
    if (everyone && hasBit(everyone.deny, PERM.SEND)) readOnly = true;
    roleId = 'everyone';
    tab = 'overview';
    hooks = [];
    hookNote = '';
    postingId = '';
    postText = '';
  });

  function modeOf(flag) {
    const row = overwrites.find((item) => item.roleId === roleId);
    if (!row) return 'neutral';
    if (hasBit(row.deny, flag)) return 'deny';
    if (hasBit(row.allow, flag)) return 'allow';
    return 'neutral';
  }

  function setMode(flag, mode) {
    const next = overwrites.map((row) => ({ ...row }));
    let row = next.find((item) => item.roleId === roleId);
    if (!row) {
      row = { roleId, allow: 0, deny: 0 };
      next.push(row);
    }
    row.allow = setBit(row.allow, flag, mode === 'allow');
    row.deny = setBit(row.deny, flag, mode === 'deny');
    overwrites = next;
  }

  function addRole(id) {
    if (!overwrites.some((row) => row.roleId === id)) {
      overwrites = [...overwrites, { roleId: id, allow: 0, deny: 0 }];
    }
    roleId = id;
    addOpen = false;
  }

  async function save() {
    const ch = channel;
    if (!ch) return;
    busy = true;
    try {
      const rows = overwrites.map((row) => ({ ...row }));
      let everyone = rows.find((row) => row.roleId === 'everyone');
      if (!everyone) {
        everyone = { roleId: 'everyone', allow: 0, deny: 0 };
        rows.push(everyone);
      }
      everyone.deny = setBit(everyone.deny, PERM.VIEW, isPrivate);
      if (!isPrivate) everyone.allow = setBit(everyone.allow, PERM.VIEW, false);
      everyone.deny = setBit(everyone.deny, PERM.SEND, readOnly && textChannel);
      if (!readOnly) everyone.deny = setBit(everyone.deny, PERM.SEND, false);
      const kept = rows.filter((row) => row.allow || row.deny);
      await api('/api/servers/' + ui.serverId + '/channels/' + ch.id, {
        method: 'PATCH',
        body: {
          name: channelName || ch.name,
          topic,
          slowmode: textChannel ? slowmode : 0,
          textOnly: textChannel && textOnly,
          noGifs: textChannel && noGifs,
          readOnly: textChannel && readOnly,
          private: isPrivate,
          overwrites: kept,
        },
      });
      ui.dialog = null;
      await openServer(ui.serverId, { keepDialog: true });
      toast('Channel saved');
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function removeChannel() {
    const ch = channel;
    if (!ch || !confirm('Delete this channel?')) return;
    busy = true;
    try {
      await api('/api/servers/' + ui.serverId + '/channels/' + ch.id, { method: 'DELETE' });
      if (ui.channelId === ch.id) ui.channelId = '';
      ui.dialog = null;
      await openServer(ui.serverId, { keepDialog: true });
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function loadHooks() {
    const ch = channel;
    if (!ch) return;
    hookNote = '';
    try {
      const data = await api('/api/servers/' + ui.serverId + '/channels/' + ch.id + '/webhooks');
      hooks = data.webhooks || [];
    } catch (err) {
      hooks = [];
      hookNote = err.status === 404
        ? 'Webhooks need the updated server. Replace server.js and start it again, then come back here.'
        : err.message;
    }
  }

  async function createHook() {
    const ch = channel;
    if (!ch) return;
    busy = true;
    try {
      const data = await api('/api/servers/' + ui.serverId + '/channels/' + ch.id + '/webhooks', {
        method: 'POST',
        body: { name: ch.name || 'webhook' },
      });
      if (data.webhook) hooks = [...hooks, data.webhook];
      toast('Webhook created');
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function copyHook(hook) {
    const url = webhookUrl(hook);
    try {
      await navigator.clipboard.writeText(url);
      toast('Webhook URL copied');
    } catch (_) {
      toast(url);
    }
  }

  async function saveHookName(hook) {
    const name = renameValue.trim();
    renameId = '';
    if (!name || name === hook.name) return;
    try {
      const data = await api('/api/servers/' + ui.serverId + '/webhooks/' + hook.id, { method: 'PATCH', body: { name } });
      hooks = hooks.map((row) => row.id === hook.id ? (data.webhook || { ...row, name }) : row);
    } catch (err) {
      toast(err.message);
    }
  }

  async function removeHook(hook) {
    if (!confirm('Delete this webhook? Anything still using the URL will stop posting.')) return;
    try {
      await api('/api/servers/' + ui.serverId + '/webhooks/' + hook.id, { method: 'DELETE' });
      hooks = hooks.filter((row) => row.id !== hook.id);
    } catch (err) {
      toast(err.message);
    }
  }

  async function sendPost(hook) {
    const content = postText.trim();
    if (!content) return;
    busy = true;
    try {
      const res = await fetch(webhookUrl(hook), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not post');
      postText = '';
      postingId = '';
      toast('Posted to #' + (channel?.name || 'channel'));
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }
</script>

<div class="ched">
  <div class="ched-tabs" role="tablist">
    <button type="button" class:on={tab === 'overview'} onclick={() => (tab = 'overview')}>Overview</button>
    <button type="button" class:on={tab === 'permissions'} onclick={() => (tab = 'permissions')}>Permissions</button>
    {#if textChannel}<button type="button" class:on={tab === 'webhooks'} onclick={() => { tab = 'webhooks'; loadHooks(); }}>Webhooks</button>{/if}
  </div>

  {#if tab === 'overview'}
    <div class="field">
      <label>Channel name</label>
      <input bind:value={channelName} maxlength="32" />
    </div>
    <div class="field">
      <label>Topic</label>
      <input bind:value={topic} maxlength="200" placeholder="What this channel is for" />
    </div>
    {#if textChannel}
      <div class="ched-row">
        <div>
          <strong>Private channel <Lock size={14} /></strong>
          <p>Only the roles you pick (plus the owner and server managers) can see and use it.</p>
        </div>
        <button type="button" class="switch" class:on={isPrivate} role="switch" aria-checked={isPrivate} onclick={() => (isPrivate = !isPrivate)}><i></i></button>
      </div>
      <div class="ched-row">
        <div>
          <strong>Text only</strong>
          <p>No pictures, files or GIFs in this channel, except from managers and mods. Keep an images channel next to it.</p>
        </div>
        <button type="button" class="switch" class:on={textOnly} role="switch" aria-checked={textOnly} onclick={() => (textOnly = !textOnly)}><i></i></button>
      </div>
      <div class="ched-row">
        <div>
          <strong>No GIFs</strong>
          <p>GIFs from the picker and GIF links are refused here. Pictures still work. People with Manage Messages are excepted.</p>
        </div>
        <button type="button" class="switch" class:on={noGifs} role="switch" aria-checked={noGifs} onclick={() => (noGifs = !noGifs)}><i></i></button>
      </div>
      <div class="ched-row">
        <div>
          <strong>Read-only</strong>
          <p>Everyone can read and react, but only the roles you pick (plus managers) can post. Great for #announcements.</p>
        </div>
        <button type="button" class="switch" class:on={readOnly} role="switch" aria-checked={readOnly} onclick={() => (readOnly = !readOnly)}><i></i></button>
      </div>
      <div class="ched-row">
        <div>
          <strong>Slowmode</strong>
          <p>How long people wait between messages. Moderators aren’t affected.</p>
        </div>
        <select value={String(slowmode)} onchange={(e) => (slowmode = Number(e.currentTarget.value) || 0)}>
          {#each SLOW as [value, label]}<option value={String(value)}>{label}</option>{/each}
        </select>
      </div>
    {/if}
  {:else if tab === 'permissions'}
    <p class="hint">Allow or deny stuff just here. Anything left neutral uses the server’s role settings.</p>
    <div class="ched-perm">
      <div class="ched-roles">
        <p>Roles</p>
        {#each shownRoles as role}
          <button type="button" class:on={roleId === role.id} onclick={() => (roleId = role.id)}>
            <i style="background:{role.color || '#99aab5'}"></i>
            {role.name}
          </button>
        {/each}
        <div class="ched-add">
          <button type="button" onclick={() => (addOpen = !addOpen)}><Plus size={14} /> Add a role</button>
          {#if addOpen}
            <div class="ched-menu">
              {#each spareRoles as role}
                <button type="button" onclick={() => addRole(role.id)}>{role.name}</button>
              {:else}
                <p>Every role is already here.</p>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="ched-flags">
        <input class="search" placeholder="Search permissions" bind:value={permQuery} />
        {#each permRows as group}
          <p class="ched-group">{group.title}</p>
          {#each group.items as [title, flag, about]}
            {@const mode = modeOf(flag)}
            <div class="ched-flag">
              <div>
                <strong>{title}</strong>
                <p>{about}</p>
              </div>
              <div class="tri" role="group" aria-label={title}>
                <button type="button" class:deny={mode === 'deny'} title="Deny" onclick={() => setMode(flag, mode === 'deny' ? 'neutral' : 'deny')}>×</button>
                <button type="button" class:mid={mode === 'neutral'} title="Neutral" onclick={() => setMode(flag, 'neutral')}>/</button>
                <button type="button" class:allow={mode === 'allow'} title="Allow" onclick={() => setMode(flag, mode === 'allow' ? 'neutral' : 'allow')}>✓</button>
              </div>
            </div>
          {/each}
        {/each}
      </div>
    </div>
  {:else}
    <p class="hint">Webhooks let other apps post here. Paste the URL into any app or tool that posts to a webhook. Anyone with the URL can post, so keep it secret.</p>
    <div class="ched-hookbar">
      <button type="button" class="btn brand" disabled={busy || hooks.length >= 10} onclick={createHook}>New webhook</button>
      <button type="button" class="btn" disabled={!hooks.length} onclick={() => { postingId = postingId ? '' : (hooks[0] && hooks[0].id); postText = ''; }}>Make a post</button>
      <span>{hooks.length} of 10</span>
    </div>
    {#if hookNote}
      <p class="hint">{hookNote}</p>
    {:else if !hooks.length}
      <div class="ched-empty">
        <img src="./logo.webp?v=3" alt="" />
        <strong>No webhooks yet</strong>
        <p>Make one and paste its URL into any app that posts to a webhook.</p>
        <button type="button" class="btn brand" disabled={busy} onclick={createHook}>New webhook</button>
      </div>
    {:else}
      {#each hooks as hook (hook.id)}
        <article class="ched-hook">
          <div class="ched-hook-h">
            {#if renameId === hook.id}
              <input bind:value={renameValue} maxlength="80" onkeydown={(e) => { if (e.key === 'Enter') saveHookName(hook); }} onblur={() => saveHookName(hook)} />
            {:else}
              <button type="button" class="ched-hook-name" onclick={() => { renameId = hook.id; renameValue = hook.name; }}>{hook.name}</button>
            {/if}
            <span>#{hook.channelName || channel?.name}</span>
          </div>
          <code>{webhookUrl(hook)}</code>
          <div class="ched-hook-actions">
            <button type="button" class="btn sm" onclick={() => copyHook(hook)}><Copy size={14} /> Copy URL</button>
            <button type="button" class="btn sm" onclick={() => { postingId = postingId === hook.id ? '' : hook.id; postText = ''; }}>Make a post</button>
            <button type="button" class="btn sm danger" onclick={() => removeHook(hook)}><Trash2 size={14} /> Delete</button>
          </div>
          {#if postingId === hook.id}
            <div class="ched-post">
              <textarea bind:value={postText} maxlength="2000" placeholder="Say something as {hook.name}"></textarea>
              <button type="button" class="btn brand" disabled={busy || !postText.trim()} onclick={() => sendPost(hook)}>Post</button>
            </div>
          {/if}
        </article>
      {/each}
    {/if}
  {/if}

  {#if tab !== 'webhooks'}
    <div class="ched-foot">
      <button type="button" class="btn danger" disabled={busy} onclick={removeChannel}>Delete</button>
      <span class="grow"></span>
      <button type="button" class="btn" disabled={busy} onclick={() => (ui.dialog = null)}>Cancel</button>
      <button type="button" class="btn brand" disabled={busy} onclick={save}>Save</button>
    </div>
  {:else}
    <div class="ched-foot">
      <span class="grow"></span>
      <button type="button" class="btn brand" onclick={() => (ui.dialog = null)}>Done</button>
    </div>
  {/if}
</div>
