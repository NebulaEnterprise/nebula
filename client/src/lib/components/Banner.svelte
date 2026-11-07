<script>
  import { assetPath, resolveMedia, readStill, writeStill } from '../api.js';
  import { frameDataUrl } from '../image.js';

  let { url = '' } = $props();
  let poster = $state(readStill(url));
  let movie = $state('');
  let playing = $state(false);

  function motionOf(ref) {
    const clean = String(ref || '').split('?')[0];
    return /\/uploads\/a_[^/]+/i.test(clean) || /\.gif$/i.test(clean);
  }

  $effect(() => {
    const current = url || '';
    let alive = true;
    let tries = 0;
    let timer = 0;
    playing = false;
    movie = '';
    const saved = readStill(current);
    poster = saved;
    if (!current) return () => { alive = false; };
    if (current.startsWith('blob:') || current.startsWith('data:')) {
      movie = current;
      playing = true;
      return () => { alive = false; };
    }
    const motion = motionOf(current);
    resolveMedia(assetPath(current, { format: motion ? 'png' : undefined, size: 512 })).then(async (src) => {
      if (!alive || !src) return;
      if (!poster) poster = src;
      try {
        const data = await frameDataUrl(src);
        if (alive && data) {
          writeStill(current, data);
          poster = data;
        }
      } catch (_) {}
    });
    const pullGif = () => {
      if (!alive || !motion) return;
      resolveMedia(assetPath(current, { format: 'gif', size: 512 })).then((src) => {
        if (!alive) return;
        if (src) {
          movie = src;
          return;
        }
        if (tries++ < 4) timer = setTimeout(pullGif, 1200);
      });
    };
    pullGif();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
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
