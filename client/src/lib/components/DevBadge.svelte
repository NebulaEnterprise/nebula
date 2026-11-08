<script>
  let { on = false } = $props();
</script>

{#if on}
  <span class="dev-badge" title="Developer" aria-label="Developer">&lt;/&gt;</span>
{/if}
