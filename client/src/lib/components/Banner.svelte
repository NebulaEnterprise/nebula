<script>
  import { assetPath, resolveMedia, readStill, writeStill, isCloud, cloudStill, openCloud } from '../api.js';
  import { frameDataUrl } from '../image.js';

  let { url = '', fileKey = '' } = $props();
  let poster = $state('');
  let movie = $state('');
  let playing = $state(false);
  const remembered = $derived(readStill(url));

  function motionOf(ref) {
    const clean = String(ref || '').split('?')[0];
    return /\/banners\/a_|\/uploads\/a_[^/]+/i.test(clean) || /\.gif$/i.test(clean);
  }

  async function loadOne(current, key, target) {
    if (isCloud(target)) return openCloud(target, key);
    return resolveMedia(target);
  }

  $effect(() => {
    const current = url || '';
    const key = fileKey || '';
    let alive = true;
    let tries = 0;
    let timer = 0;
    playing = false;
    movie = '';
    poster = remembered || '';
    if (!current) return () => { alive = false; };
    if (current.startsWith('blob:') || current.startsWith('data:')) {
      movie = current;
      playing = true;
      return () => { alive = false; };
    }
    const motion = motionOf(current);
    const stillTarget = isCloud(current) ? cloudStill(current) : assetPath(current, { format: motion ? 'png' : undefined, size: 512 });
    const show = async (src) => {
      if (!alive || !src) return;
      if (!poster) poster = src;
      try {
        const data = await frameDataUrl(src);
        if (alive && data) {
          writeStill(current, data);
          poster = data;
        }
      } catch (_) {}
    };
    if (stillTarget) loadOne(current, key, stillTarget).then(show);
    else loadOne(current, key, isCloud(current) ? current : assetPath(current, { size: 512 })).then(show);
    const pullGif = () => {
      if (!alive || !motion) return;
      const target = isCloud(current) ? current : assetPath(current, { format: 'gif', size: 512 });
      loadOne(current, key, target).then((src) => {
        if (!alive) return;
        if (src) {
          movie = src;
          return;
        }
        if (tries++ < 4) timer = setTimeout(pullGif, 1200);
      });
    };
    if (motion) pullGif();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  });
</script>

<div class="banner-media">
  {#if remembered || poster}<img class="poster" src={remembered || poster} alt="" />{/if}
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
