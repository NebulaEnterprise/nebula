<script>
  import {
    ChevronDown, Hash, Volume2, Plus, UserPlus, Settings, LogOut, Check, Search, X, Inbox as InboxIcon, MessageSquare,
    Link, Calendar, Megaphone, FolderPlus, Lock, Bell, AtSign, Pencil, BellOff, Flag, Trash2,
    Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, ChevronRight, Monitor,
  } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import SongButton from './SongButton.svelte';
  import Inbox from './Inbox.svelte';
  import { api } from '../api.js';
  import { shortBio, visibleBadges } from '../format.js';
  import { joinVoice, leaveVoice, toggleMute, toggleDeafen, toggleShare, partnerInCall } from '../voice.js';
  import { ui, hasPerm, serverMuted, showFriends, openDm, openGroup, warmDm, warmChannel, pickChannel, logout, openServerSettings, openServer, toast, saveMe, savedAccounts, switchAccount, addAccount, chatClosed, closeConversation, openIdMenu, pinnedChats, pollActivity, phoneChat } from '../state.svelte.js';
  import { serverFace } from '../serverface.js';
  import { PERM } from '../format.js';

  const groups = $derived([{ id: '', name: '' }, ...ui.categories]);
  const mentionCount = $derived(Object.values(ui.activity.channels || {}).reduce((sum, row) => sum + (Number(row?.mentions) || 0), 0));
  const inboxBadge = $derived(mentionCount + (ui.incoming || []).length + (ui.missedCalls || []).length);
  const noChats = $derived(!(ui.dms || []).some((dm) => dm.other && !chatClosed('dm:' + dm.other.id, dm.lastId)) && !(ui.groups || []).some((group) => !chatClosed('group:' + group.id, group.lastId)));
  function countLabel(n) { return n > 99 ? '99+' : String(n); }
  let dmQuery = $state('');
  const serverRow = $derived((ui.servers || []).find((server) => server.id === ui.serverId) || {});
  const face = $derived(serverFace({
    ...serverRow,
    ...(ui.serverMeta || {}),
    icon: ui.serverMeta?.icon || serverRow.icon,
    iconUrl: ui.serverMeta?.iconUrl || serverRow.iconUrl,
    color: ui.serverMeta?.color || serverRow.color,
    name: ui.serverMeta?.name || serverRow.name,
  }));

  function dmWhen(ts) {
    const n = Number(ts) || 0;
    if (!n) return '';
    const d = new Date(n);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short' });
  }

  function channelsIn(cat, type) {
    return ui.channels.filter((c) => c.type === type && (c.categoryId || '') === cat.id);
  }

  const items = $derived.by(() => {
    const list = [];
    const manage = hasPerm(PERM.MANAGE_SERVER);
    const channels = hasPerm(PERM.MANAGE_CHANNELS);
    if (hasPerm(PERM.INVITE)) list.push({ act: 'invite', label: 'Invite people', icon: Link });
    list.push({ act: 'events', label: 'Events', icon: Calendar });
    if (manage) list.push({ act: 'settings', label: 'Server settings', icon: Settings });
    if (hasPerm(PERM.INVITE)) list.push({ act: 'promote', label: 'Promote server', icon: Megaphone });
    if (channels) list.push({ act: 'channel', label: 'Create channel', icon: Hash });
    if (channels) list.push({ act: 'category', label: 'Create category', icon: FolderPlus });
    if (manage) list.push({ act: 'lock', label: 'Lock server', icon: Lock });
    list.push({ act: 'pings', label: 'Ping roles', icon: AtSign });
    list.push({ act: 'notify', label: 'Notifications', icon: Bell });
    list.push({ act: 'nick', label: 'Change nickname', icon: Pencil });
    list.push({ act: 'mute', label: 'Mute server', icon: BellOff });
    list.push({ act: 'report', label: 'Report a member', icon: Flag });
    if (ui.serverId !== 'nebula-official' && !ui.serverMeta?.owner) list.push({ act: 'leave-server', label: 'Leave server', icon: LogOut, danger: true });
    if (ui.serverMeta?.owner && ui.serverId !== 'nebula-official') list.push({ act: 'delete', label: 'Delete server', icon: Trash2, danger: true });
    return list;
  });

  function onVoice(ch) {
    joinVoice(ch);
  }

  function dmSharing(other) {
    if (!other || !ui.me) return false;
    const id = 'dm:' + [ui.me.id, other.id].sort().join(':');
    return (ui.voiceRooms[id] || []).some((person) => person.sharing && String(person.id) !== String(ui.me.id));
  }

  let accountOpen = $state(false);
  let statusOpen = $state(false);
  let accountsOpen = $state(false);
  let editingBio = $state(false);
  let bioDraft = $state('');
  const presence = [
    ['online', 'Online', '#3ecf8e'],
    ['idle', 'Idle', '#f0b429'],
    ['dnd', 'Do not disturb', '#f06a6a'],
    ['offline', 'Invisible', '#8b8e98'],
  ];
  const presenceLabel = $derived(presence.find((row) => row[0] === (ui.me?.status || 'online')) || presence[0]);

  function openAccount(event) {
    event.stopPropagation();
    accountOpen = !accountOpen;
    if (accountOpen) ui.inboxOpen = false;
    statusOpen = false;
    accountsOpen = false;
    editingBio = false;
    bioDraft = shortBio(ui.me?.bio);
  }

  function editProfile() {
    accountOpen = false;
    ui.userPage = 'look';
    ui.userSettings = true;
  }

  async function setPresence(id) {
    try {
      await saveMe({ status: id });
      statusOpen = false;
    } catch (err) {
      toast(err.message);
    }
  }

  async function useAccount(id) {
    if (id === ui.me?.id) {
      accountsOpen = false;
      return;
    }
    accountsOpen = false;
    accountOpen = false;
    try {
      await switchAccount(id);
    } catch (err) {
      toast(err.message);
    }
  }

  function startAnother() {
    if (!addAccount()) return;
    accountsOpen = false;
    accountOpen = false;
  }

  async function saveBio() {
    try {
      await saveMe({ bio: shortBio(bioDraft.trim()) });
      editingBio = false;
    } catch (err) {
      toast(err.message);
    }
  }

  $effect(() => {
    if (!accountOpen) return;
    const close = (event) => {
      const node = event.target instanceof Element ? event.target : null;
      if (node && (node.closest('.account-pop') || node.closest('.account-switch') || node.closest('.me-card'))) return;
      accountOpen = false;
    };
    const onKey = (event) => {
      if (event.key === 'Escape') accountOpen = false;
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  });

  async function menu(act) {
    ui.menuOpen = false;
    if (act === 'settings') {
      try { await openServerSettings('overview'); } catch (err) { ui.toast = err.message; }
      return;
    }
    ui.dialog = { kind: act };
  }

  async function removeChannel(ch) {
    const label = ch.type === 'voice' ? ch.name : '#' + ch.name;
    if (!confirm('Delete ' + label + '?')) return;
    try {
      await api('/api/servers/' + ui.serverId + '/channels/' + ch.id, { method: 'DELETE' });
      if (ui.channelId === ch.id) ui.channelId = '';
      await openServer(ui.serverId);
    } catch (err) {
      toast(err.message);
    }
  }
</script>

<aside class="side" class:with-hero={ui.mode === 'chat'} class:inbox-side={ui.mode !== 'chat'}>
  {#if ui.mode === 'chat'}
    <div class="srv-hero">
      <img src="./look/sky.png" alt="" />
      <span class="srv-hero-face" style="--srv:{face.color}">
        {#if face.image}<img src={face.image} alt="" />{:else}{face.mark}{/if}
      </span>
    </div>
    <div class="side-head">
      <div class="side-title">
        <button class="title" onclick={() => (ui.menuOpen = !ui.menuOpen)} oncontextmenu={(e) => openIdMenu(e, [{ label: 'Server ID', value: ui.serverId }])}>
          <span>{ui.serverMeta?.name || 'Server'}</span>
          {#if serverMuted()}<em class="muted-pill">Muted</em>{/if}
          <ChevronDown size={14} />
        </button>
      </div>
    </div>
    {#if ui.menuOpen}
      <div class="menu">
        {#each items as item, i}
          {#if item.danger && i}<hr />{/if}
          <button class:danger={item.danger} onclick={() => menu(item.act)}>
            <item.icon size={16} /> {item.label}
          </button>
        {/each}
      </div>
    {/if}
    <div class="scroll">
      {#each groups as cat}
        {@const texts = channelsIn(cat, 'text')}
        {@const voices = channelsIn(cat, 'voice')}
        {#if cat.id && !texts.length && !voices.length}
          <!-- empty category stays out of the sidebar -->
        {:else}
          {#if cat.name}<div class="cat" oncontextmenu={(e) => openIdMenu(e, [{ label: 'Category ID', value: cat.id }])}><span>{cat.name}</span></div>{/if}
          {#if texts.length || !cat.id}
            <div class="cat">
              <span>{cat.name ? 'text' : 'text channels'}</span>
              {#if !cat.id && hasPerm(PERM.MANAGE_CHANNELS)}
                <button class="cat-add" title="Create channel" onclick={() => (ui.dialog = { kind: 'channel', voice: false })}><Plus size={16} /></button>
              {/if}
            </div>
            {#each texts as ch}
              {@const note = ui.activity.channels[ch.id]}
              <div class="channel" class:on={ui.channelId === ch.id} class:unread={!!note && ui.channelId !== ch.id} oncontextmenu={(e) => openIdMenu(e, [{ label: 'Channel ID', value: ch.id }])}>
                <button class="channel-hit" onpointerenter={() => warmChannel(ch.id)} onclick={() => pickChannel(ch)}>
                  {#if String(ch.name || '').toLowerCase() === 'general'}
                    <MessageSquare size={16} />
                  {:else}
                    <Hash size={16} />
                  {/if}
                  <span class="ch-name">{ch.name}</span>
                  {#if note?.mentions}
                    <em class="pill-count">{note.mentions > 99 ? '99+' : note.mentions}</em>
                  {:else if note?.unread && ui.channelId !== ch.id}
                    <i class="pill-dot"></i>
                  {/if}
                </button>
                {#if hasPerm(PERM.MANAGE_CHANNELS)}
                  <span class="row-actions">
                    <button class="row-act" title="Edit channel" onclick={() => (ui.dialog = { kind: 'edit-channel', channel: ch })}><Pencil size={15} /></button>
                    <button class="row-act" title="Delete channel" onclick={() => removeChannel(ch)}><Trash2 size={15} /></button>
                  </span>
                {/if}
              </div>
            {/each}
          {/if}
          {#if voices.length || (!cat.id && hasPerm(PERM.MANAGE_CHANNELS))}
            <div class="cat">
              <span>{cat.name ? 'voice' : 'voice channels'}</span>
              {#if !cat.id && hasPerm(PERM.MANAGE_CHANNELS)}
                <button class="cat-add" title="Create voice channel" onclick={() => (ui.dialog = { kind: 'channel', voice: true })}><Plus size={16} /></button>
              {/if}
            </div>
            {#each voices as ch}
              <div class="channel" class:on={ui.voice?.channelId === ch.id} oncontextmenu={(e) => openIdMenu(e, [{ label: 'Channel ID', value: ch.id }])}>
                <button class="channel-hit" onclick={() => onVoice(ch)}>
                  <Volume2 size={16} />
                  <span class="ch-name">{ch.name}</span>
                </button>
                {#if hasPerm(PERM.MANAGE_CHANNELS)}
                  <span class="row-actions">
                    <button class="row-act" title="Edit channel" onclick={() => (ui.dialog = { kind: 'edit-channel', channel: ch })}><Pencil size={15} /></button>
                    <button class="row-act" title="Delete channel" onclick={() => removeChannel(ch)}><Trash2 size={15} /></button>
                  </span>
                {/if}
              </div>
              {#each ui.voiceRooms[ch.id] || [] as person (person.id)}
                <div class="voice-person" class:speaking={person.speaking}>
                  <Avatar user={person} size={22} dot={false} />
                  <span>{person.displayName || person.username}</span>
                  {#if String(person.id) === String(ui.me?.id) ? !!ui.voice?.sharing : !!person.sharing}<em class="live-pill">LIVE</em>{/if}
                  {#if person.muted || person.deafened}<MicOff size={12} />{/if}
                </div>
              {/each}
            {/each}
          {/if}
        {/if}
      {/each}
    </div>
  {:else}
    <div class="inbox-head">
      <span>Messages</span>
      <button type="button" title="New group" onclick={() => (ui.dialog = { kind: 'group' })}><UserPlus size={16} /></button>
    </div>
    <label class="msg-search">
      <Search size={15} />
      <input placeholder="Search DMs..." bind:value={dmQuery} />
    </label>
    <div class="scroll">
      {#each ui.groups || [] as group (group.id)}
        {#if !chatClosed('group:' + group.id, group.lastId) && (!dmQuery.trim() || (group.name || '').toLowerCase().includes(dmQuery.trim().toLowerCase()))}
          <div class="dm-item msg-row" role="button" tabindex="0" class:on={ui.group?.id === group.id} onclick={() => openGroup(group)} onkeydown={(e) => { if (e.key === 'Enter') openGroup(group); }}>
            <span class="group-mark">{(group.name || 'G').slice(0, 1)}</span>
            <span class="dm-copy">
              <span class="msg-top"><span class="ch-name">{group.name}</span></span>
              <span class="msg-preview">Group</span>
            </span>
            <button class="dm-x" title="Close" onclick={(e) => { e.stopPropagation(); closeConversation('group:' + group.id, group.lastId); }}><X size={14} /></button>
          </div>
        {/if}
      {/each}
      {#each [...ui.dms].sort((a, b) => {
        const pin = (pinnedChats().includes('dm:' + a.other?.id) ? 0 : 1) - (pinnedChats().includes('dm:' + b.other?.id) ? 0 : 1);
        if (pin) return pin;
        return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
      }) as dm (dm.id)}
        {#if dm.other && (!dmQuery.trim() || ((dm.other.displayName || '') + ' ' + (dm.other.username || '')).toLowerCase().includes(dmQuery.trim().toLowerCase())) && (!chatClosed('dm:' + dm.other.id, dm.lastId) || ui.activity.dms[dm.other.id])}
          {@const note = ui.activity.dms[dm.other?.id]}
          <div class="dm-item msg-row" role="button" tabindex="0" class:on={ui.dmUser?.id === dm.other?.id} class:unread={!!note && ui.dmUser?.id !== dm.other?.id} class:pinned={pinnedChats().includes('dm:' + dm.other.id)} onpointerenter={() => warmDm(dm.other?.id)} onclick={() => openDm(dm.other)} oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); ui.dmMenu = { x: e.clientX, y: e.clientY, user: dm.other, notify: false }; }} onkeydown={(e) => { if (e.key === 'Enter') openDm(dm.other); }}>
            <Avatar user={dm.other} size={34} />
            <span class="dm-copy" class:sharing={dmSharing(dm.other) || partnerInCall(dm.other) || !!(ui.dmTyping && ui.dmTyping[dm.other.id])}>
              <span class="msg-top">
                <span class="ch-name">{dm.other?.displayName || dm.other?.username}</span>
                <time>{dmWhen(dm.updatedAt)}</time>
              </span>
              {#if ui.dmTyping && ui.dmTyping[dm.other.id]}<span class="msg-preview">is typing...</span>
              {:else if dmSharing(dm.other)}<span class="msg-preview">Sharing their screen</span>
              {:else if partnerInCall(dm.other)}<span class="msg-preview">In a call</span>
              {:else}<span class="msg-preview">{dm.preview || 'No messages yet'}</span>{/if}
            </span>
            <button class="dm-x" title="Close conversation" onclick={(e) => { e.stopPropagation(); closeConversation('dm:' + dm.other.id, dm.lastId); }}><X size={14} /></button>
            {#if note && ui.dmUser?.id !== dm.other?.id}
              <i class="pill-dot" aria-label="New message"></i>
            {/if}
          </div>
        {/if}
      {/each}
      {#if noChats}
        <div class="empty-note dm-empty">
          <span class="empty-mark"><MessageSquare size={22} /></span>
          <strong>No DMs yet</strong>
          <p>{ui.friends.length ? 'Start a chat from Friends.' : 'Add a friend, then say hi.'}</p>
          <button class="btn brand empty-act" type="button" onclick={() => { showFriends(ui.friends.length ? 'online' : 'find'); phoneChat(); }}>{ui.friends.length ? 'Friends' : 'Find friends'}</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if ui.voice}
    <div class="voice-live">
      <div class="voice-live-top">
        <div class="voice-live-copy">
          <strong>{ui.voice.deafened ? 'Deafened' : 'Voice connected'}</strong>
          <span>{ui.voice.name}</span>
        </div>
        <button class="hangup" title="Leave call" onclick={leaveVoice}><PhoneOff size={18} /></button>
      </div>
      <div class="voice-tools">
        <button class="voice-tool" title={ui.voice.muted ? 'Unmute' : 'Mute'} onclick={toggleMute}>
          {#if ui.voice.muted}<MicOff size={18} />{:else}<Mic size={18} />{/if}
        </button>
        <button class="voice-tool" title={ui.voice.deafened ? 'Undeafen' : 'Deafen'} onclick={toggleDeafen}>
          {#if ui.voice.deafened}<HeadphoneOff size={18} />{:else}<Headphones size={18} />{/if}
        </button>
        <button class="voice-tool" class:on={ui.voice.sharing} title={ui.voice.sharing ? 'Stop sharing' : 'Share your screen'} onclick={toggleShare}>
          <Monitor size={18} />
        </button>
      </div>
    </div>
  {/if}
  {#if accountOpen}
    {@const cardShades = Array.isArray(ui.me?.profileColors) && ui.me.profileColors.length >= 2 ? ui.me.profileColors : ['#7c3aed', '#c084fc']}
    {@const cardSkin = ['solid', 'glow', 'rainbow'].includes(ui.me?.profileStyle) ? ui.me.profileStyle : 'gradient'}
    <div class="account-pop profile-card skin-{cardSkin}" style="--shade-a:{cardShades[0]};--shade-b:{cardShades[1]}" onclick={(e) => e.stopPropagation()}>
      <div class="pop-banner" style="background:{ui.me?.bannerColor || ui.me?.accentColor || 'var(--brand)'}">
        {#if ui.me?.bannerUrl}<Photo url={ui.me.bannerUrl} fill />{/if}
      </div>
      <div class="pop-body">
        <div class="profile-hero">
          <div class="profile-face">
            <div class="song-av">
              <div class="pop-av profile-av" style="background:{ui.me?.avatarColor || 'var(--brand)'}">
                {#if ui.me?.avatarUrl}<Photo url={ui.me.avatarUrl} />{:else}{(ui.me?.displayName || ui.me?.username || '?').charAt(0).toUpperCase()}{/if}
              </div>
              <SongButton file={ui.me?.songFile} start={ui.me?.songStart} />
            </div>
            <i class="profile-dot" style="background:{presenceLabel[2]}"></i>
            {#if editingBio}
              <form class="bio-bubble account-bubble" onsubmit={(e) => { e.preventDefault(); saveBio(); }}>
                <input bind:value={bioDraft} maxlength="29" placeholder="Bio" />
                <button type="submit" title="Save bio">✓</button>
              </form>
            {:else if shortBio(ui.me?.bio)}
              <div class="bio-bubble account-bubble">
                <span>{shortBio(ui.me.bio)}</span>
                <button type="button" title="Edit bio" onclick={() => { bioDraft = ui.me?.bio || ''; editingBio = true; }}><Pencil size={14} /></button>
                <button type="button" title="Remove bio" onclick={() => { bioDraft = ''; saveBio(); }}><Trash2 size={14} /></button>
              </div>
            {:else}
              <button type="button" class="bio-bubble bio-hint" onclick={() => { bioDraft = ''; editingBio = true; }}>
                <i><Plus size={13} /></i>
                <span>Add a bio</span>
              </button>
            {/if}
          </div>
          <h3><Name user={{ displayName: ui.me?.displayName || ui.me?.username || '', username: ui.me?.username || '', nameEffect: ui.me?.nameEffect || '', nameFont: ui.me?.nameFont || '', nameColors: ui.me?.nameColors || [] }} /></h3>
          <p class="handle">
            <span>@{ui.me?.username}</span>
            {#if visibleBadges(ui.me).includes('early')}<MoonBadge />{/if}
            {#if visibleBadges(ui.me).includes('staff')}<StaffBadge rank={ui.me?.staff || ''} />{/if}
            {#if visibleBadges(ui.me).includes('developer')}<DevBadge on={true} />{/if}
          </p>
        </div>
        <div class="account-menu">
          <button type="button" class="account-edit" onclick={editProfile}><Pencil size={14} /> Edit Profile</button>
          <button type="button" class="account-row" onclick={() => { statusOpen = !statusOpen; accountsOpen = false; }}>
            <i style="background:{presenceLabel[2]}"></i>
            <span>{presenceLabel[1]}</span>
            <ChevronRight size={14} />
          </button>
          {#if statusOpen}
            <div class="account-statuses">
              {#each presence as [id, label, color]}
                <button type="button" class:on={ui.me?.status === id || (!ui.me?.status && id === 'online')} onclick={() => setPresence(id)}>
                  <i style="background:{color}"></i> {label}
                </button>
              {/each}
            </div>
          {/if}
          <button type="button" class="account-row" onclick={() => { accountsOpen = !accountsOpen; statusOpen = false; }}>
            <span>Switch accounts</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
    {#if accountsOpen}
      <div class="account-switch" onclick={(e) => e.stopPropagation()}>
        {#each savedAccounts() as row (row.id)}
          <button type="button" class:on={row.id === ui.me?.id} onclick={() => useAccount(row.id)}>
            <Avatar user={row} size={32} dot={false} />
            <span>
              <strong>{row.displayName || row.username}</strong>
              <em>@{row.username}</em>
            </span>
            {#if row.id === ui.me?.id}<Check size={16} />{/if}
          </button>
        {/each}
        <button type="button" class="add" onclick={startAnother}>
          <Plus size={18} /> Add another account
        </button>
        <p>{savedAccounts().length} of 7 accounts</p>
      </div>
    {/if}
  {/if}
  <div class="me">
    <button type="button" class="me-card" onclick={openAccount}>
      <Avatar user={ui.me} size={36} />
      <div class="who">
        <strong><Name user={{ displayName: ui.me?.displayName || ui.me?.username || '', username: ui.me?.username || '', nameEffect: ui.me?.nameEffect || '', nameFont: ui.me?.nameFont || '', nameColors: ui.me?.nameColors || [] }} /></strong>
      </div>
    </button>
    <div class="me-tools">
      <button class="btn icon inbox-btn" title="Inbox" onclick={(e) => { e.stopPropagation(); accountOpen = false; ui.inboxOpen = !ui.inboxOpen; if (ui.inboxOpen) pollActivity(); }}>
        <InboxIcon size={15} />
        {#if inboxBadge}<em class="inbox-badge">{countLabel(inboxBadge)}</em>{/if}
      </button>
      <button class="btn icon" title="Settings" onclick={() => { ui.userPage = 'profile'; ui.userSettings = true; }}><Settings size={15} /></button>
      <button class="btn icon" title="Log out" onclick={logout}><LogOut size={15} /></button>
    </div>
    {#if ui.inboxOpen}<Inbox />{/if}
  </div>
</aside>
