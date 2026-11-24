<script>
  import { ExternalLink, Info, X, ZoomIn, ZoomOut } from '@lucide/svelte';
  import { api, fileUrl, getApiBase, pinnedSrc, resolveMedia } from '../api.js';
  import { formatSize, imageLayout } from '../image-view.js';
  import { openFile } from '../seal.js';
  import { fileRoomKeys, toast, ui } from '../state.svelte.js';
  import { openPackedFile } from '../vault.js';
  import VoiceNote from './VoiceNote.svelte';

  let { file, room = null } = $props();
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

  const name = $derived(file?.voice || file?.kind === 'audio' ? 'Voice message' : (unlockedName || file?.name || 'File'));
  const audio = $derived(!!file?.voice || file?.kind === 'audio' || /voice[- ]message/i.test(unlockedName || file?.name || '') || /^audio\//i.test(unlockedMime) || (file?.kind !== 'video' && file?.enc && /^video\/webm/i.test(unlockedMime)) || /\.(mp3|m4a|wav|ogg|aac|flac)(\?|$)/i.test(unlockedName || file?.name || ''));
  const video = $derived(!audio && (file?.kind === 'video' || /^video\//i.test(unlockedMime) || /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(unlockedName || file?.url || file?.name || '')));
  const image = $derived(!video && !audio && (file?.kind === 'image' || /^image\//i.test(unlockedMime) || /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i.test(unlockedName || file?.url || file?.name || '')));
  const gif = $derived(/gif/i.test(unlockedMime) || /\.gif(\?|$)/i.test(unlockedName || file?.name || '') || /\.gif(\?|$)/i.test(file?.url || ''));
  const progress = $derived(Math.max(0, Math.min(100, Number(file?.progress) || 0)));
  const spoiler = $derived(!!file?.spoiler && !revealed);
  const label = $derived(file?.alt || name);

  function direct(url) {
    if (!url) return '';
    if (String(url).startsWith('blob:') || String(url).startsWith('data:')) return url;
    return pinnedSrc(url) || (navigator.serviceWorker?.controller ? fileUrl(url) : '');
  }

  function sniffMime(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      return brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4';
    }
    if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
    return '';
  }

  function extFor(mime) {
    if (mime === 'image/png') return '.png';
    if (mime === 'image/jpeg') return '.jpg';
    if (mime === 'image/gif') return '.gif';
    if (mime === 'image/webp') return '.webp';
    if (mime === 'video/mp4') return '.mp4';
    if (mime === 'video/webm') return '.webm';
    if (mime === 'video/quicktime') return '.mov';
    return '';
  }

  function showPacked(opened, type) {
    const voice = !!file?.voice || file?.kind === 'audio' || /voice[- ]message/i.test(opened.name || '');
    let mime = type || opened.type || '';
    if (voice && !/^audio\//i.test(mime)) mime = /mp4|m4a/i.test(mime + opened.name) ? 'audio/mp4' : 'audio/webm';
    if (!voice && (!mime || mime === 'application/octet-stream')) mime = sniffMime(opened.bytes) || mime;
    const blob = new Blob([opened.bytes], { type: mime || 'application/octet-stream' });
    const named = opened.name && opened.name !== 'file' ? opened.name : '';
    unlockedName = named || ((mime.startsWith('image/') || mime.startsWith('video/')) ? (mime.startsWith('video/') ? 'video' : 'image') + extFor(mime) : 'file');
    unlockedMime = mime;
    return URL.createObjectURL(blob);
  }

  async function unlock(url, lock) {
    const full = /^https?:/i.test(url) ? url : getApiBase() + url;
    const headers = { 'ngrok-skip-browser-warning': 'true', 'bypass-tunnel-reminder': 'true' };
    const res = await fetch(full, { headers });
    if (!res.ok) throw new Error('locked');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (file?.enc) {
      const mode = room?.mode || ui.mode;
      const otherId = room?.dmUserId || ui.dmUser?.id || '';
      const groupId = room?.groupId || ui.group?.id || '';
      const serverId = room?.serverId || ui.serverId;
      const keys = await fileRoomKeys({ mode, dmUserId: otherId, groupId, serverId });
      let opened = null;
      for (const key of keys) {
        try {
          opened = await openPackedFile(key, bytes);
          break;
        } catch (_) {}
      }
      if (opened) return showPacked(opened, opened.type || '');
      const plain = sniffMime(bytes);
      if (!plain) throw new Error('locked');
      return showPacked({ name: 'file', type: plain, bytes }, plain);
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
    room?.mode;
    room?.dmUserId;
    room?.groupId;
    room?.serverId;
    if ((lock || file?.enc) && url && !String(url).startsWith('blob:')) {
      let stop = false;
      let made = '';
      const local = String(file?.localUrl || '');
      if (local.startsWith('blob:') && (file?.voice || file?.kind === 'audio')) src = local;
      unlock(url, lock).then((next) => {
        if (stop) URL.revokeObjectURL(next);
        else {
          made = next;
          src = next;
        }
      }).catch(() => {
        if (stop) return;
        src = local.startsWith('blob:') ? local : '';
      });
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

  async function openInBrowser(event) {
    event.preventDefault();
    event.stopPropagation();
    const url = src;
    if (!url) return;
    if (/^https?:/i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const popup = window.open('', '_blank');
    try {
      const blob = await fetch(url).then((res) => res.blob());
      if (!blob || !blob.size) throw new Error('Could not open that picture');
      const type = /^image\//i.test(blob.type || '') ? blob.type : 'image/png';
      const saved = await api('/api/preview', { method: 'POST', body: blob, headers: { 'Content-Type': type } });
      if (!saved || !saved.url) throw new Error('Could not open that picture');
      const pretty = 'https://nebulaapp.space' + saved.url;
      if (popup && !popup.closed) popup.location.replace(pretty);
      else window.open(pretty, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      toast(err.message || 'Could not open that picture');
    }
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
    {#if src}<video class="file-video" src={src} poster={poster || undefined} controls playsinline preload="metadata" crossorigin="anonymous" onerror={failed}></video>{:else}<span class="file-chip">{name}</span>{/if}
  {:else if audio}
    <VoiceNote src={src} />
  {:else if image}
    {#if src}<button type="button" class="file-open" class:gif-crop={gif} title={label} onclick={showImage}><img class="file-img" class:gif-crop={gif} src={src} alt={label} decoding="async" crossorigin="anonymous" onload={rememberSize} onerror={failed} /></button>{:else}<span class="file-chip">{name}</span>{/if}
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
