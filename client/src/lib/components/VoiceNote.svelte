<script>
  let { src = '' } = $props();
  const count = 26;
  let node = $state(null);
  let playing = $state(false);
  let current = $state(0);
  let duration = $state(0);
  let menu = $state(false);
  let bars = $state(speechBars(2));

  function speechBars(seed) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const wave = Math.abs(Math.sin(i * 0.62 + seed) * 0.48 + Math.sin(i * 1.37 + seed) * 0.28) + 0.2;
      out.push(Math.min(1, Math.max(0.16, wave)));
    }
    return out;
  }

  function clock(value) {
    const n = Number.isFinite(value) && value > 0 ? value : 0;
    const whole = Math.floor(n);
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  }

  const played = $derived(duration ? Math.min(count, Math.round((current / duration) * count)) : 0);
  const label = $derived(clock(current) + ' / ' + clock(duration));

  async function draw(url, live) {
    if (!live()) return;
    bars = speechBars(url.length % 7);
    try {
      const res = await fetch(url);
      if (!res.ok || !live()) return;
      const raw = await res.arrayBuffer();
      const ctx = new AudioContext();
      try {
        const audio = await ctx.decodeAudioData(raw.slice(0));
        if (!live()) return;
        const channel = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(channel.length / count));
        const next = [];
        for (let i = 0; i < count; i += 1) {
          let peak = 0;
          const start = i * step;
          for (let j = 0; j < step; j += 12) peak = Math.max(peak, Math.abs(channel[start + j] || 0));
          next.push(peak);
        }
        const top = Math.max(...next, 0.01);
        bars = next.map((n) => Math.max(0.16, n / top));
        if (!duration && audio.duration) duration = audio.duration;
      } finally {
        ctx.close();
      }
    } catch (_) {}
  }

  $effect(() => {
    const url = src || '';
    playing = false;
    current = 0;
    duration = 0;
    if (!url) return;
    let stop = false;
    draw(url, () => !stop);
    return () => { stop = true; };
  });

  function toggle(event) {
    event.stopPropagation();
    if (!node || !src) return;
    if (!node.paused) {
      node.pause();
      return;
    }
    if (node.ended || (duration && node.currentTime >= duration - 0.05)) node.currentTime = 0;
    node.play();
  }

  function seek(event) {
    event.stopPropagation();
    if (!node || !duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    node.currentTime = ratio * duration;
    current = node.currentTime;
  }

  async function saveClip(event) {
    event.stopPropagation();
    menu = false;
    if (!src) return;
    const res = await fetch(src);
    const blob = await res.blob();
    const type = blob.type || '';
    const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : /mpeg|mp3/.test(type) ? 'mp3' : 'webm';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'voice-message.' + ext;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function closeMenu(event) {
    if (!menu) return;
    if (event.target instanceof Element && event.target.closest('.voice-note')) return;
    menu = false;
  }
</script>

<svelte:window onclick={closeMenu} />

<div class="voice-note">
  <audio
    bind:this={node}
    class="voice-hidden"
    src={src || undefined}
    preload="metadata"
    onloadedmetadata={() => { duration = node?.duration || 0; }}
    ontimeupdate={() => { current = node?.currentTime || 0; }}
    onplay={() => { playing = true; }}
    onpause={() => { playing = false; }}
    onended={() => { playing = false; current = duration || current; }}
  ></audio>
  <button type="button" class="voice-play" aria-label={playing ? 'Pause voice message' : 'Play voice message'} disabled={!src} onclick={toggle}>
    {#if playing}
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
    {:else}
      <svg class="play-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
    {/if}
  </button>
  <button type="button" class="voice-wave" aria-label="Seek" onclick={seek}>
    {#each bars as height, index (index)}
      <i class:on={index < played} style="height:{Math.round(18 + height * 82)}%"></i>
    {/each}
  </button>
  <span class="voice-time">{label}</span>
  <span class="voice-rule"></span>
  <div class="voice-menu">
    <button type="button" class="voice-more" aria-label="Voice message options" onclick={(event) => { event.stopPropagation(); menu = !menu; }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
    </button>
    {#if menu}
      <div class="voice-speeds">
        <button type="button" onclick={saveClip}>Save audio clip</button>
      </div>
    {/if}
  </div>
</div>
