<script>
  import { onMount } from 'svelte';
  import { ui, openDm, openGroup, openServer, pickChannel, showFriends, logout, loadGroups } from '../state.svelte.js';

  onMount(() => { loadGroups(); });

  let q = $state('');
  let cursor = $state(0);
  let box = $state(null);

  const rows = $derived.by(() => {
    const query = q.trim().toLowerCase();
    const list = [];
    const keep = (label) => !query || label.toLowerCase().includes(query);
    for (const dm of ui.dms || []) {
      const label = dm.other?.displayName || dm.other?.username || 'Direct message';
      if (dm.other && keep(label)) list.push({ kind: 'Direct message', label, run: () => openDm(dm.other) });
    }
    for (const group of ui.groups || []) {
      if (keep(group.name || 'Group')) list.push({ kind: 'Group chat', label: group.name || 'Group', run: () => openGroup(group) });
    }
    for (const server of ui.servers || []) {
      if (keep(server.name || 'Server')) list.push({ kind: 'Server', label: server.name || 'Server', run: () => openServer(server.id) });
    }
    if (ui.mode === 'chat' || ui.serverId) {
      for (const channel of ui.channels || []) {
        if (channel.type === 'voice') continue;
        const label = channel.name || 'channel';
        if (keep(label)) list.push({ kind: 'Channel', label: '#' + label, run: () => pickChannel(channel.id) });
      }
    }
    const actions = [
      { kind: 'Action', label: 'Friends', run: () => showFriends('online') },
      { kind: 'Action', label: 'Find people', run: () => showFriends('find') },
      { kind: 'Action', label: 'Create a group', run: () => (ui.dialog = { kind: 'group' }) },
      { kind: 'Action', label: 'Create a server', run: () => (ui.dialog = { kind: 'add-server' }) },
      { kind: 'Action', label: 'Log out', run: () => logout() },
    ];
    for (const action of actions) if (keep(action.label)) list.push(action);
    return list.slice(0, 40);
  });

  $effect(() => {
    rows.length;
    q;
    cursor = 0;
    queueMicrotask(() => box?.focus());
  });

  function choose(index) {
    const row = rows[index];
    if (!row) return;
    ui.switcher = false;
    q = '';
    row.run();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      ui.switcher = false;
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      cursor = Math.min(rows.length - 1, cursor + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      cursor = Math.max(0, cursor - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(cursor);
    }
  }
</script>

<div class="overlay switcher-overlay" role="presentation" onclick={() => (ui.switcher = false)}>
  <div class="switcher" role="dialog" aria-label="Quick switcher" onclick={(e) => e.stopPropagation()}>
    <input bind:this={box} bind:value={q} placeholder="Find a chat, server, or action" onkeydown={onKey} />
    <div class="switcher-list">
      {#each rows as row, index (row.kind + row.label + index)}
        <button type="button" class:on={index === cursor} onmouseenter={() => (cursor = index)} onclick={() => choose(index)}>
          <em>{row.kind}</em>
          <span>{row.label}</span>
        </button>
      {/each}
      {#if !rows.length}<p class="hint">Nothing matches.</p>{/if}
    </div>
    <p class="switcher-hint">↑↓ move · Enter open · Esc close</p>
  </div>
</div>
