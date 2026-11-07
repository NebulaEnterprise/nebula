<script>
  import { MessageSquare, Check, X } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import { ui, showFriends, showAddFriend, openDm, friendAct, toast } from '../state.svelte.js';
  let q = $state('');
  let name = $state('');

  const list = $derived.by(() => {
    let rows = ui.friends;
    if (ui.friendsTab === 'online') rows = rows.filter((u) => u.status !== 'offline');
    const query = q.trim().toLowerCase();
    if (query) rows = rows.filter((u) => ((u.username || '') + ' ' + (u.displayName || '')).toLowerCase().includes(query));
    return rows;
  });

  async function add() {
    const raw = name.trim();
    if (!raw) return;
    try {
      const body = raw.startsWith('#') ? { uid: raw.slice(1) } : { username: raw };
      await friendAct('request', body);
      name = '';
      toast('Friend request sent');
    } catch (err) { toast(err.message); }
  }
</script>

<div class="friends-bar">
  <div class="tabs">
    <button class="tab" class:on={ui.mode === 'friends' && ui.friendsTab === 'online'} onclick={() => showFriends('online')}>Online</button>
    <button class="tab" class:on={ui.mode === 'friends' && ui.friendsTab === 'all'} onclick={() => showFriends('all')}>All</button>
    <button class="tab" class:on={ui.mode === 'friends' && ui.friendsTab === 'pending'} onclick={() => showFriends('pending')}>Pending</button>
    <button class="tab add" class:on={ui.mode === 'add'} onclick={showAddFriend}>Add friend</button>
  </div>
  {#if ui.mode === 'friends' && ui.friendsTab !== 'pending'}
    <input class="search" placeholder="Search" bind:value={q} />
  {/if}
</div>

<div class="friends-body">
  {#if ui.mode === 'add'}
    <div class="add-box">
      <h2>Add friend</h2>
      <p>Use their username, or a user id like #1.</p>
      <form class="add-row" onsubmit={(e) => { e.preventDefault(); add(); }}>
        <input bind:value={name} maxlength="32" placeholder="Username or #id" />
        <button class="btn brand" style="width:auto" type="submit">Send request</button>
      </form>
    </div>
  {:else if ui.friendsTab === 'pending'}
    <div class="cat">Incoming — {ui.incoming.length}</div>
    {#each ui.incoming as u}
      <div class="friend">
        <Avatar user={u} size={36} />
        <div class="meta"><strong>{u.displayName || u.username}</strong><span>Incoming request</span></div>
        <button class="btn icon" title="Accept" onclick={() => friendAct('accept', { userId: u.id })}><Check size={16} /></button>
        <button class="btn icon" title="Ignore" onclick={() => friendAct('decline', { userId: u.id })}><X size={16} /></button>
      </div>
    {/each}
    <div class="cat">Outgoing — {ui.outgoing.length}</div>
    {#each ui.outgoing as u}
      <div class="friend">
        <Avatar user={u} size={36} />
        <div class="meta"><strong>{u.displayName || u.username}</strong><span>Request sent</span></div>
        <button class="btn sm" onclick={() => friendAct('cancel', { userId: u.id })}>Cancel</button>
      </div>
    {/each}
    {#if !ui.incoming.length && !ui.outgoing.length}<p class="hint">No pending requests.</p>{/if}
  {:else}
    <div class="cat">{ui.friendsTab === 'online' ? 'Online' : 'All friends'} — {list.length}</div>
    {#each list as u}
      <div class="friend">
        <Avatar user={u} size={40} />
        <div class="meta">
          <strong>{u.displayName || u.username}</strong>
          <span>{u.customStatus || (u.status === 'offline' ? 'Offline' : 'Online')}</span>
        </div>
        <button class="btn icon" title="Message" onclick={() => openDm(u)}><MessageSquare size={16} /></button>
      </div>
    {/each}
    {#if !list.length}<p class="hint">Nobody here yet. Add a friend to start.</p>{/if}
  {/if}
</div>
