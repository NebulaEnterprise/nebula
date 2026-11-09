<script>
  import { Clock, Hash, Plus, Smile, Sticker, FileUp, BarChart3, Trash2, MoreHorizontal, Reply, Pencil, Forward, SmilePlus, MessageSquare, Eye, EyeOff } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import NameExtras from './NameExtras.svelte';
  import Picker from './Picker.svelte';
  import PollCard from './PollCard.svelte';
  import Attachment from './Attachment.svelte';
  import { ui, sendMessage, sendFiles, sendPoll, openPopout, noteTyping, noteKeyDown, noteKeyUp, noteTypingBlur, loadMembers, reactTo, removeMessage, forwardMessage, dismissLocal, toast, autoDeleteLabel } from '../state.svelte.js';
  import { formatContent, PERM } from '../format.js';
  import { fileUrl, api } from '../api.js';

  const channel = $derived(ui.channels.find((c) => c.id === ui.channelId));
  const timerMs = $derived(ui.mode === 'dm' ? (Number(ui.dmAutoDelete) || 0) : 0);
  const quickUnread = $derived(Object.values(ui.activity.dms || {}).reduce((sum, row) => sum + (Number(row?.unread) || 0), 0));
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
  const peopleNames = $derived.by(() => {
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
    return names;
  });

  function namesFor(msg) {
    const names = new Set(peopleNames);
    const flags = msg && msg.mentions;
    if (!flags || flags.everyone) names.add('everyone');
    if (!flags || flags.here) names.add('here');
    for (const role of ui.roles || []) {
      if (!role || role.id === 'everyone' || role.id === 'here' || role.id === 'owner') continue;
      const token = String(role.name || '').replace(/^@/, '');
      if (!token) continue;
      if (!flags || (flags.roles || []).includes(role.id)) names.add(token);
    }
    return [...names];
  }

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
      staff: member?.staff || mine?.staff || author.staff || '',
      developer: !!(member?.developer || mine?.developer || author.developer),
      showcase: live?.showcase || author.showcase || null,
      showcaseBadge: live?.showcaseBadge || author.showcaseBadge || '',
      badges: live?.badges || author.badges,
      roleIcon: member?.roleIcon || '',
    };
  }

  let menu = $state(null);
  let forward = $state(null);
  let forwardTargets = $state({ channels: [], dms: [] });
  let forwardBusy = $state(false);
  const quickReacts = ['💯', '👍', '👎', '❤️'];

  const reactionEmoji = $derived.by(() => {
    const rows = [];
    const seen = new Set();
    const add = (emoji, url, pack) => {
      if (!emoji || seen.has(emoji)) return;
      seen.add(emoji);
      rows.push({ emoji, url: url || '', pack: pack || '' });
    };
    for (const glyph of ['💯', '👍', '👎', '❤️', '☝️', '👀', '😩', '😂', '✅', '❌']) add(glyph);
    for (const pack of ui.packs || []) {
      for (const item of pack.emoji || []) add(':' + item.name + ':', item.url, pack.name);
    }
    for (const item of ui.emoji || []) add(':' + item.name + ':', item.url, ui.serverMeta?.name || 'This server');
    return rows;
  });

  function emojiSrc(token) {
    const hit = reactionEmoji.find((row) => row.emoji === token);
    return hit && hit.url ? fileUrl(hit.url) : '';
  }

  function openMenu(event, msg) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    menu = {
      id: msg.id,
      mine: msg.author?.id === ui.me?.id,
      x: Math.max(8, Math.min(rect.right - 232, window.innerWidth - 520)),
      y: Math.min(rect.bottom + 6, window.innerHeight - 320),
      react: false,
    };
  }

  function previewText(msg) {
    const text = String(msg?.content || '').replace(/\[\[(?:gif|sticker):[^\]]+\]\]/g, '').trim();
    if (text) return text.slice(0, 140);
    if (msg?.files?.length) return msg.files[0].name || 'Attachment';
    if (msg?.poll) return msg.poll.question || 'Poll';
    return 'Message';
  }

  const replyTargets = $derived(Array.isArray(ui.reply) ? ui.reply : (ui.reply?.id ? [ui.reply] : []));
  const replyPeople = $derived.by(() => {
    const seen = new Set();
    const people = [];
    for (const reply of replyTargets) {
      const person = reply.author || { displayName: reply.name, username: reply.name };
      const key = person.id || person.username || person.displayName || reply.id;
      if (seen.has(key)) continue;
      seen.add(key);
      people.push({ ...person, id: person.id || key });
    }
    return people;
  });

  function setReplies(list) {
    ui.reply = list.length ? list.slice(0, 5) : null;
  }

  function beginReply(msg) {
    if (!msg || msg.pending || msg.failed) return;
    const pinned = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    ui.editing = null;
    const current = replyTargets;
    if (current.some((row) => row.id === msg.id)) {
      setReplies(current.filter((row) => row.id !== msg.id));
    } else if (current.length >= 5) {
      toast('You can reply to 5 messages');
    } else {
      const author = liveAuthor(msg.author);
      setReplies([...current, {
        id: msg.id,
        name: author?.displayName || author?.username || 'Someone',
        preview: previewText(msg),
        author,
      }]);
    }
    menu = null;
    if (pinned) pinBottom();
    queueMicrotask(() => composerEl && composerEl.focus({ preventScroll: true }));
  }

  function onMessageClick(event, msg) {
    if (event.target.closest('button, a, input, textarea, label, video, img, .file-card, .poll-card, .msg-tools, .reacts')) return;
    const selected = window.getSelection();
    if (selected && String(selected).trim()) return;
    beginReply(msg);
  }

  function messageReplies(msg) {
    if (Array.isArray(msg?.replies) && msg.replies.length) return msg.replies.slice(0, 5);
    return msg?.reply?.id ? [msg.reply] : [];
  }

  function replyPerson(reply) {
    const src = ui.messages.find((row) => row.id === reply?.id);
    const author = liveAuthor(src?.author || reply?.author || {});
    return {
      ...author,
      displayName: author?.displayName || reply?.name || 'Someone',
      username: author?.username || reply?.name || '',
    };
  }

  let flashId = $state('');
  function jumpTo(id) {
    if (!id || !box) return;
    const node = box.querySelector('[data-id="' + CSS.escape(id) + '"]');
    if (!node) return;
    follow = false;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashId = id;
    setTimeout(() => { if (flashId === id) flashId = ''; }, 1600);
  }

  function beginEdit(msg) {
    ui.reply = null;
    ui.editing = { id: msg.id };
    ui.composer = msg.content || '';
    menu = null;
    queueMicrotask(() => composerEl && composerEl.focus());
  }

  async function beginForward(msg) {
    menu = null;
    forward = msg;
    forwardBusy = true;
    try {
      const data = await api('/api/forward-targets');
      forwardTargets = { channels: data.channels || [], dms: data.dms || [] };
    } catch (err) {
      toast(err.message);
      forward = null;
    } finally {
      forwardBusy = false;
    }
  }

  async function sendForward(target) {
    if (!forward) return;
    forwardBusy = true;
    try {
      await forwardMessage(forward.id, target);
      toast('Forwarded');
      forward = null;
    } catch (err) {
      toast(err.message);
    } finally {
      forwardBusy = false;
    }
  }

  async function onReact(id, emoji) {
    menu = null;
    try { await reactTo(id, emoji); }
    catch (err) { toast(err.message); }
  }

  async function onDelete(id) {
    menu = null;
    try { await removeMessage(id); }
    catch (err) { toast(err.message); }
  }

  $effect(() => {
    if (!menu) return;
    const close = (event) => {
      if (event.target?.closest?.('.msg-menu') || event.target?.closest?.('.msg-more') || event.target?.closest?.('.react-picker')) return;
      menu = null;
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  });

  let box = $state(null);
  let follow = true;
  let composerEl = $state(null);
  let mentionAt = $state(-1);
  let mentionQ = $state('');
  let mentionPick = $state(0);

  function myRoleIds() {
    const ids = new Set(['everyone']);
    const me = (ui.members || []).find((member) => member.id === ui.me?.id);
    for (const role of me?.roles || []) if (role?.id) ids.add(role.id);
    if (ui.serverMeta?.owner) ids.add('owner');
    return ids;
  }

  function canMention(role) {
    if (!role || ui.mode !== 'chat') return false;
    if (ui.serverMeta?.owner) return true;
    const mine = myRoleIds();
    if (role.id === 'everyone' || role.id === 'here') {
      if (ui.serverPerms & PERM.ADMIN) return true;
      if (ui.me?.developer || ui.me?.staff) return true;
      if (['og', 'admin', 'manager', 'moderator', 'developer', 'owner'].some((id) => mine.has(id))) return true;
    }
    if (!Array.isArray(role.mentionBy)) return true;
    if (!role.mentionBy.length) return false;
    return role.mentionBy.some((id) => mine.has(id));
  }

  const mentionChoices = $derived.by(() => {
    if (mentionAt < 0) return [];
    const q = mentionQ.toLowerCase();
    const rows = [];
    if (ui.mode === 'chat') {
      const everyone = (ui.roles || []).find((role) => role.id === 'everyone');
      const here = (ui.roles || []).find((role) => role.id === 'here');
      if ('everyone'.startsWith(q) && canMention(everyone || { id: 'everyone', mentionBy: ['og', 'admin'] })) {
        rows.push({ id: 'everyone', username: 'everyone', displayName: 'everyone', detail: 'Notify everyone in this channel' });
      }
      if ('here'.startsWith(q) && canMention(here || { id: 'here', mentionBy: ['og', 'admin'] })) {
        rows.push({ id: 'here', username: 'here', displayName: 'here', detail: 'Notify people who are online' });
      }
    }
    const people = ui.mode === 'dm' && ui.dmUser ? [ui.dmUser] : (ui.members || []);
    for (const person of people) {
      if (!person || person.id === ui.me?.id) continue;
      const username = String(person.username || '').toLowerCase();
      const display = String(person.nick || person.displayName || '').toLowerCase();
      if (!q || username.includes(q) || display.includes(q)) rows.push(person);
    }
    if (ui.mode === 'chat') {
      for (const role of ui.roles || []) {
        if (!role || role.id === 'everyone' || role.id === 'here' || role.id === 'owner') continue;
        const token = String(role.name || '').replace(/^@/, '');
        if (!token) continue;
        if (q && !token.toLowerCase().includes(q)) continue;
        if (!canMention(role)) continue;
        rows.push({ id: 'role:' + role.id, username: token, displayName: role.name, detail: 'Notify this role' });
      }
    }
    return rows.slice(0, 10);
  });

  function fitComposer() {
    const el = composerEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

  function syncMention(event) {
    noteTyping();
    fitComposer();
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
    if (event.key === 'Escape' && (ui.editing || ui.reply)) {
      ui.editing = null;
      ui.reply = null;
      ui.composer = '';
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitComposer();
      return;
    }
    noteKeyDown(event);
  }

  $effect(() => {
    ui.composer;
    queueMicrotask(fitComposer);
  });
  let drafts = $state([]);
  let sendingFiles = false;
  let editAt = $state(-1);
  let editName = $state('');
  let editAlt = $state('');
  let editSpoiler = $state(false);
  let draftRoom = '';

  $effect(() => {
    const key = ui.mode === 'dm' ? 'dm:' + (ui.dmUser?.id || '') : 'ch:' + (ui.channelId || '');
    if (draftRoom && draftRoom !== key) {
      for (const row of drafts) if (row.preview) URL.revokeObjectURL(row.preview);
      drafts = [];
      editAt = -1;
    }
    draftRoom = key;
  });

  function pastedName(file) {
    const type = file.type || '';
    if (type === 'image/jpeg') return 'image.jpg';
    if (type === 'image/gif') return 'image.gif';
    if (type === 'image/webp') return 'image.webp';
    if (type.startsWith('video/')) return 'video.mp4';
    if (type.startsWith('image/')) return 'image.png';
    return file.name || 'file';
  }

  function stageFiles(list) {
    if (ui.editing) {
      toast('Finish editing before attaching a file');
      return;
    }
    const next = [];
    for (const file of list) {
      if (!file) continue;
      if (drafts.length + next.length >= 10) break;
      const named = file.name && file.name !== 'image.png' ? file : new File([file], pastedName(file), { type: file.type });
      next.push({
        id: Math.random().toString(36).slice(2),
        file: named,
        name: named.name || pastedName(file),
        alt: '',
        spoiler: false,
        preview: URL.createObjectURL(named),
        image: /^image\//.test(named.type || '') || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(named.name || ''),
      });
    }
    if (drafts.length >= 10) toast('You can attach up to 10 files');
    if (!next.length) return;
    drafts = [...drafts, ...next];
    ui.attachOpen = false;
  }

  function removeDraft(id) {
    const row = drafts.find((item) => item.id === id);
    if (row?.preview) URL.revokeObjectURL(row.preview);
    drafts = drafts.filter((item) => item.id !== id);
    if (editAt >= drafts.length) editAt = -1;
  }

  function toggleSpoiler(id) {
    drafts = drafts.map((item) => item.id === id ? { ...item, spoiler: !item.spoiler } : item);
  }

  function openEdit(index) {
    const row = drafts[index];
    if (!row) return;
    editAt = index;
    editName = row.name;
    editAlt = row.alt;
    editSpoiler = row.spoiler;
  }

  function saveEdit() {
    if (editAt < 0 || !drafts[editAt]) return;
    const current = drafts[editAt];
    const name = editName.trim().slice(0, 80) || current.name;
    drafts = drafts.map((row, index) => index === editAt ? { ...row, name, alt: editAlt.trim().slice(0, 300), spoiler: editSpoiler } : row);
    editAt = -1;
  }

  async function submitComposer() {
    if (locked) return;
    if (ui.editing || !drafts.length) {
      sendMessage();
      return;
    }
    if (sendingFiles) return;
    sendingFiles = true;
    const payload = drafts.map((row) => ({ file: row.file, name: row.name, alt: row.alt, spoiler: row.spoiler }));
    for (const row of drafts) if (row.preview) URL.revokeObjectURL(row.preview);
    drafts = [];
    editAt = -1;
    try { await sendFiles(payload); }
    finally { sendingFiles = false; }
  }

  function onPaste(event) {
    const items = [...(event.clipboardData?.items || [])];
    const files = items
      .filter((item) => item.kind === 'file' && /^(image|video)\//.test(item.type || ''))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    stageFiles(files);
  }

  let pollOpen = $state(false);
  let pollQuestion = $state('');
  let pollAnswers = $state(['', '']);
  let pollHours = $state(24);
  let pollMulti = $state(false);

  function openPicker(tab) {
    ui.attachOpen = false;
    ui.picker = ui.picker === tab ? '' : tab;
  }

  function onFiles(event) {
    const list = [...(event.target.files || [])];
    event.target.value = '';
    if (list.length) stageFiles(list);
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

  const roomScroll = new Map();
  let pinning = false;

  function pinBottom() {
    if (!box) return;
    pinning = true;
    follow = true;
    const node = box;
    const apply = () => {
      node.scrollTop = node.scrollHeight;
      follow = true;
    };
    queueMicrotask(apply);
    requestAnimationFrame(() => {
      apply();
      pinning = false;
    });
  }

  function trackScroll() {
    if (!box || pinning) return;
    follow = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    if (roomKey) roomScroll.set(roomKey, { top: box.scrollTop, follow });
  }

  let roomKey = '';
  $effect(() => {
    const next = ui.mode + ':' + (ui.mode === 'dm' ? (ui.dmUser?.id || '') : (ui.channelId || ''));
    if (next === roomKey) return;
    roomKey = next;
    const saved = roomScroll.get(next);
    follow = saved ? saved.follow : true;
    const node = box;
    const top = saved && !saved.follow ? saved.top : null;
    queueMicrotask(() => {
      if (!node) return;
      node.scrollTop = top == null ? node.scrollHeight : top;
    });
  });

  $effect(() => {
    ui.messages.length;
    ui.messages[ui.messages.length - 1]?.id;
    ui.typers.length;
    ui.reply;
    ui.editing;
    if (!box || !follow) return;
    pinBottom();
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
  {#if ui.mode === 'dm'}
    <button type="button" class="vanish" class:on={timerMs > 0} title="Auto-delete messages" onclick={() => { ui.userPage = 'privacy'; ui.userSettings = true; }}>
      <Clock size={14} />
      {timerMs ? autoDeleteLabel(timerMs) : 'Auto-delete'}
    </button>
  {/if}
  {#if ui.mode !== 'dm'}
    <button class="btn icon quick-toggle" title="Quick reply" onclick={() => (ui.quickOpen = !ui.quickOpen)}>
      <MessageSquare size={18} />
      {#if quickUnread}<em class="pill-count">{quickUnread > 99 ? '99+' : quickUnread}</em>{/if}
    </button>
  {/if}
</div>
<div class="messages" bind:this={box} onscroll={trackScroll}>
  {#if ui.chatLoading && !ui.messages.length}
    <div class="skel-list" aria-hidden="true">
      {#each [78, 64, 86, 58, 72, 48] as width}
        <div class="skel">
          <span></span>
          <i style="width:{width}%"></i>
        </div>
      {/each}
    </div>
  {:else if !ui.messages.length}
    <div class="welcome">
      <h2>{ui.mode === 'dm' ? (ui.dmUser?.displayName || 'Direct message') : '#' + (channel?.name || 'channel')}</h2>
      <p>{ui.mode === 'dm' ? 'This is the start of your conversation.' : 'This is the start of the channel. Say hi.'}</p>
    </div>
  {/if}
  {#each ui.messages as msg (msg.id)}
    <article class="msg" class:has-reply={messageReplies(msg).length > 0} class:many={messageReplies(msg).length > 1} class:picked={replyTargets.some((row) => row.id === msg.id)} class:menu-open={menu?.id === msg.id} class:pending={msg.pending} class:flash={flashId === msg.id} data-id={msg.id} onclick={(e) => onMessageClick(e, msg)}>
      {#if !msg.pending && !msg.failed}
      <div class="msg-tools">
        {#each quickReacts as glyph}
          <button type="button" title="React" onclick={() => onReact(msg.id, glyph)}>{glyph}</button>
        {/each}
        <button type="button" class="msg-more" title="More" onclick={(e) => openMenu(e, msg)}><MoreHorizontal size={18} /></button>
      </div>
      {/if}
      {#if messageReplies(msg).length}
        <div class="reply-stack" class:many={messageReplies(msg).length > 1}>
          {#each messageReplies(msg) as reply (reply.id)}
            {@const person = replyPerson(reply)}
            <button type="button" class="reply-ref" onclick={() => jumpTo(reply.id)}>
              <span class="reply-main">
                <i class="reply-spine"></i>
                <Avatar user={person} size={messageReplies(msg).length > 1 ? 12 : 16} dot={false} />
                <strong><Name user={person} /></strong>
                <em>{reply.preview}</em>
              </span>
            </button>
          {/each}
        </div>
      {/if}
      <button type="button" class="msg-av" onclick={(e) => openPopout(liveAuthor(msg.author), e.clientX, e.clientY)}>
        <Avatar user={liveAuthor(msg.author)} size={40} dot={false} />
      </button>
      <div class="msg-body">
        <div class="msg-head">
          <span class="msg-id"><strong><Name user={liveAuthor(msg.author)} color={msg.author?.accentColor || 'white'} /></strong><NameExtras user={liveAuthor(msg.author)} /></span>
          <time>{time(msg.createdAt)}</time>
          {#if msg.editedAt}<span class="edited">(edited)</span>{/if}
        </div>
        {#if msg.forward}
          <p class="forward-tag">Forwarded from {msg.forward.name}</p>
        {/if}
        {#if msg.content}
          <div class="msg-content">{@html formatContent(msg.content, emoji, stickers, namesFor(msg))}</div>
        {/if}
        {#if msg.files?.length}
          <div class="msg-files">
            {#each msg.files as file}
              <Attachment file={file} />
            {/each}
          </div>
        {/if}
        {#if msg.failed}
          <button type="button" class="msg-fail" onclick={() => dismissLocal(msg.id)}>Couldn't send. {msg.error || 'Tap to remove.'}</button>
        {/if}
        {#if msg.poll}
          <PollCard poll={msg.poll} messageId={msg.id} />
        {/if}
        {#if msg.reactions?.length}
          <div class="reacts">
            {#each msg.reactions as react}
              <button type="button" class:on={react.me} onclick={() => onReact(msg.id, react.emoji)}>
                {#if emojiSrc(react.emoji)}
                  <img src={emojiSrc(react.emoji)} alt={react.emoji} />
                {:else}
                  {react.emoji}
                {/if}
                <span>{react.count}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </article>
  {/each}
</div>
{#if menu}
  {@const current = ui.messages.find((msg) => msg.id === menu.id)}
  <div class="msg-menu" style="left:{menu.x}px;top:{menu.y}px" onclick={(e) => e.stopPropagation()}>
    <button type="button" onclick={() => (menu = { ...menu, react: !menu.react })}><SmilePlus size={16} /> Add Reaction</button>
    {#if menu.react}
      <div class="react-picker" style="left:{menu.x + 636 < window.innerWidth ? menu.x + 228 : Math.max(8, menu.x - 416)}px;top:{Math.max(8, Math.min(menu.y, window.innerHeight - 500))}px">
        <Picker onpick={(emoji) => current && onReact(current.id, emoji)} />
      </div>
    {/if}
    {#if current && menu.mine}
      <button type="button" onclick={() => beginEdit(current)}><Pencil size={16} /> Edit Message</button>
    {/if}
    {#if current}
      <button type="button" onclick={() => beginReply(current)}><Reply size={16} /> {replyTargets.some((row) => row.id === current.id) ? 'Remove Reply' : 'Reply'}</button>
      <button type="button" onclick={() => beginForward(current)}><Forward size={16} /> Forward</button>
    {/if}
    {#if current && menu.mine}
      <button type="button" class="danger" onclick={() => onDelete(current.id)}><Trash2 size={16} /> Delete Message</button>
    {/if}
  </div>
{/if}
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
  {#if replyTargets.length}
    <div class="compose-note reply-note">
      <span class="reply-label">
        <span>Replying to</span>
        {#each replyPeople as person (person.id || person.username || person.displayName)}
          <Avatar user={person} size={16} dot={false} />
          <Name user={person} />
        {/each}
      </span>
      <button type="button" class="btn icon" title="Cancel reply" onclick={() => (ui.reply = null)}>✕</button>
    </div>
  {/if}
  {#if ui.editing}
    <div class="compose-note">
      <strong>Editing message</strong>
      <button type="button" class="btn icon" onclick={() => { ui.editing = null; ui.composer = ''; }}>✕</button>
    </div>
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
  {#if drafts.length}
    <div class="staged">
      {#each drafts as row, index (row.id)}
        <div class="staged-card">
          <div class="staged-tools">
            <button type="button" title={row.spoiler ? 'Remove spoiler' : 'Mark as spoiler'} onclick={() => toggleSpoiler(row.id)}>
              {#if row.spoiler}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
            </button>
            <button type="button" title="Modify attachment" onclick={() => openEdit(index)}><Pencil size={14} /></button>
            <button type="button" class="danger" title="Remove attachment" onclick={() => removeDraft(row.id)}><Trash2 size={14} /></button>
          </div>
          {#if row.spoiler}
            <div class="staged-cover"><span>SPOILER</span></div>
          {:else if row.image}
            <img src={row.preview} alt={row.alt || row.name} />
          {:else}
            <div class="staged-cover"><span>FILE</span></div>
          {/if}
          <em>{row.name}</em>
        </div>
      {/each}
    </div>
  {/if}
  <form class="composer" onsubmit={(e) => { e.preventDefault(); submitComposer(); }}>
    <button type="button" class="btn icon attach-toggle" title="Attach" disabled={locked} onclick={() => { ui.attachOpen = !ui.attachOpen; ui.picker = ''; }}>
      <Plus size={20} />
    </button>
    {#if ui.attachOpen}
      <div class="attach-menu">
        <label class="attach-file" for="nebula-file">
          <FileUp size={16} /> Upload a File
        </label>
        <button type="button" onclick={openPoll}><BarChart3 size={16} /> Create Poll</button>
      </div>
    {/if}
    <textarea
      bind:this={composerEl}
      bind:value={ui.composer}
      rows="1"
      onkeydown={onComposerKey}
      onpaste={onPaste}
      onkeyup={noteKeyUp}
      oninput={syncMention}
      onblur={noteTypingBlur}
      maxlength="2000"
      disabled={locked}
      placeholder={locked ? 'Finish onboarding before you chat' : ui.editing ? 'Edit message' : ui.mode === 'dm' ? 'Message @' + (ui.dmUser?.username || '') : 'Message #' + (channel?.name || 'channel')}
    ></textarea>
    <button type="button" class="btn icon picker-toggle gif-btn" title="GIF" onclick={() => openPicker('gif')}>GIF</button>
    <button type="button" class="btn icon picker-toggle" title="Stickers" onclick={() => openPicker('sticker')}><Sticker size={18} /></button>
    <button type="button" class="btn icon picker-toggle" title="Emoji" onclick={() => openPicker('emoji')}><Smile size={18} /></button>
    <input id="nebula-file" class="file-input" type="file" accept="image/*,video/*,.gif,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov" multiple onchange={onFiles} />
  </form>
  {#if editAt >= 0 && drafts[editAt]}
    <div class="poll-overlay" role="presentation" onclick={() => (editAt = -1)}>
      <div class="poll-sheet modify-sheet" role="dialog" onclick={(e) => e.stopPropagation()}>
        <div class="row">
          <h3>Modify Attachment</h3>
          <button type="button" class="btn icon" onclick={() => (editAt = -1)}>✕</button>
        </div>
        {#if drafts[editAt].image && !editSpoiler}
          <img class="modify-preview" src={drafts[editAt].preview} alt={editAlt || editName} />
        {:else}
          <div class="staged-cover modify-cover"><span>{editSpoiler ? 'SPOILER' : 'FILE'}</span></div>
        {/if}
        <div class="field">
          <label for="file-name">Filename</label>
          <input id="file-name" bind:value={editName} maxlength="80" />
        </div>
        <div class="field">
          <label for="file-alt">Description (Alt Text)</label>
          <textarea id="file-alt" bind:value={editAlt} maxlength="300" rows="3" placeholder="Add a description"></textarea>
        </div>
        <label class="spoiler-check">
          <input type="checkbox" bind:checked={editSpoiler} />
          Mark as spoiler
        </label>
        <div class="modify-actions">
          <button type="button" class="btn" onclick={() => (editAt = -1)}>Cancel</button>
          <button type="button" class="btn brand" onclick={saveEdit}>Save</button>
        </div>
      </div>
    </div>
  {/if}
  {#if forward}
    <div class="poll-overlay" role="presentation" onclick={() => (forward = null)}>
      <div class="poll-sheet" role="dialog" onclick={(e) => e.stopPropagation()}>
        <div class="row">
          <h3>Forward message</h3>
          <button type="button" class="btn icon" onclick={() => (forward = null)}>✕</button>
        </div>
        <p class="hint">{previewText(forward)}</p>
        {#if forwardBusy && !forwardTargets.channels.length && !forwardTargets.dms.length}
          <p class="hint">Loading places you can send…</p>
        {/if}
        <p class="label">Direct messages</p>
        {#each forwardTargets.dms as dm}
          <button type="button" class="forward-row" disabled={forwardBusy} onclick={() => sendForward({ userId: dm.id })}>{dm.name}</button>
        {:else}
          <p class="hint">No direct messages yet.</p>
        {/each}
        <p class="label">Channels you can send in</p>
        {#each forwardTargets.channels as ch}
          <button type="button" class="forward-row" disabled={forwardBusy} onclick={() => sendForward({ channelId: ch.channelId, serverId: ch.serverId })}>{ch.serverName} · #{ch.name}</button>
        {:else}
          <p class="hint">No text channels you can send in.</p>
        {/each}
      </div>
    </div>
  {/if}
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
