<script>
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import { ui, openPopout } from '../state.svelte.js';
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
    <button class="member" onclick={(e) => openPopout(m, e.clientX, e.clientY)}>
      <Avatar user={m} size={34} />
      <div class="meta">
        <span class="member-name">
          <strong><Name user={shown(m)} color={m.nameEffect ? '' : (m.roleColor || m.accentColor || 'inherit')} /></strong>
          <StaffBadge rank={m.staff} />
        </span>
        {#if m.bio || m.customStatus}<span>{m.bio || m.customStatus}</span>{/if}
      </div>
    </button>
  {/each}
  {#if offline.length}
    <div class="cat">Offline — {offline.length}</div>
    {#each offline as m}
      <button class="member" onclick={(e) => openPopout(m, e.clientX, e.clientY)}>
        <Avatar user={m} size={34} />
        <div class="meta">
          <span class="member-name">
            <strong><Name user={shown(m)} /></strong>
            <StaffBadge rank={m.staff} />
          </span>
          {#if m.bio || m.customStatus}<span>{m.bio || m.customStatus}</span>{/if}
        </div>
      </button>
    {/each}
  {/if}
</aside>
