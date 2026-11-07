<script>
  import { resolveMedia } from '../api.js';

  let { url = '', color = '#7c6af7' } = $props();
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

  const paint = $derived(src ? `center / cover no-repeat url('${src}')` : (color || '#7c6af7'));
</script>

<div class="banner-fill" style="background:{paint}"></div>
