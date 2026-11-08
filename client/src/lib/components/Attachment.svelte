<script>
  import { fileUrl, pinnedSrc, resolveMedia } from '../api.js';

  let { file } = $props();
  let src = $state('');

  const name = $derived(file?.name || 'File');
  const video = $derived(file?.kind === 'video' || /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i.test(file?.url || file?.name || ''));
  const image = $derived(!video && (file?.kind === 'image' || /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i.test(file?.url || file?.name || '')));

  $effect(() => {
    const url = file?.url || '';
    if (!url) {
      src = '';
      return;
    }
    const pin = pinnedSrc(url);
    if (pin) {
      src = pin;
      return;
    }
    let stop = false;
    resolveMedia(url).then((next) => {
      if (!stop) src = next || fileUrl(url);
    });
    return () => {
      stop = true;
    };
  });
</script>

{#if video}
  {#if src}<video class="file-video" src={src} controls playsinline preload="metadata"></video>{/if}
{:else if image}
  {#if src}<a href={src} target="_blank" rel="noreferrer"><img class="file-img" src={src} alt={name} /></a>{/if}
{:else}
  <a class="file-chip" href={src || fileUrl(file?.url)} target="_blank" rel="noreferrer">{name}</a>
{/if}
