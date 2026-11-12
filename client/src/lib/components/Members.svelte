<script>
  import { ChevronLeft } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import NameExtras from './NameExtras.svelte';
  import { shortBio } from '../format.js';
  import { ui, nowClock, openPopout, peekProfile, openMemberMenu } from '../state.svelte.js';
  import { presenceDot } from '../seen.js';
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
        roleIcon: m.roleIcon || '',
        showcase: ui.me.showcase || m.showcase || null,
        showcaseBadge: ui.me.showcaseBadge || '',
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
  const online = $derived(ui.members.filter((m) => presenceDot(m, nowClock.t) !== 'offline'));
  const offline = $derived(ui.members.filter((m) => presenceDot(m, nowClock.t) === 'offline'));
</script>

<aside class="members">
  <button type="button" class="phone-people-back" onclick={() => (ui.phone = 'chat')}><ChevronLeft size={18} /> Back to chat</button>
  <div class="cat">Online — {online.length}</div>
  {#each online as m}
    <button class="member" onpointerenter={() => peekProfile(m)} onclick={(e) => openPopout(m, e.clientX, e.clientY)} oncontextmenu={(e) => openMemberMenu(e, m)}>
      <Avatar user={m} size={34} />
      <div class="meta">
        <div class="name-row"><strong><Name user={shown(m)} color={nameInk(m)} /></strong><NameExtras user={shown(m)} /></div>
        {#if shortBio(m.bio)}<span>{shortBio(m.bio)}</span>{/if}
      </div>
    </button>
  {/each}
  {#if offline.length}
    <div class="cat">Offline — {offline.length}</div>
    {#each offline as m}
      <button class="member" onpointerenter={() => peekProfile(m)} onclick={(e) => openPopout(m, e.clientX, e.clientY)} oncontextmenu={(e) => openMemberMenu(e, m)}>
        <Avatar user={m} size={34} />
        <div class="meta">
          <div class="name-row"><strong><Name user={shown(m)} color={nameInk(m)} /></strong><NameExtras user={shown(m)} /></div>
          {#if shortBio(m.bio)}<span>{shortBio(m.bio)}</span>{/if}
        </div>
      </button>
    {/each}
  {/if}
</aside>
