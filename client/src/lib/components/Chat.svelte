<script>
  import { Hash, Plus, Smile, Sticker, FileUp, BarChart3, Trash2, MoreHorizontal, Reply, Pencil, Forward, SmilePlus, Eye, EyeOff, Search, Phone, PhoneOff, Bell, Pin, Image as ImageIcon, MessagesSquare, UserRound, ChevronLeft, Mic, MicOff, Headphones, HeadphoneOff, Monitor, Link, Flag, Mail, X, Maximize2, PictureInPicture2, Settings, Video } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import NameExtras from './NameExtras.svelte';
  import Picker from './Picker.svelte';
  import PollCard from './PollCard.svelte';
  import Attachment from './Attachment.svelte';
  import { ui, nowClock, sendMessage, sendFiles, sendPoll, openPopout, noteTyping, noteKeyDown, noteKeyUp, noteTypingBlur, typingLine, mentionsMessage, loadMembers, reactTo, removeMessage, forwardMessage, dismissLocal, toast, pinMessage, muteRoom, roomMuted, channelNotify, setChannelNotify, leaveThread, developerMode, copyText, messageLink, markUnread } from '../state.svelte.js';
  import { seenPhrase, presenceDot } from '../seen.js';
  import { startCall, joinOpenCall, answerCall, declineCall, leaveVoice, toggleMute, toggleDeafen, toggleShare, changeShare, setWatching, localScreen, remoteScreen, partnerInCall } from '../voice.js';
  import Dock from './Dock.svelte';
  import { formatContent, emojiScale, PERM } from '../format.js';
  import { fileUrl, api } from '../api.js';

  const channel = $derived(ui.channels.find((c) => c.id === ui.channelId));
  const typingPhrase = $derived(typingLine(ui.typers));
  let typingHold = $state({ kind: '', names: [] });
  $effect(() => {
    if (typingPhrase.kind) typingHold = typingPhrase;
  });
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
  const holdReacts = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

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

  let bell = $state(false);
  let threadMenu = $state(false);
  let renaming = $state(false);
  let threadName = $state('');

  const muteKey = $derived(
    ui.mode === 'dm' && ui.dmUser ? 'dm:' + ui.dmUser.id
      : ui.mode === 'group' && ui.group ? 'group:' + ui.group.id
        : ui.mode === 'thread' && ui.thread ? 'thread:' + ui.thread.id
          : 'ch:' + (ui.channelId || '')
  );
  const muted = $derived(roomMuted(muteKey));
  const statusLabel = $derived(seenPhrase(ui.dmUser, nowClock.t));
  const statusDot = $derived(presenceDot(ui.dmUser, nowClock.t));
  const titleName = $derived(
    ui.mode === 'dm' ? (ui.dmUser?.displayName || ui.dmUser?.username || 'Message')
      : ui.mode === 'group' ? (ui.group?.name || 'Group')
        : ui.mode === 'thread' ? (ui.thread?.name || 'Thread')
          : (channel?.name || 'channel')
  );

  let holdTimer = 0;
  let heldMenu = false;
  let holdMove = null;
  let phoneMenu = $state(false);

  $effect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const apply = () => (phoneMenu = media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  });

  function openMenu(event, msg) {
    event.preventDefault();
    event.stopPropagation();
    const point = event.type === 'contextmenu';
    const rect = event.currentTarget.getBoundingClientRect();
    const x = point ? event.clientX : rect.right - 232;
    const y = point ? event.clientY : rect.bottom + 6;
    if (phoneMenu && composerEl) composerEl.blur();
    menu = {
      id: msg.id,
      mine: msg.author?.id === ui.me?.id,
      x: Math.max(8, Math.min(x, window.innerWidth - 250)),
      y: Math.max(8, Math.min(y, window.innerHeight - 320)),
      react: false,
    };
  }

  function pressStart(event, msg) {
    if (msg.pending || msg.failed || event.pointerType === 'mouse') return;
    heldMenu = false;
    const target = event.currentTarget;
    const x = event.clientX;
    const y = event.clientY;
    pressEnd();
    holdMove = (ev) => {
      if (Math.abs(ev.clientX - x) > 10 || Math.abs(ev.clientY - y) > 10) pressEnd();
    };
    window.addEventListener('pointermove', holdMove);
    holdTimer = window.setTimeout(() => {
      pressEnd();
      heldMenu = true;
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (_) {}
      openMenu({
        preventDefault() {},
        stopPropagation() {},
        type: 'contextmenu',
        clientX: x,
        clientY: y,
        currentTarget: target,
      }, msg);
    }, 420);
  }

  function pressEnd() {
    if (holdMove) {
      window.removeEventListener('pointermove', holdMove);
      holdMove = null;
    }
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = 0;
  }

  function toggleDock(name) {
    ui.dock = ui.dock === name ? '' : name;
  }

  function togglePeople() {
    const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
    if (phone && (ui.mode === 'chat' || ui.mode === 'thread')) {
      ui.showMembers = true;
      ui.phone = 'people';
      return;
    }
    if (ui.mode === 'chat' || ui.mode === 'thread') ui.showMembers = ui.showMembers === false;
    else toggleDock(ui.mode === 'group' ? 'group' : 'profile');
  }

  async function onPin(msg) {
    menu = null;
    try { await pinMessage(msg.id, !msg.pinned); }
    catch (err) { toast(err.message); }
  }

  function createThread(msg) {
    menu = null;
    const text = previewText(msg);
    ui.threadDraft = { name: text.slice(0, 80), content: text };
    ui.dock = 'threads';
  }

  async function threadAct(type, extra) {
    if (!ui.thread) return;
    threadMenu = false;
    try {
      const data = await api('/api/threads/' + ui.thread.id + '/action', { method: 'POST', body: { type, ...extra } });
      if (data.deleted || type === 'close') {
        await leaveThread();
        return;
      }
      if (data.thread) ui.thread = { ...ui.thread, ...data.thread };
      renaming = false;
    } catch (err) {
      toast(err.message);
    }
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
    if (heldMenu) { heldMenu = false; return; }
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
  let reactTip = $state(null);
  let reactionView = $state('');
  let reactionPick = $state('');

  function reactWho(react) {
    const people = Array.isArray(react?.users) ? react.users : [];
    const names = people.slice(0, 3).map((person) => person.displayName || person.username).filter(Boolean);
    const extra = Math.max(0, (react?.count || people.length) - names.length);
    const label = react?.emoji || 'That';
    if (!names.length) return label + ' reacted by ' + (react?.count || 0);
    const head = extra
      ? names.join(', ') + ', and ' + extra + (extra === 1 ? ' other' : ' others')
      : names.length === 1
        ? names[0]
        : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return label + ' reacted by ' + head;
  }

  function showReactTip(event, react) {
    const rect = event.currentTarget.getBoundingClientRect();
    reactTip = { x: rect.left + rect.width / 2, y: rect.top, text: reactWho(react) };
  }

  async function loadReactors(message) {
    if (!message?.id) return;
    const missing = (message.reactions || []).some((row) => row && row.count && !(row.users && row.users.length));
    if (!missing) return;
    try {
      const data = await api('/api/messages/' + encodeURIComponent(message.id) + '/reactions');
      if (!Array.isArray(data.reactions)) return;
      ui.messages = ui.messages.map((row) => row.id === message.id ? { ...row, reactions: data.reactions } : row);
      const fresh = data.reactions.find((row) => reactTip && row.emoji && reactTip.text.startsWith(row.emoji));
      if (fresh && reactTip) reactTip = { ...reactTip, text: reactWho(fresh) };
    } catch (_) {}
  }

  function openReactions(message) {
    reactionView = message?.id || '';
    reactionPick = message?.reactions?.[0]?.emoji || '';
    menu = null;
    loadReactors(message);
  }

  $effect(() => {
    const id = ui.jumpTo;
    if (!id || !ui.messages.some((row) => row && row.id === id)) return;
    queueMicrotask(() => jumpTo(id));
    ui.jumpTo = '';
  });

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
    noteTyping((event.currentTarget || event.target).value);
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
      noteTyping();
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

  function chatOnScreen() {
    if (typeof window === 'undefined') return true;
    if (!window.matchMedia('(max-width: 900px)').matches) return true;
    return ui.phone === 'chat';
  }

  let pinGen = 0;

  function pinBottom() {
    if (!box) return;
    const gen = ++pinGen;
    pinning = true;
    follow = true;
    const node = box;
    node.scrollTop = node.scrollHeight;
    requestAnimationFrame(() => {
      if (gen !== pinGen || !node) return;
      node.scrollTop = node.scrollHeight;
      pinning = false;
    });
  }

  $effect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onKb = () => {
      if (!follow || !chatOnScreen()) return;
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (overlap > 80) pinBottom();
    };
    vv.addEventListener('resize', onKb);
    return () => vv.removeEventListener('resize', onKb);
  });

  function onComposerFocus() {
    menu = null;
    follow = true;
    if (window.scrollY) window.scrollTo(0, 0);
    requestAnimationFrame(() => pinBottom());
  }

  function trackScroll() {
    if (!box || pinning || !chatOnScreen()) return;
    if (box.scrollHeight <= box.clientHeight + 8) return;
    follow = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    if (roomKey) roomScroll.set(roomKey, { top: box.scrollTop, follow });
  }

  function roomToken() {
    if (ui.mode === 'dm') return 'dm:' + (ui.dmUser?.id || '');
    if (ui.mode === 'group') return 'group:' + (ui.group?.id || '');
    if (ui.mode === 'thread') return 'thread:' + (ui.thread?.id || '');
    return 'ch:' + (ui.channelId || '');
  }

  let roomKey = '';
  let shownKey = '';
  $effect(() => {
    const next = roomToken();
    ui.phone;
    const visible = chatOnScreen();
    const token = (visible ? 'v:' : 'h:') + next;
    if (token === shownKey) return;
    shownKey = token;
    roomKey = next;
    if (!visible) return;
    const saved = roomScroll.get(next);
    follow = saved ? saved.follow : true;
    const top = saved && !saved.follow ? saved.top : null;
    queueMicrotask(() => {
      if (!box) return;
      if (top == null) pinBottom();
      else box.scrollTop = top;
    });
  });

  let stickKey = '';
  let stickCount = -1;
  $effect(() => {
    const last = ui.messages[ui.messages.length - 1];
    const key = (last && (last.clientKey || last.id)) || '';
    const count = ui.messages.length;
    ui.reply;
    ui.editing;
    ui.composer;
    if (composerEl) fitComposer();
    if (!box || !follow) return;
    if (key === stickKey && count === stickCount) return;
    stickKey = key;
    stickCount = count;
    pinBottom();
  });

  function dayStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function dayKey(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = dayStart(new Date()) - dayStart(d);
    if (diff === 0) return 'Today';
    if (diff === 86400000) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  const callPeople = $derived.by(() => {
    const voice = ui.voice;
    if (!voice || voice.serverId !== 'call') return [];
    const meId = ui.me?.id;
    const room = ui.voiceRooms[voice.channelId] || [];
    const people = [];
    const seen = new Set();
    for (const person of room) {
      if (!person || seen.has(String(person.id))) continue;
      seen.add(String(person.id));
      if (String(person.id) === String(meId)) {
        people.push({ ...person, speaking: !!(voice.speaking && !voice.muted && !voice.deafened) });
      } else {
        people.push(person);
      }
    }
    if (ui.me && meId && !seen.has(String(meId))) {
      people.unshift({
        id: meId,
        displayName: ui.me.displayName || ui.me.username,
        username: ui.me.username,
        avatarUrl: ui.me.avatarUrl || '',
        avatarColor: ui.me.avatarColor,
        speaking: !!(voice.speaking && !voice.muted && !voice.deafened),
      });
    }
    return people;
  });

  const callRoomId = $derived.by(() => {
    if (ui.mode === 'group' && ui.group) return 'group:' + ui.group.id;
    if (ui.mode === 'dm' && ui.me && ui.dmUser) return 'dm:' + [ui.me.id, ui.dmUser.id].sort().join(':');
    return '';
  });
  const rejoinPeople = $derived.by(() => {
    if (!callRoomId || (ui.voice && ui.voice.channelId === callRoomId)) return [];
    return (ui.voiceRooms[callRoomId] || []).filter((person) => String(person.id) !== String(ui.me?.id));
  });
  const showIncoming = $derived.by(() => {
    const call = ui.incomingCall;
    if (!call?.from) return false;
    const fromId = String(call.from.id || '');
    if (ui.mode === 'chat' || ui.mode === 'thread' || ui.mode === 'group') return true;
    if (ui.mode === 'dm') return String(ui.dmUser?.id || '') !== fromId;
    return false;
  });
  const liveCallMessage = $derived.by(() => {
    if (ui.mode !== 'dm' || !partnerInCall(ui.dmUser)) return '';
    for (let i = ui.messages.length - 1; i >= 0; i -= 1) {
      const msg = ui.messages[i];
      if (msg?.kind === 'call' && !msg.callSeconds && !msg.callMissed) return msg.id;
    }
    return '';
  });
  let callDrag = $state({ x: 0, y: 0 });
  let callDragging = $state(false);
  let callDragFor = '';

  $effect(() => {
    const id = String(ui.incomingCall?.id || '');
    if (id === callDragFor) return;
    callDragFor = id;
    callDrag = { x: 0, y: 0 };
  });

  function dragCall(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    const box = event.currentTarget;
    const parent = box.offsetParent;
    if (!parent) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = callDrag.x;
    const originY = callDrag.y;
    callDragging = true;
    const move = (e) => {
      const bounds = parent.getBoundingClientRect();
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const baseLeft = bounds.width / 2 - width / 2;
      const baseTop = 64;
      let x = originX + e.clientX - startX;
      let y = originY + e.clientY - startY;
      x = Math.min(bounds.width - width - 8 - baseLeft, Math.max(8 - baseLeft, x));
      y = Math.min(bounds.height - height - 8 - baseTop, Math.max(8 - baseTop, y));
      callDrag = { x, y };
    };
    const up = () => {
      callDragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  let streamPop = null;
  let gearOpen = $state(false);
  const serverVoice = $derived(!!(ui.voice && ui.voice.serverId !== 'call'));
  const streamLive = $derived(!!(ui.screen?.local || ui.screen?.remote));
  const mineStream = $derived(!!(ui.voice?.sharing || ui.screen?.local));
  const wideOpen = $derived(serverVoice && ui.streamUi?.view === 'wide');
  const dmBoard = $derived((ui.mode === 'dm' || ui.mode === 'group') && ui.streamUi?.view !== 'mini' && ((ui.voice?.serverId === 'call') || rejoinPeople.length > 0));
  const showBoard = $derived(dmBoard || wideOpen);
  const remoteSharer = $derived.by(() => {
    if (mineStream) return null;
    const room = ui.voiceRooms[ui.voice?.channelId || callRoomId] || [];
    return room.find((person) => person.sharing && String(person.id) !== String(ui.me?.id)) || null;
  });
  const miniOpen = $derived(!!ui.voice && ui.streamUi?.view === 'mini' && !showBoard && (streamLive || !!remoteSharer || !!mineStream));
  const boardPeople = $derived(ui.voice?.serverId === 'call' ? callPeople : (dmBoard ? rejoinPeople : (ui.voiceRooms[ui.voice?.channelId] || [])));
  const sharer = $derived.by(() => {
    if (ui.voice?.sharing || ui.screen?.local) return ui.me;
    const room = ui.voiceRooms[ui.voice?.channelId || callRoomId] || [];
    return room.find((person) => person.sharing) || null;
  });
  const watcherCount = $derived.by(() => {
    const room = ui.voiceRooms[ui.voice?.channelId] || [];
    const host = sharer?.id;
    return room.filter((person) => person.watching && String(person.id) !== String(host)).length;
  });

  function setStream(patch) {
    ui.streamUi = { ...ui.streamUi, ...patch };
  }

  function watchStream() {
    const wide = !!(ui.voice && ui.voice.serverId !== 'call');
    if (!ui.voice) {
      joinOpenCall().then(() => setStream({ watching: true, view: 'auto', hideChat: false }));
      return;
    }
    setStream({ watching: true, view: wide ? 'wide' : 'auto', hideChat: wide ? true : !!ui.streamUi?.hideChat });
  }

  function dockStream() {
    setStream({ view: 'mini', watching: true, hideChat: false });
  }

  function stopWatching() {
    gearOpen = false;
    setStream({ view: 'off', watching: false });
  }

  function openWide() {
    setStream({ view: 'wide', watching: true, hideChat: true });
  }

  function toggleChat() {
    const hidden = !!ui.streamUi?.hideChat;
    const live = !!(remoteSharer || mineStream || streamLive);
    if (serverVoice) {
      if (hidden) setStream({ hideChat: false, view: live ? 'mini' : 'auto', watching: live });
      else setStream({ hideChat: true, view: 'wide' });
      return;
    }
    if (hidden) setStream({ hideChat: false, view: live && ui.streamUi?.watching ? 'mini' : 'auto' });
    else setStream({ hideChat: true, view: 'auto' });
  }

  $effect(() => {
    const on = !!(ui.voice && (streamLive || ui.streamUi?.watching) && ui.streamUi?.view !== 'off' && (ui.streamUi?.view === 'mini' || ui.streamUi?.view === 'wide' || ui.streamUi?.watching));
    setWatching(on);
  });

  $effect(() => {
    if (!ui.voice) return;
    const sharing = !!(ui.voice.sharing || remoteSharer || streamLive);
    if (!sharing && ui.streamUi?.view === 'mini') setStream({ view: 'auto', watching: false });
  });

  function streamTitle() {
    if (remoteScreen && !localScreen) {
      const room = ui.voiceRooms[ui.voice?.channelId] || [];
      const host = room.find((person) => person.sharing && String(person.id) !== String(ui.me?.id));
      return (host?.displayName || host?.username || 'Someone') + ' is sharing';
    }
    return 'Your screen';
  }

  function paintPopout(win, stream) {
    if (!win || win.closed) return;
    let video = win.document.querySelector('video');
    if (!video) {
      win.document.title = 'Nebula stream';
      win.document.body.innerHTML = '';
      const style = win.document.createElement('style');
      style.textContent = 'html,body{margin:0;height:100%;background:#000;color:#fff;font-family:system-ui,sans-serif}.bar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:linear-gradient(#000,transparent)}button{background:#2b2d31;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:700}video{width:100%;height:100%;object-fit:contain;background:#000}';
      win.document.head.appendChild(style);
      const bar = win.document.createElement('div');
      bar.className = 'bar';
      const name = win.document.createElement('strong');
      name.className = 'who';
      const back = win.document.createElement('button');
      back.textContent = 'Return to Nebula';
      back.onclick = () => win.close();
      bar.append(name, back);
      video = win.document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      win.document.body.append(video, bar);
    }
    const name = win.document.querySelector('.who');
    if (name) name.textContent = streamTitle();
    if (video.srcObject !== stream) {
      video.srcObject = stream || null;
      if (stream) video.play().catch(() => {});
    }
  }

  function popOutStream() {
    const stream = remoteScreen || localScreen;
    if (!stream) return;
    const win = window.open('', 'nebula-stream', 'popup=yes,width=1100,height=700');
    if (!win) {
      toast('Allow pop-ups to pop the stream out');
      return;
    }
    streamPop = win;
    paintPopout(win, stream);
  }

  function fillScreen(node) {
    if (!node) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else node.requestFullscreen?.().catch(() => {});
  }

  $effect(() => {
    const stream = remoteScreen || localScreen;
    const tick = ui.screen?.at;
    if (!streamPop || streamPop.closed || (tick == null && !stream)) return;
    paintPopout(streamPop, stream);
  });

  function callLength(seconds) {
    const s = Number(seconds) || 0;
    if (s < 60) return 'a few seconds';
    const minutes = Math.round(s / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute' : ' minutes');
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours + (hours === 1 ? ' hour' : ' hours') + (rest ? ' ' + rest + (rest === 1 ? ' minute' : ' minutes') : '');
  }

  function attach(node, stream) {
    node.srcObject = stream || null;
    if (stream) node.play().catch(() => {});
    return {
      update(next) {
        node.srcObject = next || null;
        if (next) node.play().catch(() => {});
      },
    };
  }

  function time(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const diff = dayStart(new Date()) - dayStart(d);
    if (diff === 0) return clock;
    if (diff === 86400000) return 'Yesterday at ' + clock;
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }) + ', ' + clock;
  }
</script>

<div class="chat-frame">
<div class="chat-col" class:chat-hidden={ui.streamUi?.hideChat && showBoard}>
{#if showIncoming}
  <div class="incoming-call" class:dragging={callDragging} role="dialog" aria-label="Incoming call" style="transform: translate(calc(-50% + {callDrag.x}px), {callDrag.y}px)" onpointerdown={dragCall}>
    <Avatar user={ui.incomingCall.from} size={80} />
    <strong>{ui.incomingCall.from?.displayName || ui.incomingCall.from?.username || 'Someone'}</strong>
    <span>Incoming Call...</span>
    <div class="incoming-actions">
      <button type="button" class="decline" title="Decline" onclick={declineCall}><X size={18} /></button>
      <button type="button" class="accept" title="Accept" onclick={answerCall}><Phone size={18} /></button>
    </div>
  </div>
{/if}
<div class="top">
  <button type="button" class="phone-back" title="Back" onclick={() => (ui.phone = 'browse')}><ChevronLeft size={22} /></button>
  {#if ui.mode === 'thread'}
    <button class="crumb" title="Back to channel" onclick={leaveThread}><ChevronLeft size={16} /> #{ui.thread?.channelName || channel?.name || 'channel'}</button>
  {:else if ui.mode !== 'dm' && ui.mode !== 'group'}
    <Hash size={18} />
  {/if}
  <h2>{titleName}</h2>
  {#if ui.mode === 'dm' && partnerInCall(ui.dmUser)}
    <span class="in-call"><Phone size={14} /> In a call</span>
  {:else if ui.mode === 'dm'}
    <span class="status-word {statusDot}">{statusLabel}</span>
  {:else if ui.mode === 'group'}
    <span class="topic">{ui.group?.memberCount || (ui.group?.members || []).length || 0} members</span>
  {:else if ui.mode !== 'thread'}
    <span class="topic">{channel?.topic || ''}</span>
  {:else}
    <span class="topic"></span>
  {/if}
  {#if ui.mode === 'thread'}
    <button class="btn sm" onclick={() => threadAct((ui.thread?.followers || []).includes(ui.me?.id) ? 'unfollow' : 'follow')}>
      {(ui.thread?.followers || []).includes(ui.me?.id) ? 'Unfollow' : 'Follow'}
    </button>
    <button class="btn sm" onclick={() => { renaming = !renaming; threadName = ui.thread?.name || ''; }}>Edit</button>
    <button class="btn icon" title="Thread options" onclick={() => (threadMenu = !threadMenu)}><MoreHorizontal size={16} /></button>
  {/if}
  <div class="top-tools">
    <button type="button" class="bar-tool switcher-btn" title="Quick switcher" onclick={() => (ui.switcher = true)}><Search size={18} /><kbd>Ctrl K</kbd></button>
    {#if ui.mode === 'dm' || ui.mode === 'group'}
      <button type="button" class="bar-tool" title="Start a call" onclick={startCall}><Phone size={18} /></button>
    {/if}
    <button type="button" class="bar-tool" class:on={muted} title="Notifications" onclick={() => (bell = !bell)}><Bell size={18} /></button>
    <button type="button" class="bar-tool" class:on={ui.dock === 'pins'} title="Pinned messages" onclick={() => toggleDock('pins')}><Pin size={18} /></button>
    <button type="button" class="bar-tool" class:on={ui.dock === 'media'} title="Media" onclick={() => toggleDock('media')}><ImageIcon size={18} /></button>
    {#if ui.mode === 'chat' || ui.mode === 'thread'}
      <button type="button" class="bar-tool" class:on={ui.dock === 'threads'} title="Threads" onclick={() => toggleDock('threads')}><MessagesSquare size={18} /></button>
    {/if}
    <button type="button" class="bar-tool" class:on={(ui.mode === 'chat' || ui.mode === 'thread') ? ui.showMembers !== false : ui.dock === (ui.mode === 'group' ? 'group' : 'profile')} title={ui.mode === 'chat' || ui.mode === 'thread' ? 'Members' : 'Profile'} onclick={togglePeople}><UserRound size={18} /></button>
    <label class="top-search">
      <Search size={15} />
      <input placeholder={ui.mode === 'dm' ? 'Search' : 'Search ' + (ui.mode === 'group' ? (ui.group?.name || 'group') : titleName)} bind:value={ui.dockQuery} onfocus={() => (ui.dock = 'search')} />
    </label>
  </div>
</div>
{#if renaming && ui.mode === 'thread'}
  <form class="thread-rename" onsubmit={(e) => { e.preventDefault(); threadAct('rename', { name: threadName }); }}>
    <input bind:value={threadName} maxlength="100" />
    <button class="btn sm" type="submit">Save</button>
  </form>
{/if}
{#if threadMenu}
  <div class="thread-menu">
    <button type="button" onclick={() => threadAct('close')}>Close</button>
    <button type="button" class="danger" onclick={() => threadAct('delete')}>Delete</button>
  </div>
{/if}
{#if bell}
  <div class="bell-menu">
    <strong>{ui.mode === 'chat' || ui.mode === 'thread' ? 'Notification settings' : 'Mute chat'}</strong>
    {#if ui.mode === 'chat'}
      {#each [['default', 'Use server default'], ['all', 'All messages'], ['mentions', 'Only @mentions'], ['nothing', 'Nothing']] as [id, label]}
        <button type="button" class:on={channelNotify(ui.channelId) === id} onclick={() => { setChannelNotify(ui.channelId, id); bell = false; }}>{label}</button>
      {/each}
    {/if}
    <button type="button" onclick={() => { muteRoom(muteKey, 15 * 60 * 1000); bell = false; }}>For 15 minutes</button>
    <button type="button" onclick={() => { muteRoom(muteKey, 60 * 60 * 1000); bell = false; }}>For 1 hour</button>
    <button type="button" onclick={() => { muteRoom(muteKey, 8 * 60 * 60 * 1000); bell = false; }}>For 8 hours</button>
    <button type="button" onclick={() => { muteRoom(muteKey, 24 * 60 * 60 * 1000); bell = false; }}>For 24 hours</button>
    <button type="button" onclick={() => { muteRoom(muteKey, 'forever'); bell = false; }}>Until I turn it back on</button>
    {#if muted}<button type="button" onclick={() => { muteRoom(muteKey, 0); bell = false; }}>Unmute</button>{/if}
  </div>
{/if}
{#if showBoard}
  <div class="call-board" class:wide={wideOpen || (showBoard && ui.streamUi?.hideChat)} class:focus={!!(remoteSharer || mineStream)}>
    <div class="call-tiles">
      {#if remoteSharer && !ui.streamUi?.watching}
        <button type="button" class="watch-tile" onclick={watchStream}>Watch Stream</button>
      {/if}
      {#if mineStream || (ui.streamUi?.watching && (streamLive || remoteSharer))}
        <div class="stream-tile" class:main={!!ui.streamUi?.watching} onclick={() => (wideOpen ? dockStream() : setStream({ watching: true }))}>
          {#key ui.screen?.at}
            {#if ui.screen?.remote && !mineStream}
              <video class="call-video" autoplay playsinline use:attach={remoteScreen}></video>
            {:else if ui.screen?.local}
              <video class="call-video" autoplay playsinline muted use:attach={localScreen}></video>
            {/if}
          {/key}
          <div class="tile-hover" onclick={(event) => event.stopPropagation()}>
            <button type="button" title="Full screen" onclick={(event) => fillScreen(event.currentTarget.closest('.stream-tile'))}><Maximize2 size={16} /></button>
            <button type="button" title="Pop out" onclick={popOutStream}><PictureInPicture2 size={16} /></button>
            {#if !mineStream}<button type="button" title="Stop watching" onclick={stopWatching}><EyeOff size={16} /></button>{/if}
            {#if wideOpen}<button type="button" title="Pop down" onclick={dockStream}><ChevronLeft size={16} /></button>{/if}
          </div>
          <span class="tile-name">{sharer?.displayName || sharer?.username || 'Stream'}</span>
          {#if mineStream}<em class="watch-count"><Eye size={14} /> {watcherCount}</em>{/if}
        </div>
      {/if}
      <div class="call-people">
        {#each boardPeople as person (person.id)}
          <div class="person-tile" class:speaking={person.speaking}>
            <Avatar user={person} size={72} />
            <span>{person.displayName || person.username}</span>
          </div>
        {/each}
      </div>
    </div>
    <div class="call-controls">
      {#if ui.voice?.serverId === 'call'}
        <button type="button" class:on={ui.voice.muted} title={ui.voice.muted ? 'Unmute' : 'Mute'} onclick={toggleMute}>
          {#if ui.voice.muted}<MicOff size={18} />{:else}<Mic size={18} />{/if}
        </button>
        <button type="button" class:on={ui.voice.deafened} title={ui.voice.deafened ? 'Undeafen' : 'Deafen'} onclick={toggleDeafen}>
          {#if ui.voice.deafened}<HeadphoneOff size={18} />{:else}<Headphones size={18} />{/if}
        </button>
        <button type="button" class:on={ui.voice.sharing} title={ui.voice.sharing ? 'Stop sharing' : 'Share your screen'} onclick={toggleShare}>
          <Monitor size={18} />
        </button>
        <button type="button" class="hang" title="Hang up" onclick={leaveVoice}><PhoneOff size={18} /></button>
      {:else if !ui.voice}
        <button type="button" class="join-cam" title="Join call" onclick={joinOpenCall}><Video size={18} /></button>
        <button type="button" class="join-back" title="Join call" onclick={joinOpenCall}><Phone size={18} /></button>
      {/if}
      <button type="button" class="hide-chat" onclick={toggleChat}>{ui.streamUi?.hideChat ? 'Show chat' : 'Hide chat'}</button>
    </div>
  </div>
{/if}
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
      <h2>{ui.mode === 'dm' ? (ui.dmUser?.displayName || 'Direct message') : ui.mode === 'group' ? (ui.group?.name || 'Group') : ui.mode === 'thread' ? (ui.thread?.name || 'Thread') : '#' + (channel?.name || 'channel')}</h2>
      <p>{ui.mode === 'dm' ? 'This is the start of your conversation.' : ui.mode === 'group' ? 'Welcome to the beginning of the ' + (ui.group?.name || 'group') + ' group.' : ui.mode === 'thread' ? 'Welcome to #' + (ui.thread?.name || 'thread') + '. This is the start of the thread.' : 'This is the start of the channel. Say hi.'}</p>
    </div>
  {/if}
  {#each ui.messages as msg, index (msg.clientKey || msg.id)}
    {#if dayKey(msg.createdAt) && dayKey(msg.createdAt) !== dayKey(ui.messages[index - 1]?.createdAt)}
      <div class="day-line"><span>{dayLabel(msg.createdAt)}</span></div>
    {/if}
    {#if msg.kind === 'call'}
      <div class="call-note">
        <Phone size={16} />
        <span>
          {#if msg.callMissed && String(msg.authorId) !== String(ui.me?.id)}
            You missed a call from <Name user={liveAuthor(msg.author)} />.
          {:else if msg.callMissed}
            Your call wasn't answered.
          {:else}
            <Name user={liveAuthor(msg.author)} /> started a call{msg.callSeconds ? ' that lasted ' + callLength(msg.callSeconds) : ''}.
            {#if msg.id === liveCallMessage}<button type="button" class="join-link" onclick={joinOpenCall}>Join the call</button>{/if}
          {/if}
        </span>
        <time>{time(msg.createdAt)}</time>
      </div>
    {:else}
    <article class="msg" class:has-reply={messageReplies(msg).length > 0} class:many={messageReplies(msg).length > 1} class:mentioned={mentionsMessage(msg)} class:picked={replyTargets.some((row) => row.id === msg.id)} class:menu-open={menu?.id === msg.id} class:pending={msg.pending} class:flash={flashId === msg.id} data-id={msg.id} onclick={(e) => onMessageClick(e, msg)} oncontextmenu={(e) => { if (!msg.pending && !msg.failed) openMenu(e, msg); }} onpointerdown={(e) => pressStart(e, msg)} onpointerup={pressEnd} onpointercancel={pressEnd} onpointerleave={pressEnd}>
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
          <div class="msg-content" class:jumbo={emojiScale(msg.content) === 'jumbo'} class:jumbo-mid={emojiScale(msg.content) === 'jumbo-mid'} class:jumbo-sm={emojiScale(msg.content) === 'jumbo-sm'}>{@html formatContent(msg.content, emoji, stickers, namesFor(msg))}</div>
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
              <button type="button" class:on={react.me} title={reactWho(react)} onclick={() => onReact(msg.id, react.emoji)} onmouseenter={(e) => { showReactTip(e, react); loadReactors(msg); }} onmouseleave={() => (reactTip = null)}>
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
    {/if}
  {/each}
</div>
{#if reactTip}
  <div class="react-tip" style="left:{reactTip.x}px;top:{reactTip.y}px">{reactTip.text}</div>
{/if}
{#if reactionView}
  {@const viewed = ui.messages.find((row) => row.id === reactionView)}
  {@const rows = viewed?.reactions || []}
  {@const chosen = rows.find((row) => row.emoji === reactionPick) || rows[0]}
  <div class="overlay react-overlay" role="presentation" onclick={() => (reactionView = '')}>
    <div class="sheet react-sheet" role="dialog" onclick={(e) => e.stopPropagation()}>
      <div class="sheet-h">
        <h3>Reactions</h3>
        <button class="btn icon" type="button" aria-label="Close" onclick={() => (reactionView = '')}><X size={16} /></button>
      </div>
      <div class="react-board">
        <aside>
          {#each rows as row}
            <button type="button" class:on={(chosen && chosen.emoji) === row.emoji} onclick={() => (reactionPick = row.emoji)}>
              {#if emojiSrc(row.emoji)}<img src={emojiSrc(row.emoji)} alt="" />{:else}<span>{row.emoji}</span>{/if}
              <em>{row.count}</em>
            </button>
          {/each}
        </aside>
        <div class="react-people">
          {#each chosen?.users || [] as person (person.id)}
            <button type="button" onclick={() => openPopout(person, window.innerWidth / 2, 120)}>
              <Avatar user={person} size={36} dot={false} />
              <span>
                <strong>{person.displayName || person.username}</strong>
                <em>@{person.username}</em>
              </span>
            </button>
          {:else}
            <p class="hint">Nobody is on this reaction.</p>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
{#if menu && phoneMenu}
  {@const current = ui.messages.find((msg) => msg.id === menu.id)}
  <div class="msg-sheet-back" role="presentation" onclick={() => (menu = null)}>
    <div class="msg-sheet" role="dialog" aria-label="Message actions" onclick={(e) => e.stopPropagation()}>
      {#if menu.react}
        <button type="button" class="sheet-back" onclick={() => (menu = { ...menu, react: false })}><ChevronLeft size={18} /> Quick reactions</button>
        <Picker onpick={(emoji) => current && onReact(current.id, emoji)} />
      {:else}
        <div class="menu-reacts">
          {#each holdReacts as glyph}
            <button type="button" onclick={() => current && onReact(current.id, glyph)}>{glyph}</button>
          {/each}
          <button type="button" class="react-more" title="All emoji" onclick={() => (menu = { ...menu, react: true })}><Smile size={22} /></button>
        </div>
        {#if current?.reactions?.length}
          <button type="button" onclick={() => openReactions(current)}><SmilePlus size={16} /> View Reactions</button>
        {/if}
        {#if current && menu.mine}
          <button type="button" onclick={() => beginEdit(current)}><Pencil size={16} /> Edit Message</button>
        {/if}
        {#if current}
          <button type="button" onclick={() => beginReply(current)}><Reply size={16} /> {replyTargets.some((row) => row.id === current.id) ? 'Remove Reply' : 'Reply'}</button>
          <button type="button" onclick={() => beginForward(current)}><Forward size={16} /> Forward</button>
          <button type="button" onclick={() => onPin(current)}><Pin size={16} /> {current.pinned ? 'Unpin Message' : 'Pin Message'}</button>
          {#if developerMode()}
            <button type="button" onclick={() => copyText(current.id, 'message ID')}>Copy Message ID</button>
            <button type="button" onclick={() => copyText(current.author?.id, 'user ID')}>Copy User ID</button>
          {/if}
          {#if ui.mode === 'chat'}
            <button type="button" onclick={() => createThread(current)}><MessagesSquare size={16} /> Create Thread</button>
          {/if}
          <button type="button" onclick={() => { copyText(messageLink(current), 'message link'); menu = null; }}><Link size={16} /> Copy Message Link</button>
          <button type="button" onclick={() => { markUnread(current); menu = null; }}><Mail size={16} /> Mark Unread</button>
          {#if !menu.mine}
            <button type="button" class="danger" onclick={() => { ui.dialog = { kind: 'user-report', user: current.author, message: current }; menu = null; }}><Flag size={16} /> Report Message</button>
          {/if}
        {/if}
        {#if current && menu.mine}
          <button type="button" class="danger" onclick={() => onDelete(current.id)}><Trash2 size={16} /> Delete Message</button>
        {/if}
      {/if}
    </div>
  </div>
{:else if menu}
  {@const current = ui.messages.find((msg) => msg.id === menu.id)}
  <div class="msg-menu" style="left:{menu.x}px;top:{menu.y}px" onclick={(e) => e.stopPropagation()}>
    {#if current?.reactions?.length}
      <button type="button" onclick={() => openReactions(current)}><SmilePlus size={16} /> View Reactions</button>
    {/if}
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
      <button type="button" onclick={() => onPin(current)}><Pin size={16} /> {current.pinned ? 'Unpin Message' : 'Pin Message'}</button>
      {#if developerMode()}
        <button type="button" onclick={() => copyText(current.id, 'message ID')}>Copy Message ID</button>
        <button type="button" onclick={() => copyText(current.author?.id, 'user ID')}>Copy User ID</button>
      {/if}
      {#if ui.mode === 'chat'}
        <button type="button" onclick={() => createThread(current)}><MessagesSquare size={16} /> Create Thread</button>
      {/if}
      <button type="button" onclick={() => { copyText(messageLink(current), 'message link'); menu = null; }}><Link size={16} /> Copy Message Link</button>
      <button type="button" onclick={() => { markUnread(current); menu = null; }}><Mail size={16} /> Mark Unread</button>
      {#if !menu.mine}
        <button type="button" class="danger" onclick={() => { ui.dialog = { kind: 'user-report', user: current.author, message: current }; menu = null; }}><Flag size={16} /> Report Message</button>
      {/if}
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
  <p class="typing" class:on={!!typingPhrase.kind} aria-live="polite">
    {#if typingHold.kind === 'one'}
      <strong>{typingHold.names[0]}</strong> is typing
    {:else if typingHold.kind === 'two'}
      <strong>{typingHold.names[0]}</strong> and <strong>{typingHold.names[1]}</strong> are typing
    {:else if typingHold.kind === 'many'}
      Several people are typing
    {/if}
    <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
  </p>
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
      onfocus={onComposerFocus}
      onblur={noteTypingBlur}
      maxlength="2000"
      disabled={locked}
      placeholder={locked ? 'Finish onboarding before you chat' : ui.editing ? 'Edit message' : ui.mode === 'dm' ? 'Message @' + (ui.dmUser?.username || '') : ui.mode === 'group' ? 'Message ' + (ui.group?.name || 'group') : ui.mode === 'thread' ? 'Message #' + (ui.thread?.name || 'thread') : 'Message #' + (channel?.name || 'channel')}
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
</div>
{#if miniOpen}
  <div class="mini-stream">
    <button type="button" class="mini-back" onclick={openWide}><ChevronLeft size={16} /> {ui.voice?.name || 'Call'}</button>
    {#key ui.screen?.at}
      {#if ui.screen?.remote && !mineStream}
        <video autoplay playsinline use:attach={remoteScreen}></video>
      {:else if ui.screen?.local}
        <video autoplay playsinline muted use:attach={localScreen}></video>
      {/if}
    {/key}
    <div class="mini-bar">
      <strong>{sharer?.displayName || sharer?.username || 'Stream'}</strong>
      {#if mineStream}<em class="watch-count"><Eye size={14} /> {watcherCount}</em>{/if}
      <button type="button" title="Pop out" onclick={popOutStream}><PictureInPicture2 size={16} /></button>
      {#if mineStream}
        <button type="button" title="Stream settings" onclick={() => (gearOpen = !gearOpen)}><Settings size={16} /></button>
      {/if}
      <button type="button" title={mineStream ? 'Hide preview' : 'Stop watching'} onclick={stopWatching}><X size={16} /></button>
    </div>
    {#if gearOpen && mineStream}
      <div class="stream-gear">
        <button type="button" onclick={() => { gearOpen = false; toggleShare(); }}>Stop streaming</button>
        <button type="button" onclick={() => { gearOpen = false; changeShare(); }}>Change stream</button>
      </div>
    {/if}
  </div>
{/if}
{#if ui.dock}<Dock />{/if}
</div>
