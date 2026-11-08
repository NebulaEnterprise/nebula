<script>
  let { on = false } = $props();
</script>

{#if on}
  <span class="dev-badge" title="Developer" aria-label="Developer">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M6.1 3.1 2.2 8l3.9 4.9-1.3 1L.4 8l4.4-5.9 1.3 1zm3.8 0 1.3-1L15.6 8l-4.4 5.9-1.3-1L13.8 8 9.9 3.1zM9.2 2.2l-1.5 11.6H6.3L7.8 2.2h1.4z" />
    </svg>
  </span>
{/if}
