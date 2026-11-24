<script>
  import { X, Pin, Image as ImageIcon, Search, UserPlus, User, AtSign, Tags, Smile, Clock, Circle, Gamepad2 } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import Attachment from './Attachment.svelte';
  import Inbox from './Inbox.svelte';
  import SongButton from './SongButton.svelte';
  import FullPhoto from './FullPhoto.svelte';
  import { shortBio, visibleBadges, playingName, bannerFocus, gifUrls } from '../format.js';
  import { t } from '../i18n.svelte.js';
  import { ui, nowClock, openThread, pinMessage, friendAct, toast, showFriends, loadProfile, revealList } from '../state.svelte.js';
  import { isSealedText } from '../vault.js';
  import { profileSeen, localClock } from '../seen.js';
  import { api, uploadFile, fileUrl } from '../api.js';

  let pins = $state([]);
  let files = $state([]);
  let hits = $state([]);
  let threads = $state([]);
  let mediaKind = $state('all');
  let mediaWho = $state('anyone');
  let threadName = $state('');
  let threadBody = $state('');
  let busy = $state(false);
  let addId = $state('');
  let profileLoaded = '';
  let full = $state('');

  const title = $derived(
    ui.dock === 'pins' ? 'Pinned messages'
      : ui.dock === 'media' ? 'Media'
        : ui.dock === 'inbox' ? 'Inbox'
        : ui.dock === 'search' ? 'Search'
          : ui.dock === 'threads' ? 'Threads'
            : ui.dock === 'group' ? 'Group details'
              : 'Profile'
  );
  const dockRoom = $derived({
    mode: ui.mode,
    dmUserId: ui.dmUser?.id || '',
    groupId: ui.group?.id || '',
    serverId: ui.serverId || '',
  });

  function spoken(msg) {
    return plainLine(msg).replace(/\[\[(?:gif|sticker):[^\]]+\]\]/g, '').trim();
  }

  function keepShot(file) {
    if (!file || file.kind === 'audio' || file.voice) return false;
    const name = file.name || file.url || '';
    const image = file.kind === 'image' || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(name);
    const video = file.kind === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(name);
    if (mediaKind === 'images') return image;
    if (mediaKind === 'videos') return video;
    if (mediaKind === 'files') return !image && !video;
    return true;
  }

  function roomQuery() {
    if (ui.mode === 'dm' && ui.dmUser) return 'dmUserId=' + encodeURIComponent(ui.dmUser.id);
    if (ui.mode === 'group' && ui.group) return 'groupId=' + encodeURIComponent(ui.group.id);
    if (ui.mode === 'thread' && ui.thread) return 'threadId=' + encodeURIComponent(ui.thread.id);
    return 'channelId=' + encodeURIComponent(ui.channelId || '') + '&serverId=' + encodeURIComponent(ui.serverId || '');
  }

  function plainLine(msg) {
    const text = String(msg?.content || '').trim();
    if (!text || isSealedText(text)) return '';
    return text;
  }

  function when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + 'm';
    if (diff < 86400000) return Math.round(diff / 3600000) + 'h';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  async function load() {
    const kind = ui.dock;
    if (!kind || kind === 'profile' || kind === 'group' || kind === 'inbox') return;
    try {
      if (kind === 'pins') {
        const data = await api('/api/room/pins?' + roomQuery());
        pins = await revealList(data.messages || []);
      } else if (kind === 'media') {
        const data = await api('/api/room/media?' + roomQuery() + '&kind=' + mediaKind + '&user=' + encodeURIComponent(mediaWho));
        const shots = [];
        const seen = new Set();
        const add = (file) => {
          if (!keepShot(file)) return;
          const key = String(file.messageId || '') + '|' + String(file.url || '');
          if (!file.url || seen.has(key)) return;
          seen.add(key);
          shots.push(file);
        };
        for (const msg of ui.messages || []) {
          for (const url of gifUrls(msg.content)) add({ url, name: 'gif.gif', kind: 'image', messageId: msg.id });
          for (const file of msg.files || []) add({ ...file, messageId: file.messageId || msg.id });
        }
        for (const file of data.files || []) add(file);
        files = shots;
      } else if (kind === 'search') {
        const data = await api('/api/room/search?' + roomQuery() + '&q=' + encodeURIComponent(ui.dockQuery || ''));
        hits = await revealList(data.messages || []);
      } else if (kind === 'threads' && ui.channelId) {
        const data = await api('/api/channels/' + encodeURIComponent(ui.channelId) + '/threads?serverId=' + encodeURIComponent(ui.serverId || ''));
        threads = data.threads || [];
      }
    } catch (err) {
      toast(err.message);
    }
  }

  const statusName = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Invisible' };
  const statusColor = { online: '#3ecf8e', idle: '#f0b429', dnd: '#f06a6a', offline: '#8b8e98' };

  function joinedLabel(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  $effect(() => {
    const id = ui.dock === 'profile' && ui.mode === 'dm' ? String(ui.dmUser?.id || '') : '';
    if (!id) {
      profileLoaded = '';
      return;
    }
    if (profileLoaded === id) return;
    profileLoaded = id;
    let stop = false;
    loadProfile(id).then((fresh) => {
      if (stop || !fresh || !ui.dmUser || String(ui.dmUser.id) !== String(fresh.id)) return;
      ui.dmUser = { ...ui.dmUser, ...fresh };
    }).catch(() => {});
    return () => { stop = true; };
  });

  $effect(() => {
    ui.dock;
    ui.channelId;
    ui.dmUser?.id;
    ui.group?.id;
    ui.thread?.id;
    mediaKind;
    mediaWho;
    ui.dockQuery;
    load();
  });

  $effect(() => {
    if (ui.dock === 'threads' && ui.threadDraft) {
      threadName = ui.threadDraft.name || '';
      threadBody = ui.threadDraft.content || '';
      ui.threadDraft = null;
    }
  });

  function addFilter(token) {
    const q = ui.dockQuery || '';
    ui.dockQuery = (q && !q.endsWith(' ') ? q + ' ' : q) + token;
    ui.dock = 'search';
  }

  async function startThread() {
    if (!threadName.trim() || !threadBody.trim()) return;
    busy = true;
    try {
      const data = await api('/api/channels/' + encodeURIComponent(ui.channelId) + '/threads', {
        method: 'POST',
        body: { serverId: ui.serverId, name: threadName.trim(), content: threadBody.trim() },
      });
      threadName = '';
      threadBody = '';
      if (data.thread) await openThread({ ...data.thread, channelName: ui.channels.find((c) => c.id === ui.channelId)?.name || 'channel' });
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function addMember() {
    if (!addId || !ui.group) return;
    try {
      const data = await api('/api/groups/' + ui.group.id + '/members', { method: 'POST', body: { userId: addId } });
      if (data.group) ui.group = data.group;
      addId = '';
      toast('Added to the group');
    } catch (err) {
      toast(err.message);
    }
  }

  async function leaveGroup() {
    if (!ui.group) return;
    try {
      await api('/api/groups/' + ui.group.id + '/leave', { method: 'POST', body: {} });
      showFriends();
    } catch (err) {
      toast(err.message);
    }
  }

  async function changeIcon(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !ui.group) return;
    try {
      const uploaded = await uploadFile(file);
      const data = await api('/api/groups/' + ui.group.id, { method: 'POST', body: { iconUrl: uploaded.url || '' } });
      if (data.group) ui.group = data.group;
    } catch (err) {
      toast(err.message);
    }
  }

  const addable = $derived((ui.friends || []).filter((person) => !(ui.group?.members || []).some((member) => member.id === person.id)));
</script>

<aside class="dock" class:profile-dock={ui.dock === 'profile' && !!ui.dmUser}>
  {#if ui.dock !== 'profile'}
  <div class="dock-h">
    <strong>{t(title)}</strong>
    <button class="btn icon" title="Close" onclick={() => (ui.dock = '')}><X size={16} /></button>
  </div>
  {/if}
  <div class="dock-body" class:dock-fill={ui.dock === 'inbox'}>
    {#if ui.dock === 'inbox'}
      <Inbox panel />
    {:else if ui.dock === 'pins'}
      {#if pins.length}
        {#each pins as msg (msg.id)}
          <article class="dock-card">
            <div class="dock-who"><Avatar user={msg.author} size={28} dot={false} /><Name user={msg.author} /><time>{when(msg.createdAt)}</time></div>
            {#if spoken(msg)}<p>{spoken(msg)}</p>{:else if !msg.files?.length}<p>{t('Attachment')}</p>{/if}
            {#if msg.files?.length}
              <div class="dock-shots">
                {#each msg.files as file, index (`${msg.id}-pin-${index}`)}
                  <Attachment {file} room={dockRoom} />
                {/each}
              </div>
            {/if}
            <button class="btn sm" onclick={() => pinMessage(msg.id, false)}>Unpin</button>
          </article>
        {/each}
      {:else}
        <div class="dock-empty">
          <Pin size={28} />
          <strong>{t('Nothing pinned yet')}</strong>
          <p>Open a message's menu and choose Pin to keep it here.</p>
        </div>
      {/if}
    {:else if ui.dock === 'media'}
      <div class="dock-tabs">
        {#each [['all', 'All media'], ['images', 'Images'], ['videos', 'Videos'], ['files', 'Files']] as [id, label]}
          <button class:on={mediaKind === id} onclick={() => (mediaKind = id)}>{t(label)}</button>
        {/each}
      </div>
      <select class="dock-select" bind:value={mediaWho}>
        <option value="anyone">{t('From anyone')}</option>
        {#if ui.dmUser}<option value={ui.dmUser.username}>{ui.dmUser.username}</option>{/if}
        {#if ui.me}<option value={ui.me.username}>{ui.me.username}</option>{/if}
      </select>
      {#if files.length}
        <div class="media-grid">
          {#each files as file, index (`${file.messageId}-${index}`)}
            <Attachment {file} room={dockRoom} />
          {/each}
        </div>
      {:else}
        <div class="dock-empty">
          <ImageIcon size={28} />
          <strong>{t('No pictures or videos here yet.')}</strong>
        </div>
      {/if}
    {:else if ui.dock === 'search'}
      <div class="dock-filters">
        {#each ['from:', 'mentions:', 'has:image', 'has:video', 'has:file', 'has:link', 'before:', 'during:', 'after:', 'pinned:true'] as token}
          <button type="button" onclick={() => addFilter(token)}>{token.replace(':', '')}</button>
        {/each}
      </div>
      {#if hits.length}
        {#each hits as msg (msg.id)}
          <article class="dock-card">
            <div class="dock-who"><Name user={msg.author} /><time>{when(msg.createdAt)}</time></div>
            {#if spoken(msg)}<p>{spoken(msg)}</p>{/if}
            {#if gifUrls(msg.content).length || msg.files?.length}
              <div class="dock-shots">
                {#each gifUrls(msg.content) as url, index (`${msg.id}-gif-${index}`)}
                  <img src={url} alt="" />
                {/each}
                {#each msg.files || [] as file, index (`${msg.id}-file-${index}`)}
                  <Attachment {file} room={dockRoom} />
                {/each}
              </div>
            {:else if !spoken(msg)}
              <p>{t('Attachment')}</p>
            {/if}
          </article>
        {/each}
      {:else}
        <div class="dock-empty">
          <Search size={28} />
          <strong>{ui.dockQuery ? t('No messages found') : t('Search this chat')}</strong>
          <p>Try mentions:name, from:name, or pinned:true.</p>
        </div>
      {/if}
    {:else if ui.dock === 'threads'}
      <label class="dock-label">Thread name<input bind:value={threadName} maxlength="100" placeholder="A short title" /></label>
      <label class="dock-label">First message<textarea bind:value={threadBody} maxlength="2000" rows="3" placeholder="Start the conversation"></textarea></label>
      <button class="btn brand dock-go" disabled={busy || !threadName.trim() || !threadBody.trim()} onclick={startThread}>Start</button>
      {#if threads.length}
        {#each threads as thread (thread.id)}
          <button class="thread-row" onclick={() => openThread({ ...thread, channelName: ui.channels.find((c) => c.id === ui.channelId)?.name || 'channel' })}>
            <strong>{thread.name}</strong>
            <span>{thread.messageCount || 0} message{thread.messageCount === 1 ? '' : 's'} · {when(thread.lastAt || thread.createdAt)}</span>
          </button>
        {/each}
      {:else}
        <div class="dock-empty">
          <strong>No threads yet</strong>
          <p>Hover a message and pick Create thread, or start one up here.</p>
        </div>
      {/if}
    {:else if ui.dock === 'group' && ui.group}
      <div class="group-hero">
        {#if ui.group.iconUrl}
          <img src={fileUrl(ui.group.iconUrl)} alt="" />
        {:else}
          <span>{(ui.group.name || 'G').slice(0, 1)}</span>
        {/if}
        <strong>{ui.group.name}</strong>
        <p>Click or tap the picture to change it</p>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange={changeIcon} />
      </div>
      <div class="dock-label">Add people
        <div class="add-row">
          <select bind:value={addId}>
            <option value="">Choose a friend</option>
            {#each addable as person}
              <option value={person.id}>{person.displayName || person.username}</option>
            {/each}
          </select>
          <button class="btn sm" disabled={!addId} onclick={addMember}><UserPlus size={14} /> Add</button>
        </div>
      </div>
      <div class="cat">Members — {ui.group.memberCount || (ui.group.members || []).length}</div>
      {#each ui.group.members || [] as person (person.id)}
        <div class="friend">
          <Avatar user={person} size={32} />
          <div class="meta"><strong><Name user={person} /></strong><span>@{person.username}</span></div>
        </div>
      {/each}
      <button class="btn danger dock-go" onclick={leaveGroup}>Leave group</button>
    {:else if ui.dmUser}
      {@const person = ui.dmUser}
      {@const shades = Array.isArray(person.profileColors) && person.profileColors.length >= 2 ? person.profileColors : ['#7c3aed', '#c084fc']}
      {@const skin = ['solid', 'glow', 'rainbow'].includes(person.profileStyle) ? person.profileStyle : 'gradient'}
      <div class="dock-profile profile-card skin-{skin}" style="--shade-a:{shades[0]};--shade-b:{shades[1]}">
        <div class="pop-banner" style="background:{person.bannerColor || person.accentColor || shades[0]}">
          {#if person.bannerUrl}
            <Photo url={person.bannerUrl} fill focus={bannerFocus(person)} />
            <button type="button" class="banner-hit" aria-label="View banner" onclick={() => (full = 'banner')}></button>
          {/if}
          <button class="dock-close" title="Close" onclick={() => (ui.dock = '')}><X size={16} /></button>
        </div>
        <div class="pop-body">
          <div class="profile-hero">
            <div class="profile-face">
              <div class="song-av">
                <div class="pfp-hold">
                  <div class="pop-av profile-av" style="background:{person.avatarColor || shades[0]}">
                    {#if person.avatarUrl}<Photo url={person.avatarUrl} />{:else}{(person.displayName || person.username || '?').charAt(0).toUpperCase()}{/if}
                    {#if person.avatarUrl}<button type="button" class="banner-hit" aria-label="View profile picture" onclick={(event) => { event.stopPropagation(); full = 'avatar'; }}></button>{/if}
                  </div>
                </div>
                <SongButton file={person.songFile} start={person.songStart} />
              </div>
              <i class="profile-dot" style="background:{statusColor[person.status] || statusColor.offline}"></i>
              {#if playingName(person)}
                <div class="bio-bubble"><span>Playing {playingName(person)}</span></div>
              {:else if shortBio(person.bio)}
                <div class="bio-bubble"><span>{shortBio(person.bio)}</span></div>
              {/if}
            </div>
            <h3><Name user={person} />{#if person.bot}<span class="bot-tag">BOT</span>{/if}</h3>
            <div class="profile-idline">
              <p class="handle"><span>@{person.username}</span></p>
              <span class="profile-badges">
                {#if visibleBadges(person).includes('early')}<MoonBadge />{/if}
                {#if visibleBadges(person).includes('staff')}<StaffBadge rank={person.staff} />{/if}
                {#if visibleBadges(person).includes('developer')}<DevBadge on={true} />{/if}
              </span>
            </div>
            {#if playingName(person)}
              <p class="profile-status playing"><Gamepad2 size={14} /> Playing {playingName(person)}</p>
            {:else if person.aboutMe}
              <p class="profile-status">{person.aboutMe}</p>
            {/if}
          </div>
          <section class="profile-panel">
            <div class="profile-row"><span><User size={14} /> Display name</span><strong>{person.displayName || person.username}</strong></div>
            <div class="profile-row"><span><AtSign size={14} /> Username</span><strong>@{person.username}</strong></div>
            {#if (person.aliases || []).length}
              <div class="profile-row alias-row"><span><Tags size={14} /> Aliases</span><strong class="alias-names">@{person.aliases.join(', @')}</strong></div>
            {/if}
            {#if String(person.pronouns || '').trim()}
              <div class="profile-row"><span><Smile size={14} /> Pronouns</span><strong>{person.pronouns}</strong></div>
            {/if}
          </section>
          <section class="profile-panel">
            <div class="profile-row"><span><Clock size={14} /> Last seen</span><strong>{profileSeen(person, nowClock.t)}</strong></div>
            {#if localClock(person, nowClock.t)}
              <div class="profile-row"><span><Clock size={14} /> Local time</span><strong>{localClock(person, nowClock.t)}</strong></div>
            {/if}
            <div class="profile-row"><span><Circle size={14} /> Online status</span><strong><i style="background:{statusColor[person.status] || statusColor.offline}"></i>{statusName[person.status] || 'Offline'}</strong></div>
          </section>
          <div class="pop-meta">
            <div><span>Member since</span><strong>{joinedLabel(person.createdAt)}</strong></div>
            <div><span>User id</span><strong>{person.uid != null ? '#' + person.uid : '—'}</strong></div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</aside>
{#if full === 'banner' && ui.dmUser?.bannerUrl}
  <FullPhoto url={ui.dmUser.bannerUrl} label="Banner" onclose={() => (full = '')} />
{:else if full === 'avatar' && ui.dmUser?.avatarUrl}
  <FullPhoto url={ui.dmUser.avatarUrl} label="Profile picture" onclose={() => (full = '')} />
{/if}
