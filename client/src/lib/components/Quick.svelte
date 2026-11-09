<script>
  import { MessageSquare, X, ChevronLeft, ExternalLink } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Attachment from './Attachment.svelte';
  import { ui, openQuick, closeQuick, openDm, loadDms, toast } from '../state.svelte.js';
  import { api } from '../api.js';
  import { formatContent } from '../format.js';

  let messages = $state([]);
  let person = $state(null);
  let draft = $state('');
  let sending = $state(false);
  let loading = $state(false);
  let log = $state(null);
  let dock = $state(null);
  let follow = true;
  let dragging = $state(false);
  let serial = 0;
  let pos = $state(readPlace());

  function readPlace() {
    try {
      const saved = JSON.parse(localStorage.getItem('nebula-quick-pos') || 'null');
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.w)) return saved;
    } catch (_) {}
    return null;
  }

  const dockStyle = $derived(pos ? `left:${pos.x}px;top:${pos.y}px;right:auto;bottom:auto;width:${pos.w}px;` : '');

  const who = $derived(person && ui.quickUser && String(person.id) === String(ui.quickUser.id) ? { ...ui.quickUser, ...person } : ui.quickUser);
  const unread = $derived(Object.values(ui.activity.dms || {}).reduce((sum, row) => sum + (Number(row?.unread) || 0), 0));
  const hidden = $derived(ui.mode === 'dm' && ui.dmUser && ui.quickUser && String(ui.dmUser.id) === String(ui.quickUser.id));
  const rows = $derived((ui.dms || []).filter((dm) => dm.other));
  const emoji = $derived.by(() => {
    const map = new Map();
    for (const row of ui.emoji || []) if (row?.name) map.set(row.name, row);
    for (const pack of ui.packs || []) for (const row of pack.emoji || []) if (row?.name) map.set(row.name, row);
    return [...map.values()];
  });
  const stickers = $derived.by(() => {
    const map = new Map();
    for (const row of ui.stickers || []) if (row?.name) map.set(row.name, row);
    for (const pack of ui.packs || []) for (const row of pack.stickers || []) if (row?.name) map.set(row.name, row);
    return [...map.values()];
  });
  const names = $derived.by(() => {
    const list = [];
    for (const person of [ui.me, who]) {
      if (!person) continue;
      if (person.username) list.push(person.username);
      if (person.displayName) list.push(person.displayName);
      for (const alias of person.aliases || []) if (alias) list.push(alias);
    }
    return list;
  });

  function time(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return clock;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + clock;
  }

  function textOf(msg) {
    return String(msg?.content || '').trim();
  }

  function onScroll(event) {
    const node = event.currentTarget;
    follow = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }

  async function refresh(id, full) {
    const mine = ++serial;
    const after = !full && messages.length ? messages[messages.length - 1]?.id : '';
    const query = full || !after ? '?all=1' : '?after=' + encodeURIComponent(after);
    const data = await api('/api/dms/' + encodeURIComponent(id) + '/messages' + query);
    if (mine !== serial || !ui.quickUser || String(ui.quickUser.id) !== String(id)) return;
    const incoming = data.messages || [];
    if (full || !after || data.mode !== 'delta') {
      messages = incoming;
    } else if (incoming.length) {
      const seen = new Set(messages.map((msg) => msg.id));
      messages = [...messages, ...incoming.filter((msg) => msg && !seen.has(msg.id))];
    }
    if (data.other) person = data.other;
    loading = false;
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button')) return;
    const node = dock;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = rect.left;
    const originY = rect.top;
    const width = rect.width;
    dragging = true;
    const move = (e) => {
      const maxX = Math.max(8, window.innerWidth - width - 8);
      const maxY = Math.max(8, window.innerHeight - 56);
      pos = {
        x: Math.min(maxX, Math.max(8, originX + (e.clientX - startX))),
        y: Math.min(maxY, Math.max(8, originY + (e.clientY - startY))),
        w: width,
      };
    };
    const up = () => {
      dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem('nebula-quick-pos', JSON.stringify(pos)); } catch (_) {}
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    event.preventDefault();
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
      loading = true;
    }
    if (!id) return;
    let stop = false;
    let timer = 0;
    const tick = async (full) => {
      if (stop) return;
      try { await refresh(id, full); } catch (_) { loading = false; }
      if (!stop) timer = setTimeout(() => tick(false), 2500);
    };
    tick(true);
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
    <aside class="quick-dock" class:dragging bind:this={dock} style={dockStyle}>
      <header onpointerdown={startDrag}>
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
          {#if loading && !messages.length}
            <p class="quick-empty">Loading history…</p>
          {:else if !messages.length}
            <p class="quick-empty">This is the start of your conversation.</p>
          {/if}
          {#each messages as msg (msg.id)}
            {@const mine = msg.author?.id === ui.me?.id}
            {@const text = textOf(msg)}
            <div class="qbubble" class:mine class:theirs={!mine}>
              {#if text}<div class="quick-text">{@html formatContent(text, emoji, stickers, names)}</div>{/if}
              {#if msg.files?.length}
                <div class="quick-files">
                  {#each msg.files as file}
                    <Attachment {file} />
                  {/each}
                </div>
              {/if}
              {#if !text && !msg.files?.length && msg.poll?.question}<p>{msg.poll.question}</p>{/if}
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
