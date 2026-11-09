<script>
  import { bannerGif, fileUrl, pinnedSrc, resolveMedia } from '../api.js';

  let { url = '', fill = false } = $props();
  let src = $state('');

  function direct(value) {
    if (!value) return '';
    if (value.startsWith('blob:') || value.startsWith('data:')) return value;
    const pinned = pinnedSrc(value) || pinnedSrc(url);
    if (pinned) return pinned;
    if (navigator.serviceWorker?.controller) return fileUrl(value);
    return '';
  }

  $effect(() => {
    const current = bannerGif(url);
    let stop = false;
    const apply = () => {
      if (stop) return;
      const next = direct(current);
      if (next) src = next;
    };
    apply();
    const onReady = () => apply();
    navigator.serviceWorker?.addEventListener('controllerchange', onReady);
    if (current && !direct(current)) resolveMedia(current).then((next) => { if (!stop && next) src = next; });
    return () => {
      stop = true;
      navigator.serviceWorker?.removeEventListener('controllerchange', onReady);
    };
  });

  function failed() {
    const current = bannerGif(url);
    if (!current || current.startsWith('blob:') || current.startsWith('data:')) return;
    resolveMedia(current).then((next) => { if (next) src = next; });
  }
</script>

{#if src}<img class:fill src={src} alt="" decoding="async" onerror={failed} />{/if}

<style>
  img.fill {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: cover;
    display: block;
  }
</style>
