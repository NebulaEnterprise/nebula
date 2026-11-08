<script>
  import { fileUrl, pinnedSrc, resolveMedia } from '../api.js';

  let { url = '', fill = false } = $props();
  let src = $state('');

  $effect(() => {
    const current = url;
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
    const current = url;
    if (!current || current.startsWith('data:') || current.startsWith('blob:')) return;
    resolveMedia(current).then((next) => {
      if (next && next !== src) src = next;
    });
  }
</script>

{#if src}<img class:fill src={src} alt="" onerror={failed} />{/if}

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
