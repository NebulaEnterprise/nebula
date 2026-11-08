<script>
  let { user = null, color = '' } = $props();
  const label = $derived(user?.nick || user?.displayName || user?.username || '');
  const fx = $derived(['plain', 'glow', 'gradient', 'rainbow', 'glitch', 'sparkle'].includes(user?.nameEffect) ? user.nameEffect : '');
  const font = $derived(['serif', 'mono', 'round', 'script', 'display'].includes(user?.nameFont) ? user.nameFont : '');
  const paint = $derived.by(() => {
    const colors = Array.isArray(user?.nameColors) ? user.nameColors : [];
    const parts = [];
    if (fx === 'plain' && colors[0]) parts.push('color:' + colors[0]);
    else if (!fx && color) parts.push('color:' + color);
    if (colors[0]) parts.push('--fx1:' + colors[0]);
    if (colors[1]) parts.push('--fx2:' + colors[1]);
    return parts.join(';');
  });
</script>

<span class="name-fx {fx}" class:name-font-serif={font === 'serif'} class:name-font-mono={font === 'mono'} class:name-font-round={font === 'round'} class:name-font-script={font === 'script'} class:name-font-display={font === 'display'} style={paint}>{label}{#if fx === 'sparkle'}<i></i><i></i><i></i><i></i>{/if}</span>
