<script>
  import { Inbox, X, Check, ChevronDown } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import { ui, markAllRead, openMention, openServer, pickChannel, friendAct, showFriends } from '../state.svelte.js';

  let tab = $state('you');
  let dragging = $state(false);
  let drag = $state(0);
  const mentionCount = $derived(Object.values(ui.activity.channels || {}).reduce((sum, row) => sum + (Number(row?.mentions) || 0), 0));
  const badge = $derived(mentionCount + (ui.incoming || []).length);
  const panel = $derived(Math.max(0, Math.min(480, (ui.inboxOpen ? 420 : 0) + drag)));

  const unreadCount = $derived(Object.values(ui.activity.channels || {}).reduce((sum, row) => sum + (Number(row?.unread) || 0), 0) + Object.values(ui.activity.dms || {}).reduce((sum, row) => sum + (Number(row?.unread) || 0), 0));

  const unreadRows = $derived.by(() => {
    const rows = [];
    for (const [id, note] of Object.entries(ui.activity.channels || {})) {
      const server = (ui.servers || []).find((item) => item.id === note.serverId);
      const channel = note.serverId === ui.serverId ? (ui.channels || []).find((item) => item.id === id) : null;
      rows.push({
        id,
        serverId: note.serverId,
        serverName: server?.name || 'Server',
        channelName: channel?.name || 'channel',
        mentions: note.mentions || 0,
        unread: note.unread || 0,
      });
    }
    rows.sort((a, b) => (b.mentions - a.mentions) || (b.unread - a.unread));
    return rows;
  });

  function ago(iso) {
    const then = Date.parse(iso || '');
    if (!then) return '';
    const diff = Date.now() - then;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + 'm';
    if (diff < 86400000) return Math.round(diff / 3600000) + 'h';
    return Math.round(diff / 86400000) + 'd';
  }

  function count(n) {
    return n > 99 ? '99+' : String(n);
  }

  function pointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    dragging = true;
    drag = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.dataset.y = String(event.clientY);
  }

  function pointerMove(event) {
    if (!dragging) return;
    drag = event.clientY - Number(event.currentTarget.dataset.y || event.clientY);
  }

  function pointerUp(event) {
    if (!dragging) return;
    const moved = event.clientY - Number(event.currentTarget.dataset.y || event.clientY);
    dragging = false;
    drag = 0;
    if (moved > 48) ui.inboxOpen = true;
    else if (moved < -48) ui.inboxOpen = false;
    else if (Math.abs(moved) < 8) ui.inboxOpen = !ui.inboxOpen;
  }

  async function openUnread(row) {
    ui.inboxOpen = false;
    if (row.serverId && row.serverId !== ui.serverId) await openServer(row.serverId);
    const channel = (ui.channels || []).find((item) => item.id === row.id);
    if (channel) pickChannel(channel);
  }
</script>

<div class="inbox-shelf inbox-pop" class:open={ui.inboxOpen || panel > 8} class:dragging style="--panel:{panel}px">
  <div class="inbox-panel">
  <div class="inbox-h">
    <strong><Inbox size={16} /> Inbox</strong>
    <button class="btn icon" title="Close" onclick={() => (ui.inboxOpen = false)}><X size={16} /></button>
  </div>
  <div class="inbox-tabs">
    <button type="button" class:on={tab === 'you'} onclick={() => (tab = 'you')}>For you {#if ui.incoming.length}<em>{count(ui.incoming.length)}</em>{/if}</button>
    <button type="button" class:on={tab === 'mentions'} onclick={() => (tab = 'mentions')}>Mentions {#if mentionCount}<em>{count(mentionCount)}</em>{/if}</button>
    <button type="button" class:on={tab === 'unreads'} onclick={() => (tab = 'unreads')}>Unreads {#if unreadCount}<em>{count(unreadCount)}</em>{/if}</button>
  </div>
  <button type="button" class="inbox-read" onclick={markAllRead}><Check size={14} /> Mark all read</button>
  <div class="inbox-body">
    {#if tab === 'you'}
      {#each ui.incoming as person (person.id)}
        <article class="inbox-row">
          <Avatar user={person} size={32} />
          <div class="inbox-copy">
            <strong><Name user={person} /> sent you a friend request</strong>
            <span>Incoming request</span>
          </div>
          <button class="btn icon" title="Accept" onclick={() => friendAct('accept', { userId: person.id })}><Check size={14} /></button>
          <button class="btn icon" title="Ignore" onclick={() => friendAct('decline', { userId: person.id })}><X size={14} /></button>
        </article>
      {:else}
        <div class="empty-note">
          <strong>You're all caught up</strong>
          <p>Friend requests and other updates show up here.</p>
          <button class="btn brand empty-act" type="button" onclick={() => { ui.inboxOpen = false; showFriends('find'); }}>Find friends</button>
        </div>
      {/each}
    {:else if tab === 'mentions'}
      {#if mentionCount}
        <p class="inbox-total">{count(mentionCount)} mention{mentionCount === 1 ? '' : 's'}</p>
      {/if}
      {#each ui.mentions as row (row.id)}
        <button type="button" class="inbox-row" onclick={() => openMention(row)}>
          <Avatar user={row.author} size={32} dot={false} />
          <div class="inbox-copy">
            <strong><Name user={row.author} /></strong>
            <span>{row.serverName} · #{row.channelName} · {ago(row.at)}</span>
            <p>{row.content || 'Mentioned you'}</p>
          </div>
          <i class="inbox-dot"></i>
        </button>
      {:else}
        <div class="empty-note">
          <strong>{mentionCount ? count(mentionCount) + ' mentions' : "You're all caught up"}</strong>
          <p>{mentionCount ? 'Open a server to catch up on mentions.' : 'Mentions of you will show up here.'}</p>
        </div>
      {/each}
    {:else}
      {#each unreadRows as row (row.id)}
        <button type="button" class="inbox-row unread-row" onclick={() => openUnread(row)}>
          <div class="inbox-copy">
            <strong>{row.serverName} · #{row.channelName}</strong>
          </div>
          {#if row.mentions}<em class="pill-count">@{count(row.mentions)}</em>{/if}
          <em class="quiet-count">{count(row.unread)}</em>
        </button>
      {:else}
        <div class="empty-note">
          <strong>You're all caught up</strong>
          <p>Channels with new messages show up here.</p>
        </div>
      {/each}
    {/if}
  </div>
  </div>
  <button
    type="button"
    class="inbox-bar"
    aria-expanded={ui.inboxOpen}
    title={ui.inboxOpen ? 'Slide up to close inbox' : 'Slide down to open inbox'}
    onpointerdown={pointerDown}
    onpointermove={pointerMove}
    onpointerup={pointerUp}
    onpointercancel={pointerUp}
  >
    <i></i>
    <span>Inbox</span>
    {#if badge}<em>{count(badge)}</em>{/if}
    <ChevronDown size={14} />
  </button>
</div>
