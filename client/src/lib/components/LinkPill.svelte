<script>
  import { ui } from '../state.svelte.js';

  let { floating = false } = $props();

  const busy = $derived(ui.link === 'reconnecting' || ui.link === 'catching' || ui.link === 'updating');
  const label = $derived(
    ui.link === 'reconnecting' ? 'Reconnecting...'
    : ui.link === 'catching' ? 'Catching up...'
    : ui.link === 'updating' ? 'Updating...'
    : ui.link === 'online' ? 'Back online'
    : 'Caught up'
  );
</script>

{#if ui.link}
  <div class="link-pill" class:float={floating} class:down={busy} role="status">
    {#if busy}
      <i class="link-spin"></i>
    {:else}
      <i class="link-dot"></i>
    {/if}
    {label}
  </div>
{/if}
