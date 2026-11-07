<script>
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import { ui, openPopout } from '../state.svelte.js';
  const online = $derived(ui.members.filter((m) => m.status !== 'offline'));
  const offline = $derived(ui.members.filter((m) => m.status === 'offline'));
</script>

<aside class="members">
  <div class="cat">Online — {online.length}</div>
  {#each online as m}
    <button class="member" onclick={(e) => openPopout(m, e.clientX, e.clientY)}>
      <Avatar user={m} size={34} />
      <div class="meta">
        <strong><Name user={m} color={m.roleColor || m.accentColor || 'inherit'} /></strong>
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
          <strong><Name user={m} /></strong>
          {#if m.bio || m.customStatus}<span>{m.bio || m.customStatus}</span>{/if}
        </div>
      </button>
    {/each}
  {/if}
</aside>
