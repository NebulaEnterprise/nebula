<script>
  import { Plus, X } from '@lucide/svelte';
  import Photo from './Photo.svelte';
  import { api, fileUrl, uploadFile } from '../api.js';
  import { ui, toast, touchProfileMedia } from '../state.svelte.js';

  let busy = $state('');
  let storyAt = $state(-1);
  let photoAt = $state(-1);
  let photoInput = $state(null);
  let storyInput = $state(null);

  const photos = $derived(Array.isArray(ui.me?.gallery) ? ui.me.gallery : []);
  const stories = $derived(Array.isArray(ui.me?.stories) ? ui.me.stories : []);

  function isVideo(item) {
    return !!item && (item.kind === 'video' || /\.(mp4|webm|mov)(\?|#|$)/i.test(String(item.url || '')));
  }

  function withoutMedia(list, id) {
    return (Array.isArray(list) ? list : []).filter((row) => row && String(row.id) !== String(id));
  }

  async function addMedia(kind, file) {
    if (!file) return;
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
      }
      toast(kind === 'stories' ? 'Story added' : 'Post added');
    } catch (err) {
      toast(err.message || 'Could not add that');
    } finally {
      busy = '';
    }
  }

  async function removeMedia(kind, id) {
    if (!id) return;
    touchProfileMedia();
    const previous = ui.me;
    ui.me = { ...ui.me, [kind]: withoutMedia(ui.me?.[kind], id) };
    if (kind === 'stories') storyAt = -1;
    if (kind === 'gallery') photoAt = -1;
    try {
      const data = await api('/api/me/' + kind + '/' + encodeURIComponent(id), { method: 'DELETE' });
      touchProfileMedia();
      if (data.user) ui.me = { ...ui.me, ...data.user, [kind]: withoutMedia(data.user[kind], id) };
    } catch (err) {
      ui.me = previous;
      toast(err.message || 'Could not remove that');
    }
  }
</script>

<div class="media-board">
  <header class="media-head">
    <button type="button" class="ig-av" class:live={stories.length} onclick={() => stories.length && (storyAt = 0)} aria-label="Open stories">
      <span>
        {#if ui.me?.avatarUrl}<Photo url={ui.me.avatarUrl} />{:else}{(ui.me?.displayName || ui.me?.username || '?').charAt(0).toUpperCase()}{/if}
      </span>
    </button>
    <div class="media-id">
      <strong>@{ui.me?.username}</strong>
      <em>{ui.me?.displayName || ui.me?.username}</em>
      <p>{photos.length} {photos.length === 1 ? 'post' : 'posts'} · {stories.length} {stories.length === 1 ? 'story' : 'stories'}</p>
    </div>
  </header>

  <section class="media-block">
    <div class="media-label">
      <h3>Stories</h3>
      <button type="button" class="btn sm" disabled={busy === 'stories'} onclick={() => storyInput?.click()}>{busy === 'stories' ? 'Adding…' : 'Add story'}</button>
    </div>
    <div class="ig-stories media-stories">
      <button type="button" class="ig-story add" onclick={() => storyInput?.click()}>
        <Plus size={16} />
        <span>Story</span>
      </button>
      {#each stories as story, index (story.id)}
        <div class="ig-story-wrap">
          <button type="button" class="ig-story" onclick={() => (storyAt = index)}>
            <span class="ig-story-pic">
              {#if isVideo(story)}<video src={fileUrl(story.url)} muted playsinline></video>{:else}<Photo url={story.url} fill />{/if}
            </span>
          </button>
          <button type="button" class="ig-x" title="Remove story" onclick={() => removeMedia('stories', story.id)}><X size={12} /></button>
        </div>
      {/each}
    </div>
    {#if !stories.length}<p class="hint">Stories stay on your profile for 24 hours.</p>{/if}
  </section>

  <section class="media-block">
    <div class="media-label">
      <h3>Posts</h3>
      <button type="button" class="btn sm" disabled={busy === 'gallery'} onclick={() => photoInput?.click()}>{busy === 'gallery' ? 'Adding…' : 'Add post'}</button>
    </div>
    <div class="media-grid">
      <button type="button" class="media-add" onclick={() => photoInput?.click()}>
        <Plus size={22} />
        <span>{busy === 'gallery' ? 'Adding…' : 'New post'}</span>
      </button>
      {#each photos as photo, index (photo.id)}
        <div class="media-cell">
          <button type="button" class="ig-open" title="View post" onclick={() => (photoAt = index)}>
            {#if isVideo(photo)}<video src={fileUrl(photo.url)} muted playsinline></video>{:else}<Photo url={photo.url} fill />{/if}
          </button>
          <button type="button" class="ig-x" title="Remove post" onclick={() => removeMedia('gallery', photo.id)}><X size={12} /></button>
        </div>
      {/each}
    </div>
    {#if !photos.length}<p class="hint">Posts show on the back of your profile, like a photo grid.</p>{/if}
  </section>

  {#if storyAt >= 0 && stories[storyAt]}
    <div class="media-view">
      {#if isVideo(stories[storyAt])}<video src={fileUrl(stories[storyAt].url)} controls autoplay playsinline></video>{:else}<Photo url={stories[storyAt].url} fill />{/if}
      <div class="ig-bars">
        {#each stories as story, index (story.id)}<i class:on={index <= storyAt}></i>{/each}
      </div>
      <button type="button" class="ig-close" title="Close" onclick={() => (storyAt = -1)}><X size={16} /></button>
      {#if storyAt > 0}<button type="button" class="ig-nav prev" title="Previous story" onclick={() => (storyAt -= 1)}></button>{/if}
      {#if storyAt < stories.length - 1}<button type="button" class="ig-nav next" title="Next story" onclick={() => (storyAt += 1)}></button>{/if}
      <button type="button" class="ig-remove" onclick={() => removeMedia('stories', stories[storyAt].id)}>Remove story</button>
    </div>
  {/if}
  {#if photoAt >= 0 && photos[photoAt]}
    <div class="media-view">
      {#if isVideo(photos[photoAt])}<video src={fileUrl(photos[photoAt].url)} controls autoplay playsinline></video>{:else}<Photo url={photos[photoAt].url} fill />{/if}
      {#if photos.length > 1}
        <div class="ig-bars">
          {#each photos as photo, index (photo.id)}<i class:on={index <= photoAt}></i>{/each}
        </div>
      {/if}
      <button type="button" class="ig-close" title="Close" onclick={() => (photoAt = -1)}><X size={16} /></button>
      {#if photoAt > 0}<button type="button" class="ig-nav prev" title="Previous post" onclick={() => (photoAt -= 1)}></button>{/if}
      {#if photoAt < photos.length - 1}<button type="button" class="ig-nav next" title="Next post" onclick={() => (photoAt += 1)}></button>{/if}
      <button type="button" class="ig-remove" onclick={() => removeMedia('gallery', photos[photoAt].id)}>Remove post</button>
    </div>
  {/if}

  <input bind:this={photoInput} class="ig-file" type="file" accept="image/*,video/*" onchange={(event) => { addMedia('gallery', event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
  <input bind:this={storyInput} class="ig-file" type="file" accept="image/*,video/*" onchange={(event) => { addMedia('stories', event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
</div>
