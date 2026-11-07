<script>
  import { resolveMedia } from '../api.js';

  let { url = '' } = $props();
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
      if (alive) src = next;
    });
    return () => {
      alive = false;
    };
  });
</script>

{#if src}<img src={src} alt="" />{/if}
