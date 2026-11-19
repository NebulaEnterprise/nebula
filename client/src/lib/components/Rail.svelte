<script>
  import { ChevronRight, Compass, MessageSquare, Server, Settings, Users } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import { ui, showFriends, showMessages, showServers, showDiscover, openDm, phoneBrowse } from '../state.svelte.js';
  import { presenceDot } from '../seen.js';

  const onMessages = $derived(ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'messages');
  const onPeople = $derived(ui.mode === 'friends' || ui.mode === 'add');
  const onServers = $derived(ui.mode === 'servers' || ui.mode === 'chat' || ui.mode === 'thread');
  const onDiscover = $derived(ui.mode === 'discover');
  const chatUnread = $derived((ui.dms || []).reduce((sum, dm) => sum + (Number(ui.activity.dms[dm.other?.id]?.unread) || 0), 0));
  const peopleUnread = $derived((ui.incoming || []).length);
  function dmCount(dm) {
    const id = dm?.other?.id;
    if (!id) return 0;
    if (ui.mode === 'dm' && String(ui.dmUser?.id || '') === String(id)) return 0;
    return Math.max(Number(ui.activity.dms?.[id]?.unread) || 0, Number(dm.unread) || 0);
  }
  const unreadDms = $derived.by(() => {
    const rows = [];
    const seen = new Set();
    for (const dm of ui.dms || []) {
      if (!dm?.other || dmCount(dm) <= 0) continue;
      seen.add(String(dm.other.id));
      rows.push(dm);
    }
    for (const [id, note] of Object.entries(ui.activity.dms || {})) {
      if (seen.has(String(id)) || !(Number(note?.unread) > 0)) continue;
      if (ui.mode === 'dm' && String(ui.dmUser?.id || '') === String(id)) continue;
      const person = (ui.friends || []).find((user) => String(user.id) === String(id))
        || (ui.members || []).find((user) => String(user.id) === String(id));
      if (!person) continue;
      rows.push({ other: person, updatedAt: Date.now(), unread: note.unread });
    }
    rows.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    return rows;
  });
  const status = $derived(presenceDot(ui.me));

  function latestDm() {
    return [...(ui.dms || [])]
      .filter((dm) => dm.other)
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
  }

  function messages() {
    ui.menuOpen = false;
    if (onMessages) {
      phoneBrowse();
      return;
    }
    const dm = latestDm();
    if (dm?.other) openDm(dm.other);
    else showMessages();
  }

  function people() {
    ui.menuOpen = false;
    if (onPeople) {
      phoneBrowse();
      return;
    }
    showFriends('all');
  }

  function servers() {
    ui.menuOpen = false;
    if (ui.mode === 'servers') {
      phoneBrowse();
      return;
    }
    showServers();
  }

  function discover() {
    ui.menuOpen = false;
    if (onDiscover) {
      phoneBrowse();
      return;
    }
    showDiscover();
  }

  function count(n) {
    return n > 99 ? '99+' : String(n);
  }
</script>

<aside class="rail">
  <button class="rail-logo" title="Nebula" onclick={messages}>
    <img src="./logo.webp?v=3" alt="" />
  </button>
  {#if unreadDms.length}
    <div class="rail-dms" aria-label="New direct messages">
      {#each unreadDms as dm (dm.other.id)}
        <button type="button" class="rail-dm" title={dm.other.displayName || dm.other.username} onclick={() => openDm(dm.other)}>
          <Avatar user={dm.other} size={48} dot={false} />
          <em>{count(dmCount(dm))}</em>
        </button>
      {/each}
    </div>
  {/if}
  <button class="rail-tab" class:on={onMessages} title="Messages" onclick={messages}>
    <MessageSquare size={22} />
    <span>Messages</span>
    {#if chatUnread}<em class="rail-count">{count(chatUnread)}</em>{/if}
  </button>
  <button class="rail-tab" class:on={onPeople} title="Friends" onclick={people}>
    <Users size={22} />
    <span>Friends</span>
    {#if peopleUnread}<em class="rail-count">{count(peopleUnread)}</em>{/if}
  </button>
  <button class="rail-tab" class:on={onServers} title="Servers" onclick={servers}>
    <Server size={22} />
    <span>Servers</span>
  </button>
  <button class="rail-tab" class:on={onDiscover} title="Discover" onclick={discover}>
    <Compass size={22} />
    <span>Discover</span>
  </button>
  <div class="rail-spacer"></div>
  <button class="rail-tab" class:on={ui.userSettings} title="Settings" onclick={() => { ui.userPage = 'profile'; ui.userSettings = true; }}>
    <Settings size={22} />
    <span>Settings</span>
  </button>
  <button type="button" class="rail-user" title="Account" onclick={() => { ui.userPage = 'profile'; ui.userSettings = true; }}>
    <Avatar user={ui.me} size={32} />
    <span>
      <strong>{ui.me?.displayName || ui.me?.username || 'You'}</strong>
      <em>{status === 'dnd' ? 'Busy' : status === 'idle' ? 'Idle' : status === 'online' ? 'Online' : 'Offline'}</em>
    </span>
    <ChevronRight size={14} />
  </button>
</aside>
