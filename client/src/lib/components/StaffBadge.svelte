<script>
  let { rank = '' } = $props();
  const label = $derived(rank === 'admin' ? 'Admin' : rank === 'manager' ? 'Manager' : rank === 'moderator' ? 'Moderator' : '');
</script>

{#if label}
  <span class="staff-badge" title={label} aria-label={label}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M2 13.4V2.6h2.4l7.2 8.2V2.6H14v10.8h-2.4L4.4 5.2v8.2H2z" />
    </svg>
  </span>
{/if}
