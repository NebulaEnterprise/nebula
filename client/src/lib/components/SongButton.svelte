<script>
  import { Pause, Play } from '@lucide/svelte';
  import { hasSong, playing, toggleSong } from '../song.svelte.js';

  let { file = '', start = 0 } = $props();
  const ready = $derived(hasSong(file));
  const on = $derived(playing(file, start));
</script>

{#if ready}
  <button
    type="button"
    class="song-btn"
    aria-label={on ? 'Pause song' : 'Play song'}
    onclick={(event) => { event.stopPropagation(); toggleSong(file, start); }}
  >
    {#if on}<Pause size={11} />{:else}<Play size={11} />{/if}
  </button>
{/if}
