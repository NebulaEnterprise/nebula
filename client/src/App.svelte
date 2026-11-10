<script>
  import { onMount } from 'svelte';
  import { UserRound, Flag } from '@lucide/svelte';
  import { ui, boot, askSiteAccess, copyText, staffReport, applySiteTitle, openPopout, muteRoom, roomMuted, togglePin, closeConversation, pinnedChats, developerMode } from './lib/state.svelte.js';
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

  $effect(() => {
    const call = ui.incomingCall;
    if (!call) return;
    const at = Number(call.at) || Date.now();
    const wait = Math.max(0, 22000 - (Date.now() - at));
    const id = call.id;
    const timer = setTimeout(() => {
      if (ui.incomingCall && ui.incomingCall.id === id) ui.incomingCall = null;
    }, wait);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    boot();
    const vv = window.visualViewport;
    const fitKeyboard = () => {
      const phone = window.matchMedia('(max-width: 900px)').matches;
      const root = document.documentElement;
      const app = document.getElementById('app');
      if (!phone || !vv || !app) {
        root.classList.remove('kb');
        if (app) {
          app.style.removeProperty('height');
          app.style.removeProperty('transform');
        }
        return;
      }
      const height = Math.round(vv.height);
      const offset = Math.round(vv.offsetTop);
      const overlap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      app.style.height = height + 'px';
      app.style.transform = offset ? 'translateY(' + offset + 'px)' : 'none';
      root.classList.toggle('kb', overlap > 60);
    };
    fitKeyboard();
    vv?.addEventListener('resize', fitKeyboard);
    vv?.addEventListener('scroll', fitKeyboard);
    window.addEventListener('resize', fitKeyboard);
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.switcher = !ui.switcher;
        return;
      }
      if (e.key !== 'Escape') return;
      if (ui.dialog?.kind === 'leave') { ui.dialog = null; return; }
      ui.switcher = false;
      ui.menuOpen = false;
      ui.popout = null;
      ui.picker = '';
      ui.attachOpen = false;
      ui.dmMenu = null;
      ui.memberMenu = null;
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
      if (!inside('.dm-menu')) ui.dmMenu = null;
      if (!inside('.member-menu')) ui.memberMenu = null;
      if (!inside('.inbox-pop') && !inside('.inbox-btn')) ui.inboxOpen = false;
    };
    const onGesture = () => askSiteAccess();
    const onLink = (e) => {
      const node = e.target instanceof Element ? e.target : null;
      const link = node && node.closest('a.msg-link');
      if (!link) return;
      const url = link.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(url)) return;
      e.preventDefault();
      e.stopPropagation();
      ui.dialog = { kind: 'leave', url };
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    window.addEventListener('click', onLink, true);
    window.addEventListener('auxclick', onLink, true);
    window.addEventListener('pointerdown', onGesture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
      window.removeEventListener('click', onLink, true);
      window.removeEventListener('auxclick', onLink, true);
      window.removeEventListener('pointerdown', onGesture);
      vv?.removeEventListener('resize', fitKeyboard);
      vv?.removeEventListener('scroll', fitKeyboard);
      window.removeEventListener('resize', fitKeyboard);
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
  <div class="shell" class:phone-browse={ui.phone === 'browse'} class:phone-chat={ui.phone === 'chat'} class:phone-people={ui.phone === 'people'}>
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
  {#if ui.switcher}<Switcher />{/if}
  {#if ui.popout}<Popout />{/if}
  {#if ui.userSettings}<UserSettings />{/if}
  {#if ui.serverSettings}<ServerSettings />{/if}
  {#if ui.dialog}<Dialogs />{/if}
{/if}
{#if ui.toast}<div class="toast">{ui.toast}</div>{/if}
{#if ui.dmMenu}
  {@const person = ui.dmMenu.user}
  {@const pinKey = 'dm:' + person?.id}
  <div class="msg-menu dm-menu" style="left:{ui.dmMenu.x}px;top:{ui.dmMenu.y}px">
    <button type="button" onclick={() => { openPopout(person, ui.dmMenu.x, ui.dmMenu.y); ui.dmMenu = null; }}>View Profile</button>
    <button type="button" onclick={() => (ui.dmMenu = { ...ui.dmMenu, notify: !ui.dmMenu.notify })}>Notifications</button>
    {#if ui.dmMenu.notify}
      <button type="button" onclick={() => { muteRoom(pinKey, 15 * 60 * 1000); ui.dmMenu = null; }}>For 15 minutes</button>
      <button type="button" onclick={() => { muteRoom(pinKey, 60 * 60 * 1000); ui.dmMenu = null; }}>For 1 hour</button>
      <button type="button" onclick={() => { muteRoom(pinKey, 8 * 60 * 60 * 1000); ui.dmMenu = null; }}>For 8 hours</button>
      <button type="button" onclick={() => { muteRoom(pinKey, 24 * 60 * 60 * 1000); ui.dmMenu = null; }}>For 24 hours</button>
      <button type="button" onclick={() => { muteRoom(pinKey, 'forever'); ui.dmMenu = null; }}>Until I turn it back on</button>
      {#if roomMuted(pinKey)}<button type="button" onclick={() => { muteRoom(pinKey, 0); ui.dmMenu = null; }}>Unmute</button>{/if}
    {/if}
    <button type="button" onclick={() => togglePin(pinKey)}>{pinnedChats().includes(pinKey) ? 'Unpin DM' : 'Pin DM'}</button>
    <button type="button" onclick={() => { const row = (ui.dms || []).find((dm) => String(dm.other?.id) === String(person?.id)); closeConversation(pinKey, row && row.lastId); ui.dmMenu = null; }}>Close chat</button>
  </div>
{/if}
{#if ui.memberMenu}
  {@const person = ui.memberMenu.user}
  <div class="msg-menu member-menu" style="left:{ui.memberMenu.x}px;top:{ui.memberMenu.y}px">
    <button type="button" onclick={() => { openPopout(person, ui.memberMenu.x, ui.memberMenu.y); ui.memberMenu = null; }}><UserRound size={16} /> Profile</button>
    {#if person && String(person.id) !== String(ui.me?.id)}
      <button type="button" class="danger" onclick={() => { ui.dialog = { kind: 'user-report', user: person }; ui.memberMenu = null; }}><Flag size={16} /> Report</button>
    {/if}
    {#if developerMode()}
      <button type="button" onclick={() => copyText(person?.id, 'user ID')}>Copy User ID</button>
    {/if}
  </div>
{/if}
{#if ui.idMenu}
  <div class="msg-menu id-menu" style="left:{ui.idMenu.x}px;top:{ui.idMenu.y}px">
    {#each ui.idMenu.items as item}
      <button type="button" onclick={() => copyText(item.value, item.label)}>Copy {item.label}</button>
    {/each}
  </div>
{/if}
{#if ui.reportPopup}
  <div class="report-slide">
    <article>
      <strong>New report</strong>
      <p>@{ui.reportPopup.target?.username || 'someone'} was reported{ui.reportPopup.text ? ': ' + ui.reportPopup.text : ''}.</p>
      <div>
        <button type="button" onclick={() => { if (ui.me) localStorage.setItem('nebula-report-seen:' + ui.me.id, ui.reportPopup.id); ui.userPage = 'admin'; ui.userSettings = true; ui.reportPopup = null; }}>View</button>
        <button type="button" onclick={() => staffReport(ui.reportPopup.id, 'close')}>Dismiss</button>
      </div>
    </article>
  </div>
{/if}
