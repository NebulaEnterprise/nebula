<script>
  import { Hash, Smile } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import Picker from './Picker.svelte';
  import { ui, sendMessage, openPopout, noteTyping, noteKeyDown, noteKeyUp, noteTypingBlur } from '../state.svelte.js';
  import { formatContent } from '../format.js';

  const channel = $derived(ui.channels.find((c) => c.id === ui.channelId));
  const locked = $derived(!!(ui.onboarding && ui.onboarding.mustFinish));
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

  function liveAuthor(author) {
    if (!author) return author;
    const member = ui.members.find((m) => m.id === author.id);
    const mine = author.id === ui.me?.id ? ui.me : null;
    const effect = mine?.nameEffect || author.nameEffect || member?.nameEffect || '';
    const colors = mine?.nameColors?.length
      ? mine.nameColors
      : (author.nameColors?.length ? author.nameColors : (member?.nameColors || []));
    return {
      ...author,
      username: mine?.username || author.username || member?.username,
      displayName: member?.nick || mine?.displayName || author.displayName || member?.displayName,
      nameEffect: effect,
      nameColors: colors,
      avatarUrl: mine?.avatarUrl || author.avatarUrl || member?.avatarUrl,
      avatarColor: mine?.avatarColor || author.avatarColor || member?.avatarColor,
    };
  }

  let box = $state(null);
  let follow = true;

  function trackScroll() {
    if (!box) return;
    follow = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  }

  $effect(() => {
    ui.messages.length;
    ui.messages[ui.messages.length - 1]?.id;
    ui.typers.length;
    if (!box || !follow) return;
    const node = box;
    queueMicrotask(() => {
      node.scrollTop = node.scrollHeight;
    });
  });

  function time(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
</script>

<div class="top">
  <Hash size={18} />
  <h2>{ui.mode === 'dm' ? (ui.dmUser?.displayName || ui.dmUser?.username || 'Message') : (channel?.name || 'channel')}</h2>
  <span class="topic">{ui.mode === 'dm' ? '@' + (ui.dmUser?.username || '') : (channel?.topic || '')}</span>
</div>
<div class="messages" bind:this={box} onscroll={trackScroll}>
  {#if !ui.messages.length}
    <div class="welcome">
      <h2>{ui.mode === 'dm' ? (ui.dmUser?.displayName || 'Direct message') : '#' + (channel?.name || 'channel')}</h2>
      <p>{ui.mode === 'dm' ? 'This is the start of your conversation.' : 'This is the start of the channel. Say hi.'}</p>
    </div>
  {/if}
  {#each ui.messages as msg (msg.id)}
    <article class="msg">
      <button type="button" onclick={(e) => openPopout(liveAuthor(msg.author), e.clientX, e.clientY)}>
        <Avatar user={liveAuthor(msg.author)} size={40} dot={false} />
      </button>
      <div class="msg-body">
        <div class="msg-head">
          <strong><Name user={liveAuthor(msg.author)} color={msg.author?.accentColor || 'white'} /></strong>
          <time>{time(msg.createdAt)}</time>
        </div>
        <div class="msg-content">{@html formatContent(msg.content, emoji, stickers)}</div>
      </div>
    </article>
  {/each}
</div>
<div class="composer-wrap">
  {#if ui.mode === 'chat' && ui.showLobby && ui.about}
    <div class="lobby">
      <strong>{ui.serverMeta?.name}</strong>
      <p>{ui.about}</p>
    </div>
  {/if}
  {#if ui.picker}
    <Picker />
  {/if}
  {#if ui.typers.length}
    <p class="typing">{ui.typers.map((person) => person.name).filter(Boolean).join(', ')} {ui.typers.length === 1 ? 'is typing...' : 'are typing...'}</p>
  {/if}
  <form class="composer" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
    <button type="button" class="btn icon picker-toggle" title="GIFs, stickers, and emoji" onclick={() => (ui.picker = ui.picker ? '' : 'emoji')}><Smile size={18} /></button>
    <input
      bind:value={ui.composer}
      onkeydown={noteKeyDown}
      onkeyup={noteKeyUp}
      oninput={noteTyping}
      onblur={noteTypingBlur}
      maxlength="2000"
      disabled={locked}
      placeholder={locked ? 'Finish onboarding before you chat' : ui.mode === 'dm' ? 'Message @' + (ui.dmUser?.username || '') : 'Message #' + (channel?.name || 'channel')}
    />
  </form>
</div>
