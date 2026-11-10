<script>
  import { User, AtSign, Tags, Smile, Clock, Circle, MessageSquare, MoreHorizontal } from '@lucide/svelte';
  import Name from './Name.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import SongButton from './SongButton.svelte';
  import { shortBio, visibleBadges } from '../format.js';
  import { ui, relation, friendAct, openDm, toast, copyText } from '../state.svelte.js';
  import { isLive } from '../voice.js';
  import { hasSong, playSongAfterPaint, releaseSong } from '../song.svelte.js';

  const u = $derived.by(() => {
    const shown = ui.popout?.user;
    if (!shown) return shown;
    if (ui.me?.id && shown.id === ui.me.id) return { ...shown, ...ui.me, roles: ui.mode === 'chat' ? (shown.roles || []) : [] };
    return shown;
  });
  const roles = $derived(ui.mode === 'chat' ? (u?.roles || []).filter((r) => r && r.id !== 'everyone' && r.id !== 'owner').slice().sort((a, b) => (b.position || 0) - (a.position || 0)) : []);
  const rel = $derived(u ? relation(u.id) : 'none');
  const shades = $derived(Array.isArray(u?.profileColors) && u.profileColors.length >= 2 ? u.profileColors : ['#7c3aed', '#c084fc']);
  const skin = $derived(['solid', 'glow', 'rainbow'].includes(u?.profileStyle) ? u.profileStyle : 'gradient');
  let more = $state(false);
  const statusName = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Invisible' };
  const statusColor = { online: '#3ecf8e', idle: '#f0b429', dnd: '#f06a6a', offline: '#8b8e98' };

  function lastSeenLabel(value) {
    const t = Number(value);
    if (!t) return '';
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return '';
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return 'Today at ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + time;
  }

  function joinedLabel(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  $effect(() => {
    const id = u?.id;
    const file = u?.songFile || '';
    const start = u?.songStart || 0;
    if (!id || !u?.songAutoplay || !hasSong(file) || ui.mode === 'dm') return;
    playSongAfterPaint(file, start);
    return () => releaseSong(file, start);
  });

  async function act(kind) {
    try {
      await friendAct(kind, kind === 'request' ? { username: u.username } : { userId: u.id });
    } catch (err) { toast(err.message); }
  }
</script>

{#if u}
  <div class="pop-backdrop"></div>
  <div class="pop profile-card skin-{skin}" style="--shade-a:{shades[0]};--shade-b:{shades[1]}">
    <div class="pop-banner" style="background:{u.bannerColor || u.accentColor || 'var(--brand)'}">
      {#if u.bannerUrl}<Photo url={u.bannerUrl} fill />{/if}
    </div>
    {#if rel !== 'self'}
      <div class="pop-actions">
        <button class="pop-msg" title="Message" onclick={() => { ui.popout = null; openDm(u); }}><MessageSquare size={18} /></button>
        <button class="pop-more" title="More" onclick={() => (more = !more)}><MoreHorizontal size={18} /></button>
      </div>
      {#if more}
        <div class="pop-menu">
          {#if rel === 'friends'}<button type="button" onclick={() => act('remove')}>Remove friend</button>{/if}
          {#if rel === 'none'}<button type="button" onclick={() => act('request')}>Add friend</button>{/if}
          {#if rel === 'blocked'}<button type="button" onclick={() => act('unblock')}>Unblock</button>{/if}
          <button type="button" onclick={() => copyText(u.id, 'user ID')}>Copy user ID</button>
          <button type="button" class="danger" onclick={() => { more = false; ui.popout = null; ui.dialog = { kind: 'user-report', user: u }; }}>Report</button>
          {#if rel !== 'blocked'}<button type="button" class="danger" onclick={() => act('block')}>Block</button>{/if}
        </div>
      {/if}
    {/if}
    <div class="pop-body">
      <div class="profile-hero">
        <div class="profile-face">
          <div class="song-av">
            <div class="pop-av profile-av" style="background:{u.avatarColor || 'var(--brand)'}">
              {#if u.avatarUrl}<Photo url={u.avatarUrl} />{:else}{(u.displayName || u.username || '?').charAt(0).toUpperCase()}{/if}
            </div>
            <SongButton file={u.songFile} start={u.songStart} />
          </div>
          <i class="profile-dot" style="background:{statusColor[u.status] || statusColor.offline}"></i>
          {#if shortBio(u.bio)}<div class="bio-bubble"><span>{shortBio(u.bio)}</span></div>{/if}
        </div>
        <h3><Name user={u} />{#if isLive(u.id)}<em class="live-pill">LIVE</em>{/if}</h3>
        <p class="handle">
          <span>@{u.username}</span>
          {#if visibleBadges(u).includes('early')}<MoonBadge />{/if}
          {#if visibleBadges(u).includes('staff')}<StaffBadge rank={u.staff} />{/if}
          {#if visibleBadges(u).includes('developer')}<DevBadge on={true} />{/if}
        </p>
        {#if u.aboutMe}<p class="profile-status">{u.aboutMe}</p>{/if}
      </div>
      {#if roles.length}
        <div class="pop-role-list profile-roles">
          {#each roles as r}
            <em class="pop-role"><i style="background:{r.color || '#99aab5'}"></i>{r.name}</em>
          {/each}
        </div>
      {/if}
      <section class="profile-panel">
        <div class="profile-row"><span><User size={14} /> Display name</span><strong>{u.displayName || u.username}</strong></div>
        <div class="profile-row"><span><AtSign size={14} /> Username</span><strong>@{u.username}</strong></div>
        {#if (u.aliases || []).length}
          <div class="profile-row alias-row">
            <span><Tags size={14} /> Aliases</span>
            <strong class="alias-names">@{u.aliases.join(', @')}</strong>
          </div>
        {/if}
        <div class="profile-row"><span><Smile size={14} /> Pronouns</span><strong>{u.pronouns || '—'}</strong></div>
      </section>
      <section class="profile-panel">
        <div class="profile-row"><span><Clock size={14} /> Last seen</span><strong>{u.lastSeen ? lastSeenLabel(u.lastSeen) : (u.hideLastSeen ? 'Hidden' : '—')}</strong></div>
        <div class="profile-row"><span><Circle size={14} /> Online status</span><strong><i style="background:{statusColor[u.status] || statusColor.offline}"></i>{statusName[u.status] || 'Offline'}</strong></div>
      </section>
      {#if rel === 'incoming' || rel === 'outgoing'}
        <div class="stack">
          {#if rel === 'incoming'}
            <button class="btn brand" onclick={() => act('accept')}>Accept request</button>
            <button class="btn" onclick={() => act('decline')}>Ignore</button>
          {:else}
            <button class="btn" onclick={() => act('cancel')}>Cancel request</button>
          {/if}
        </div>
      {/if}
      <div class="pop-meta">
        <div>
          <span>Member since</span>
          <strong>{joinedLabel(u.createdAt)}</strong>
        </div>
        <div>
          <span>User id</span>
          <strong>{u.uid != null ? `#${u.uid}` : '—'}</strong>
        </div>
      </div>
    </div>
  </div>
{/if}
