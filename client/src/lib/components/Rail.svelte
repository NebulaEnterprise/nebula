<script>
  import { MessageSquare, Plus } from '@lucide/svelte';
  import { ui, openServer, showFriends } from '../state.svelte.js';
</script>

<aside class="rail">
  <button class="rail-btn" class:on={ui.mode !== 'chat'} title="Direct messages" onclick={() => showFriends('online')}>
    <MessageSquare size={22} />
  </button>
  <div class="sep"></div>
  {#each ui.servers as server}
    <button
      class="srv"
      class:on={ui.mode === 'chat' && ui.serverId === server.id}
      title={server.name}
      style="background:{server.color || 'var(--brand)'}"
      onclick={() => openServer(server.id)}
    >
      {(server.icon || server.name || 'S').slice(0, 1).toUpperCase()}
    </button>
  {/each}
  <button class="rail-btn rail-add" title="Add a server" onclick={() => (ui.dialog = { kind: 'add-server' })}>
    <Plus size={22} />
  </button>
</aside>
