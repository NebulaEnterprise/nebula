<script>
  let { rank = '' } = $props();
  const label = $derived(rank ? 'Nebula staff' : '');
</script>

{#if label}
  <span class="staff-badge" title={label} aria-label={label}>
    <img src="./badges/staff.png?v=2" alt="" />
  </span>
{/if}
