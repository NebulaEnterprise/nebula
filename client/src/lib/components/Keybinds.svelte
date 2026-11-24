<script>
  import { BIND_GROUPS, bindOn, setBind } from '../keybinds.js';

  let off = $state({});

  function enabled(id) {
    if (off[id] != null) return off[id];
    return bindOn(id);
  }

  function toggle(id) {
    const next = !enabled(id);
    off = { ...off, [id]: next };
    setBind(id, next);
  }
</script>

<div class="sound-page">
  {#each BIND_GROUPS as group}
    {#if group.label}<p class="sound-kicker">{group.label}</p>{/if}
    {#each group.rows as row}
      <div class="sound-row bind-row">
        <div class="copy">
          <strong>{row.title}</strong>
          {#if row.text}<em>{row.text}</em>{/if}
        </div>
        <span class="bind-keys">
          {#each row.keys as key}
            {#if key === '/'}<span class="bind-or">/</span>{:else}<kbd>{key}</kbd>{/if}
          {/each}
        </span>
        {#if row.locked}
          <span class="bind-lock">On</span>
        {:else}
          <button type="button" class="switch" class:on={enabled(row.id)} aria-pressed={enabled(row.id)} onclick={() => toggle(row.id)}><i></i></button>
        {/if}
      </div>
    {/each}
  {/each}
</div>
