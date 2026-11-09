<script>
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import NameExtras from './NameExtras.svelte';
  import { shortBio } from '../format.js';
  import { ui, openPopout, openIdMenu } from '../state.svelte.js';
  function shown(m) {
    if (m.id === ui.me?.id && ui.me) {
      return {
        ...m,
        username: ui.me.username || m.username,
        displayName: ui.me.displayName || m.displayName,
        nameEffect: ui.me.nameEffect || '',
        nameColors: ui.me.nameColors && ui.me.nameColors.length ? ui.me.nameColors : m.nameColors,
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
  const online = $derived(ui.members.filter((m) => m.status !== 'offline'));
  const offline = $derived(ui.members.filter((m) => m.status === 'offline'));
</script>

<aside class="members">
  <div class="cat">Online — {online.length}</div>
  {#each online as m}
    <button class="member" onclick={(e) => openPopout(m, e.clientX, e.clientY)} oncontextmenu={(e) => openIdMenu(e, [{ label: 'User ID', value: m.id }])}>
      <Avatar user={m} size={34} />
      <div class="meta">
        <div class="name-row"><strong><Name user={shown(m)} color={m.nameEffect ? '' : (m.roleColor || m.accentColor || 'inherit')} /></strong><NameExtras user={shown(m)} /></div>
        {#if shortBio(m.bio)}<span>{shortBio(m.bio)}</span>{/if}
      </div>
    </button>
  {/each}
  {#if offline.length}
    <div class="cat">Offline — {offline.length}</div>
    {#each offline as m}
      <button class="member" onclick={(e) => openPopout(m, e.clientX, e.clientY)} oncontextmenu={(e) => openIdMenu(e, [{ label: 'User ID', value: m.id }])}>
        <Avatar user={m} size={34} />
        <div class="meta">
          <div class="name-row"><strong><Name user={shown(m)} /></strong><NameExtras user={shown(m)} /></div>
          {#if shortBio(m.bio)}<span>{shortBio(m.bio)}</span>{/if}
        </div>
      </button>
    {/each}
  {/if}
</aside>
