<script>
  import { UserPlus } from '@lucide/svelte';
  import { ui, relation, friendAct, openDm, toast } from '../state.svelte.js';

  const u = $derived(ui.popout?.user);
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
    <div class="pop-banner" style="background:{u.bannerUrl ? `center/cover url('${u.bannerUrl}')` : (u.bannerColor || u.accentColor || 'var(--brand)')}"></div>
    {#if rel === 'none'}
      <button class="pop-add" title="Add friend" onclick={() => act('request')}><UserPlus size={18} /></button>
    {/if}
    <div class="pop-body">
      <div class="pop-top">
        <div class="pop-av" style="background:{u.avatarColor || 'var(--brand)'}">
          {#if u.avatarUrl}<img src={u.avatarUrl} alt="" />{:else}{(u.displayName || u.username || '?').charAt(0).toUpperCase()}{/if}
        </div>
        {#if u.bio}<div class="bio-bubble">{u.bio}</div>{/if}
      </div>
      <div class="pop-head">
        <div>
          <h3>{u.displayName || u.username}</h3>
          <p class="handle">@{u.username}{u.pronouns ? ' · ' + u.pronouns : ''}</p>
        </div>
      </div>
      {#if u.customStatus}<p style="margin-top:8px">{u.customStatus}</p>{/if}
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
