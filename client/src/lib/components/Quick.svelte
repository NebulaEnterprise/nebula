<script>
  import { MessageSquare, X, ChevronLeft, ExternalLink, Phone, EyeOff } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Attachment from './Attachment.svelte';
  import { ui, openQuick, closeQuick, openDm, loadDms, toast, deliveryTone, relation, publishBox } from '../state.svelte.js';
  import { openSeal, sealText } from '../seal.js';
  import { api } from '../api.js';
  import { formatContent, emojiScale } from '../format.js';
  import { startCall } from '../voice.js';

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
  const quickTyping = $derived(!!(ui.quickUser && ui.dmTyping && ui.dmTyping[ui.quickUser.id]));
  let typeToken = 0;

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
  const hidden = $derived(ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'friends' || ui.mode === 'add');
  const rows = $derived([...(ui.dms || [])].filter((dm) => dm.other).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)));
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
    const incoming = await revealQuick(data.messages || []);
    const locals = messages.filter((msg) => String(msg.id || '').startsWith('local-'));
    const withLocal = (rows) => {
      if (!locals.length) return rows;
      const seen = new Set(rows.map((msg) => msg.id));
      return [...rows, ...locals.filter((msg) => !seen.has(msg.id))];
    };
    if (full || !after || data.mode !== 'delta') {
      messages = withLocal(incoming);
    } else if (incoming.length) {
      const seen = new Set(messages.map((msg) => msg.id));
      messages = withLocal([...messages.filter((msg) => !String(msg.id || '').startsWith('local-')), ...incoming.filter((msg) => msg && !seen.has(msg.id))]);
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
  let shownBlocked = $state({});

  function quickBlocked(msg) {
    if (!msg || msg.kind === 'clyde') return false;
    const id = msg.author?.id;
    if (!id || (ui.me && String(id) === String(ui.me.id))) return false;
    return relation(id) === 'blocked';
  }

  function toggleQuickBlocked(key) {
    shownBlocked = { ...shownBlocked, [key]: !shownBlocked[key] };
  }

  const quickRows = $derived.by(() => {
    const list = messages || [];
    const open = shownBlocked;
    const out = [];
    let i = 0;
    while (i < list.length) {
      if (!quickBlocked(list[i])) {
        out.push({ kind: 'msg', key: list[i].id, msg: list[i] });
        i += 1;
        continue;
      }
      const start = i;
      while (i < list.length && quickBlocked(list[i])) i += 1;
      const key = 'blocked-' + list[start].id;
      out.push({ kind: 'blocked', key, count: i - start, open: !!open[key] });
      if (open[key]) {
        for (let j = start; j < i; j += 1) out.push({ kind: 'msg', key: list[j].id, msg: list[j] });
      }
    }
    return out;
  });

  $effect(() => {
    const id = (ui.quickOpen && ui.quickUser?.id) || '';
    if (id !== openId) {
      openId = id;
      draft = '';
      follow = true;
      shownBlocked = {};
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
      if (!stop) timer = setTimeout(() => tick(false), 5000);
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

  async function revealQuick(list) {
    const out = [];
    for (const msg of list || []) {
      if (!msg?.seal || !ui.me?.id) { out.push(msg); continue; }
      try { out.push({ ...msg, content: await openSeal(msg.seal, ui.me.id), locked: false }); }
      catch { out.push({ ...msg, content: '', locked: true }); }
    }
    return out;
  }

  function undeliveredText(tone) {
    if (tone === 'friends') return 'Your message could not be delivered. Send a friend request first and start the conversation once they\'ve accepted.';
    if (tone === 'links') return 'Your message could not be delivered. They are not accepting links from you.';
    if (tone === 'media') return 'Your message could not be delivered. They are not accepting photos, videos, or files from you.';
    return 'Your message could not be delivered.';
  }

  async function send() {
    const content = draft.trim();
    const user = who;
    if (!content || !user?.id || sending) return;
    sending = true;
    draft = '';
    const typingToken = stopQuick(user.id, false);
    const tempId = 'local-' + Math.random().toString(36).slice(2, 10);
    messages = [...messages, {
      id: tempId,
      createdAt: new Date().toISOString(),
      author: ui.me,
      content,
    }];
    follow = true;
    try {
      await publishBox();
      if (!user.boxKey || !ui.me?.boxKey) throw new Error((user.displayName || user.username || 'They') + ' has to open Nebula once before this message can be encrypted.');
      const seal = await sealText(content, [{ id: ui.me.id, boxKey: ui.me.boxKey }, { id: user.id, boxKey: user.boxKey }]);
      const data = await api('/api/dms/' + encodeURIComponent(user.id) + '/messages', { method: 'POST', body: { seal, typingToken } });
      const opened = data.message ? (await revealQuick([data.message]))[0] : null;
      if (opened) messages = [...messages.filter((msg) => msg.id !== tempId && msg.id !== opened.id), opened];
      loadDms();
    } catch (err) {
      const tone = deliveryTone(err.message);
      if (tone) {
        messages = [...messages, {
          id: 'local-clyde-' + Date.now(),
          kind: 'clyde',
          createdAt: new Date().toISOString(),
          content: undeliveredText(tone),
        }];
        return;
      }
      messages = messages.filter((msg) => msg.id !== tempId);
      draft = content;
      toast(err.message || 'Could not send');
    } finally {
      sending = false;
    }
  }

  let quickLive = false;
  let quickAt = 0;
  let quickTimer = 0;

  function stopQuick(id, notify = false) {
    clearTimeout(quickTimer);
    quickTimer = 0;
    const token = ++typeToken;
    if (notify && quickLive && id) api('/api/typing', { method: 'POST', body: { dmUserId: id, token, stop: true } }).catch(() => {});
    quickLive = false;
    quickAt = 0;
    return token;
  }

  function pokeQuick(id) {
    if (!id) return;
    const now = Date.now();
    if (quickLive && now - quickAt < 8000) return;
    quickAt = now;
    quickLive = true;
    const token = ++typeToken;
    api('/api/typing', { method: 'POST', body: { dmUserId: id, token } }).catch(() => {});
  }

  function markQuick(id) {
    if (!id || !draft.trim()) return;
    pokeQuick(id);
  }

  function onKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    const edits = event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete';
    if (!edits || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if ((event.key === 'Backspace' || event.key === 'Delete') && !draft.trim()) return;
    pokeQuick(ui.quickUser?.id);
  }

  $effect(() => {
    const id = ui.quickOpen && ui.quickUser?.id;
    return () => { if (id) stopQuick(id); };
  });

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
          <button class="icon" title="Call" onclick={() => startCall(who)}><Phone size={15} /></button>
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
          {#each quickRows as row (row.key)}
            {#if row.kind === 'blocked'}
              <button type="button" class="qbubble notice blocked-fold" onclick={() => toggleQuickBlocked(row.key)}>
                <EyeOff size={14} />
                {row.count} blocked {row.count === 1 ? 'message' : 'messages'} — {row.open ? 'Hide' : 'Show'}
              </button>
            {:else}
            {@const msg = row.msg}
            {@const mine = msg.author?.id === ui.me?.id}
            {@const text = textOf(msg)}
            <div class="qbubble" class:mine class:theirs={!mine} class:notice={msg.kind === 'clyde'}>
              {#if msg.locked}<div class="quick-text">Encrypted message</div>
              {:else if text}<div class="quick-text" class:jumbo={emojiScale(text) === 'jumbo'} class:jumbo-mid={emojiScale(text) === 'jumbo-mid'} class:jumbo-sm={emojiScale(text) === 'jumbo-sm'}>{@html formatContent(text, emoji, stickers, names)}</div>{/if}
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
            {/if}
          {/each}
        </div>
        {#if quickTyping}
          <p class="quick-typing"><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span> <strong>{who.displayName || who.username}</strong> is typing...</p>
        {/if}
        <form class="quick-compose" onsubmit={(event) => { event.preventDefault(); send(); }}>
          <input bind:value={draft} maxlength="2000" placeholder={'Message @' + (who?.username || '')} onkeydown={onKey} oninput={() => markQuick(ui.quickUser?.id)} />
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
