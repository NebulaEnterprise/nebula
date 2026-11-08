<script>
  import { Pause, Play } from '@lucide/svelte';
  import { hasSong, playing, toggleSong, warmSong } from '../song.svelte.js';

  let { url = '', start = 0 } = $props();
  const on = $derived(playing(url, start));
  $effect(() => { if (hasSong(url)) warmSong(url); });
</script>

{#if hasSong(url)}
  <button
    type="button"
    class="song-btn"
    aria-label={on ? 'Pause song' : 'Play song'}
    onclick={(event) => { event.stopPropagation(); toggleSong(url, start); }}
  >
    {#if on}<Pause size={11} />{:else}<Play size={11} />{/if}
  </button>
{/if}
