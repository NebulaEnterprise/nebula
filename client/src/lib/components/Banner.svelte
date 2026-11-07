<script>
  import { assetPath, resolveMedia } from '../api.js';

  let { url = '' } = $props();
  let poster = $state('');
  let movie = $state('');
  let playing = $state(false);

  function animated(ref) {
    const clean = String(ref || '').split('?')[0];
    return /\/uploads\/a_[^/]+/i.test(clean) || /\.gif$/i.test(clean);
  }

  $effect(() => {
    const current = url || '';
    let alive = true;
    poster = '';
    movie = '';
    playing = false;
    if (!current) return () => { alive = false; };
    if (current.startsWith('blob:') || current.startsWith('data:')) {
      movie = current;
      playing = true;
      return () => { alive = false; };
    }
    const motion = animated(current);
    resolveMedia(assetPath(current, { format: motion ? 'png' : undefined, size: 512 })).then((src) => {
      if (alive && src) poster = src;
    });
    if (!motion) return () => { alive = false; };
    resolveMedia(assetPath(current, { format: 'gif', size: 512 })).then((src) => {
      if (alive && src) movie = src;
    });
    return () => { alive = false; };
  });
</script>

<div class="banner-media">
  {#if poster}<img class="poster" src={poster} alt="" />{/if}
  {#if movie}<img class="movie" class:on={playing} src={movie} alt="" onload={() => (playing = true)} />{/if}
</div>

<style>
  .banner-media { position: absolute; inset: 0; }
  img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    max-width: none; object-fit: cover; display: block;
  }
  .movie { opacity: 0; }
  .movie.on { opacity: 1; }
</style>
