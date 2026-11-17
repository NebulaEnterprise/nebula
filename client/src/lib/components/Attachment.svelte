<script>
  import { ExternalLink, Info, X, ZoomIn, ZoomOut } from '@lucide/svelte';
  import { fileUrl, getApiBase, pinnedSrc, resolveMedia } from '../api.js';
  import { formatSize, imageLayout } from '../image-view.js';
  import { openFile } from '../seal.js';
  import { ui } from '../state.svelte.js';
  import { loadVault, openPackedFile } from '../vault.js';

  let { file } = $props();
  let src = $state('');
  let poster = $state('');
  let open = $state(false);
  let view = $state(false);
  let zoomed = $state(false);
  let details = $state(false);
  let focus = $state({ x: 0.5, y: 0.5 });
  let natural = $state({ w: 0, h: 0 });
  let bytes = $state(0);
  let frame = $state({ w: 0, h: 0 });
  let over = $state(false);
  let revealed = $state(false);
  let unlockedName = $state('');
  let unlockedMime = $state('');

  const name = $derived(unlockedName || file?.name || 'File');
  const video = $derived(file?.kind === 'video' || /^video\//i.test(unlockedMime) || /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i.test(unlockedName || file?.url || file?.name || ''));
  const image = $derived(!video && (file?.kind === 'image' || /^image\//i.test(unlockedMime) || /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i.test(unlockedName || file?.url || file?.name || '')));
  const gif = $derived(/gif/i.test(unlockedMime) || /\.gif(\?|$)/i.test(unlockedName || file?.name || '') || /\.gif(\?|$)/i.test(file?.url || ''));
  const progress = $derived(Math.max(0, Math.min(100, Number(file?.progress) || 0)));
  const spoiler = $derived(!!file?.spoiler && !revealed);
  const label = $derived(file?.alt || name);

  function direct(url) {
    if (!url) return '';
    if (String(url).startsWith('blob:') || String(url).startsWith('data:')) return url;
    return pinnedSrc(url) || (navigator.serviceWorker?.controller ? fileUrl(url) : '');
  }

  async function unlock(url, lock) {
    const full = /^https?:/i.test(url) ? url : getApiBase() + url;
    const headers = { 'ngrok-skip-browser-warning': 'true', 'bypass-tunnel-reminder': 'true' };
    const res = await fetch(full, { headers });
    if (!res.ok) throw new Error('locked');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (file?.enc) {
      const vault = loadVault(ui.me?.id);
      const serverKey = vault?.servers?.[ui.serverId] || '';
      const dmId = ui.dmUser ? [ui.me.id, ui.dmUser.id].sort().join(':') : '';
      const groupId = ui.group?.id || '';
      const master = ui.mode === 'dm' ? vault?.dms?.[dmId] : (ui.mode === 'group' ? vault?.groups?.[groupId] : serverKey);
      if (!master) throw new Error('locked');
      const opened = await openPackedFile(master, bytes);
      const blob = new Blob([opened.bytes], { type: opened.type || 'application/octet-stream' });
      unlockedName = opened.name || 'file';
      unlockedMime = opened.type || '';
      return URL.createObjectURL(blob);
    }
    const opened = await openFile(lock, bytes, ui.me?.id);
    const mime = String(opened.meta?.mime || '');
    const blob = new Blob([opened.bytes], { type: mime || 'application/octet-stream' });
    unlockedName = String(opened.meta?.name || 'Encrypted file');
    unlockedMime = mime;
    return URL.createObjectURL(blob);
  }

  $effect(() => {
    const url = file?.url || '';
    const lock = file?.lock;
    const posterUrl = file?.poster || '';
    if ((lock || file?.enc) && url && !String(url).startsWith('blob:')) {
      let stop = false;
      let made = '';
      unlock(url, lock).then((next) => {
        if (stop) URL.revokeObjectURL(next);
        else {
          made = next;
          src = next;
        }
      }).catch(() => { if (!stop) src = ''; });
      return () => {
        stop = true;
        if (made) URL.revokeObjectURL(made);
      };
    }
    let stop = false;
    const apply = () => {
      if (stop) return;
      const next = direct(url);
      const still = direct(posterUrl);
      if (next) src = next;
      if (still) poster = still;
    };
    apply();
    const onReady = () => apply();
    navigator.serviceWorker?.addEventListener('controllerchange', onReady);
    if (url && !direct(url)) resolveMedia(url).then((next) => { if (!stop && next) src = next; });
    if (posterUrl && !direct(posterUrl)) resolveMedia(posterUrl).then((next) => { if (!stop && next) poster = next; });
    return () => {
      stop = true;
      navigator.serviceWorker?.removeEventListener('controllerchange', onReady);
    };
  });

  function portal(node) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  function stillFromVideo(url) {
    return new Promise((resolve) => {
      const videoEl = document.createElement('video');
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || '');
      };
      videoEl.preload = 'auto';
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.src = url;
      videoEl.onloadeddata = () => {
        const duration = Number(videoEl.duration) || 0;
        const target = duration ? Math.min(0.25, duration / 2) : 0;
        const draw = () => {
          const w0 = videoEl.videoWidth || 0;
          const h0 = videoEl.videoHeight || 0;
          if (!w0 || !h0) return finish('');
          const scale = Math.min(1, 640 / Math.max(w0, h0));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w0 * scale));
          canvas.height = Math.max(1, Math.round(h0 * scale));
          canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.72));
        };
        if (target > 0) {
          videoEl.onseeked = draw;
          try { videoEl.currentTime = target; } catch (_) { draw(); }
        } else draw();
      };
      videoEl.onerror = () => finish('');
      setTimeout(() => finish(''), 2500);
    });
  }

  function failed() {
    const url = file?.url || '';
    if (!url || String(url).startsWith('blob:')) return;
    resolveMedia(url).then((next) => { if (next) src = next; });
  }

  const place = $derived(imageLayout(natural.w, natural.h, frame.w, frame.h, zoomed, focus.x, focus.y));
  const sizeLine = $derived(formatSize(natural.w, natural.h, bytes));

  function rememberSize(event) {
    const img = event.currentTarget;
    if (img?.naturalWidth) natural = { w: img.naturalWidth, h: img.naturalHeight };
  }

  function syncFrame() {
    frame = { w: window.innerWidth, h: window.innerHeight };
  }

  function showImage() {
    zoomed = false;
    details = false;
    focus = { x: 0.5, y: 0.5 };
    over = false;
    syncFrame();
    view = true;
  }

  function closeView() {
    view = false;
    zoomed = false;
    details = false;
  }

  function pointInImage(event) {
    const box = place;
    if (!box) return false;
    return event.clientX >= box.x && event.clientX <= box.x + box.w && event.clientY >= box.y && event.clientY <= box.y + box.h;
  }

  function onMove(event) {
    over = pointInImage(event);
    if (!zoomed) return;
    const vw = frame.w || window.innerWidth;
    const vh = frame.h || window.innerHeight;
    focus = {
      x: Math.min(1, Math.max(0, event.clientX / vw)),
      y: Math.min(1, Math.max(0, event.clientY / vh)),
    };
  }

  function onStageClick(event) {
    const hit = pointInImage(event);
    if (zoomed) {
      zoomed = false;
      return;
    }
    if (!hit) {
      closeView();
      return;
    }
    const vw = frame.w || window.innerWidth;
    const vh = frame.h || window.innerHeight;
    focus = {
      x: Math.min(1, Math.max(0, event.clientX / vw)),
      y: Math.min(1, Math.max(0, event.clientY / vh)),
    };
    zoomed = true;
  }

  function zoomFromButton(event) {
    event.stopPropagation();
    event.preventDefault();
    if (!zoomed) focus = { x: 0.5, y: 0.5 };
    zoomed = !zoomed;
  }

  function onKey(event) {
    if (view && event.key === 'Escape') closeView();
  }

  function openInBrowser(event) {
    event.preventDefault();
    event.stopPropagation();
    const url = src;
    if (!url) return;
    if (/^https?:/i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const tab = window.open('', '_blank');
    if (!tab) return;
    const title = String(name || 'Image');
    tab.document.title = title;
    const style = tab.document.createElement('style');
    style.textContent = 'html,body{margin:0;background:#111;min-height:100%}body{display:grid;place-items:center}img{max-width:100vw;max-height:100vh;object-fit:contain}';
    tab.document.head.appendChild(style);
    const img = tab.document.createElement('img');
    img.alt = title;
    tab.document.body.appendChild(img);
    fetch(url).then((res) => res.blob()).then((blob) => {
      if (tab.closed) return;
      img.src = tab.URL.createObjectURL(blob);
    }).catch(() => {});
  }

  $effect(() => {
    const url = src;
    if (!view && video && url && !poster) {
      let stop = false;
      stillFromVideo(url).then((next) => { if (!stop && next) poster = next; });
      return () => { stop = true; };
    }
  });

  $effect(() => {
    if (!view) return;
    syncFrame();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const blockWheel = (event) => event.preventDefault();
    window.addEventListener('wheel', blockWheel, { passive: false });
    let stop = false;
    bytes = 0;
    if (src) {
      fetch(src).then((res) => res.blob()).then((blob) => {
        if (!stop) bytes = blob.size || 0;
      }).catch(() => {});
    }
    return () => {
      stop = true;
      document.body.style.overflow = previous;
      window.removeEventListener('wheel', blockWheel);
    };
  });
</script>

<svelte:window onkeydown={onKey} onresize={syncFrame} />

<div class="file-card" class:is-spoiler={spoiler}>
  {#if spoiler}
    <button type="button" class="spoiler-cover" title="Spoiler" onclick={() => (revealed = true)}>
      {#if src}<img src={src} alt="" />{/if}
      <span>SPOILER</span>
    </button>
  {:else if video}
    {#if src}<video class="file-video" src={src} poster={poster || undefined} controls playsinline preload="metadata" crossorigin="anonymous" onerror={failed}></video>{/if}
  {:else if image}
    {#if src}<button type="button" class="file-open" class:gif-crop={gif} title={label} onclick={showImage}><img class="file-img" class:gif-crop={gif} src={src} alt={label} decoding="async" crossorigin="anonymous" onload={rememberSize} onerror={failed} /></button>{/if}
  {:else if (file?.lock || file?.enc) && !src}
    <span class="file-chip">Encrypted file</span>
  {:else}
    <a class="file-chip" href={src || fileUrl(file?.url)} target="_blank" rel="noreferrer">{name}</a>
  {/if}
  {#if progress > 0 && progress < 100}
    <span class="file-progress"><i style="width:{progress}%"></i></span>
  {/if}
</div>
{#if view}
  <div class="image-view" role="dialog" aria-modal="true" aria-label={name} use:portal>
    <div
      class="image-stage"
      style:cursor={zoomed ? 'zoom-out' : (over ? 'zoom-in' : 'default')}
      onpointermove={onMove}
      onclick={onStageClick}
    >
      <img
        src={src}
        alt={name}
        draggable="false"
        style:width={place ? `${place.w}px` : undefined}
        style:height={place ? `${place.h}px` : undefined}
        style:transform={place ? `translate(${place.x}px, ${place.y}px)` : undefined}
        onload={rememberSize}
      />
    </div>
    <div class="image-bar">
      <button type="button" title={zoomed ? 'Zoom out' : 'Zoom in'} aria-label={zoomed ? 'Zoom out' : 'Zoom in'} onclick={zoomFromButton}>
        {#if zoomed}<ZoomOut size={20} />{:else}<ZoomIn size={20} />{/if}
      </button>
      <button type="button" title="Open in browser" aria-label="Open in browser" onclick={openInBrowser}><ExternalLink size={20} /></button>
      <button type="button" class="words" class:on={details} title="View details" aria-label="View details" aria-expanded={details} onclick={(event) => { event.stopPropagation(); details = !details; }}>View details</button>
      <button type="button" title="Close" aria-label="Close" onclick={(event) => { event.stopPropagation(); closeView(); }}><X size={20} /></button>
    </div>
    {#if details}
      <aside class="image-details">
        <p>Filename</p>
        <strong>{name}</strong>
        <p>Size</p>
        <strong>{sizeLine}</strong>
      </aside>
    {/if}
  </div>
{:else if open}
  <div class="lightbox" role="presentation" onclick={() => (open = false)}>
    {#if video}
      <video src={src} poster={poster || undefined} controls autoplay playsinline onclick={(e) => e.stopPropagation()}></video>
    {:else}
      <img src={src} alt={name} onclick={(e) => e.stopPropagation()} />
    {/if}
  </div>
{/if}
