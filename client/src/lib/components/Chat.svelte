<script>
  import { Hash, Plus, Smile, Sticker, FileUp, BarChart3, Trash2 } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import Picker from './Picker.svelte';
  import PollCard from './PollCard.svelte';
  import Attachment from './Attachment.svelte';
  import { ui, sendMessage, sendFiles, sendPoll, openPopout, noteTyping, noteKeyDown, noteKeyUp, noteTypingBlur, loadMembers } from '../state.svelte.js';
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
  const mentionNames = $derived.by(() => {
    const names = new Set();
    const add = (person) => {
      if (!person) return;
      if (person.username) names.add(person.username);
      if (person.displayName) names.add(person.displayName);
      if (person.nick) names.add(person.nick);
    };
    for (const person of ui.members || []) add(person);
    add(ui.dmUser);
    add(ui.me);
    return [...names];
  });

  function liveAuthor(author) {
    if (!author) return author;
    const member = ui.members.find((m) => m.id === author.id);
    const mine = author.id === ui.me?.id ? ui.me : null;
    const dm = ui.dmUser && ui.dmUser.id === author.id ? ui.dmUser : null;
    const live = mine || member || dm;
    const effect = live ? (live.nameEffect || '') : (author.nameEffect || '');
    const colors = live && live.nameColors && live.nameColors.length
      ? live.nameColors
      : (author.nameColors || []);
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
  let composerEl = $state(null);
  let mentionAt = $state(-1);
  let mentionQ = $state('');
  let mentionPick = $state(0);

  const mentionChoices = $derived.by(() => {
    if (mentionAt < 0) return [];
    const q = mentionQ.toLowerCase();
    const rows = [];
    if (ui.mode === 'chat' && 'everyone'.startsWith(q)) rows.push({ id: 'everyone', username: 'everyone', displayName: 'everyone', detail: 'Notify everyone in this channel' });
    if (ui.mode === 'chat' && 'here'.startsWith(q)) rows.push({ id: 'here', username: 'here', displayName: 'here', detail: 'Notify people who are online' });
    const people = ui.mode === 'dm' && ui.dmUser ? [ui.dmUser] : (ui.members || []);
    for (const person of people) {
      if (!person || person.id === ui.me?.id) continue;
      const username = String(person.username || '').toLowerCase();
      const display = String(person.nick || person.displayName || '').toLowerCase();
      if (!q || username.includes(q) || display.includes(q)) rows.push(person);
    }
    return rows.slice(0, 8);
  });

  function syncMention(event) {
    noteTyping();
    const el = event.currentTarget || event.target;
    const value = String(el.value || '');
    const pos = el.selectionStart ?? value.length;
    const upto = value.slice(0, pos);
    const match = upto.match(/(^|\s)@([^\s@]{0,32})$/);
    if (!match) {
      mentionAt = -1;
      return;
    }
    mentionAt = pos - match[2].length - 1;
    mentionQ = match[2];
    mentionPick = 0;
    if (ui.mode === 'chat' && !(ui.members || []).length) loadMembers(true);
  }

  function applyMention(person) {
    const name = person.username || 'user';
    const el = composerEl;
    const value = el ? String(el.value || '') : String(ui.composer || '');
    const end = mentionAt + 1 + mentionQ.length;
    const next = value.slice(0, mentionAt) + '@' + name + ' ' + value.slice(end);
    const caret = mentionAt + name.length + 2;
    ui.composer = next;
    mentionAt = -1;
    queueMicrotask(() => {
      if (!composerEl) return;
      composerEl.focus();
      composerEl.setSelectionRange(caret, caret);
    });
  }

  function onComposerKey(event) {
    if (mentionAt >= 0 && mentionChoices.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        mentionPick = (mentionPick + 1) % mentionChoices.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        mentionPick = (mentionPick - 1 + mentionChoices.length) % mentionChoices.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applyMention(mentionChoices[Math.min(mentionPick, mentionChoices.length - 1)]);
        return;
      }
      if (event.key === 'Escape') {
        mentionAt = -1;
        return;
      }
    }
    noteKeyDown(event);
  }
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
    const list = [...(event.target.files || [])];
    event.target.value = '';
    if (!list.length) return;
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
          <div class="msg-content">{@html formatContent(msg.content, emoji, stickers, mentionNames)}</div>
        {/if}
        {#if msg.files?.length}
          <div class="msg-files">
            {#each msg.files as file}
              <Attachment file={file} />
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
  {#if mentionChoices.length}
    <div class="mention-menu">
      {#each mentionChoices as person, index}
        <button type="button" class:on={index === mentionPick} onmousedown={(e) => e.preventDefault()} onclick={() => applyMention(person)}>
          <strong>@{person.username}</strong>
          <span>{person.detail || person.displayName || ''}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="composer" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
    <button type="button" class="btn icon attach-toggle" title="Attach" disabled={locked || uploading} onclick={() => { ui.attachOpen = !ui.attachOpen; ui.picker = ''; }}>
      <Plus size={20} />
    </button>
    {#if ui.attachOpen}
      <div class="attach-menu">
        <label class="attach-file" for="nebula-file">
          <FileUp size={16} /> {uploading ? 'Uploading…' : 'Upload a File'}
        </label>
        <button type="button" onclick={openPoll}><BarChart3 size={16} /> Create Poll</button>
      </div>
    {/if}
    <input
      bind:this={composerEl}
      bind:value={ui.composer}
      onkeydown={onComposerKey}
      onkeyup={noteKeyUp}
      oninput={syncMention}
      onblur={noteTypingBlur}
      maxlength="2000"
      disabled={locked}
      placeholder={locked ? 'Finish onboarding before you chat' : ui.mode === 'dm' ? 'Message @' + (ui.dmUser?.username || '') : 'Message #' + (channel?.name || 'channel')}
    />
    <button type="button" class="btn icon picker-toggle gif-btn" title="GIF" onclick={() => openPicker('gif')}>GIF</button>
    <button type="button" class="btn icon picker-toggle" title="Stickers" onclick={() => openPicker('sticker')}><Sticker size={18} /></button>
    <button type="button" class="btn icon picker-toggle" title="Emoji" onclick={() => openPicker('emoji')}><Smile size={18} /></button>
    <input id="nebula-file" class="file-input" type="file" accept="image/*,video/*,.gif,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov" multiple disabled={uploading} onchange={onFiles} />
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
