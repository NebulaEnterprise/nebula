<script>
  let { user = null, color = '' } = $props();
  const label = $derived(user?.nick || user?.displayName || user?.username || '');
  const fx = $derived(['glow', 'gradient', 'rainbow', 'glitch'].includes(user?.nameEffect) ? user.nameEffect : '');
</script>

<span class="name-fx {fx}" style={!fx && color ? 'color:' + color : ''}>{label}</span>
