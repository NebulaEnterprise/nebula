<script>
  import { resolveMedia, resolvePoster, savePoster } from '../api.js';
  import { frameBlob } from '../image.js';

  let { url = '', still = '' } = $props();
  let poster = $state('');
  let movie = $state('');
  let playing = $state(false);

  $effect(() => {
    const current = url || '';
    const stillUrl = still || '';
    let alive = true;
    poster = '';
    movie = '';
    playing = false;
    const paintPoster = (src) => {
      if (alive && src) poster = src;
    };
    if (stillUrl) resolveMedia(stillUrl).then(paintPoster);
    else if (current) resolvePoster(current).then(paintPoster);
    if (!current) return () => { alive = false; };
    if (current.startsWith('blob:') || current.startsWith('data:')) {
      movie = current;
      return () => { alive = false; };
    }
    resolveMedia(current).then((src) => {
      if (!alive || !src) return;
      movie = src;
      if (stillUrl) return;
      frameBlob(src).then((blob) => {
        const local = URL.createObjectURL(blob);
        if (alive && !poster) poster = local;
        savePoster(current, blob);
      }).catch(() => {});
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
