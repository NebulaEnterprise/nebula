<script>
  import {
    ChevronDown, Hash, Volume2, Plus, Users, UserPlus, Settings, LogOut,
    Link, Calendar, Megaphone, FolderPlus, Lock, Bell, AtSign, Pencil, BellOff, Flag, Trash2,
    Mic, MicOff, Headphones, HeadphoneOff, PhoneOff,
  } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import { api } from '../api.js';
  import { joinVoice, leaveVoice, toggleMute, toggleDeafen } from '../voice.js';
  import { ui, hasPerm, serverMuted, showFriends, showAddFriend, openDm, pickChannel, logout, openServerSettings, openServer, toast } from '../state.svelte.js';
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
              <div class="channel" class:on={ui.channelId === ch.id}>
                <button class="channel-hit" onclick={() => pickChannel(ch)}>
                  <Hash size={16} />
                  <span class="ch-name">{ch.name}</span>
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
                <button class="channel-hit" onclick={() => joinVoice(ch)}>
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
      {#each ui.dms as dm}
        <button class="dm-item" class:on={ui.dmUser?.id === dm.other?.id} onclick={() => openDm(dm.other)}>
          <Avatar user={dm.other} size={28} />
          <span class="ch-name">{dm.other?.displayName || dm.other?.username}</span>
        </button>
      {/each}
      {#if !ui.dms.length}<p class="hint" style="padding:8px">No conversations yet.</p>{/if}
    </div>
  {/if}

  {#if ui.voice}
    <div class="voice-live">
      <div class="voice-live-copy">
        <strong>{ui.voice.deafened ? 'Deafened' : 'Voice connected'}</strong>
        <span>{ui.voice.name}</span>
      </div>
      <button class="row-act" title="Disconnect" onclick={leaveVoice}><PhoneOff size={16} /></button>
      <button class="row-act" title={ui.voice.muted ? 'Unmute' : 'Mute'} onclick={toggleMute}>
        {#if ui.voice.muted}<MicOff size={16} />{:else}<Mic size={16} />{/if}
      </button>
      <button class="row-act" title={ui.voice.deafened ? 'Undeafen' : 'Deafen'} onclick={toggleDeafen}>
        {#if ui.voice.deafened}<HeadphoneOff size={16} />{:else}<Headphones size={16} />{/if}
      </button>
    </div>
  {/if}
  <div class="me">
    <Avatar user={ui.me} size={36} />
    <div class="who">
      <strong>{ui.me?.displayName || ui.me?.username}</strong>
      <span>{ui.me?.customStatus || 'Online'}</span>
    </div>
    <button class="btn icon" title="Settings" onclick={() => (ui.userSettings = true)}><Settings size={16} /></button>
    <button class="btn icon" title="Log out" onclick={logout}><LogOut size={16} /></button>
  </div>
</aside>
