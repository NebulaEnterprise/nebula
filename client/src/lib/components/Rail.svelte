<script>
  import { Plus } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import dmMark from '../../assets/dm-mark.png';
  import { ui, openServer, showFriends, openDm, warmDm, phoneBrowse } from '../state.svelte.js';

  const incoming = $derived(
    (ui.dms || [])
      .filter((dm) => dm.other && ui.activity.dms[dm.other.id] && !(ui.mode === 'dm' && ui.dmUser && String(ui.dmUser.id) === String(dm.other.id)))
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  );
</script>

<aside class="rail">
  <button class="rail-btn dm-mark" class:on={ui.mode !== 'chat'} title="Direct messages" onclick={() => { showFriends('online'); phoneBrowse(); }}>
    <img src={dmMark} alt="" />
  </button>
  {#each incoming as dm (dm.other.id)}
    <button class="srv dm-rail" title={dm.other.displayName || dm.other.username} onpointerenter={() => warmDm(dm.other.id)} onclick={() => openDm(dm.other)}>
      <Avatar user={dm.other} size={40} dot={false} />
      <em class="badge">{(ui.activity.dms[dm.other.id].unread || 1) > 99 ? '99+' : (ui.activity.dms[dm.other.id].unread || 1)}</em>
    </button>
  {/each}
  <div class="sep"></div>
  {#each ui.servers as server}
    {@const note = ui.activity.servers[server.id]}
    <button
      class="srv"
      class:on={ui.mode === 'chat' && ui.serverId === server.id}
      class:unread={!!note}
      title={server.name}
      style="background:{server.color || 'var(--brand)'}"
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
  <button class="rail-btn rail-add" title="Add a server" onclick={() => (ui.dialog = { kind: 'add-server' })}>
    <Plus size={22} />
  </button>
</aside>
