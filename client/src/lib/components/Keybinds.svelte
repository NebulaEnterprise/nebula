<script>
  import { onMount } from 'svelte';
  import { BIND_GROUPS, bindOn, setBind, chordOf, chordLabel, chordFromEvent, chordFromPointer, setChord, setRecordingBind } from '../keybinds.js';

  let off = $state({});
  let listening = $state('');
  let tick = $state(0);

  function enabled(id) {
    if (off[id] != null) return off[id];
    return bindOn(id);
  }

  function toggle(id) {
    const next = !enabled(id);
    off = { ...off, [id]: next };
    setBind(id, next);
  }

  function labels(id) {
    tick;
    return chordLabel(chordOf(id));
  }

  function arm(id) {
    listening = id;
    setRecordingBind(true);
  }

  function takeChord(chord) {
    if (!listening || !chord) return;
    setChord(listening, chord);
    listening = '';
    setRecordingBind(false);
    tick += 1;
  }

  onMount(() => {
    const onKey = (event) => {
      if (!listening) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        listening = '';
        setRecordingBind(false);
        return;
      }
      takeChord(chordFromEvent(event));
    };
    const onPointer = (event) => {
      if (!listening) return;
      if (event.button === 0 && event.target instanceof Element && event.target.closest('.bind-edit')) return;
      event.preventDefault();
      event.stopPropagation();
      takeChord(chordFromPointer(event));
    };
    const onMenu = (event) => {
      if (!listening) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('contextmenu', onMenu, true);
    return () => {
      setRecordingBind(false);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('contextmenu', onMenu, true);
    };
  });
</script>

<div class="sound-page">
  <p class="hint">Click a shortcut, then press the keys or mouse button you want. Esc cancels.</p>
  {#each BIND_GROUPS as group}
    {#if group.label}<p class="sound-kicker">{group.label}</p>{/if}
    {#each group.rows as row}
      <div class="sound-row bind-row">
        <div class="copy">
          <strong>{row.title}</strong>
          {#if row.text}<em>{row.text}</em>{/if}
        </div>
        {#if row.locked}
          <span class="bind-keys">
            {#each row.keys as key}
              {#if key === '/'}<span class="bind-or">/</span>{:else}<kbd>{key}</kbd>{/if}
            {/each}
          </span>
          <span class="bind-lock">On</span>
        {:else}
          <button type="button" class="bind-keys bind-edit" class:on={listening === row.id} onclick={() => arm(row.id)}>
            {#if listening === row.id}
              <kbd>Press a key or mouse button</kbd>
            {:else}
              {#each labels(row.id) as key}<kbd>{key}</kbd>{/each}
            {/if}
          </button>
          <button type="button" class="switch" class:on={enabled(row.id)} aria-pressed={enabled(row.id)} onclick={() => toggle(row.id)}><i></i></button>
        {/if}
      </div>
    {/each}
  {/each}
</div>
