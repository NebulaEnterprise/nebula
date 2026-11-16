<script>
  import { Hash, Calendar, Clock } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import Photo from './Photo.svelte';
  import { ui } from '../state.svelte.js';
  import { presenceDot } from '../seen.js';

  const user = $derived(ui.dmUser);
  const dot = $derived(presenceDot(user));
  const since = $derived.by(() => {
    const at = Date.parse(user?.createdAt || '');
    if (!Number.isFinite(at)) return '';
    return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  });
  const zone = $derived(user?.timezone || user?.timeZone || '');
  const about = $derived(user?.aboutMe || user?.bio || '');
  const status = $derived(dot === 'online' ? 'Online' : dot === 'idle' ? 'Idle' : dot === 'dnd' ? 'Do not disturb' : 'Offline');
</script>

{#if user}
  <aside class="dm-card">
    <div class="dm-banner">
      {#if user.bannerUrl}<Photo url={user.bannerUrl} fill />{:else}<img src="./look/moon.png" alt="" />{/if}
    </div>
    <div class="dm-face">
      <Avatar user={user} size={84} />
    </div>
    <div class="dm-body">
      <h2><Name user={user} /></h2>
      <p class="dm-handle">@{user.username}</p>
      <p class="dm-status"><i class={dot}></i> {status}</p>
      {#if user.bio && user.aboutMe}
        <p class="dm-bio">{user.bio}</p>
      {:else if user.bio}
        <p class="dm-bio">{user.bio}</p>
      {/if}
      <dl>
        {#if since}
          <div><dt><Calendar size={14} /> Member since</dt><dd>{since}</dd></div>
        {/if}
        {#if zone}
          <div><dt><Clock size={14} /> Time zone</dt><dd>{zone}</dd></div>
        {/if}
        <div><dt><Hash size={14} /> ID</dt><dd>#{user.uid || user.id}</dd></div>
      </dl>
      {#if about}
        <h3>About me</h3>
        <p>{about}</p>
      {/if}
    </div>
  </aside>
{/if}
