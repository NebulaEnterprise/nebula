<script>
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import TagPill from './TagPill.svelte';
  import { ownedBadges } from '../format.js';

  let { user = null } = $props();
  const badge = $derived(ownedBadges(user).includes(user?.showcaseBadge) ? user.showcaseBadge : '');
</script>

<span class="name-extras">
  {#if user?.roleIcon}<i class="role-ico">{user.roleIcon}</i>{/if}
  {#if !user?.bot && badge === 'early'}<MoonBadge />{/if}
  {#if !user?.bot && badge === 'staff'}<StaffBadge rank={user?.staff || 'staff'} />{/if}
  {#if !user?.bot && badge === 'developer'}<DevBadge on={true} />{/if}
  {#if !user?.bot}<TagPill tag={user?.showcase} />{/if}
</span>
