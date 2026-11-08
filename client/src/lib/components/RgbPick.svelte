<script>
  let { colors = ['#7c3aed', '#c084fc'], slots = 2, onpick } = $props();

  let which = $state(0);
  const slot = $derived(slots < 2 ? 0 : which);

  function channels(hex) {
    let raw = String(hex || '').trim().replace('#', '');
    if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return { r: 124, g: 58, b: 237 };
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }

  const rgb = $derived(channels(colors[slot]));

  function hex(r, g, b) {
    const part = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16).padStart(2, '0');
    return '#' + part(r) + part(g) + part(b);
  }

  function setChannel(key, value) {
    const next = { ...rgb, [key]: value };
    onpick?.(slot, hex(next.r, next.g, next.b));
  }
</script>

<div class="rgb-pick">
  <div class="rgb-head">
    {#if slots > 1}
      {#each [0, 1] as i}
        <button type="button" class="rgb-dot" class:on={which === i} onclick={() => (which = i)}>
          <i style="background:{colors[i] || '#7c3aed'}"></i>
          {i === 0 ? 'Main' : 'Tone'}
        </button>
      {/each}
    {:else}
      <span class="rgb-dot on"><i style="background:{colors[0] || '#7c3aed'}"></i>Color</span>
    {/if}
    <code>{hex(rgb.r, rgb.g, rgb.b)}</code>
  </div>
  {#each [['r', 'R'], ['g', 'G'], ['b', 'B']] as [key, label]}
    <label>
      <span>{label}</span>
      <input type="range" min="0" max="255" value={rgb[key]} style="--track:{hex(key === 'r' ? rgb.r : 0, key === 'g' ? rgb.g : 0, key === 'b' ? rgb.b : 0)}" oninput={(e) => setChannel(key, e.currentTarget.value)} />
      <em>{rgb[key]}</em>
    </label>
  {/each}
</div>
