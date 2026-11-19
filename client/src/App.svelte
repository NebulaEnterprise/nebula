<script>
  import { onMount } from 'svelte';
  import { UserRound, Flag, Hash, FolderPlus, Bell, Pencil, Trash2, MicOff, HeadphoneOff, MessageSquare, Clock } from '@lucide/svelte';
  import { ui, boot, askSiteAccess, copyText, staffReport, applySiteTitle, openPopout, muteRoom, roomMuted, togglePin, closeConversation, pinnedChats, developerMode, markChannelRead, deleteChannel, openVoiceRoom } from './lib/state.svelte.js';
  import { joinVoice } from './lib/voice.js';
  import Auth from './lib/components/Auth.svelte';
  import Home from './lib/components/Home.svelte';
  import Rail from './lib/components/Rail.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Chat from './lib/components/Chat.svelte';
  import Members from './lib/components/Members.svelte';
  import Friends from './lib/components/Friends.svelte';
  import ServersHome from './lib/components/ServersHome.svelte';
  import Discover from './lib/components/Discover.svelte';
  import Popout from './lib/components/Popout.svelte';
  import UserSettings from './lib/components/UserSettings.svelte';
  import ServerSettings from './lib/components/ServerSettings.svelte';
  import Dialogs from './lib/components/Dialogs.svelte';
  import Quick from './lib/components/Quick.svelte';
  import Switcher from './lib/components/Switcher.svelte';
  import DesktopChrome from './lib/components/DesktopChrome.svelte';

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
      if (!app.querySelector('.shell')) {
        app.style.removeProperty('height');
        app.style.removeProperty('transform');
        root.style.setProperty('--kb', '0px');
        root.classList.remove('kb');
        return;
      }
      if (vv.offsetTop > 1 || window.scrollY > 0) window.scrollTo(0, 0);
      const overlap = Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height));
      app.style.removeProperty('height');
      app.style.removeProperty('transform');
      root.style.setProperty('--kb', overlap + 'px');
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
      ui.channelMenu = null;
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
      if (!inside('.channel-menu')) ui.channelMenu = null;
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

<DesktopChrome />
{#if ui.booting}
  <div class="boot">Opening Nebula…</div>
{:else if !ui.me}
  {#if ui.addingAccount || ui.authGate}
    <Auth />
  {:else}
    <Home />
  {/if}
{:else}
  <div class="shell" class:directory={ui.mode === 'friends' || ui.mode === 'add' || ui.mode === 'servers' || ui.mode === 'discover'} class:phone-browse={ui.phone === 'browse'} class:phone-chat={ui.phone === 'chat'} class:phone-people={ui.phone === 'people'}>
    <Rail />
    <Sidebar />
    <main class="main">
      {#if ui.mode === 'friends' || ui.mode === 'add'}
        <Friends />
      {:else if ui.mode === 'servers'}
        <ServersHome />
      {:else if ui.mode === 'discover'}
        <Discover />
      {:else if ui.mode === 'messages'}
        <div class="pick-chat">
          <strong>Pick a conversation</strong>
          <p>Choose someone from Messages, or add a friend and say hi.</p>
        </div>
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
{#if ui.channelMenu}
  {@const menu = ui.channelMenu}
  <div class="msg-menu channel-menu" style="left:{menu.x}px;top:{menu.y}px">
    {#if menu.kind === 'blank'}
      {#if menu.canChannels}
        <button type="button" onclick={() => { ui.dialog = { kind: 'channel', categoryId: menu.categoryId || '' }; ui.channelMenu = null; }}><Hash size={16} /> Create channel</button>
      {/if}
      {#if menu.canServer}
        <button type="button" onclick={() => { ui.dialog = { kind: 'category' }; ui.channelMenu = null; }}><FolderPlus size={16} /> Create category</button>
      {/if}
    {:else if menu.kind === 'voice'}
      <button type="button" onclick={() => { joinVoice(menu.channel, { muted: true }); ui.channelMenu = null; }}><MicOff size={16} /> Join muted</button>
      <button type="button" onclick={() => { joinVoice(menu.channel, { deafened: true }); ui.channelMenu = null; }}><HeadphoneOff size={16} /> Join deafened</button>
      <button type="button" onclick={() => { const ch = menu.channel; ui.channelMenu = null; openVoiceRoom(ch).catch((err) => { ui.toast = err.message; }); }}><MessageSquare size={16} /> Open chat</button>
      <button type="button" onclick={() => { ui.dialog = { kind: 'voice-log', channel: menu.channel }; ui.channelMenu = null; }}><Clock size={16} /> Voice log</button>
      <button type="button" onclick={() => markChannelRead(menu.channel.id)}>Mark as read</button>
      <button type="button" onclick={() => { ui.dialog = { kind: 'channel-notify', channel: menu.channel }; ui.channelMenu = null; }}><Bell size={16} /> Notifications</button>
      {#if menu.canChannels}
        <button type="button" onclick={() => { ui.dialog = { kind: 'edit-channel', channel: menu.channel }; ui.channelMenu = null; }}><Pencil size={16} /> Edit channel</button>
        <button type="button" class="danger" onclick={() => deleteChannel(menu.channel).catch((err) => { ui.toast = err.message; })}><Trash2 size={16} /> Delete channel</button>
      {/if}
    {:else}
      <button type="button" onclick={() => markChannelRead(menu.channel.id)}>Mark as read</button>
      <button type="button" onclick={() => { ui.dialog = { kind: 'channel-notify', channel: menu.channel }; ui.channelMenu = null; }}><Bell size={16} /> Notifications</button>
      {#if menu.canChannels}
        <button type="button" onclick={() => { ui.dialog = { kind: 'edit-channel', channel: menu.channel }; ui.channelMenu = null; }}><Pencil size={16} /> Edit channel</button>
        <button type="button" class="danger" onclick={() => deleteChannel(menu.channel).catch((err) => { ui.toast = err.message; })}><Trash2 size={16} /> Delete channel</button>
      {/if}
    {/if}
    {#if developerMode() && menu.channel}
      <button type="button" onclick={() => copyText(menu.channel.id, 'channel ID')}>Copy Channel ID</button>
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
