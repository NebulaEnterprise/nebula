<script>
  import { bannerGif, fileUrl, pinnedSrc, resolveMedia } from '../api.js';

  let { url = '', fill = false, size = 0 } = $props();
  let src = $state('');
  let step = 0;

  $effect(() => {
    const current = bannerGif(url, size || 512);
    step = 0;
    if (!current) {
      src = '';
      return;
    }
    if (current.startsWith('data:') || current.startsWith('blob:')) {
      src = current;
      return;
    }
    const pin = pinnedSrc(current);
    src = pin || fileUrl(current);
  });

  function failed() {
    const smooth = fileUrl(bannerGif(url, size || 512));
    const plain = fileUrl(url);
    if (step === 0 && plain && plain !== src) {
      step = 1;
      src = plain;
      return;
    }
    if (!plain || plain.startsWith('data:') || plain.startsWith('blob:')) return;
    if (!plain.includes('/files/') && !plain.includes('/uploads/')) return;
    resolveMedia(url).then((next) => {
      if (next && next !== src) src = next;
    });
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
