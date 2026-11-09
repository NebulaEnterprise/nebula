<script>
  import { onMount } from 'svelte';
  import { ui, boot, askSiteAccess } from './lib/state.svelte.js';
  import Auth from './lib/components/Auth.svelte';
  import Rail from './lib/components/Rail.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Chat from './lib/components/Chat.svelte';
  import Members from './lib/components/Members.svelte';
  import Friends from './lib/components/Friends.svelte';
  import Popout from './lib/components/Popout.svelte';
  import UserSettings from './lib/components/UserSettings.svelte';
  import ServerSettings from './lib/components/ServerSettings.svelte';
  import Dialogs from './lib/components/Dialogs.svelte';
  import Quick from './lib/components/Quick.svelte';

  onMount(() => {
    boot();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      ui.menuOpen = false;
      ui.popout = null;
      ui.picker = '';
      ui.attachOpen = false;
    };
    const onClick = (e) => {
      const node = e.target instanceof Element ? e.target : null;
      if (node && !node.isConnected) return;
      const inside = (selector) => !!(node && node.closest(selector));
      if (!inside('.menu') && !inside('.title')) ui.menuOpen = false;
      if (!inside('.pop') && !inside('.member') && !inside('.msg')) ui.popout = null;
      if (!inside('.picker') && !inside('.picker-toggle') && !inside('.react-picker')) ui.picker = '';
      if (!inside('.attach-menu') && !inside('.attach-toggle')) ui.attachOpen = false;
    };
    const onGesture = () => askSiteAccess();
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    window.addEventListener('pointerdown', onGesture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
      window.removeEventListener('pointerdown', onGesture);
    };
  });
</script>

{#if ui.booting}
  <div class="boot">Opening Nebula…</div>
{:else if !ui.me}
  <Auth />
{:else}
  <div class="shell">
    <Rail />
    <Sidebar />
    <main class="main">
      {#if ui.mode === 'friends' || ui.mode === 'add'}
        <Friends />
      {:else}
        <Chat />
      {/if}
    </main>
    {#if ui.mode === 'chat'}
      <Members />
    {/if}
  </div>
  <Quick />
  {#if ui.popout}<Popout />{/if}
  {#if ui.userSettings}<UserSettings />{/if}
  {#if ui.serverSettings}<ServerSettings />{/if}
  {#if ui.dialog}<Dialogs />{/if}
{/if}
{#if ui.toast}<div class="toast">{ui.toast}</div>{/if}
