<script>
  import { ChevronLeft, Gamepad2 } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import NameExtras from './NameExtras.svelte';
  import { shortBio, playingName } from '../format.js';
  import { ui, nowClock, openPopout, peekProfile, openMemberMenu } from '../state.svelte.js';
  import { presenceDot } from '../seen.js';
  import { t } from '../i18n.svelte.js';
  function shown(m) {
    if (m.id === ui.me?.id && ui.me) {
      return {
        ...m,
        username: ui.me.username || m.username,
        displayName: ui.me.displayName || m.displayName,
        nameEffect: ui.me.nameEffect || m.nameEffect || '',
        nameFont: ui.me.nameFont || m.nameFont || '',
        nameColors: ui.me.nameColors && ui.me.nameColors.length ? ui.me.nameColors : (m.nameColors || []),
        avatarUrl: ui.me.avatarUrl || m.avatarUrl,
        avatarColor: ui.me.avatarColor || m.avatarColor,
        bio: ui.me.bio ?? m.bio,
        activity: ui.me.activity || m.activity || '',
        roleIcon: m.roleIcon || '',
        showcase: ui.me.showcase || null,
        showcaseBadge: ui.me.showcaseBadge || '',
        serverOwner: Number(ui.me.uid ?? m.uid) === 2 ? false : !!m.serverOwner,
        badges: ui.me.badges || m.badges,
        staff: ui.me.staff || m.staff,
        developer: !!(ui.me.developer || m.developer),
      };
    }
    return m;
  }
  function nameInk(m) {
    const person = shown(m);
    if (person?.nameEffect) return '';
    return m.roleColor || m.accentColor || 'inherit';
  }
  function hoistOf(member) {
    const saved = new Map((ui.roles || []).map((role) => [role.id, role]));
    const roles = (member?.roles || []).map((role) => {
      const full = saved.get(role?.id) || role;
      return full;
    }).filter((role) => role && role.hoist && role.id !== 'everyone' && role.id !== 'here' && role.id !== 'owner');
    roles.sort((a, b) => (b.position || 0) - (a.position || 0));
    return roles[0] || null;
  }
  const grouped = $derived.by(() => {
    const online = [];
    const offline = [];
    const buckets = new Map();
    for (const member of ui.members || []) {
      if (presenceDot(member, nowClock.t) === 'offline') {
        offline.push(member);
        continue;
      }
      const role = hoistOf(member);
      if (!role) {
        online.push(member);
        continue;
      }
      if (!buckets.has(role.id)) buckets.set(role.id, { role, members: [] });
      buckets.get(role.id).members.push(member);
    }
    const roles = [...buckets.values()].sort((a, b) => (b.role.position || 0) - (a.role.position || 0));
    return { roles, online, offline };
  });
</script>

{#snippet person(m)}
  <button class="member" onpointerenter={() => peekProfile(m)} onclick={(e) => openPopout(m, e.clientX, e.clientY)} oncontextmenu={(e) => openMemberMenu(e, m)}>
    <Avatar user={m} size={34} />
    <div class="meta">
      <div class="name-row"><strong><Name user={shown(m)} color={nameInk(m)} /></strong>{#if m.bot}<span class="bot-tag">BOT</span>{/if}<NameExtras user={shown(m)} /></div>
      {#if playingName(shown(m))}
        <span class="playing"><Gamepad2 size={12} /> Playing {playingName(shown(m))}</span>
      {:else if shortBio(shown(m).bio)}
        <span>{shortBio(shown(m).bio)}</span>
      {/if}
    </div>
  </button>
{/snippet}

<aside class="members">
  <button type="button" class="phone-people-back" onclick={() => (ui.phone = 'chat')}><ChevronLeft size={18} /> Back to chat</button>
  {#if !grouped.roles.length && !grouped.online.length && !grouped.offline.length}
    <div class="cat">{t('Online')} — 0</div>
  {/if}
  {#each grouped.roles as group (group.role.id)}
    <div class="cat role-cat">{group.role.name} — {group.members.length}</div>
    {#each group.members as m (m.id)}
      {@render person(m)}
    {/each}
  {/each}
  {#if grouped.online.length}
    <div class="cat">{t('Online')} — {grouped.online.length}</div>
    {#each grouped.online as m (m.id)}
      {@render person(m)}
    {/each}
  {/if}
  {#if grouped.offline.length}
    <div class="cat">{t('Offline')} — {grouped.offline.length}</div>
    {#each grouped.offline as m (m.id)}
      {@render person(m)}
    {/each}
  {/if}
</aside>
