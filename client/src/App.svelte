<script>
  import { onMount } from 'svelte';
  import { ui, boot, unlockSound } from './lib/state.svelte.js';
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
      if (!e.target.closest?.('.menu') && !e.target.closest?.('.title')) ui.menuOpen = false;
      if (!e.target.closest?.('.pop') && !e.target.closest?.('.member') && !e.target.closest?.('.msg')) ui.popout = null;
      if (!e.target.closest?.('.picker') && !e.target.closest?.('.picker-toggle')) ui.picker = '';
      if (!e.target.closest?.('.attach-menu') && !e.target.closest?.('.attach-toggle')) ui.attachOpen = false;
    };
    const onGesture = () => unlockSound();
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
  {#if ui.popout}<Popout />{/if}
  {#if ui.userSettings}<UserSettings />{/if}
  {#if ui.serverSettings}<ServerSettings />{/if}
  {#if ui.dialog}<Dialogs />{/if}
{/if}
{#if ui.toast}<div class="toast">{ui.toast}</div>{/if}
