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
    <img src="./look/moon.png" alt="" />
  </button>
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
