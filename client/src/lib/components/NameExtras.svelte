<script>
  import { Crown } from '@lucide/svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import TagPill from './TagPill.svelte';
  import { ownedBadges } from '../format.js';
  import { ui } from '../state.svelte.js';

  let { user = null } = $props();
  const badge = $derived(ownedBadges(user).includes(user?.showcaseBadge) ? user.showcaseBadge : '');
  const inServer = $derived(ui.mode === 'chat' || ui.mode === 'thread');
  const crown = $derived(inServer && !!user?.serverOwner && !user?.bot && Number(user?.uid) !== 2);
</script>

<span class="name-extras">
  {#if crown}<Crown size={13} class="owner-crown" />{/if}
  {#if user?.roleIcon}<i class="role-ico">{user.roleIcon}</i>{/if}
  {#if !user?.bot && badge === 'early'}<MoonBadge />{/if}
  {#if !user?.bot && badge === 'staff'}<StaffBadge rank={user?.staff || 'staff'} />{/if}
  {#if !user?.bot && badge === 'developer'}<DevBadge on={true} />{/if}
  {#if !user?.bot}<TagPill tag={user?.showcase} />{/if}
</span>
