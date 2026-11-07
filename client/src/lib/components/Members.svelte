<script>
  import Avatar from './Avatar.svelte';
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
        <strong style="color:{m.roleColor || m.accentColor || 'inherit'}">{m.nick || m.displayName || m.username}</strong>
        {#if m.customStatus}<span>{m.customStatus}</span>{/if}
      </div>
    </button>
  {/each}
  {#if offline.length}
    <div class="cat">Offline — {offline.length}</div>
    {#each offline as m}
      <button class="member" onclick={(e) => openPopout(m, e.clientX, e.clientY)}>
        <Avatar user={m} size={34} />
        <div class="meta">
          <strong>{m.nick || m.displayName || m.username}</strong>
        </div>
      </button>
    {/each}
  {/if}
</aside>
