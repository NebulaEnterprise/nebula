<script>
  import { resolveMedia } from '../api.js';

  let { url = '', fill = false } = $props();
  let src = $state('');

  $effect(() => {
    const current = url;
    let alive = true;
    if (!current) {
      src = '';
      return;
    }
    if (current.startsWith('data:') || current.startsWith('blob:')) {
      src = current;
      return;
    }
    resolveMedia(current).then((next) => {
      if (alive && next) src = next;
    });
    return () => {
      alive = false;
    };
  });
</script>

{#if src}<img class:fill src={src} alt="" />{/if}

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
