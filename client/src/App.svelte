<script>
  import { onMount } from 'svelte';
  import { ui, boot, askSiteAccess, copyText, staffReport, applySiteTitle } from './lib/state.svelte.js';
  import { answerCall, declineCall } from './lib/voice.js';
  import Auth from './lib/components/Auth.svelte';
  import Home from './lib/components/Home.svelte';
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
  import Switcher from './lib/components/Switcher.svelte';

  $effect(() => {
    ui.activity;
    ui.incoming;
    ui.missedCalls;
    applySiteTitle();
  });

  onMount(() => {
    boot();
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.switcher = !ui.switcher;
        return;
      }
      if (e.key !== 'Escape') return;
      ui.switcher = false;
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
      if (!inside('.id-menu')) ui.idMenu = null;
      if (!inside('.inbox-pop') && !inside('.inbox-btn')) ui.inboxOpen = false;
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
  {#if ui.addingAccount || ui.authGate}
    <Auth />
  {:else}
    <Home />
  {/if}
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
    {#if (ui.mode === 'chat' || ui.mode === 'thread') && ui.showMembers !== false}
      <Members />
    {/if}
  </div>
  <Quick />
  {#if ui.incomingCall}
    <div class="call-alert" role="dialog">
      <strong>{ui.incomingCall.from?.displayName || ui.incomingCall.from?.username || 'Someone'} is calling</strong>
      <button type="button" class="accept" onclick={answerCall}>Accept</button>
      <button type="button" class="decline" onclick={declineCall}>Decline</button>
    </div>
  {/if}
  {#if ui.switcher}<Switcher />{/if}
  {#if ui.popout}<Popout />{/if}
  {#if ui.userSettings}<UserSettings />{/if}
  {#if ui.serverSettings}<ServerSettings />{/if}
  {#if ui.dialog}<Dialogs />{/if}
{/if}
{#if ui.toast}<div class="toast">{ui.toast}</div>{/if}
{#if ui.idMenu}
  <div class="msg-menu id-menu" style="left:{ui.idMenu.x}px;top:{ui.idMenu.y}px">
    {#each ui.idMenu.items as item}
      <button type="button" onclick={() => copyText(item.value, item.label)}>Copy {item.label}</button>
    {/each}
  </div>
{/if}
{#if ui.reportPopup}
  <div class="overlay">
    <div class="sheet report-alert" role="dialog">
      <div class="sheet-h"><h3>New report</h3></div>
      <div class="body">
        <p><strong>@{ui.reportPopup.target?.username || 'someone'}</strong> was reported.</p>
        {#if ui.reportPopup.text}<p>{ui.reportPopup.text}</p>{/if}
        <p class="hint">Sent by @{ui.reportPopup.reporter?.username || 'someone'}. Status: {ui.reportPopup.status}</p>
        <div class="group-actions">
          <button class="btn" type="button" onclick={() => { if (ui.me) localStorage.setItem('nebula-report-seen:' + ui.me.id, ui.reportPopup.id); ui.userPage = 'admin'; ui.userSettings = true; ui.reportPopup = null; }}>View</button>
          <button class="btn" type="button" onclick={() => staffReport(ui.reportPopup.id, 'handle')}>Handle</button>
          <button class="btn" type="button" onclick={() => staffReport(ui.reportPopup.id, 'close')}>Close</button>
        </div>
      </div>
    </div>
  </div>
{/if}
