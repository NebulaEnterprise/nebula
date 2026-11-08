<script>
  import { untrack } from 'svelte';

  let { value = '#7c6af7', onpick } = $props();

  let h = $state(250);
  let sat = $state(0.55);
  let val = $state(0.96);
  let hexText = $state('#7c6af7');
  let focused = $state(false);
  let wheelEl = $state(null);
  let svEl = $state(null);
  let drag = $state('');

  function hexToHsv(hex) {
    let raw = String(hex || '').trim().replace('#', '');
    if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
    const r = parseInt(raw.slice(0, 2), 16) / 255;
    const g = parseInt(raw.slice(2, 4), 16) / 255;
    const b = parseInt(raw.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let hue = 0;
    if (d) {
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { h: hue, s: max === 0 ? 0 : d / max, v: max };
  }

  function hsvToHex(hue, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) [r, g, b] = [c, x, 0];
    else if (hue < 120) [r, g, b] = [x, c, 0];
    else if (hue < 180) [r, g, b] = [0, c, x];
    else if (hue < 240) [r, g, b] = [0, x, c];
    else if (hue < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const to = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return '#' + to(r) + to(g) + to(b);
  }

  const hex = $derived(hsvToHex(h, sat, val));

  $effect(() => {
    const next = hexToHsv(value);
    if (!next) return;
    const current = untrack(() => hsvToHex(h, sat, val));
    if (hsvToHex(next.h, next.s, next.v).toLowerCase() === current.toLowerCase()) return;
    h = next.h;
    sat = next.s;
    val = next.v;
  });

  $effect(() => {
    if (!focused) hexText = hex;
  });

  function emit(next) {
    if (next.toLowerCase() !== String(value || '').toLowerCase()) onpick?.(next);
  }

  function fromPoint(e, mode) {
    if (mode === 'hue' && wheelEl) {
      const rect = wheelEl.getBoundingClientRect();
      const x = e.clientX - (rect.left + rect.width / 2);
      const y = e.clientY - (rect.top + rect.height / 2);
      let deg = Math.atan2(y, x) * 180 / Math.PI + 90;
      if (deg < 0) deg += 360;
      h = deg;
    } else if (svEl) {
      const rect = svEl.getBoundingClientRect();
      sat = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      val = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    }
    emit(hsvToHex(h, sat, val));
  }

  function start(e, mode) {
    drag = mode;
    fromPoint(e, mode);
    const move = (ev) => { if (drag) fromPoint(ev, drag); };
    const up = () => {
      drag = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function commitHex() {
    const next = hexToHsv(hexText);
    if (!next) {
      hexText = hex;
      return;
    }
    h = next.h;
    sat = next.s;
    val = next.v;
    emit(hsvToHex(h, sat, val));
  }
</script>

<div class="picker">
  <div class="wheel" bind:this={wheelEl}>
    <button type="button" class="ring" aria-label="Hue" onpointerdown={(e) => start(e, 'hue')}></button>
    <button
      type="button"
      class="sv"
      aria-label="Shade"
      bind:this={svEl}
      style="background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl({h}, 100%, 50%))"
      onpointerdown={(e) => start(e, 'sv')}
    >
      <span class="sv-dot" style="left:{sat * 100}%;top:{(1 - val) * 100}%"></span>
    </button>
    <span class="hue-dot" style="--hue:{h}deg; background: hsl({h}, 100%, 50%)"></span>
  </div>
  <div class="picker-side">
    <span class="picker-preview" style="background:{hex}"></span>
    <input
      class="picker-hex"
      aria-label="Hex color"
      bind:value={hexText}
      maxlength="7"
      spellcheck="false"
      onfocus={() => (focused = true)}
      onblur={() => { focused = false; commitHex(); }}
      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitHex(); } }}
    />
  </div>
</div>
