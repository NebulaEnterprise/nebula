<script>
  import { MessageSquare, X, ChevronLeft, ExternalLink } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import { ui, openQuick, closeQuick, openDm, loadDms, toast } from '../state.svelte.js';
  import { api } from '../api.js';

  let messages = $state([]);
  let person = $state(null);
  let draft = $state('');
  let sending = $state(false);
  let log = $state(null);
  let follow = true;
  let serial = 0;

  const who = $derived(person && ui.quickUser && String(person.id) === String(ui.quickUser.id) ? { ...ui.quickUser, ...person } : ui.quickUser);
  const unread = $derived(Object.values(ui.activity.dms || {}).reduce((sum, row) => sum + (Number(row?.unread) || 0), 0));
  const hidden = $derived(ui.mode === 'dm' && ui.dmUser && ui.quickUser && String(ui.dmUser.id) === String(ui.quickUser.id));
  const rows = $derived((ui.dms || []).filter((dm) => dm.other));

  function time(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function body(msg) {
    const text = String(msg?.content || '').trim();
    if (text) return text;
    if (msg?.poll?.question) return 'Poll: ' + msg.poll.question;
    const count = Array.isArray(msg?.files) ? msg.files.length : 0;
    if (count === 1) return 'Sent a file';
    if (count > 1) return 'Sent ' + count + ' files';
    return '';
  }

  function onScroll(event) {
    const node = event.currentTarget;
    follow = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }

  async function refresh(id) {
    const mine = ++serial;
    const data = await api('/api/dms/' + encodeURIComponent(id) + '/messages');
    if (mine !== serial || !ui.quickUser || String(ui.quickUser.id) !== String(id)) return;
    messages = data.messages || [];
    if (data.other) person = data.other;
  }

  let openId = '';

  $effect(() => {
    const id = (ui.quickOpen && ui.quickUser?.id) || '';
    if (id !== openId) {
      openId = id;
      draft = '';
      follow = true;
      messages = [];
      person = null;
    }
    if (!id) return;
    let stop = false;
    let timer = 0;
    const tick = async () => {
      if (stop) return;
      try { await refresh(id); } catch (_) {}
      if (!stop) timer = setTimeout(tick, 2500);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  });

  $effect(() => {
    messages.length;
    messages[messages.length - 1]?.id;
    if (!follow || !log) return;
    log.scrollTop = log.scrollHeight;
  });

  async function send() {
    const content = draft.trim();
    const user = ui.quickUser;
    if (!content || !user?.id || sending) return;
    sending = true;
    draft = '';
    try {
      const data = await api('/api/dms/' + encodeURIComponent(user.id) + '/messages', { method: 'POST', body: { content } });
      if (data.message) messages = [...messages.filter((msg) => msg.id !== data.message.id), data.message];
      follow = true;
      loadDms();
    } catch (err) {
      draft = content;
      toast(err.message || 'Could not send');
    } finally {
      sending = false;
    }
  }

  function onKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  async function openFull() {
    const user = ui.quickUser;
    if (!user) return;
    closeQuick();
    await openDm(user);
  }
</script>

{#if ui.me && !hidden}
  {#if !ui.quickOpen}
    <button class="quick-pill" title="Messages" onclick={() => (ui.quickOpen = true)}>
      <MessageSquare size={16} />
      Messages
      {#if unread}<em>{unread > 99 ? '99+' : unread}</em>{/if}
    </button>
  {:else}
    <aside class="quick-dock">
      <header>
        {#if ui.quickUser}
          <button class="icon" title="All messages" onclick={() => (ui.quickUser = null)}><ChevronLeft size={16} /></button>
          <Avatar user={who} size={28} />
          <strong>{who.displayName || who.username}</strong>
          <button class="icon" title="Open conversation" onclick={openFull}><ExternalLink size={15} /></button>
        {:else}
          <MessageSquare size={16} />
          <strong>Messages</strong>
          {#if unread}<em>{unread > 99 ? '99+' : unread}</em>{/if}
        {/if}
        <button class="icon" title="Hide" onclick={closeQuick}><X size={16} /></button>
      </header>
      {#if ui.quickUser}
        <div class="quick-log" bind:this={log} onscroll={onScroll}>
          {#if !messages.length}
            <p class="quick-empty">This is the start of your conversation.</p>
          {/if}
          {#each messages as msg (msg.id)}
            {@const mine = msg.author?.id === ui.me?.id}
            <div class="qbubble" class:mine class:theirs={!mine}>
              <p>{body(msg)}</p>
              <time>{time(msg.createdAt)}</time>
            </div>
          {/each}
        </div>
        <form class="quick-compose" onsubmit={(event) => { event.preventDefault(); send(); }}>
          <input bind:value={draft} maxlength="2000" placeholder={'Message @' + (who?.username || '')} onkeydown={onKey} />
          <button class="send" type="submit" disabled={sending || !draft.trim()}>Send</button>
        </form>
      {:else}
        <div class="quick-list">
          {#each rows as dm (dm.id)}
            {@const note = ui.activity.dms[dm.other.id]}
            <button class="quick-person" class:unread={!!note} onclick={() => openQuick(dm.other)}>
              <Avatar user={dm.other} size={32} />
              <span>
                <strong>{dm.other.displayName || dm.other.username}</strong>
                <em>{dm.preview || 'No messages yet'}</em>
              </span>
              {#if note}<i>{note.unread > 99 ? '99+' : note.unread}</i>{/if}
            </button>
          {/each}
          {#if !rows.length}<p class="quick-empty">No direct messages yet.</p>{/if}
        </div>
      {/if}
    </aside>
  {/if}
{/if}
