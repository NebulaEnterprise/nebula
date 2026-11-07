<script>
  import Photo from './Photo.svelte';
  import { assetPath } from '../api.js';

  let { url = '' } = $props();
  const src = $derived(assetPath(url, { size: 512 }));
</script>

<div class="banner-media">
  {#if src}<Photo url={src} fill />{/if}
</div>

<style>
  .banner-media { position: absolute; inset: 0; }
</style>
