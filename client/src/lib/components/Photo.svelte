<script>
  import { bannerGif, fileUrl, pinnedSrc, resolveMedia, primeMedia, mediaReady } from '../api.js';

  let { url = '', fill = false } = $props();
  let src = $state('');
  let ready = $state(false);

  function motion(value) {
    const raw = String(value || '');
    return /\.gif(\?|#|$)/i.test(raw) || /\/uploads\/a_/i.test(raw);
  }

  function direct(value) {
    if (!value) return '';
    if (value.startsWith('blob:') || value.startsWith('data:')) return value;
    const pinned = pinnedSrc(value) || pinnedSrc(url);
    if (pinned) return pinned;
    if (navigator.serviceWorker?.controller) return fileUrl(value);
    return '';
  }

  function show(next) {
    if (!next) return;
    const known = mediaReady(next);
    if (next !== src) {
      ready = known;
      src = next;
    } else if (known) {
      ready = true;
    }
  }

  $effect(() => {
    const current = bannerGif(url);
    let stop = false;
    const paint = () => {
      if (stop) return;
      show(direct(current));
    };
    if (motion(current) && !current.startsWith('blob:') && !current.startsWith('data:')) {
      primeMedia(current).then((next) => { if (!stop) show(next); });
    } else {
      paint();
      if (current && !direct(current)) resolveMedia(current).then((next) => { if (!stop) show(next); });
    }
    const onReady = () => {
      if (motion(current)) primeMedia(current).then((next) => { if (!stop) show(next); });
      else paint();
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onReady);
    return () => {
      stop = true;
      navigator.serviceWorker?.removeEventListener('controllerchange', onReady);
    };
  });

  function failed() {
    const current = bannerGif(url);
    if (!current || current.startsWith('blob:') || current.startsWith('data:')) return;
    resolveMedia(current).then((next) => show(next));
  }
</script>

{#if src}<img class:fill class:ready src={src} alt="" decoding={ready ? 'sync' : 'async'} onload={() => (ready = true)} onerror={failed} />{/if}

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
