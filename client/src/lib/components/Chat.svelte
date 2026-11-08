<script>
  import { Hash, Plus, Smile, Sticker, FileUp, BarChart3, Trash2 } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import Picker from './Picker.svelte';
  import PollCard from './PollCard.svelte';
  import { ui, sendMessage, sendFiles, sendPoll, openPopout, noteTyping, noteKeyDown, noteKeyUp, noteTypingBlur } from '../state.svelte.js';
  import { formatContent } from '../format.js';
  import { fileUrl } from '../api.js';

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
  let filePick = $state(null);
  let uploading = $state(false);
  let pollOpen = $state(false);
  let pollQuestion = $state('');
  let pollAnswers = $state(['', '']);
  let pollHours = $state(24);
  let pollMulti = $state(false);

  function openPicker(tab) {
    ui.attachOpen = false;
    ui.picker = ui.picker === tab ? '' : tab;
  }

  async function onFiles(event) {
    const list = event.target.files;
    event.target.value = '';
    if (!list || !list.length) return;
    uploading = true;
    try { await sendFiles(list); }
    finally { uploading = false; }
  }

  function openPoll() {
    ui.attachOpen = false;
    pollQuestion = '';
    pollAnswers = ['', ''];
    pollHours = 24;
    pollMulti = false;
    pollOpen = true;
  }

  function postPoll() {
    const options = pollAnswers.map((text) => text.trim()).filter(Boolean);
    if (!pollQuestion.trim() || options.length < 2) return;
    sendPoll({ question: pollQuestion.trim(), options, hours: Number(pollHours), multi: pollMulti });
    pollOpen = false;
  }

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
        {#if msg.content}
          <div class="msg-content">{@html formatContent(msg.content, emoji, stickers)}</div>
        {/if}
        {#if msg.files?.length}
          <div class="msg-files">
            {#each msg.files as file}
              {#if file.kind === 'image'}
                <a href={fileUrl(file.url)} target="_blank" rel="noreferrer"><img class="file-img" src={fileUrl(file.url)} alt={file.name} /></a>
              {:else}
                <a class="file-chip" href={fileUrl(file.url)} target="_blank" rel="noreferrer">{file.name || 'File'}</a>
              {/if}
            {/each}
          </div>
        {/if}
        {#if msg.poll}
          <PollCard poll={msg.poll} messageId={msg.id} />
        {/if}
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
    <button type="button" class="btn icon attach-toggle" title="Attach" disabled={locked || uploading} onclick={() => { ui.attachOpen = !ui.attachOpen; ui.picker = ''; }}>
      <Plus size={20} />
    </button>
    {#if ui.attachOpen}
      <div class="attach-menu">
        <button type="button" onclick={() => filePick && filePick.click()}><FileUp size={16} /> {uploading ? 'Uploading…' : 'Upload a File'}</button>
        <button type="button" onclick={openPoll}><BarChart3 size={16} /> Create Poll</button>
      </div>
    {/if}
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
    <button type="button" class="btn icon picker-toggle gif-btn" title="GIF" onclick={() => openPicker('gif')}>GIF</button>
    <button type="button" class="btn icon picker-toggle" title="Stickers" onclick={() => openPicker('sticker')}><Sticker size={18} /></button>
    <button type="button" class="btn icon picker-toggle" title="Emoji" onclick={() => openPicker('emoji')}><Smile size={18} /></button>
    <input bind:this={filePick} class="file-input" type="file" multiple onchange={onFiles} />
  </form>
  {#if pollOpen}
    <div class="poll-overlay" role="presentation" onclick={() => (pollOpen = false)}>
      <div class="poll-sheet" role="dialog" onclick={(e) => e.stopPropagation()}>
        <div class="row">
          <h3>Create a Poll</h3>
          <button type="button" class="btn icon" onclick={() => (pollOpen = false)}>✕</button>
        </div>
        <div class="field">
          <label for="poll-q">Question</label>
          <input id="poll-q" bind:value={pollQuestion} maxlength="300" placeholder="What question do you want to ask?" />
        </div>
        <p class="label">Answers</p>
        {#each pollAnswers as answer, index}
          <div class="poll-answer">
            <input placeholder="Type your answer" maxlength="100" bind:value={pollAnswers[index]} />
            {#if pollAnswers.length > 2}
              <button type="button" class="btn icon" title="Remove" onclick={() => (pollAnswers = pollAnswers.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
            {/if}
          </div>
        {/each}
        {#if pollAnswers.length < 10}
          <button type="button" class="btn sm" onclick={() => (pollAnswers = [...pollAnswers, ''])}>+ Add another answer</button>
        {/if}
        <div class="field">
          <label for="poll-hours">Duration</label>
          <select id="poll-hours" bind:value={pollHours}>
            <option value={1}>1 hour</option>
            <option value={4}>4 hours</option>
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>7 days</option>
          </select>
        </div>
        <label class="check"><input type="checkbox" bind:checked={pollMulti} /> Allow multiple answers</label>
        <div class="actions">
          <button type="button" class="btn brand" disabled={!pollQuestion.trim() || pollAnswers.filter((text) => text.trim()).length < 2} onclick={postPoll}>Post</button>
        </div>
      </div>
    </div>
  {/if}
</div>
