<script>
  let { tag = null } = $props();
</script>

{#if tag?.tag}
  <em class="tag-pill" title={tag.name || tag.tag}>{#if tag.icon}<i>{tag.icon}</i>{/if}{tag.tag}</em>
{/if}
