<script>
  let { rank = '' } = $props();
  const label = $derived(rank === 'admin' ? 'Admin' : rank === 'manager' ? 'Manager' : rank === 'moderator' ? 'Moderator' : '');
</script>

{#if label}
  <span class="staff-badge" title={label} aria-label={label}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M1.6 13.2V2.8h2.4l4 6.4 4-6.4h2.4v10.4h-2.2V6.4L8.8 11.2H7.2L4 6.4v6.8H1.6z" />
    </svg>
  </span>
{/if}
