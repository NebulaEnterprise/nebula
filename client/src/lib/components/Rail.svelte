<script>
  import { Compass, MessageSquare, Plus, Settings, Users } from '@lucide/svelte';
  import { ui, openServer, showFriends, openDm, phoneBrowse } from '../state.svelte.js';

  const onChats = $derived(ui.mode === 'dm' || ui.mode === 'group');
  const onPeople = $derived(ui.mode === 'friends' || ui.mode === 'add');
  const onServers = $derived(ui.mode === 'chat' || ui.mode === 'thread');
  const chatUnread = $derived((ui.dms || []).reduce((sum, dm) => sum + (Number(ui.activity.dms[dm.other?.id]?.unread) || 0), 0));
  const peopleUnread = $derived((ui.incoming || []).length);

  function latestDm() {
    return [...(ui.dms || [])]
      .filter((dm) => dm.other)
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
  }

  function chats() {
    ui.serverPick = false;
    ui.menuOpen = false;
    if (onChats) {
      phoneBrowse();
      return;
    }
    const dm = latestDm();
    if (dm?.other) openDm(dm.other);
    else showFriends('online');
  }

  function people() {
    ui.serverPick = false;
    ui.menuOpen = false;
    showFriends('online');
  }

  function servers() {
    ui.menuOpen = false;
    ui.serverPick = false;
    if (ui.mode === 'chat') {
      phoneBrowse();
      return;
    }
    const id = ui.serverId || ui.servers?.[0]?.id;
    if (!id) {
      ui.dialog = { kind: 'add-server' };
      return;
    }
    openServer(id);
  }

  function count(n) {
    return n > 99 ? '99+' : String(n);
  }
</script>

<aside class="rail">
  <button class="rail-logo" title="Nebula" onclick={chats}>
    <img src="./logo.webp?v=3" alt="" />
  </button>
  <button class="rail-tab" class:on={onChats} title="Chats" onclick={chats}>
    <MessageSquare size={22} />
    {#if chatUnread}<em class="rail-count">{count(chatUnread)}</em>{/if}
  </button>
  <button class="rail-tab" class:on={onPeople} title="Friends" onclick={people}>
    <Users size={22} />
    {#if peopleUnread}<em class="rail-count">{count(peopleUnread)}</em>{/if}
  </button>
  <hr class="rail-line" />
  <div class="rail-servers">
    {#each ui.servers as server (server.id)}
      {@const note = ui.activity.servers[server.id]}
      <button
        class="rail-srv"
        class:on={ui.mode === 'chat' && ui.serverId === server.id}
        title={server.name}
        style="--srv:{server.color || '#a78bfa'}"
        onclick={() => openServer(server.id)}
      >
        {(server.icon || server.name || 'S').slice(0, 1).toUpperCase()}
        {#if note?.mentions}<em class="rail-count">{count(note.mentions)}</em>{/if}
      </button>
    {/each}
    <button class="rail-tab" title="Join a server" onclick={() => (ui.dialog = { kind: 'add-server' })}>
      <Plus size={20} />
    </button>
  </div>
  <button class="rail-tab" class:on={onServers} title="Servers" onclick={servers}>
    <Compass size={22} />
    {#if serverUnread}<em class="rail-count">{count(serverUnread)}</em>{/if}
  </button>
  <div class="rail-spacer"></div>
  <button class="rail-tab rail-gear" title="Settings" onclick={() => { ui.userPage = 'profile'; ui.userSettings = true; }}>
    <Settings size={22} />
  </button>
</aside>
