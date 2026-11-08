<script>
  import { fileUrl, pinnedSrc, resolveMedia } from '../api.js';

  let { file } = $props();
  let src = $state('');
  let poster = $state('');
  let open = $state(false);

  const name = $derived(file?.name || 'File');
  const video = $derived(file?.kind === 'video' || /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i.test(file?.url || file?.name || ''));
  const image = $derived(!video && (file?.kind === 'image' || /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i.test(file?.url || file?.name || '')));
  const gif = $derived(/\.gif(\?|$)/i.test(file?.name || '') || /\.gif(\?|$)/i.test(file?.url || ''));
  const progress = $derived(Math.max(0, Math.min(100, Number(file?.progress) || 0)));

  function direct(url) {
    if (!url) return '';
    if (String(url).startsWith('blob:') || String(url).startsWith('data:')) return url;
    return pinnedSrc(url) || (navigator.serviceWorker?.controller ? fileUrl(url) : '');
  }

  $effect(() => {
    const url = file?.url || '';
    const posterUrl = file?.poster || '';
    let stop = false;
    const apply = () => {
      if (stop) return;
      const next = direct(url);
      const still = direct(posterUrl);
      if (next) src = next;
      if (still) poster = still;
    };
    apply();
    const onReady = () => apply();
    navigator.serviceWorker?.addEventListener('controllerchange', onReady);
    if (url && !direct(url)) resolveMedia(url).then((next) => { if (!stop && next) src = next; });
    if (posterUrl && !direct(posterUrl)) resolveMedia(posterUrl).then((next) => { if (!stop && next) poster = next; });
    return () => {
      stop = true;
      navigator.serviceWorker?.removeEventListener('controllerchange', onReady);
    };
  });

  function failed() {
    const url = file?.url || '';
    if (!url || String(url).startsWith('blob:')) return;
    resolveMedia(url).then((next) => { if (next) src = next; });
  }
</script>

<div class="file-card">
  {#if video}
    {#if src}<video class="file-video" src={src} poster={poster || undefined} controls playsinline preload="metadata" crossorigin="anonymous" onerror={failed}></video>{/if}
  {:else if image}
    {#if src}<button type="button" class="file-open" class:gif-crop={gif} onclick={() => (open = true)}><img class="file-img" class:gif-crop={gif} src={src} alt={name} decoding="async" crossorigin="anonymous" onerror={failed} /></button>{/if}
  {:else}
    <a class="file-chip" href={src || fileUrl(file?.url)} target="_blank" rel="noreferrer">{name}</a>
  {/if}
  {#if progress > 0 && progress < 100}
    <span class="file-progress"><i style="width:{progress}%"></i></span>
  {/if}
</div>
{#if open}
  <div class="lightbox" role="presentation" onclick={() => (open = false)}>
    {#if video}
      <video src={src} poster={poster || undefined} controls autoplay playsinline onclick={(e) => e.stopPropagation()}></video>
    {:else}
      <img src={src} alt={name} onclick={(e) => e.stopPropagation()} />
    {/if}
  </div>
{/if}
