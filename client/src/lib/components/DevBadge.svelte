<script>
  let { on = false } = $props();
</script>

{#if on}
  <span class="dev-badge" title="Developer" aria-label="Developer">
    <img src="./badges/developer.png?v=1" alt="" />
  </span>
{/if}
