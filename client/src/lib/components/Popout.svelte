<script>
  import { UserPlus } from '@lucide/svelte';
  import Name from './Name.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import { visibleBadges } from '../format.js';
  import { ui, relation, friendAct, openDm, toast } from '../state.svelte.js';

  const u = $derived(ui.popout?.user);
  const roles = $derived((u?.roles || []).filter((r) => r && r.id !== 'everyone' && r.id !== 'owner').slice().sort((a, b) => (b.position || 0) - (a.position || 0)));
  const rel = $derived(u ? relation(u.id) : 'none');
  const left = $derived(Math.max(8, Math.min(ui.popout?.x || 80, window.innerWidth - 340)));
  const top = $derived(Math.max(8, Math.min((ui.popout?.y || 80) - 20, window.innerHeight - 460)));

  async function act(kind) {
    try {
      await friendAct(kind, kind === 'request' ? { username: u.username } : { userId: u.id });
    } catch (err) { toast(err.message); }
  }
</script>

{#if u}
  <div class="pop" style="left:{left}px;top:{top}px">
    <div class="pop-banner" style="background:{u.bannerColor || u.accentColor || 'var(--brand)'}">
      {#if u.bannerUrl}<Photo url={u.bannerUrl} fill />{/if}
    </div>
    {#if u.bio}<div class="bio-bubble"><span>{u.bio}</span></div>{/if}
    {#if rel === 'none'}
      <button class="pop-add" title="Add friend" onclick={() => act('request')}><UserPlus size={18} /></button>
    {/if}
    <div class="pop-body">
      <div class="pop-av" style="background:{u.avatarColor || 'var(--brand)'}">
        {#if u.avatarUrl}<Photo url={u.avatarUrl} />{:else}{(u.displayName || u.username || '?').charAt(0).toUpperCase()}{/if}
      </div>
      <div class="pop-head">
        <div class="pop-id">
          <h3><Name user={u} /></h3>
          <p class="handle">
            <span>@{u.username}{u.pronouns ? ' · ' + u.pronouns : ''}</span>
            {#if visibleBadges(u).includes('early')}<MoonBadge />{/if}
            {#if visibleBadges(u).includes('staff')}<StaffBadge rank={u.staff} />{/if}
            {#if visibleBadges(u).includes('developer')}<DevBadge on={true} />{/if}
          </p>
        </div>
      </div>
      {#if u.customStatus}<p style="margin-top:8px">{u.customStatus}</p>{/if}
      {#if roles.length}
        <div class="pop-roles">
          <span>Roles</span>
          <div class="pop-role-list">
            {#each roles as r}
              <em class="pop-role"><i style="background:{r.color || '#99aab5'}"></i>{r.name}</em>
            {/each}
          </div>
        </div>
      {/if}
      <div class="stack">
        {#if rel === 'friends'}
          <button class="btn brand" onclick={() => { ui.popout = null; openDm(u); }}>Message</button>
          <button class="btn" onclick={() => act('remove')}>Remove friend</button>
        {:else if rel === 'incoming'}
          <button class="btn brand" onclick={() => act('accept')}>Accept request</button>
          <button class="btn" onclick={() => act('decline')}>Ignore</button>
        {:else if rel === 'outgoing'}
          <button class="btn" onclick={() => act('cancel')}>Cancel request</button>
        {/if}
      </div>
      <div class="pop-meta">
        <div>
          <span>Member since</span>
          <strong>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</strong>
        </div>
        <div>
          <span>User id</span>
          <strong>{u.uid ?? '—'}</strong>
        </div>
      </div>
    </div>
  </div>
{/if}
