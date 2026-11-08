<script>
  import { initial } from '../format.js';
  import Photo from './Photo.svelte';
  let { user, size = 32, dot = true } = $props();
  const name = $derived(user?.nick || user?.displayName || user?.username || '?');
</script>

<div class="avatar" style="width:{size}px;height:{size}px;background:{user?.avatarColor || 'var(--brand)'};font-size:{Math.round(size * 0.4)}px">
  {#if user?.avatarUrl}
    <Photo url={user.avatarUrl} />
  {:else}
    {initial(name)}
  {/if}
  {#if dot}
    <i class="dot {user?.status || 'online'}"></i>
  {/if}
</div>
