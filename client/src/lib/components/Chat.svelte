<script>
  import { Hash, Smile } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import { ui, sendMessage, sendSticker, openPopout, noteTyping, refreshTyping, typingLine } from '../state.svelte.js';
  import { formatContent } from '../format.js';

  const channel = $derived(ui.channels.find((c) => c.id === ui.channelId));
  const locked = $derived(!!(ui.onboarding && ui.onboarding.mustFinish));

  $effect(() => {
    ui.mode;
    ui.channelId;
    ui.dmUser?.id;
    refreshTyping();
    const timer = setInterval(refreshTyping, 1500);
    return () => clearInterval(timer);
  });

  function liveAuthor(author) {
    if (!author) return author;
    const live = ui.members.find((m) => m.id === author.id)
      || (ui.me?.id === author.id ? ui.me : null)
      || (ui.dmUser?.id === author.id ? ui.dmUser : null);
    return live ? { ...author, nameEffect: live.nameEffect || '', displayName: live.nick || live.displayName || author.displayName } : author;
  }

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
<div class="messages">
  {#if !ui.messages.length}
    <div class="welcome">
      <h2>{ui.mode === 'dm' ? (ui.dmUser?.displayName || 'Direct message') : '#' + (channel?.name || 'channel')}</h2>
      <p>{ui.mode === 'dm' ? 'This is the start of your conversation.' : 'This is the start of the channel. Say hi.'}</p>
    </div>
  {/if}
  {#each ui.messages as msg}
    <article class="msg">
      <button type="button" onclick={(e) => openPopout(msg.author, e.clientX, e.clientY)}>
        <Avatar user={msg.author} size={40} dot={false} />
      </button>
      <div class="msg-body">
        <div class="msg-head">
          <strong><Name user={liveAuthor(msg.author)} color={msg.author?.accentColor || 'white'} /></strong>
          <time>{time(msg.createdAt)}</time>
        </div>
        <div class="msg-content">{@html formatContent(msg.content, ui.emoji, ui.stickers)}</div>
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
  {#if ui.stickersOpen}
    <div class="sticker-pop">
      {#if !ui.stickers.length}<p class="hint">No stickers on this server yet.</p>{/if}
      {#each ui.stickers as s}
        <button type="button" onclick={() => sendSticker(s.name)}><img src={s.url} alt={s.name} /></button>
      {/each}
    </div>
  {/if}
  {#if typingLine(ui.typers)}<p class="typing">{typingLine(ui.typers)}</p>{/if}
  <form class="composer" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
    {#if ui.mode === 'chat'}
      <button type="button" class="btn icon" title="Stickers" onclick={() => (ui.stickersOpen = !ui.stickersOpen)}><Smile size={18} /></button>
    {/if}
    <input
      bind:value={ui.composer}
      oninput={noteTyping}
      maxlength="2000"
      disabled={locked}
      placeholder={locked ? 'Finish onboarding before you chat' : ui.mode === 'dm' ? 'Message @' + (ui.dmUser?.username || '') : 'Message #' + (channel?.name || 'channel')}
    />
  </form>
</div>
