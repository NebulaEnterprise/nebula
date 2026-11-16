<script>
  import { Plus, Settings } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import { ui, openServer, showFriends, openDm, warmDm, phoneBrowse } from '../state.svelte.js';

  const incoming = $derived(
    (ui.dms || [])
      .filter((dm) => dm.other && ui.activity.dms[dm.other.id] && !(ui.mode === 'dm' && ui.dmUser && String(ui.dmUser.id) === String(dm.other.id)))
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  );
</script>

<aside class="rail">
  <button class="rail-btn dm-mark" class:on={ui.mode !== 'chat'} title="Direct messages" onclick={() => { showFriends('online'); phoneBrowse(); }}>
    <img src="./logo.webp?v=3" alt="" />
    {#if ui.incoming.length}
      <em class="badge ask">{ui.incoming.length > 99 ? '99+' : ui.incoming.length}</em>
    {/if}
  </button>
  {#each ui.servers as server}
    {@const note = ui.activity.servers[server.id]}
    <button
      class="srv"
      class:on={ui.mode === 'chat' && ui.serverId === server.id}
      class:unread={!!note}
      title={server.name}
      style="--srv:{server.color || '#a78bfa'}"
      onclick={() => openServer(server.id)}
    >
      {(server.icon || server.name || 'S').slice(0, 1).toUpperCase()}
      {#if note?.mentions}
        <em class="badge">{note.mentions > 99 ? '99+' : note.mentions}</em>
      {:else if note?.unread}
        <i class="badge dot"></i>
      {/if}
    </button>
  {/each}
  {#each incoming as dm (dm.other.id)}
    <button class="srv dm-rail" title={dm.other.displayName || dm.other.username} onpointerenter={() => warmDm(dm.other.id)} onclick={() => openDm(dm.other)}>
      <Avatar user={dm.other} size={40} dot={false} />
      <em class="badge">{(ui.activity.dms[dm.other.id].unread || 1) > 99 ? '99+' : (ui.activity.dms[dm.other.id].unread || 1)}</em>
    </button>
  {/each}
  <button class="rail-btn rail-add" title="Add a server" onclick={() => (ui.dialog = { kind: 'add-server' })}>
    <Plus size={20} />
  </button>
  <div class="rail-spacer"></div>
  <button class="rail-btn rail-gear" title="Settings" onclick={() => { ui.userPage = 'profile'; ui.userSettings = true; }}>
    <Settings size={20} />
  </button>
</aside>
