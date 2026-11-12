<script>
  import { User, AtSign, Tags, Smile, Clock, Circle, MessageSquare, MoreHorizontal, Plus, X } from '@lucide/svelte';
  import Name from './Name.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import SongButton from './SongButton.svelte';
  import { shortBio, visibleBadges } from '../format.js';
  import { api, fileUrl, uploadFile } from '../api.js';
  import { ui, nowClock, relation, friendAct, openDm, toast, copyText, touchProfileMedia } from '../state.svelte.js';
  import { profileSeen } from '../seen.js';
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
  let turned = $state(false);
  let faceFor = '';
  let busy = $state('');
  let storyAt = $state(-1);
  let photoAt = $state(-1);
  let photoInput = $state(null);
  let storyInput = $state(null);
  const statusName = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Invisible' };
  const statusColor = { online: '#3ecf8e', idle: '#f0b429', dnd: '#f06a6a', offline: '#8b8e98' };

  function joinedLabel(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  const photos = $derived(Array.isArray(u?.gallery) ? u.gallery : []);
  const stories = $derived(Array.isArray(u?.stories) ? u.stories : []);
  $effect(() => {
    const id = u?.id || '';
    if (id === faceFor) return;
    faceFor = id;
    turned = false;
    storyAt = -1;
    photoAt = -1;
  });

  function flipCard(event) {
    if (event.target.closest('button, a, input, label, video, .ig-view')) return;
    turned = !turned;
  }

  function stepStory(event) {
    if (event.target.closest('button, video')) return;
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    const back = event.clientX - box.left < box.width * 0.33;
    if (back) {
      if (storyAt > 0) storyAt -= 1;
      return;
    }
    if (storyAt < stories.length - 1) storyAt += 1;
    else storyAt = -1;
  }

  function stepPost(event) {
    if (event.target.closest('button, video')) return;
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    const back = event.clientX - box.left < box.width * 0.33;
    if (back) {
      if (photoAt > 0) photoAt -= 1;
      return;
    }
    if (photoAt < photos.length - 1) photoAt += 1;
    else photoAt = -1;
  }

  function isVideo(item) {
    return !!item && (item.kind === 'video' || /\.(mp4|webm|mov)(\?|#|$)/i.test(String(item.url || '')));
  }

  async function addMedia(kind, file) {
    if (!file || rel !== 'self') return;
    const type = String(file.type || '');
    const video = type.startsWith('video/');
    if (!type.startsWith('image/') && !video) return toast('Choose a photo or video');
    if (video && file.size > 25 * 1024 * 1024) return toast('Videos can be up to 25 MB');
    busy = kind;
    try {
      const uploaded = await uploadFile(file, null, file.name || 'photo.jpg', '/api/upload?slot=photo');
      if (!uploaded.url) throw new Error('The photo did not upload');
      const data = await api('/api/me/' + kind, { method: 'POST', body: { url: uploaded.url } });
      if (data.user) {
        touchProfileMedia();
        ui.me = { ...ui.me, ...data.user };
        if (ui.popout?.user?.id === data.user.id) ui.popout = { ...ui.popout, user: { ...ui.popout.user, ...data.user } };
      }
      toast(kind === 'stories' ? 'Story added' : 'Photo added');
    } catch (err) {
      toast(err.message || 'Could not add that');
    } finally {
      busy = '';
    }
  }

  function withoutMedia(list, id) {
    return (Array.isArray(list) ? list : []).filter((row) => row && String(row.id) !== String(id));
  }

  async function removeMedia(kind, id) {
    if (rel !== 'self' || !id) return;
    touchProfileMedia();
    const previousMe = ui.me;
    const previousPopout = ui.popout;
    ui.me = { ...ui.me, [kind]: withoutMedia(ui.me?.[kind], id) };
    if (ui.popout?.user && String(ui.popout.user.id) === String(ui.me.id)) {
      ui.popout = { ...ui.popout, user: { ...ui.popout.user, [kind]: withoutMedia(ui.popout.user[kind], id) } };
    }
    if (kind === 'stories') storyAt = -1;
    if (kind === 'gallery') photoAt = -1;
    try {
      const data = await api('/api/me/' + kind + '/' + encodeURIComponent(id), { method: 'DELETE' });
      touchProfileMedia();
      if (data.user) {
        ui.me = { ...ui.me, ...data.user, [kind]: withoutMedia(data.user[kind], id) };
        if (ui.popout?.user?.id === data.user.id) {
          ui.popout = { ...ui.popout, user: { ...ui.popout.user, ...data.user, [kind]: withoutMedia(data.user[kind], id) } };
        }
      }
    } catch (err) {
      ui.me = previousMe;
      ui.popout = previousPopout;
      toast(err.message || 'Could not remove that');
    }
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
    <div class="pop-spin" class:show-back={turned} style="transform: rotateY({turned ? 180 : 0}deg)" onclick={flipCard}>
    <div class="pop-face">
    <div class="pop-frame">
    <div class="pop-banner" style="background:{u.bannerColor || u.accentColor || 'var(--brand)'}">
      {#if u.bannerUrl}<Photo url={u.bannerUrl} fill />{/if}
    </div>
    {#if rel !== 'self'}
      <div class="pop-actions">
        <button class="pop-msg" title="Message" onclick={() => { const person = u; ui.popout = null; openDm(person); }}><MessageSquare size={16} /></button>
        <button class="pop-more" title="More" onclick={() => (more = !more)}><MoreHorizontal size={14} /></button>
      </div>
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
        <h3><Name user={u} /></h3>
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
        {#if String(u.pronouns || '').trim()}
          <div class="profile-row"><span><Smile size={14} /> Pronouns</span><strong>{u.pronouns}</strong></div>
        {/if}
      </section>
      <section class="profile-panel">
        <div class="profile-row"><span><Clock size={14} /> Last seen</span><strong>{profileSeen(u, nowClock.t)}</strong></div>
        <div class="profile-row"><span><Circle size={14} /> Online status</span><strong><i style="background:{statusColor[u.status] || statusColor.offline}"></i>{statusName[u.status] || 'Offline'}</strong></div>
      </section>
      {#if rel === 'outgoing'}
        <div class="stack">
          <button class="btn" onclick={() => act('cancel')}>Cancel request</button>
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
    </div>
    <div class="pop-face pop-back">
      <div class="ig">
        <header class="ig-head">
          <button type="button" class="ig-av" class:live={stories.length} onclick={() => stories.length && (storyAt = 0)}>
            <span>{#if u.avatarUrl}<Photo url={u.avatarUrl} />{:else}{(u.displayName || u.username || '?').charAt(0).toUpperCase()}{/if}</span>
          </button>
          <div class="ig-id">
            <strong>@{u.username}</strong>
            <p>{photos.length} {photos.length === 1 ? 'photo' : 'photos'} · {stories.length} {stories.length === 1 ? 'story' : 'stories'}</p>
          </div>
        </header>
        {#if u.aboutMe}<p class="ig-bio">{u.aboutMe}</p>{/if}
        {#if rel === 'self'}
        <div class="ig-stories">
          {#if rel === 'self'}
            <button type="button" class="ig-story add" onclick={() => storyInput?.click()}>
              <Plus size={16} />
              <span>Story</span>
            </button>
          {/if}
          {#each stories as story, index (story.id)}
            <div class="ig-story-wrap">
              <button type="button" class="ig-story" onclick={() => (storyAt = index)}>
                {#if isVideo(story)}<video src={fileUrl(story.url)} muted playsinline autoplay loop></video>{:else}<Photo url={story.url} />{/if}
              </button>
              <button type="button" class="ig-x" title="Remove story" onclick={() => removeMedia('stories', story.id)}><X size={12} /></button>
            </div>
          {/each}
        </div>
        {/if}
        <div class="ig-grid">
          {#if rel === 'self'}
            <button type="button" class="ig-add" onclick={() => photoInput?.click()}>{busy === 'gallery' ? '…' : '+'}<span>Photo</span></button>
          {/if}
          {#each photos as photo, index (photo.id)}
            <div class="ig-cell">
              <button type="button" class="ig-open" title="View post" onclick={() => (photoAt = index)}>
                {#if isVideo(photo)}<video src={fileUrl(photo.url)} muted playsinline autoplay loop></video>{:else}<Photo url={photo.url} fill />{/if}
              </button>
              {#if rel === 'self'}<button type="button" class="ig-x" title="Remove" onclick={() => removeMedia('gallery', photo.id)}><X size={12} /></button>{/if}
            </div>
          {/each}
          {#if !photos.length && rel !== 'self'}<p class="ig-empty">No photos yet</p>{/if}
        </div>
        {#if storyAt >= 0 && stories[storyAt]}
          <div class="ig-view" onclick={stepStory}>
            {#if isVideo(stories[storyAt])}<video src={fileUrl(stories[storyAt].url)} controls autoplay playsinline></video>{:else}<Photo url={stories[storyAt].url} fill />{/if}
            <div class="ig-bars">
              {#each stories as story, index (story.id)}<i class:on={index <= storyAt}></i>{/each}
            </div>
            <button type="button" class="ig-close" title="Close" onclick={() => (storyAt = -1)}><X size={16} /></button>
            {#if storyAt > 0}<button type="button" class="ig-nav prev" title="Previous story" onclick={() => (storyAt -= 1)}></button>{/if}
            {#if storyAt < stories.length - 1}<button type="button" class="ig-nav next" title="Next story" onclick={() => (storyAt += 1)}></button>{/if}
            {#if rel === 'self'}<button type="button" class="ig-remove" onclick={(event) => { event.stopPropagation(); removeMedia('stories', stories[storyAt].id); }}>Remove story</button>{/if}
          </div>
        {/if}
        {#if photoAt >= 0 && photos[photoAt]}
          <div class="ig-view" onclick={stepPost}>
            {#if isVideo(photos[photoAt])}<video src={fileUrl(photos[photoAt].url)} controls autoplay playsinline></video>{:else}<Photo url={photos[photoAt].url} fill />{/if}
            {#if photos.length > 1}
              <div class="ig-bars">
                {#each photos as photo, index (photo.id)}<i class:on={index <= photoAt}></i>{/each}
              </div>
            {/if}
            <button type="button" class="ig-close" title="Close" onclick={() => (photoAt = -1)}><X size={16} /></button>
            {#if photoAt > 0}<button type="button" class="ig-nav prev" title="Previous post" onclick={() => (photoAt -= 1)}></button>{/if}
            {#if photoAt < photos.length - 1}<button type="button" class="ig-nav next" title="Next post" onclick={() => (photoAt += 1)}></button>{/if}
            {#if rel === 'self'}<button type="button" class="ig-remove" onclick={(event) => { event.stopPropagation(); removeMedia('gallery', photos[photoAt].id); }}>Remove post</button>{/if}
          </div>
        {/if}
      </div>
      <input bind:this={photoInput} class="ig-file" type="file" accept="image/*,video/*" onchange={(event) => { addMedia('gallery', event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
      <input bind:this={storyInput} class="ig-file" type="file" accept="image/*,video/*" onchange={(event) => { addMedia('stories', event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
    </div>
    </div>
    {#if rel !== 'self' && more}
      <div class="pop-menu">
        {#if rel === 'friends'}<button type="button" onclick={() => act('remove')}>Remove friend</button>{/if}
        {#if rel === 'none'}<button type="button" onclick={() => act('request')}>Add friend</button>{/if}
        {#if rel === 'blocked'}<button type="button" onclick={() => act('unblock')}>Unblock</button>{/if}
        <button type="button" onclick={() => copyText(u.id, 'user ID')}>Copy user ID</button>
        <button type="button" class="danger" onclick={() => { const person = u; more = false; ui.popout = null; ui.dialog = { kind: 'user-report', user: person }; }}>Report</button>
        {#if rel !== 'blocked'}<button type="button" class="danger" onclick={() => act('block')}>Block</button>{/if}
      </div>
    {/if}
  </div>
{/if}
