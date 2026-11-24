<script>
  import Photo from './Photo.svelte';

  let { url = '', label = 'Photo', onclose } = $props();
  let node = $state(null);

  $effect(() => {
    const box = node;
    if (!box) return;
    document.body.appendChild(box);
    const onKey = (event) => {
      if (event.key === 'Escape') onclose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (box.parentNode) box.parentNode.removeChild(box);
    };
  });
</script>

<div bind:this={node} class="lightbox profile-full" role="dialog" aria-modal="true" aria-label={label} tabindex="-1" onclick={(event) => { if (event.target === event.currentTarget) onclose?.(); }} onkeydown={(event) => { if (event.key === 'Escape') onclose?.(); }}>
  <div class="profile-full-frame">
    <Photo {url} />
  </div>
</div>
