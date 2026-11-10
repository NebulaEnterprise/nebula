<script>
  import { initial } from '../format.js';
  import Photo from './Photo.svelte';
  import { nowClock } from '../state.svelte.js';
  import { presenceDot } from '../seen.js';
  let { user, size = 32, dot = true } = $props();
  const name = $derived(user?.nick || user?.displayName || user?.username || '?');
  const dotClass = $derived(presenceDot(user, nowClock.t));
</script>

<div class="avatar" style="width:{size}px;height:{size}px;background:{user?.avatarColor || 'var(--brand)'};font-size:{Math.round(size * 0.4)}px">
  {#if user?.avatarUrl}
    <span class="avatar-photo"><Photo url={user.avatarUrl} /></span>
  {:else}
    {initial(name)}
  {/if}
  {#if dot}
    <i class="dot {dotClass}"></i>
  {/if}
</div>
