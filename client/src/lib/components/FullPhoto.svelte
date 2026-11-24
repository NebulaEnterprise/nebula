<script>
  import { Download } from '@lucide/svelte';
  import Photo from './Photo.svelte';
  import { bannerGif, resolveMedia } from '../api.js';

  let { url = '', label = 'Photo', onclose } = $props();
  let node = $state(null);
  let saving = $state(false);

  function fileName(source, type) {
    const kind = /banner/i.test(label) ? 'banner' : 'profile-picture';
    const raw = String(source || '');
    if (/gif/i.test(type) || /\.gif(\?|#|$)/i.test(raw)) return kind + '.gif';
    if (/webp/i.test(type) || /\.webp(\?|#|$)/i.test(raw)) return kind + '.webp';
    if (/jpe?g/i.test(type) || /\.jpe?g(\?|#|$)/i.test(raw)) return kind + '.jpg';
    return kind + '.png';
  }

  function saveBlob(blob, name) {
    const local = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = local;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(local), 2000);
  }

  async function download(event) {
    event.preventDefault();
    event.stopPropagation();
    if (saving || !url) return;
    saving = true;
    try {
      const source = bannerGif(url);
      const src = await resolveMedia(source);
      if (!src) return;
      const blob = await fetch(src).then((res) => res.blob());
      saveBlob(blob, fileName(source, blob.type));
    } finally {
      saving = false;
    }
  }

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
  <button type="button" class="profile-download" disabled={saving} onclick={download}>
    <Download size={16} />
    {saving ? 'Saving...' : 'Download'}
  </button>
  <div class="profile-full-frame">
    <Photo {url} />
  </div>
</div>
