<script>
  import {
    ChevronDown, Hash, Volume2, Plus, Users, UserPlus, Settings, LogOut,
    Link, Calendar, Megaphone, FolderPlus, Lock, Bell, AtSign, Pencil, BellOff, Flag, Trash2,
    Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, ChevronRight,
  } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import { api } from '../api.js';
  import { shortBio, visibleBadges } from '../format.js';
  import { joinVoice, leaveVoice, toggleMute, toggleDeafen } from '../voice.js';
  import { ui, hasPerm, serverMuted, showFriends, showAddFriend, openDm, warmDm, warmChannel, pickChannel, logout, openServerSettings, openServer, toast, saveMe } from '../state.svelte.js';
  import { PERM } from '../format.js';

  const groups = $derived([{ id: '', name: '' }, ...ui.categories]);

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
    if (ui.serverMeta?.owner && ui.serverId !== 'nebula-official') list.push({ act: 'delete', label: 'Delete server', icon: Trash2, danger: true });
    return list;
  });

  function onVoice(ch) {
    if (ui.voice && ui.voice.channelId === ch.id && ui.voice.serverId === ui.serverId) {
      leaveVoice();
      return;
    }
    joinVoice(ch);
  }

  let accountOpen = $state(false);
  let statusOpen = $state(false);
  let editingStatus = $state(false);
  let editingBio = $state(false);
  let statusDraft = $state('');
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
    statusOpen = false;
    editingStatus = false;
    editingBio = false;
    statusDraft = ui.me?.customStatus || '';
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

  async function saveCustomStatus() {
    try {
      await saveMe({ customStatus: statusDraft.trim() });
      editingStatus = false;
    } catch (err) {
      toast(err.message);
    }
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
      if (node && (node.closest('.account-pop') || node.closest('.me-card'))) return;
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

<aside class="side">
  {#if ui.mode === 'chat'}
    <div class="side-head">
      <button class="title" onclick={() => (ui.menuOpen = !ui.menuOpen)}>
        <span>{ui.serverMeta?.name || 'Server'}</span>
        {#if serverMuted()}<em class="muted-pill">Muted</em>{/if}
        <ChevronDown size={16} />
      </button>
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
    {#if ui.bannerUrl}
      <div class="banner-strip" style="background-image:linear-gradient(rgba(12,13,17,0.2), rgba(12,13,17,0.72)), url('{ui.bannerUrl}')"></div>
    {/if}
    <div class="scroll">
      {#if hasPerm(PERM.INVITE)}
        <button class="invite-btn" onclick={() => (ui.dialog = { kind: 'invite' })}>
          <Link size={16} /> Invite people
        </button>
      {/if}
      {#each groups as cat}
        {@const texts = channelsIn(cat, 'text')}
        {@const voices = channelsIn(cat, 'voice')}
        {#if cat.id && !texts.length && !voices.length}
          <!-- empty category stays out of the sidebar -->
        {:else}
          {#if cat.name}<div class="cat"><span>{cat.name}</span></div>{/if}
          {#if texts.length || !cat.id}
            <div class="cat">
              <span>{cat.name ? 'Text' : 'Text channels'}</span>
              {#if !cat.id && hasPerm(PERM.MANAGE_CHANNELS)}
                <button class="cat-add" title="Create channel" onclick={() => (ui.dialog = { kind: 'channel', voice: false })}><Plus size={16} /></button>
              {/if}
            </div>
            {#each texts as ch}
              {@const note = ui.activity.channels[ch.id]}
              <div class="channel" class:on={ui.channelId === ch.id} class:unread={!!note && ui.channelId !== ch.id}>
                <button class="channel-hit" onpointerenter={() => warmChannel(ch.id)} onclick={() => pickChannel(ch)}>
                  <Hash size={16} />
                  <span class="ch-name">{ch.name}</span>
                  {#if note && ui.channelId !== ch.id}
                    {#if note.mentions}
                      <em class="pill-count">{note.mentions > 99 ? '99+' : note.mentions}</em>
                    {:else if note.unread}
                      <i class="pill-dot"></i>
                    {/if}
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
              <span>{cat.name ? 'Voice' : 'Voice channels'}</span>
              {#if !cat.id && hasPerm(PERM.MANAGE_CHANNELS)}
                <button class="cat-add" title="Create voice channel" onclick={() => (ui.dialog = { kind: 'channel', voice: true })}><Plus size={16} /></button>
              {/if}
            </div>
            {#each voices as ch}
              <div class="channel" class:on={ui.voice?.channelId === ch.id}>
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
                  {#if person.muted || person.deafened}<MicOff size={12} />{/if}
                  {#if ui.voice?.channelId === ch.id && person.id === ui.me?.id}
                    <button class="leave-mini" onclick={leaveVoice}>Leave</button>
                  {/if}
                </div>
              {/each}
            {/each}
          {/if}
        {/if}
      {/each}
    </div>
  {:else}
    <div class="side-head">Direct messages</div>
    <div class="scroll">
      <button class="nav-item" class:on={ui.mode === 'friends'} onclick={() => showFriends(ui.friendsTab)}><Users size={16} /> Friends</button>
      <button class="nav-item" class:on={ui.mode === 'add'} onclick={showAddFriend}><UserPlus size={16} /> Add friend</button>
      <div class="cat"><span>Direct messages</span></div>
      {#each ui.dms as dm (dm.id)}
        {@const note = ui.activity.dms[dm.other?.id]}
        <button class="dm-item" class:on={ui.dmUser?.id === dm.other?.id} class:unread={!!note && ui.dmUser?.id !== dm.other?.id} onpointerenter={() => warmDm(dm.other?.id)} onclick={() => openDm(dm.other)}>
          <Avatar user={dm.other} size={28} />
          <span class="dm-copy">
            <span class="ch-name">{dm.other?.displayName || dm.other?.username}</span>
            <span class="dm-preview">{dm.preview || ''}</span>
          </span>
          {#if note && ui.dmUser?.id !== dm.other?.id}
            <em class="pill-count">{note.unread > 99 ? '99+' : note.unread}</em>
          {/if}
        </button>
      {/each}
      {#if !ui.dms.length}<p class="hint" style="padding:8px">No conversations yet.</p>{/if}
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
      </div>
      <button class="leave-call" onclick={leaveVoice}><PhoneOff size={16} /> Leave call</button>
    </div>
  {/if}
  {#if accountOpen}
    <div class="account-pop" onclick={(e) => e.stopPropagation()}>
      <div class="account-banner" style="background:{ui.me?.bannerColor || ui.me?.accentColor || 'var(--brand)'}">
        {#if ui.me?.bannerUrl}<Photo url={ui.me.bannerUrl} fill />{/if}
      </div>
      <div class="account-face">
        <div class="account-av" style="background:{ui.me?.avatarColor || 'var(--brand)'}">
          {#if ui.me?.avatarUrl}<Photo url={ui.me.avatarUrl} />{:else}{(ui.me?.displayName || ui.me?.username || '?').charAt(0).toUpperCase()}{/if}
          <i style="background:{presenceLabel[2]}"></i>
        </div>
        {#if editingBio}
          <form class="account-bubble" onsubmit={(e) => { e.preventDefault(); saveBio(); }}>
            <input bind:value={bioDraft} maxlength="29" placeholder="Bio" />
            <button type="submit" title="Save bio">✓</button>
          </form>
        {:else if shortBio(ui.me?.bio)}
          <div class="account-bubble">
            <span>{shortBio(ui.me.bio)}</span>
            <button type="button" title="Edit bio" onclick={() => { bioDraft = ui.me?.bio || ''; editingBio = true; }}><Pencil size={14} /></button>
            <button type="button" title="Remove bio" onclick={() => { bioDraft = ''; saveBio(); }}><Trash2 size={14} /></button>
          </div>
        {:else if editingStatus}
          <form class="account-bubble" onsubmit={(e) => { e.preventDefault(); saveCustomStatus(); }}>
            <input bind:value={statusDraft} maxlength="128" placeholder="Set a custom status" />
            <button type="submit" title="Save status">✓</button>
          </form>
        {:else if ui.me?.customStatus}
          <div class="account-bubble">
            <span>{ui.me.customStatus}</span>
            <button type="button" title="Edit status" onclick={() => { statusDraft = ui.me?.customStatus || ''; editingStatus = true; }}><Pencil size={14} /></button>
            <button type="button" title="Clear status" onclick={() => { statusDraft = ''; saveCustomStatus(); }}>✕</button>
          </div>
        {/if}
      </div>
      <div class="account-body">
        <strong><Name user={{ displayName: ui.me?.displayName || ui.me?.username || '', username: ui.me?.username || '', nameEffect: ui.me?.nameEffect || '', nameColors: ui.me?.nameColors || [] }} /></strong>
        <div class="account-handle">
          <span class="account-user">@{ui.me?.username}</span>
          {#if visibleBadges(ui.me).includes('early')}<MoonBadge />{/if}
          {#if visibleBadges(ui.me).includes('staff')}<StaffBadge rank={ui.me?.staff || ''} />{/if}
          {#if visibleBadges(ui.me).includes('developer')}<DevBadge on={true} />{/if}
        </div>
        {#if ui.me?.aboutMe || ui.me?.customStatus}<p class="about-copy">{ui.me.aboutMe || ui.me.customStatus}</p>{/if}
        <button type="button" class="account-edit" onclick={editProfile}><Pencil size={16} /> Edit Profile</button>
        <button type="button" class="account-row" onclick={() => (statusOpen = !statusOpen)}>
          <i style="background:{presenceLabel[2]}"></i>
          <span>{presenceLabel[1]}</span>
          <ChevronRight size={16} />
        </button>
        {#if statusOpen}
          <div class="account-statuses">
            {#each presence as [id, label, color]}
              <button type="button" class:on={ui.me?.status === id || (!ui.me?.status && id === 'online')} onclick={() => setPresence(id)}>
                <i style="background:{color}"></i> {label}
              </button>
            {/each}
            {#if !editingStatus}
              <button type="button" onclick={() => { statusDraft = ui.me?.customStatus || ''; editingStatus = true; statusOpen = false; }}>
                <Pencil size={14} /> Custom status
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
  <div class="me">
    <button type="button" class="me-card" onclick={openAccount}>
      <Avatar user={ui.me} size={36} />
      <div class="who">
        <strong><Name user={{ displayName: ui.me?.displayName || ui.me?.username || '', username: ui.me?.username || '', nameEffect: ui.me?.nameEffect || '', nameColors: ui.me?.nameColors || [] }} /></strong>
      </div>
    </button>
    <button class="btn icon" title="Settings" onclick={() => { ui.userPage = 'profile'; ui.userSettings = true; }}><Settings size={16} /></button>
    <button class="btn icon" title="Log out" onclick={logout}><LogOut size={16} /></button>
  </div>
</aside>
