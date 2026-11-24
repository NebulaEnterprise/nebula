<script>
  import {
    X, Search, Image, Palette, Hash, Calendar, Smile, Sticker, UserRound, Bell, Shield,
    Flag, ScrollText, Trash2, Users, Crown, Ban, Bot, Webhook, DoorOpen, Plus, ChevronLeft,
    ChevronUp, ChevronDown, Copy, Pencil, Clock, Undo2, MoreHorizontal, GripVertical,
  } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Select from './Select.svelte';
  import { ui, guildAction, reloadSettings, toast, loadMembers, keepServerKey, serverInvite, openServer, hasPerm, placeChannel } from '../state.svelte.js';
  import Events from './Events.svelte';
  import { newRoomKey } from '../vault.js';
  import { PERM, PERM_GROUPS, TAG_ICONS, hasBit, setBit, initial } from '../format.js';
  import { readSmallImage } from '../image.js';
  import { api, webhookUrl } from '../api.js';

  const SWATCHES = ['#f23f43', '#f97316', '#23a559', '#1abc9c', '#3b82f6', '#8b5cf6', '#ec4899', '#eab308'];
  const TAG_COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#f47b67', '#9b59b6', '#3498db', '#e67e22', '#1abc9c'];
  const NAV = [
    { label: 'Overview', pages: [
      { id: 'overview', label: 'Overview', icon: Image, keys: 'profile icon banner name tag discovery description invite vanity template links rules tickets clips transfer delete hide server list' },
      { id: 'theme', label: 'Theme', icon: Palette, keys: 'accent colour color tint background' },
      { id: 'channels', label: 'Channels', icon: Hash, keys: 'category reorder text voice' },
    ]},
    { label: 'Community', pages: [
      { id: 'events', label: 'Events', icon: Calendar, keys: 'event calendar game night' },
      { id: 'emoji', label: 'Emoji', icon: Smile, keys: 'emojis upload' },
      { id: 'stickers', label: 'Stickers', icon: Sticker, keys: 'sticker upload' },
      { id: 'onboarding', label: 'Onboarding', icon: UserRound, keys: 'questions starting channel' },
      { id: 'pings', label: 'Ping roles', icon: Bell, keys: 'announcements mentions' },
    ]},
    { label: 'Safety', pages: [
      { id: 'safety', label: 'Safety', icon: Shield, keys: 'raid lock verification join' },
      { id: 'reports', label: 'Reports', icon: Flag, keys: 'review handled' },
      { id: 'audit', label: 'Audit log', icon: ScrollText, keys: 'who changed' },
      { id: 'trash', label: 'Trash', icon: Trash2, keys: 'deleted restore' },
    ]},
    { label: 'Members', pages: [
      { id: 'members', label: 'Members', icon: Users, keys: 'kick ban timeout nickname' },
      { id: 'roles', label: 'Roles', icon: Crown, keys: 'permissions administrator manage channels' },
      { id: 'bans', label: 'Bans', icon: Ban, keys: 'unban voice' },
      { id: 'requests', label: 'Join requests', icon: DoorOpen, keys: 'apply approve' },
    ]},
    { label: 'Apps', pages: [
      { id: 'webhooks', label: 'Webhooks', icon: Webhook, keys: 'webhook url post apps' },
      { id: 'bots', label: 'Bots', icon: Bot, keys: 'apps' },
    ]},
  ];

  let name = $state(ui.settings?.name || '');
  let tag = $state(ui.settings?.tag || '');
  let tagIcon = $state(ui.settings?.tagIcon || '');
  let tagColor = $state(ui.settings?.tagColor || '');
  let vanity = $state(ui.settings?.official ? 'nebula' : (ui.settings?.vanity || ''));
  let accent = $state(ui.settings?.theme?.accent || ui.settings?.color || '#7c6af7');
  let tint = $state(ui.settings?.theme?.tint || '');
  let about = $state(ui.settings?.about || '');
  let discover = $state(ui.settings?.discover === true);
  let iconUrl = $state('');
  let bannerUrl = $state('');
  let assetName = $state('');
  let q = $state('');
  let navQuery = $state('');
  let tags = $state(Array.isArray(ui.settings?.tags) ? ui.settings.tags.join(', ') : (ui.settings?.tags || ''));
  let links = $state(Array.isArray(ui.settings?.links) ? ui.settings.links.map((item) => ({ label: item.label || '', url: item.url || '' })) : []);
  let rulesId = $state(ui.settings?.rulesChannelId || '');
  let tickets = $state(!!ui.settings?.tickets);
  let clips = $state(ui.settings?.clips !== false);
  let verify = $state(ui.settings?.verification || 'none');
  let joinMode = $state(ui.settings?.joinMode || 'open');
  let joinQ = $state(ui.settings?.joinQuestions?.[0] || '');
  let raidOn = $state(!!ui.settings?.raid?.on);
  let raidJoin = $state(String(ui.settings?.raid?.joinHours || 1));
  let newAccounts = $state(String(ui.settings?.raid?.accountDays || 0));
  let raidFor = $state(String(ui.settings?.raid?.durationHours || 6));
  let obOn = $state(!!ui.settings?.onboarding?.enabled);
  let obMust = $state(!!ui.settings?.onboarding?.mustFinish);
  let startChannel = $state(ui.settings?.onboarding?.startChannelId || '');
  let questions = $state((ui.settings?.onboarding?.questions || []).map((item) => ({ ...item })));
  let reportTab = $state('open');
  let serverHooks = $state([]);
  let hookChannel = $state('');
  let serverBots = $state([]);
  let myBots = $state([]);
  let botPick = $state('');
  let botNote = $state('');
  let hookNote = $state('');
  let menuFor = $state('');
  let roleFilter = $state('');
  let memberKind = $state('all');
  let memberSort = $state('new');
  let lastMove = $state(null);
  let transferOpen = $state(false);
  let transferQ = $state('');
  let roleEdit = $state('');
  let roleTab = $state('display');
  let editName = $state('');
  let editColor = $state('#99aab5');
  let editBits = $state(PERM.VIEW + PERM.SEND);
  let editIcon = $state('');
  let editMention = $state([]);
  let editHoist = $state(false);
  let adding = $state(false);
  let held = $state([]);
  let addQ = $state('');
  let banUid = $state('');
  let banReason = $state('');
  let roster = $state([]);
  let rosterFor = $state('');
  let rosterOk = $state(false);

  const s = $derived(ui.settings || {});
  const ownerHere = $derived(!!ui.serverMeta?.owner);
  const canKick = $derived(ownerHere || hasPerm(PERM.KICK));
  const canBan = $derived(ownerHere || hasPerm(PERM.BAN));
  const canTimeout = $derived(ownerHere || hasPerm(PERM.TIMEOUT));
  const canNick = $derived(ownerHere || hasPerm(PERM.MANAGE_NICKS));
  const people = $derived.by(() => {
    const serverId = s.id || ui.serverId;
    const saved = (s.members || []).filter((member) => member?.id);
    const sidebar = ui.serverId === serverId ? (ui.members || []) : [];
    const live = rosterOk && rosterFor === serverId ? roster : null;
    const source = live || [...saved, ...sidebar];
    const map = new Map();
    for (const member of source) {
      if (!member?.id) continue;
      const prev = map.get(member.id) || {};
      map.set(member.id, { ...prev, ...member, roles: member.roles || prev.roles, roleIds: member.roleIds || prev.roleIds });
    }
    return [...map.values()];
  });
  const customRoles = $derived((s.roles || []).filter((role) => role.id !== 'everyone' && role.id !== 'here' && role.id !== 'owner'));
  const textChannels = $derived((s.channels || []).filter((ch) => ch.type !== 'voice'));
  const voiceChannels = $derived((s.channels || []).filter((ch) => ch.type === 'voice'));
  const openReports = $derived((s.reports || []).filter((item) => item.status === 'open'));
  const pageMeta = $derived(NAV.flatMap((group) => group.pages).find((page) => page.id === ui.settingsPage));
  const visibleNav = $derived.by(() => {
    const query = navQuery.trim().toLowerCase();
    return NAV.map((group) => ({
      ...group,
      pages: group.pages.filter((page) => !query || page.label.toLowerCase().includes(query) || page.keys.includes(query)),
    })).filter((group) => group.pages.length);
  });
  const shownMembers = $derived.by(() => {
    const query = q.trim().toLowerCase();
    let list = people.filter((member) => {
      const blob = (member.nick + ' ' + member.displayName + ' ' + member.username + ' ' + member.uid).toLowerCase();
      if (query && !blob.includes(query)) return false;
      if (roleFilter && !memberRoleIds(member).includes(roleFilter)) return false;
      if (memberKind === 'bots' && !member.bot) return false;
      if (memberKind === 'people' && member.bot) return false;
      return true;
    });
    const stamp = (member) => Date.parse(member.joinedAt || member.joined || member.createdAt || '') || 0;
    if (memberSort === 'new') list = [...list].sort((a, b) => stamp(b) - stamp(a));
    else if (memberSort === 'old') list = [...list].sort((a, b) => stamp(a) - stamp(b));
    else list = [...list].sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return list;
  });
  const titleCount = $derived(
    ui.settingsPage === 'members' ? people.length
      : ui.settingsPage === 'bans' ? (s.bans || []).length
        : ui.settingsPage === 'reports' ? openReports.length
          : null
  );
  const verifyCopy = {
    none: 'Anyone in the server can talk right away.',
    low: 'Accounts must be older than 5 minutes.',
    medium: 'Accounts older than 5 minutes, and in this server for 5 minutes.',
    high: 'Medium, plus a verified email.',
  };
  const editing = $derived((s.roles || []).find((role) => role.id === roleEdit) || null);
  const adminOn = $derived(hasBit(editBits, PERM.ADMIN));
  const holders = $derived(people.filter((member) => held.includes(member.id)));
  const outsiders = $derived(people.filter((member) => !held.includes(member.id) && member.id !== 'here'));

  $effect(() => {
    const query = navQuery.trim();
    if (!query) return;
    const pages = visibleNav.flatMap((group) => group.pages);
    if (pages.length && !pages.some((page) => page.id === ui.settingsPage)) ui.settingsPage = pages[0].id;
  });

  function displayName(member) {
    return member?.nick || member?.displayName || member?.username || 'Someone';
  }

  function memberRoleIds(member) {
    return (member?.roles || member?.roleIds || []).map((role) => (typeof role === 'string' ? role : role?.id)).filter(Boolean);
  }

  function roleNames(member) {
    return (member?.roles || []).filter((role) => role && typeof role === 'object' && role.id && role.name && role.id !== 'everyone' && role.id !== 'here' && role.id !== 'owner');
  }

  function joinedLabel(member) {
    const iso = member?.joinedAt || member?.joined || '';
    if (iso) return 'Joined ' + ago(iso);
    return ago(member?.createdAt);
  }

  async function loadRoster() {
    const serverId = ui.settings?.id || ui.serverId;
    if (!serverId) return;
    try {
      const data = await api('/api/members?serverId=' + encodeURIComponent(serverId));
      if ((ui.settings?.id || ui.serverId) !== serverId) return;
      roster = data.members || [];
      rosterFor = serverId;
      rosterOk = true;
    } catch (_) {
      if ((ui.settings?.id || ui.serverId) !== serverId) return;
      rosterOk = false;
    }
  }

  $effect(() => {
    const serverId = ui.settings?.id || ui.serverId;
    if (!ui.serverSettings || !serverId) return;
    loadRoster();
  });

  async function saveLinks() {
    const next = links
      .map((link) => ({ label: String(link.label || '').trim(), url: String(link.url || '').trim() }))
      .filter((link) => link.label && /^https?:\/\//i.test(link.url))
      .slice(0, 8);
    const ok = await run(() => guildAction({ type: 'settings', links: next }));
    if (!ok) return;
    const saved = Array.isArray(ui.settings?.links) ? ui.settings.links : next;
    links = saved.map((item) => ({ label: item.label || '', url: item.url || '' }));
    ui.links = saved;
  }

  function ago(iso) {
    const then = Date.parse(iso || '');
    if (!then) return '';
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 60) return mins + 'm ago';
    const hours = Math.round(mins / 60);
    if (hours < 48) return hours + 'h ago';
    return Math.round(hours / 24) + 'd ago';
  }

  function established() {
    const then = Date.parse(s.createdAt || '');
    if (!then) return '';
    return new Date(then).toLocaleDateString([], { month: 'short', year: 'numeric' });
  }

  async function loadServerHooks() {
    hookNote = '';
    try {
      const data = await api('/api/servers/' + ui.serverId + '/webhooks');
      serverHooks = data.webhooks || [];
      if (!hookChannel) {
        const first = (ui.channels || []).find((ch) => ch.type !== 'voice');
        hookChannel = first ? first.id : '';
      }
    } catch (err) {
      serverHooks = [];
      hookNote = err.status === 404
        ? 'Webhooks need the updated server. Replace server.js and start it again.'
        : err.message;
    }
  }

  $effect(() => {
    if (ui.settingsPage !== 'webhooks' || !ui.serverId) return;
    loadServerHooks();
  });

  async function loadServerBots() {
    botNote = '';
    try {
      const data = await api('/api/servers/' + ui.serverId + '/bots');
      serverBots = data.bots || [];
      myBots = data.mine || [];
      if (!botPick || !myBots.some((bot) => bot.id === botPick)) {
        const next = myBots.find((bot) => !serverBots.some((row) => row.id === bot.id));
        botPick = next ? next.id : '';
      }
    } catch (err) {
      serverBots = [];
      myBots = [];
      botNote = err.status === 404
        ? 'Bots need the updated server. Replace server.js and start it again.'
        : err.message;
    }
  }

  $effect(() => {
    if (ui.settingsPage !== 'bots' || !ui.serverId) return;
    loadServerBots();
  });

  async function run(fn) {
    try {
      await fn();
      await reloadSettings();
      toast('Saved');
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  }

  async function saveProfile() {
    const body = { name, color: accent, theme: { accent, tint: '' } };
    if (iconUrl) body.iconUrl = iconUrl;
    if (bannerUrl) body.bannerUrl = bannerUrl;
    await run(() => guildAction({ type: 'settings', ...body }));
  }

  async function saveDiscovery(next) {
    const previous = discover;
    discover = next;
    const ok = await run(async () => {
      let roomKey = s.roomKey || '';
      if (discover && !roomKey) roomKey = newRoomKey();
      if (discover && roomKey) keepServerKey(ui.serverId, roomKey);
      await guildAction({ type: 'settings', discover, roomKey: discover ? roomKey : '' });
    });
    discover = ok ? ui.settings?.discover === true : previous;
  }

  async function pickFile(event, kind) {
    try {
      const url = await readSmallImage(event.target.files[0]);
      if (kind === 'icon') iconUrl = url;
      else bannerUrl = url;
    } catch (err) {
      toast(err.message);
    }
  }

  function openRole(role) {
    if (!role) return;
    roleEdit = role.id;
    roleTab = 'display';
    adding = false;
    editName = role.name || '';
    editColor = role.color || '#99aab5';
    editBits = Number(role.permissions) || 0;
    editIcon = role.icon || '';
    editHoist = !!role.hoist;
    editMention = [...(role.mentionBy || [])];
    held = people.filter((member) => memberRoleIds(member).includes(role.id)).map((member) => member.id);
  }

  async function createRole() {
    try {
      const data = await api('/api/servers/' + ui.serverId + '/roles', {
        method: 'POST',
        body: { name: 'new role', color: '#99aab5', permissions: PERM.VIEW + PERM.SEND },
      });
      await reloadSettings();
      const id = data?.role?.id || data?.id;
      const fresh = (ui.settings?.roles || []).find((role) => role.id === id)
        || [...(ui.settings?.roles || [])].reverse().find((role) => role.name === 'new role' && role.id !== 'everyone');
      if (fresh) openRole(fresh);
      else toast('Role created');
    } catch (err) {
      toast(err.message);
    }
  }

  async function saveRole() {
    if (!editing) return;
    const tab = roleTab;
    const body = { color: editColor, icon: editIcon, permissions: editBits, mentionBy: editMention, hoist: editing.id !== 'everyone' && editing.id !== 'here' && editing.id !== 'owner' && editHoist };
    if (editing.id !== 'everyone' && editing.id !== 'here') body.name = editName.trim() || editing.name;
    const ok = await run(() => api('/api/servers/' + ui.serverId + '/roles/' + editing.id, { method: 'PATCH', body }).then(() => loadMembers()));
    if (ok) {
      const fresh = (ui.settings?.roles || []).find((role) => role.id === roleEdit);
      if (fresh) {
        openRole(fresh);
        roleTab = tab;
      }
    }
  }

  async function deleteRole(role) {
    if (!role || role.id === 'everyone' || role.id === 'here' || role.id === 'owner') return;
    if (!confirm('Delete the ' + role.name + ' role?')) return;
    try {
      await api('/api/servers/' + ui.serverId + '/roles/' + role.id, { method: 'DELETE' });
      roleEdit = '';
      await reloadSettings();
      await loadMembers();
      toast('Role deleted');
    } catch (err) {
      toast(err.message);
    }
  }

  async function give(member, action) {
    if (!editing) return;
    try {
      await api('/api/servers/' + ui.serverId + '/members/' + member.id + '/roles', {
        method: 'POST',
        body: { roleId: editing.id, action },
      });
      await reloadSettings();
      await loadMembers();
      held = action === 'add' ? [...new Set([...held, member.id])] : held.filter((id) => id !== member.id);
      toast(action === 'add' ? 'Role given' : 'Role removed');
    } catch (err) {
      toast(err.message);
    }
  }

  async function giveAll() {
    const pending = outsiders.slice();
    if (!pending.length) return;
    for (const member of pending) {
      try {
        await api('/api/servers/' + ui.serverId + '/members/' + member.id + '/roles', {
          method: 'POST',
          body: { roleId: editing.id, action: 'add' },
        });
        held = [...new Set([...held, member.id])];
      } catch (err) {
        toast(err.message);
        break;
      }
    }
    await reloadSettings();
    await loadMembers();
  }

  async function moveChannel(ch, dir) {
    lastMove = { id: ch.id, dir: dir === 'up' ? 'down' : 'up' };
    await run(() => guildAction({ type: 'move-channel', channelId: ch.id, dir }));
  }

  let dragCh = $state('');
  let dragCat = $state('');

  async function dropChannel(target) {
    const from = (s.channels || []).find((ch) => ch.id === dragCh) || (ui.channels || []).find((ch) => ch.id === dragCh);
    dragCh = '';
    if (!from || !target || from.id === target.id) return;
    if (from.type !== target.type || (from.categoryId || '') !== (target.categoryId || '')) return;
    try {
      await placeChannel(from, target);
      await reloadSettings();
    } catch (err) {
      toast(err.message);
    }
  }

  async function dropCategory(id) {
    const from = dragCat;
    dragCat = '';
    if (!from || from === id) return;
    const list = s.categories || [];
    const start = list.findIndex((cat) => cat.id === from);
    const dest = list.findIndex((cat) => cat.id === id);
    if (start < 0 || dest < 0) return;
    const dir = dest > start ? 'down' : 'up';
    try {
      for (let i = 0; i < Math.abs(dest - start); i += 1) {
        await guildAction({ type: 'category-move', categoryId: from, dir });
      }
      await reloadSettings();
    } catch (err) {
      toast(err.message);
    }
  }

  async function uploadAsset(event) {
    try {
      const url = await readSmallImage(event.target.files[0]);
      await guildAction({ type: ui.settingsPage === 'emoji' ? 'emoji' : 'sticker', name: assetName, url });
      assetName = '';
      await reloadSettings();
      toast('Uploaded');
    } catch (err) {
      toast(err.message);
    }
  }

  async function transferTo(member) {
    const who = displayName(member);
    if (!confirm('Hand ' + (s.name || 'this server') + ' to ' + who + '? You stay in it with your roles.')) return;
    try {
      await guildAction({ type: 'transfer', userId: member.id });
      transferOpen = false;
      toast('Ownership transferred');
      await reloadSettings();
    } catch (err) {
      toast(err.message);
    }
  }

  async function deleteServer() {
    if (!confirm('Delete ' + (s.name || 'this server') + '? Everything in it goes too. No take-backs.')) return;
    try {
      await guildAction({ type: 'delete' });
      ui.serverSettings = false;
      await openServer('nebula-official');
    } catch (err) {
      toast(err.message);
    }
  }

  function toggleMention(otherId, on) {
    const next = new Set(editMention);
    if (on) next.add(otherId);
    else next.delete(otherId);
    editMention = [...next];
  }

  function permChecked(flag) {
    return flag === PERM.ADMIN ? adminOn : adminOn || hasBit(editBits, flag);
  }
</script>

{#snippet colors(value, set, allowNone)}
  <div class="gset-swatches">
    {#if allowNone}
      <button type="button" class="swatch none" class:on={!value} aria-label="Default colour" onclick={() => set('')}></button>
    {/if}
    {#each SWATCHES as color}
      <button type="button" class="swatch" class:on={String(value).toLowerCase() === color} style="background:{color}" aria-label={color} onclick={() => set(color)}></button>
    {/each}
    <label class="swatch rainbow" title="Custom colour">
      <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#7c6af7'} oninput={(e) => set(e.target.value)} />
    </label>
    <input class="gset-hex" placeholder="#rrggbb" value={value || ''} onchange={(e) => {
      const raw = e.target.value.trim();
      const next = raw.startsWith('#') ? raw : '#' + raw;
      if (/^#[0-9a-fA-F]{6}$/.test(next)) set(next);
    }} />
  </div>
{/snippet}

{#snippet bear(title, text)}
  <div class="gset-empty">
    <img src="./logo.webp?v=3" alt="" />
    <strong>{title}</strong>
    <p>{text}</p>
  </div>
{/snippet}

{#snippet channelRow(ch)}
  <div class="gset-chan" draggable="true" ondragstart={() => (dragCh = ch.id)} ondragover={(e) => e.preventDefault()} ondrop={() => dropChannel(ch)}>
    <GripVertical size={14} />
    <strong>{ch.type === 'voice' ? '🔊' : '#'} {ch.name}</strong>
    <button type="button" class="btn icon" title="Move up" onclick={() => moveChannel(ch, 'up')}><ChevronUp size={16} /></button>
    <button type="button" class="btn icon" title="Move down" onclick={() => moveChannel(ch, 'down')}><ChevronDown size={16} /></button>
  </div>
{/snippet}

<div class="overlay" onclick={() => (menuFor = '')}>
  <div class="settings" role="dialog" aria-label="Server settings">
    <aside class="set-nav gset-nav">
      <div class="set-brand">{s.name || 'Server'}</div>
      {#each visibleNav as group}
        <div class="group">{group.label}</div>
        {#each group.pages as page}
          {@const Icon = page.icon}
          <button type="button" class:on={ui.settingsPage === page.id} onclick={() => { ui.settingsPage = page.id; if (page.id !== 'roles') roleEdit = ''; }}>
            <Icon size={16} /> {page.label}
            {#if page.id === 'reports' && openReports.length}<i class="set-badge">{openReports.length}</i>{/if}
            {#if page.id === 'requests' && (s.requests || []).length}<i class="set-badge">{s.requests.length}</i>{/if}
          </button>
        {/each}
      {:else}
        <p class="hint">No settings match.</p>
      {/each}
    </aside>
    <div class="set-main gset">
      <div class="gset-bar">
        <h2>
          {pageMeta?.label || 'Settings'}
          {#if titleCount != null}<i class="gset-count">{titleCount}</i>{/if}
        </h2>
        <div class="gset-tools">
          <label class="gset-search">
            <Search size={16} />
            <input placeholder="Search settings" bind:value={navQuery} />
          </label>
          <button type="button" class="btn icon" aria-label="Close" onclick={() => (ui.serverSettings = false)}><X size={18} /></button>
        </div>
      </div>
      <div class="gset-body">
        {#if ui.settingsPage === 'overview'}
          <section class="gset-card">
            <h3>Server profile</h3>
            <p class="hint">How your server looks in invites and Discovery.</p>
            <div class="gset-profile">
              <div>
                <p class="label">Server icon</p>
                <div class="gset-icon">
                  {#if iconUrl || s.iconUrl}<img src={iconUrl || s.iconUrl} alt="" />{:else}<span>{initial(name || s.name)}</span>{/if}
                </div>
                <p class="hint">A square image works best. GIFs move here too.</p>
                <label class="btn brand gset-upload">Upload image<input type="file" accept="image/*" onchange={(e) => pickFile(e, 'icon')} /></label>
                <p class="label">Server banner</p>
                <p class="hint">A wide image at the top of the channel list.</p>
                <label class="btn brand gset-upload">Upload banner<input type="file" accept="image/*" onchange={(e) => pickFile(e, 'banner')} /></label>
                <div class="field"><label>Server name</label>
                  <div class="gset-inline">
                    <input bind:value={name} maxlength="40" />
                    <button type="button" class="btn brand" onclick={saveProfile}>Save</button>
                  </div>
                </div>
              </div>
              <div class="gset-preview">
                <div class="gset-preview-banner" style:background-image={bannerUrl || s.bannerUrl ? 'url(' + (bannerUrl || s.bannerUrl) + ')' : ''}></div>
                <div class="gset-preview-icon">
                  {#if iconUrl || s.iconUrl}<img src={iconUrl || s.iconUrl} alt="" />{:else}<span>{initial(name || s.name)}</span>{/if}
                </div>
                <strong>{name || s.name || 'Server'}</strong>
                <p><i></i> {people.filter((member) => member.online || member.status === 'online').length} online · {s.memberCount || people.length} Members</p>
                {#if established()}<p>Est. {established()}</p>{/if}
              </div>
            </div>
          </section>

          <section class="gset-card">
            <div class="gset-split">
              <div>
                <h3>Hide server list</h3>
                <p class="hint">Hides every member in the list for this server. The list disappears for everyone except roles with See Server List. Owners and administrators still see it.</p>
              </div>
              <button type="button" class="switch" class:on={!!s.hideMembers} role="switch" aria-checked={!!s.hideMembers} aria-label="Hide server list" onclick={() => run(() => guildAction({ type: 'settings', hideMembers: !s.hideMembers }))}><i></i></button>
            </div>
          </section>

          <section class="gset-card">
            <h3>Server tag</h3>
            <p class="hint">2 to 6 letters or numbers. Members can wear it next to their name.</p>
            {#if s.canCustomize}
              <div class="gset-inline">
                <input bind:value={tag} maxlength="6" placeholder="TAG" />
                <button type="button" class="btn brand" onclick={async () => {
                  const ok = await run(() => guildAction({ type: 'settings', tag, tagIcon, tagColor, vanity: s.official ? 'nebula' : vanity }));
                  if (!ok || !ui.settings) return;
                  tag = ui.settings.tag || '';
                  tagIcon = ui.settings.tagIcon || '';
                  tagColor = ui.settings.tagColor || '';
                }}>Save</button>
              </div>
              <div class="tag-icons">
                <button type="button" class:on={!tagIcon} onclick={() => (tagIcon = '')}>None</button>
                {#each TAG_ICONS as icon}
                  <button type="button" class:on={tagIcon === icon} onclick={() => (tagIcon = icon)}>{icon}</button>
                {/each}
              </div>
              <p class="label">Tag colour</p>
              <p class="hint">Pick a colour for your tag. Everyone sees it next to members' names.</p>
              <div class="tag-colors">
                {#each TAG_COLORS as color}
                  <button type="button" class:on={tagColor === color} style="background:{color}" aria-label={color} onclick={() => (tagColor = color)}>{tag || 'TAG'}</button>
                {/each}
              </div>
              {#if tag}<p class="hint">Preview <em class="tag-pill" style:background={tagColor || ''} style:color={tagColor ? '#fff' : ''}>{#if tagIcon}<i>{tagIcon}</i>{/if}{tag}</em></p>{/if}
            {:else}
              <p class="hint">This server needs 5 members before it can have a tag. It has {s.memberCount || 0}.</p>
            {/if}
          </section>

          <section class="gset-card">
            <div class="gset-split">
              <div>
                <h3>Discovery</h3>
                <p class="hint">Public by default: anyone can find and join from the compass. Listed once you have 5 members (you have {s.memberCount || 0}).</p>
              </div>
              <button type="button" class="switch green" class:on={discover} role="switch" aria-checked={discover} onclick={() => saveDiscovery(!discover)}><i></i></button>
            </div>
            <div class="field"><label>Description</label><input bind:value={about} maxlength="120" placeholder="One line about the server (shown on the card)" /></div>
            <div class="field"><label>Tags</label>
              <div class="gset-inline">
                <input bind:value={tags} maxlength="80" placeholder="Up to 5, comma-separated: gaming, music, art" />
                <button type="button" class="btn brand" onclick={() => run(() => guildAction({ type: 'settings', about, tags: tags.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 5) }))}>Save</button>
              </div>
            </div>
          </section>

          <p class="gset-kicker">Invites and sharing</p>
          <section class="gset-card">
            <h3>Custom invite link</h3>
            {#if s.canCustomize}
              <p class="hint">Unlocks at 5 members (you have {s.memberCount || people.length || 0}).</p>
              <div class="gset-inline">
                <span class="gset-prefix">nebulaapp.space/</span>
                <input bind:value={vanity} maxlength="20" placeholder="yourserver" disabled={s.official} />
                <button type="button" class="btn brand" disabled={s.official} onclick={() => run(() => guildAction({ type: 'settings', vanity: s.official ? 'nebula' : vanity }))}>Save</button>
              </div>
              {#if serverInvite(s.official ? 'nebula' : vanity)}<p class="hint">{serverInvite(s.official ? 'nebula' : vanity)}</p>{/if}
            {:else}
              <p class="hint">This server needs 5 members before the invite can be a name. It has {s.memberCount || 0}. Invites still work. They get a random link.</p>
            {/if}
          </section>
          <section class="gset-card">
            <div class="gset-split">
              <div>
                <h3>Server template</h3>
                <p class="hint">A link to start a server with the same channels, roles and permissions. No messages or members.</p>
              </div>
              <button type="button" class="btn" onclick={async () => {
                try {
                  const data = await guildAction({ type: 'template' });
                  const url = data?.url || data?.link || '';
                  if (!url) throw new Error('This server cannot make a template link yet');
                  await navigator.clipboard.writeText(url);
                  toast('Template link copied');
                } catch (err) { toast(err.message); }
              }}>Create template link</button>
            </div>
          </section>
          <section class="gset-card">
            <p class="label">Links</p>
            {#each links as link, i}
              <div class="gset-inline">
                <input bind:value={link.label} placeholder="Label" maxlength="40" />
                <input bind:value={link.url} placeholder="https://" maxlength="200" />
                <button type="button" class="btn icon" aria-label="Remove link" onclick={() => (links = links.filter((_, index) => index !== i))}><X size={15} /></button>
              </div>
            {/each}
            <div class="gset-inline">
              <button type="button" class="btn" onclick={() => (links = [...links, { label: '', url: '' }])}>+ Add link</button>
              {#if links.length}<button type="button" class="btn brand" onclick={saveLinks}>Save links</button>{/if}
            </div>
          </section>

          <p class="gset-kicker">Features</p>
          <section class="gset-card">
            <div class="gset-split">
              <div>
                <h3>Rules channel</h3>
                <p class="hint">Gets a book icon, only managers can post in it, and new members get a nudge to read it.</p>
              </div>
              <Select value={rulesId} placeholder="No rules channel" options={[{ value: '', label: 'No rules channel' }, ...textChannels.map((ch) => ({ value: ch.id, label: '# ' + ch.name }))]} onpick={(value) => { rulesId = value; run(() => guildAction({ type: 'settings', rulesChannelId: value })); }} />
            </div>
            <div class="gset-line">
              <div>
                <strong>Let members open tickets</strong>
                <p class="hint">A private channel between one member and everyone who can manage messages.</p>
              </div>
              <button type="button" class="switch" class:on={tickets} role="switch" aria-checked={tickets} onclick={() => { tickets = !tickets; run(() => guildAction({ type: 'settings', tickets })); }}><i></i></button>
            </div>
            <div class="gset-line">
              <div>
                <strong>Allow clips in voice channels</strong>
                <p class="hint">Members can save the last few seconds of a call or stream and post them.</p>
              </div>
              <button type="button" class="switch green" class:on={clips} role="switch" aria-checked={clips} onclick={() => { clips = !clips; run(() => guildAction({ type: 'settings', clips })); }}><i></i></button>
            </div>
          </section>
          <section class="gset-card gset-danger">
            <div class="gset-split">
              <div>
                <h3>Transfer ownership</h3>
                <p class="hint">Hand the server to another member. You stay in it with your roles.</p>
              </div>
              <button type="button" class="btn danger-fill" onclick={() => (transferOpen = true)}>Transfer</button>
            </div>
          </section>
          <section class="gset-card gset-danger">
            <div class="gset-split">
              <div>
                <h3>Delete server</h3>
                <p class="hint">Everything in it goes too. No take-backs.</p>
              </div>
              <button type="button" class="btn danger-fill" onclick={deleteServer}>Delete server</button>
            </div>
          </section>

        {:else if ui.settingsPage === 'theme'}
          <p class="hint">Give your server its own colour. Everyone sees it on the Invite people button and this server's icon.</p>
          <p class="label">Accent colour</p>
          <p class="hint">The invite button and the server icon use this colour.</p>
          {@render colors(accent, (value) => (accent = value || '#7c6af7'), false)}
          <div class="gset-theme-preview">
            <div class="gset-fake-av" style:background={accent}></div>
            <div>
              <strong>yapper check out <span style:color={accent}>this link</span></strong>
              <p class="hint">Looks like this for everyone in the server.</p>
              <button type="button" class="btn brand" style:background={accent}>Button</button>
            </div>
          </div>
          <div class="gset-inline">
            <button type="button" class="btn brand" onclick={() => run(() => guildAction({ type: 'settings', color: accent, theme: { accent, tint: '' } }))}>Save</button>
            <button type="button" class="btn" onclick={() => { accent = '#7c6af7'; tint = ''; run(() => guildAction({ type: 'settings', color: '#7c6af7', theme: { accent: '#7c6af7', tint: '' } })); }}>Remove theme</button>
          </div>

        {:else if ui.settingsPage === 'channels'}
          <div class="gset-split">
            <p class="hint">Drag a channel to reorder it. Members see this order in the sidebar.</p>
            <div class="gset-inline">
              {#if lastMove}<button type="button" class="btn" onclick={() => moveChannel({ id: lastMove.id }, lastMove.dir)}><Undo2 size={14} /> Undo</button>{/if}
              <button type="button" class="btn brand" onclick={() => (ui.dialog = { kind: 'category' })}>Create category</button>
            </div>
          </div>
          {#each s.categories || [] as cat}
            <div class="gset-chan head" draggable="true" ondragstart={() => (dragCat = cat.id)} ondragover={(e) => e.preventDefault()} ondrop={() => dropCategory(cat.id)}>
              <GripVertical size={14} />
              <strong>{cat.name}</strong>
              <button type="button" class="btn icon danger" title="Delete category" onclick={() => run(() => guildAction({ type: 'category-delete', categoryId: cat.id }))}><Trash2 size={16} /></button>
            </div>
            {#each (s.channels || []).filter((ch) => ch.categoryId === cat.id) as ch}
              {@render channelRow(ch)}
            {/each}
          {/each}
          <section class="gset-card">
            <div class="gset-split"><strong>Text channels</strong><i class="gset-count">{textChannels.filter((ch) => !(s.categories || []).some((cat) => cat.id === ch.categoryId)).length}</i></div>
            {#each textChannels.filter((ch) => !(s.categories || []).some((cat) => cat.id === ch.categoryId)) as ch}
              {@render channelRow(ch)}
            {/each}
            <div class="gset-split"><strong>Voice channels</strong><i class="gset-count">{voiceChannels.filter((ch) => !(s.categories || []).some((cat) => cat.id === ch.categoryId)).length}</i></div>
            {#each voiceChannels.filter((ch) => !(s.categories || []).some((cat) => cat.id === ch.categoryId)) as ch}
              {@render channelRow(ch)}
            {/each}
          </section>

        {:else if ui.settingsPage === 'events'}
          <Events />

        {:else if ui.settingsPage === 'emoji' || ui.settingsPage === 'stickers'}
          {@const list = ui.settingsPage === 'emoji' ? (s.emoji || []) : (s.stickers || [])}
          {@const cap = ui.settingsPage === 'emoji' ? 50 : 30}
          <p class="hint">{ui.settingsPage === 'emoji' ? 'Add up to 50 emojis. Everyone in this server can use them anywhere on Nebula, other servers and DMs too.' : 'Add up to 30 stickers: PNG, WebP or GIF, up to 320 px and 512 KB. Everyone in this server can send them from the sticker tab next to GIF.'}</p>
          <div class="gset-inline">
            <label class="btn brand gset-upload">Upload {ui.settingsPage === 'emoji' ? 'emoji' : 'sticker'}<input type="file" accept="image/*" onchange={uploadAsset} /></label>
            <span class="hint">{list.length} / {cap} used</span>
          </div>
          <div class="field"><label>Name</label><input bind:value={assetName} maxlength="32" placeholder={ui.settingsPage === 'emoji' ? 'wave' : 'hello'} /></div>
          {#if list.length}
            {#each list as item}
              <div class="gset-chan">
                <img src={item.url} alt="" />
                <strong class="grow">:{item.name}:</strong>
                <button type="button" class="btn sm danger" onclick={() => run(() => guildAction({ type: ui.settingsPage === 'emoji' ? 'emoji' : 'sticker', remove: true, id: item.id }))}>Remove</button>
              </div>
            {/each}
          {:else}
            <section class="gset-card">
              {@render bear(ui.settingsPage === 'emoji' ? 'No emojis yet' : 'No stickers yet', ui.settingsPage === 'emoji' ? "Upload one and it shows up in everyone's emoji picker." : "Upload one and it shows up in everyone's sticker tab.")}
              <label class="btn brand gset-upload">Upload {ui.settingsPage === 'emoji' ? 'emoji' : 'sticker'}<input type="file" accept="image/*" onchange={uploadAsset} /></label>
            </section>
          {/if}

        {:else if ui.settingsPage === 'onboarding'}
          <p class="hint">New members answer a few questions when they join. Answers can give roles, so they only see the channels they care about. Then they read the rules and land in your starting channel.</p>
          <div class="gset-line">
            <div><strong>Turn on onboarding</strong><p class="hint">Only people who join from now on go through it. Everyone can redo it from the server menu.</p></div>
            <button type="button" class="switch" class:on={obOn} role="switch" aria-checked={obOn} onclick={() => (obOn = !obOn)}><i></i></button>
          </div>
          <div class="gset-line">
            <div><strong>Must finish before chatting</strong><p class="hint">New members can read but not send messages until they finish.</p></div>
            <button type="button" class="switch" class:on={obMust} role="switch" aria-checked={obMust} onclick={() => (obMust = !obMust)}><i></i></button>
          </div>
          <p class="label">Starting channel</p>
          <Select value={startChannel} placeholder="Same as usual" options={[{ value: '', label: 'Same as usual' }, ...textChannels.map((ch) => ({ value: ch.id, label: '# ' + ch.name }))]} onpick={(value) => (startChannel = value)} />
          <p class="hint">Where people land when they finish.</p>
          <p class="label">Questions</p>
          <p class="hint">Make some roles first (Roles tab) so answers can give them. Roles with mod powers, channel mod overrides or the Tickets support role can't be used here.</p>
          {#each questions as item, i}
            <div class="gset-inline">
              <input bind:value={item.q} placeholder="Question" maxlength="120" />
              <Select value={item.roleId || ''} placeholder="Role" options={customRoles.map((role) => ({ value: role.id, label: role.name }))} onpick={(value) => (questions[i].roleId = value)} />
              <button type="button" class="btn icon" aria-label="Remove question" onclick={() => (questions = questions.filter((_, index) => index !== i))}><X size={15} /></button>
            </div>
          {/each}
          <button type="button" class="btn gset-wide" onclick={() => (questions = [...questions, { q: '', roleId: '' }])}>Add question</button>
          <button type="button" class="btn brand" onclick={() => run(() => guildAction({ type: 'settings', onboarding: { enabled: obOn, mustFinish: obMust, startChannelId: startChannel, questions } }))}>Save</button>

        {:else if ui.settingsPage === 'pings'}
          <section class="gset-card">
            <p class="hint">Members pick these themselves. A ping role never includes manage permissions.</p>
            <button type="button" class="btn" onclick={async () => {
              try {
                const names = ['Announcements', 'Giveaways', 'Updates', 'Events', 'Polls'];
                for (const label of names) {
                  if ((s.roles || []).some((role) => role.name === label)) continue;
                  await api('/api/servers/' + ui.serverId + '/roles', { method: 'POST', body: { name: label, color: '#7c6af7', permissions: PERM.VIEW } });
                }
                const fresh = (await api('/api/servers/' + ui.serverId + '/settings')).settings;
                const ids = (fresh.roles || []).filter((role) => names.includes(role.name)).map((role) => role.id);
                await guildAction({ type: 'settings', pingRoleIds: [...new Set([...(fresh.pingRoleIds || []), ...ids])] });
                await reloadSettings();
                toast('Template added');
              } catch (err) { toast(err.message); }
            }}>Add the starter roles</button>
            {#each customRoles as role}
              <label class="check">
                <input type="checkbox" checked={(s.pingRoleIds || []).includes(role.id)} onchange={async (e) => {
                  const set = new Set(s.pingRoleIds || []);
                  if (e.target.checked) set.add(role.id); else set.delete(role.id);
                  await run(() => guildAction({ type: 'settings', pingRoleIds: [...set] }));
                }} />
                {role.name}
              </label>
            {/each}
          </section>

        {:else if ui.settingsPage === 'safety'}
          <section class="gset-card">
            <h3>Raid protection</h3>
            <p class="hint">Locked: nobody new can join and only people who can manage messages can post. Nebula also locks by itself after 60 joins in a minute.</p>
            <div class="gset-inline">
              <button type="button" class="btn" onclick={() => run(() => guildAction({ type: 'lock', minutes: 15 }))}>Lock for 15 min</button>
              <button type="button" class="btn" onclick={() => run(() => guildAction({ type: 'lock', minutes: 60 }))}>Lock for 1 hour</button>
              <button type="button" class="btn" onclick={() => run(() => guildAction({ type: 'lock', minutes: 1440 }))}>Lock for a day</button>
              <button type="button" class="btn" onclick={() => run(() => guildAction({ type: 'lock', minutes: 0 }))}>Unlock</button>
            </div>
          </section>
          <section class="gset-card">
            <h3>Raid mode</h3>
            <p class="hint">Flip this when a crowd shows up to spam. Members who joined recently or whose account is new can't post, start threads or upload until it ends. Mods, bots and people with a role are never blocked.</p>
            <div class="gset-inline">
              <Select value={raidJoin} options={[{ value: '1', label: 'Joined: under 1 hour ago' }, { value: '6', label: 'Joined: under 6 hours ago' }, { value: '24', label: 'Joined: under a day ago' }]} onpick={(value) => (raidJoin = value)} />
              <Select value={newAccounts} options={[{ value: '0', label: 'Account: any age' }, { value: '1', label: 'Account: under 1 day old' }, { value: '3', label: 'Account: under 3 days old' }, { value: '7', label: 'Account: under 7 days old' }]} onpick={(value) => (newAccounts = value)} />
              <Select value={raidFor} options={[{ value: '1', label: 'For 1 hour' }, { value: '6', label: 'For 6 hours' }, { value: '12', label: 'For 12 hours' }, { value: '24', label: 'For a day' }]} onpick={(value) => (raidFor = value)} />
              <button type="button" class="btn danger-fill" onclick={() => run(() => guildAction({ type: 'settings', raid: { on: !raidOn, accountDays: Number(newAccounts) || 0, joinHours: Number(raidJoin) || 1, durationHours: Number(raidFor) || 6 } })).then(() => { raidOn = !!ui.settings?.raid?.on; })}>{raidOn ? 'Turn off raid mode' : 'Turn on raid mode'}</button>
            </div>
          </section>
          <section class="gset-card">
            <div class="gset-split">
              <div>
                <h3>Verification level</h3>
                <p class="hint">What people need before they can talk here. Mods, people with roles and bots skip it.</p>
                <p class="hint">{verifyCopy[verify] || verifyCopy.none}</p>
              </div>
              <Select value={verify} options={[{ value: 'none', label: 'None' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} onpick={(value) => (verify = value)} />
            </div>
          </section>
          <section class="gset-card">
            <div class="gset-split">
              <div>
                <h3>New accounts</h3>
                <p class="hint">Stops raids from freshly made accounts. Mods and Nebula staff are never blocked.</p>
              </div>
              <Select value={newAccounts} options={[{ value: '0', label: 'Off' }, { value: '1', label: 'Under 1 day' }, { value: '3', label: 'Under 3 days' }, { value: '7', label: 'Under 7 days' }]} onpick={(value) => (newAccounts = value)} />
            </div>
          </section>
          <section class="gset-card">
            <div class="gset-split">
              <div>
                <h3>Who can join</h3>
                <p class="hint">{joinMode === 'apply' ? 'They answer a question and you approve them.' : 'People join the moment they open the link.'}</p>
              </div>
              <Select value={joinMode} options={[{ value: 'open', label: 'Anyone with the link' }, { value: 'apply', label: 'They apply, you approve' }]} onpick={(value) => (joinMode = value)} />
            </div>
            {#if joinMode === 'apply'}
              <div class="field"><label>Question on the form</label><input bind:value={joinQ} maxlength="120" /></div>
            {/if}
          </section>
          <button type="button" class="btn brand" onclick={() => run(() => guildAction({ type: 'settings', raid: { on: raidOn, accountDays: Number(newAccounts) || 0, joinHours: Number(raidJoin) || 1, durationHours: Number(raidFor) || 6 }, verification: verify, joinMode, joinQuestions: joinQ ? [joinQ] : [] }))}>Save</button>

        {:else if ui.settingsPage === 'reports'}
          <p class="hint">Messages in this server that members reported. You can delete the message, ban the person from this server, or dismiss. Reports with clear evidence also go to Nebula's admins.</p>
          <div class="gset-inline">
            <button type="button" class="btn" class:brand={reportTab === 'open'} onclick={() => (reportTab = 'open')}>Open</button>
            <button type="button" class="btn" class:brand={reportTab === 'handled'} onclick={() => (reportTab = 'handled')}>Handled</button>
          </div>
          {#each (reportTab === 'open' ? openReports : (s.reports || []).filter((item) => item.status !== 'open')) as item}
            <div class="gset-chan">
              <div class="grow"><strong>{item.status}</strong> {item.text}</div>
              {#if item.status === 'open'}<button type="button" class="btn sm" onclick={() => run(() => guildAction({ type: 'report-handle', reportId: item.id }))}>Handled</button>{/if}
            </div>
          {:else}
            <p class="hint">Nothing to review.</p>
          {/each}

        {:else if ui.settingsPage === 'audit'}
          <section class="gset-card">
            <h3>Audit log</h3>
            <p class="hint">Who changed what in the server.</p>
            {#each s.audit || [] as item}
              <div class="gset-chan">
                <div class="grow"><strong>{item.name}</strong> {item.text}<div class="hint">{item.at}</div></div>
              </div>
            {:else}
              {@render bear('No changes yet', 'Role edits, kicks, bans and setting changes show up here.')}
            {/each}
          </section>

        {:else if ui.settingsPage === 'trash'}
          <p class="hint">Deleted channels, categories, threads and roles stay here for 7 days, messages and permissions included. Bring them back any time before that.</p>
          <section class="gset-card">
            {@render bear('The trash is empty', 'Deleted channels, categories and roles wait here for 7 days.')}
          </section>

        {:else if ui.settingsPage === 'members' && ui.hideMembers && ui.seeMembers === false}
          <section class="gset-card">
            <h3>Members</h3>
            <p class="hint">The member list is hidden. Roles with See Server List can still open it.</p>
          </section>

        {:else if ui.settingsPage === 'members'}
          <section class="gset-card">
            <h3>Members</h3>
            <p class="hint">Search, filter and sort the whole server.</p>
            <label class="gset-search wide"><Search size={16} /><input placeholder="Search by name or handle" bind:value={q} /></label>
            <div class="gset-inline">
              <Select value={roleFilter} options={[{ value: '', label: 'Any role' }, ...customRoles.map((role) => ({ value: role.id, label: role.name }))]} onpick={(value) => (roleFilter = value)} />
              <Select value={memberKind} options={[{ value: 'all', label: 'People and bots' }, { value: 'people', label: 'People' }, { value: 'bots', label: 'Bots' }]} onpick={(value) => (memberKind = value)} />
              <Select value={memberSort} options={[{ value: 'new', label: 'Newest first' }, { value: 'old', label: 'Oldest first' }, { value: 'name', label: 'Name' }]} onpick={(value) => (memberSort = value)} />
            </div>
            <p class="hint">Showing {shownMembers.length} of {people.length}</p>
            {#each shownMembers as member}
              <div class="gset-member">
                <Avatar user={member} size={36} />
                <div class="grow">
                  <strong>{displayName(member)} {#if member.bot}<em class="bot-tag">BOT</em>{/if}{#if member.id === ui.me?.id}<em class="gset-you">YOU</em>{/if}</strong>
                  <span>@{member.username}{#if member.uid} · {member.uid}{/if}</span>
                  {#if roleNames(member).length}
                    <span class="gset-roles">
                      {#each roleNames(member) as role (role.id)}
                        <i style:color={role.color || '#d7c4ea'}>{role.name}</i>
                      {/each}
                    </span>
                  {/if}
                </div>
                <span class="hint">{joinedLabel(member)}</span>
                <button type="button" class="btn icon" aria-label="Member actions" onclick={(e) => { e.stopPropagation(); menuFor = menuFor === member.id ? '' : member.id; }}><MoreHorizontal size={16} /></button>
                {#if menuFor === member.id}
                  <div class="gset-menu" role="menu" onclick={(e) => e.stopPropagation()}>
                    <button type="button" onclick={() => { navigator.clipboard.writeText(String(member.uid || member.id || '')); menuFor = ''; toast('Copied'); }}><Copy size={15} /> Copy user ID</button>
                    <button type="button" onclick={() => { menuFor = ''; ui.settingsPage = 'roles'; }}><Crown size={15} /> Roles...</button>
                    {#if canNick}
                      <button type="button" onclick={async () => {
                        menuFor = '';
                        const nick = prompt('Nickname', member.nick || '');
                        if (nick == null) return;
                        await run(() => guildAction({ type: 'nick-other', userId: member.id, nick }));
                      }}><Pencil size={15} /> Change nickname...</button>
                    {/if}
                    {#if canTimeout}
                      <button type="button" onclick={async () => {
                        menuFor = '';
                        const minutes = Number(prompt('Minutes to time out. 0 clears it.', '10'));
                        if (Number.isNaN(minutes)) return;
                        await run(() => guildAction({ type: 'timeout', userId: member.id, minutes }));
                      }}><Clock size={15} /> Time out...</button>
                    {/if}
                    {#if canKick}
                      <button type="button" class="danger" onclick={() => { menuFor = ''; if (confirm('Kick this member? They can rejoin with an invite.')) run(() => guildAction({ type: 'kick', userId: member.id })); }}><DoorOpen size={15} /> Kick from server</button>
                    {/if}
                    {#if canBan}
                      <button type="button" class="danger" onclick={async () => {
                        menuFor = '';
                        const reason = prompt('Ban reason', '') ?? '';
                        await run(() => guildAction({ type: 'ban', userId: member.id, reason }));
                      }}><Ban size={15} /> Ban from server</button>
                    {/if}
                  </div>
                {/if}
              </div>
            {:else}
              <p class="hint">No members match.</p>
            {/each}
            {#if shownMembers.length}<p class="hint gset-end">That's everyone.</p>{/if}
          </section>

        {:else if ui.settingsPage === 'roles'}
          {#if !editing}
            <section class="gset-card">
              <div class="gset-split">
                <div>
                  <h3>Roles</h3>
                  <p class="hint">Group your members and hand out permissions. Members use the colour of their highest role.</p>
                </div>
                <button type="button" class="btn brand" onclick={createRole}>Create role</button>
              </div>
              <button type="button" class="gset-role-row" onclick={() => openRole((s.roles || []).find((role) => role.id === 'everyone'))}>
                <span class="gset-dot"></span>
                <span class="grow"><strong>Default permissions</strong><em>@everyone · applies to all server members</em></span>
              </button>
              <p class="hint">Click a role to edit it. {customRoles.length} custom {customRoles.length === 1 ? 'role' : 'roles'}.</p>
              {#each customRoles as role}
                <button type="button" class="gset-role-row" onclick={() => openRole(role)}>
                  <span class="gset-dot" style:background={role.color || '#99aab5'}></span>
                  <strong class="grow">{role.icon ? role.icon + ' ' : ''}{role.name}</strong>
                  <span class="hint">{people.filter((member) => memberRoleIds(member).includes(role.id)).length}</span>
                  <Pencil size={14} />
                </button>
              {/each}
            </section>
          {:else}
            <div class="gset-role">
              <aside class="gset-role-side">
                <div class="gset-inline">
                  <button type="button" class="btn" onclick={() => (roleEdit = '')}><ChevronLeft size={16} /> Back</button>
                  <button type="button" class="btn icon" title="Create role" onclick={createRole}><Plus size={16} /></button>
                </div>
                {#each customRoles as role}
                  <button type="button" class="gset-role-row" class:on={role.id === editing.id} onclick={() => openRole(role)}>
                    <span class="gset-dot" style:background={role.color || '#99aab5'}></span>
                    <span>{role.name}</span>
                  </button>
                {/each}
                {#if (s.roles || []).some((role) => role.id === 'everyone')}
                  <button type="button" class="gset-role-row" class:on={editing.id === 'everyone'} onclick={() => openRole((s.roles || []).find((role) => role.id === 'everyone'))}>
                    <span class="gset-dot"></span>
                    <span>@everyone</span>
                  </button>
                {/if}
              </aside>
              <div>
                <div class="gset-split">
                  <strong>Edit role — {editName || editing.name}</strong>
                  <div class="gset-inline">
                    <button type="button" class="btn" onclick={() => { navigator.clipboard.writeText(String(editing.id)); toast('Copied'); }}>Copy role ID</button>
                    {#if editing.id !== 'everyone' && editing.id !== 'here' && editing.id !== 'owner'}
                      <button type="button" class="btn danger" onclick={() => deleteRole(editing)}>Delete role</button>
                    {/if}
                  </div>
                </div>
                <div class="gset-tabs">
                  <button type="button" class:on={roleTab === 'display'} onclick={() => (roleTab = 'display')}>Display</button>
                  <button type="button" class:on={roleTab === 'perms'} onclick={() => (roleTab = 'perms')}>Permissions</button>
                  <button type="button" class:on={roleTab === 'members'} onclick={() => { roleTab = 'members'; adding = false; }}>Manage Members</button>
                </div>

                {#if roleTab === 'display'}
                  <div class="field"><label>Role name</label><input bind:value={editName} maxlength="32" disabled={editing.id === 'everyone' || editing.id === 'here'} /></div>
                  <p class="label">Role colour</p>
                  <p class="hint">Members use the colour of the highest role they have on the roles list.</p>
                  {@render colors(editColor, (value) => (editColor = value || '#99aab5'), true)}
                  {#if editing.id !== 'everyone' && editing.id !== 'here'}
                    <p class="label">Role icon</p>
                    <p class="hint">Shows next to the names of people with this role. If they have a few, the highest one wins.</p>
                    <div class="tag-icons">
                      <button type="button" class:on={!editIcon} onclick={() => (editIcon = '')}>None</button>
                      {#each TAG_ICONS as icon}
                        <button type="button" class:on={editIcon === icon} onclick={() => (editIcon = icon)}>{icon}</button>
                      {/each}
                    </div>
                  {/if}
                  {#if editing.id !== 'everyone' && editing.id !== 'here' && editing.id !== 'owner'}
                    <div class="gset-line">
                      <div>
                        <strong>Display role members separately from online members</strong>
                        <p class="hint">Online members with this role show under the role name in the member list. The highest role like this wins.</p>
                      </div>
                      <button type="button" class="switch" class:on={editHoist} role="switch" aria-checked={editHoist} aria-label="Display role members separately from online members" onclick={() => (editHoist = !editHoist)}><i></i></button>
                    </div>
                  {/if}
                  <p class="label">Who can mention this role</p>
                  <div class="mention-by">
                    {#each (s.roles || []).filter((other) => other.id !== editing.id && other.id !== 'here') as other}
                      <label class="check">
                        <input type="checkbox" checked={editMention.includes(other.id)} onchange={(e) => toggleMention(other.id, e.target.checked)} />
                        {other.name}
                      </label>
                    {/each}
                  </div>
                  <p class="hint">Changes are saved when you press Save. Automatic roles are for looks. They can't carry permissions until you open Permissions.</p>
                  <button type="button" class="btn brand" onclick={saveRole}>Save</button>
                {:else if roleTab === 'perms'}
                  <p class="hint">Tick what this role can do. Administrator already includes every permission.</p>
                  {#each PERM_GROUPS as group}
                    <h3 class="gset-kicker">{group.title}</h3>
                    {#each group.items as [label, flag, desc]}
                      <label class="perm-row" class:danger={flag === PERM.ADMIN}>
                        <input type="checkbox" checked={permChecked(flag)} disabled={flag !== PERM.ADMIN && adminOn} onchange={(e) => (editBits = setBit(editBits, flag, e.target.checked))} />
                        <span><strong>{label}</strong><em>{desc}</em></span>
                      </label>
                    {/each}
                  {/each}
                  <button type="button" class="btn brand" onclick={saveRole}>Save</button>
                {:else}
                  <div class="gset-split">
                    <label class="gset-search wide"><Search size={16} /><input placeholder={adding ? 'Search members to add' : 'Search members'} bind:value={addQ} /></label>
                    {#if adding}
                      <button type="button" class="btn brand" onclick={() => (adding = false)}>Done</button>
                    {:else}
                      <button type="button" class="btn brand" onclick={() => (adding = true)}>Add members</button>
                    {/if}
                  </div>
                  {#if adding}
                    <div class="gset-split">
                      <p class="hint">{outsiders.length} {outsiders.length === 1 ? 'member does' : 'members do'}n't have {editing.name} yet</p>
                      <button type="button" class="btn" onclick={giveAll}>Give to everyone</button>
                    </div>
                    {#each outsiders.filter((member) => !addQ.trim() || displayName(member).toLowerCase().includes(addQ.trim().toLowerCase()) || String(member.username || '').toLowerCase().includes(addQ.trim().toLowerCase())) as member}
                      <div class="gset-member">
                        <Avatar user={member} size={32} dot={false} />
                        <strong class="grow">{displayName(member)}</strong>
                        <button type="button" class="btn" onclick={() => give(member, 'add')}>Add</button>
                      </div>
                    {:else}
                      <p class="hint">Nobody left to add.</p>
                    {/each}
                  {:else if holders.length}
                    {#each holders.filter((member) => !addQ.trim() || displayName(member).toLowerCase().includes(addQ.trim().toLowerCase())) as member}
                      <div class="gset-member">
                        <Avatar user={member} size={32} dot={false} />
                        <strong class="grow">{displayName(member)}</strong>
                        <button type="button" class="btn" onclick={() => give(member, 'remove')}>Remove</button>
                      </div>
                    {/each}
                  {:else}
                    <p class="hint">Nobody has this role yet.</p>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}

        {:else if ui.settingsPage === 'bans'}
          <section class="gset-card">
            <h3>Bans</h3>
            <p class="hint">Banned people can't rejoin with any invite until you unban them.</p>
            {#if (s.bans || []).length}
              {#each s.bans as ban}
                <div class="gset-chan">
                  <span class="grow">{ban.user?.displayName || ban.user?.username || ban.userId} {ban.reason || ''}</span>
                  <button type="button" class="btn sm" onclick={() => run(() => guildAction({ type: 'unban', userId: ban.userId }))}>Unban</button>
                </div>
              {/each}
            {:else}
              {@render bear('Nobody is banned', 'Peaceful. Bans you make show up here.')}
            {/if}
          </section>
          <section class="gset-card">
            <h3>Voice bans</h3>
            <p class="hint">Banned from this server's calls only.</p>
            {#if (s.voiceBans || []).length}
              {#each s.voiceBans as ban}
                <div class="gset-chan">
                  <span class="grow">{ban.user?.displayName || ban.user?.username || ban.userId} {ban.reason || ''}</span>
                  <button type="button" class="btn sm" onclick={() => run(() => guildAction({ type: 'voice-unban', userId: ban.userId }))}>Unban</button>
                </div>
              {/each}
            {:else}
              <p class="hint">Nobody is banned from voice.</p>
            {/if}
          </section>
          <section class="gset-card">
            <div class="field"><label>Ban by user id</label><input bind:value={banUid} placeholder="4" /></div>
            <div class="field"><label>Reason</label><input bind:value={banReason} maxlength="200" /></div>
            <button type="button" class="btn brand" onclick={async () => {
              try {
                const mem = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
                const user = (mem.members || []).find((member) => String(member.uid) === banUid.trim());
                if (!user) throw new Error('No member with that id');
                await guildAction({ type: 'ban', userId: user.id, reason: banReason });
                await reloadSettings();
                toast('Banned');
              } catch (err) { toast(err.message); }
            }}>Ban</button>
          </section>

        {:else if ui.settingsPage === 'requests'}
          <section class="gset-card">
            {#each s.requests || [] as request}
              <div class="gset-chan">
                <div class="grow"><strong>{request.user?.displayName || request.user?.username || 'Someone'}</strong><div class="hint">{request.message}</div></div>
                <button type="button" class="btn sm brand" onclick={() => run(() => guildAction({ type: 'request', requestId: request.id, accept: true }))}>Accept</button>
                <button type="button" class="btn sm" onclick={() => run(() => guildAction({ type: 'request', requestId: request.id, accept: false }))}>Decline</button>
              </div>
            {:else}
              {@render bear('Nobody is waiting', 'When the server asks people to apply, their answers show up here.')}
            {/each}
          </section>

        {:else if ui.settingsPage === 'webhooks'}
          <section class="gset-card">
            <h3>Webhooks</h3>
            <p class="hint">A webhook posts into a channel without an account. Paste its URL into any app that speaks the webhook format. Anyone with the URL can post, so keep it secret. You can also make them from Edit channel.</p>
            {#if hookNote}<p class="hint">{hookNote}</p>{/if}
            <div class="gset-chan">
              <select class="look-select" bind:value={hookChannel}>
                {#each (ui.channels || []).filter((ch) => ch.type !== 'voice') as ch}
                  <option value={ch.id}>#{ch.name}</option>
                {/each}
              </select>
              <button type="button" class="btn brand" disabled={!hookChannel} onclick={async () => {
                try {
                  await api('/api/servers/' + ui.serverId + '/channels/' + hookChannel + '/webhooks', { method: 'POST', body: { name: (ui.channels || []).find((ch) => ch.id === hookChannel)?.name || 'webhook' } });
                  await loadServerHooks();
                  toast('Webhook created');
                } catch (err) { toast(err.message); }
              }}>New webhook</button>
            </div>
            {#each serverHooks as hook (hook.id)}
              <div class="gset-chan">
                <div class="grow">
                  <strong>{hook.name}</strong>
                  <div class="hint">#{hook.channelName || 'channel'}</div>
                </div>
                <button type="button" class="btn sm" onclick={async () => {
                  try { await navigator.clipboard.writeText(webhookUrl(hook)); toast('Webhook URL copied'); }
                  catch { toast(webhookUrl(hook)); }
                }}>Copy URL</button>
                <button type="button" class="btn sm" onclick={async () => {
                  if (!confirm('Delete this webhook?')) return;
                  try {
                    await api('/api/servers/' + ui.serverId + '/webhooks/' + hook.id, { method: 'DELETE' });
                    await loadServerHooks();
                  } catch (err) { toast(err.message); }
                }}>Delete</button>
              </div>
            {:else}
              {#if !hookNote}{@render bear('No webhooks yet', 'Make one for a channel, then paste the URL into the app that should post there.')}{/if}
            {/each}
          </section>

        {:else if ui.settingsPage === 'bots'}
          <section class="gset-card">
            <h3>Bots</h3>
            <p class="hint">Add a bot you made in Settings → Developer. It can read and post where @everyone can.</p>
            {#if botNote}<p class="hint">{botNote}</p>{/if}
            <div class="gset-chan">
              <select class="look-select" bind:value={botPick}>
                <option value="">Your bots</option>
                {#each myBots.filter((bot) => !serverBots.some((row) => row.id === bot.id)) as bot}
                  <option value={bot.id}>{bot.name}</option>
                {/each}
              </select>
              <button type="button" class="btn brand" disabled={!botPick} onclick={async () => {
                try {
                  await api('/api/servers/' + ui.serverId + '/bots', { method: 'POST', body: { botId: botPick } });
                  await loadServerBots();
                  toast('Bot added');
                } catch (err) { toast(err.message); }
              }}>Add</button>
            </div>
            {#each serverBots as bot (bot.id)}
              <div class="gset-chan">
                <div class="grow">
                  <strong>{bot.displayName || bot.name}</strong>
                  <div class="hint">@{bot.username}</div>
                </div>
                <button type="button" class="btn sm" onclick={async () => {
                  try {
                    await api('/api/servers/' + ui.serverId + '/bots/' + bot.id, { method: 'DELETE' });
                    await loadServerBots();
                  } catch (err) { toast(err.message); }
                }}>Remove</button>
              </div>
            {:else}
              {#if !botNote}{@render bear('No bots yet', 'Make one in Settings → Developer, then add it here.')}{/if}
            {/each}
          </section>
        {/if}
      </div>
    </div>
  </div>
  {#if transferOpen}
    <div class="gset-modal" role="dialog" aria-label="Transfer ownership">
      <div class="gset-modal-card">
        <h3>Transfer ownership</h3>
        <p class="hint">Pick who gets {s.name || 'this server'}.</p>
        <label class="gset-search wide"><Search size={16} /><input placeholder="Search members" bind:value={transferQ} /></label>
        <div class="gset-modal-list">
          {#each people.filter((member) => member.id !== ui.me?.id && (!transferQ.trim() || displayName(member).toLowerCase().includes(transferQ.trim().toLowerCase()))) as member}
            <button type="button" class="gset-person" onclick={() => transferTo(member)}>
              <Avatar user={member} size={36} dot={false} />
              <span><strong>{displayName(member)}</strong><em>@{member.username}</em></span>
            </button>
          {:else}
            <p class="hint">No members to hand it to.</p>
          {/each}
        </div>
        <button type="button" class="btn" onclick={() => (transferOpen = false)}>Cancel</button>
      </div>
    </div>
  {/if}
</div>
