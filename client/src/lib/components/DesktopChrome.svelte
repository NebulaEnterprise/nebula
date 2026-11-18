<script>
  import { onMount } from 'svelte';
  import { ui } from '../state.svelte.js';

  const chrome = typeof window !== 'undefined' ? window.nebulaDesktop : null;
  const overlay = !!(chrome && chrome.overlayTitle);
  const mac = chrome?.platform === 'darwin';
  let maximized = $state(false);
  let fullscreen = $state(false);

  onMount(() => {
    if (!overlay) return;
    chrome.onState?.((value) => { maximized = !!value; });
    chrome.onFull?.((value) => { fullscreen = !!value; });
  });
</script>

{#if (overlay && !fullscreen) || (!chrome && ui.me)}
  <header class="desk-title" class:mac class:web={!overlay}>
    {#if mac}
      <div class="desk-wins">
        <button type="button" class="close" aria-label="Close" onclick={() => chrome.close()}></button>
        <button type="button" class="min" aria-label="Minimize" onclick={() => chrome.minimize()}></button>
        <button type="button" class="max" aria-label="Zoom" onclick={() => chrome.toggleMax()}></button>
      </div>
    {/if}
    <div class="desk-brand">
      <img src="./logo.webp?v=3" alt="" />
      <strong>Nebula</strong>
    </div>
    {#if !mac}
      <div class="desk-wins">
        <button type="button" aria-label="Minimize" onclick={() => chrome.minimize()}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
        <button type="button" aria-label={maximized ? 'Restore' : 'Maximize'} onclick={() => chrome.toggleMax()}>
          {#if maximized}
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 3.2h5.2V8.4M3 4.4h5.2V9.6H3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
          {:else}
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
          {/if}
        </button>
        <button type="button" class="close" aria-label="Close" onclick={() => chrome.close()}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
      </div>
    {/if}
  </header>
{/if}
