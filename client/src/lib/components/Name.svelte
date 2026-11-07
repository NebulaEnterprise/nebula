<script>
  let { user = null, color = '' } = $props();
  const label = $derived(user?.nick || user?.displayName || user?.username || '');
  const fx = $derived(['plain', 'glow', 'gradient', 'rainbow', 'glitch'].includes(user?.nameEffect) ? user.nameEffect : '');
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

<span class="name-fx {fx}" style={paint}>{label}</span>
