<script>
  import { MessageSquare, Check, X, MoreHorizontal } from '@lucide/svelte';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import { ui, showFriends, showAddFriend, openDm, openPopout, friendAct, toast } from '../state.svelte.js';
  import { api } from '../api.js';
  let q = $state('');
  let name = $state('');
  let people = $state([]);
  let finding = $state(false);
  let moreId = $state('');

  $effect(() => {
    if (!moreId) return;
    const close = () => { moreId = ''; };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  });

  const list = $derived.by(() => {
    let rows = ui.friendsTab === 'blocked' ? ui.blocked : ui.friendsTab === 'suggested' ? ui.suggested : ui.friends;
    if (ui.friendsTab === 'online') rows = rows.filter((u) => u.status !== 'offline' && u.status !== 'invisible');
    const query = q.trim().toLowerCase();
    if (query && ui.friendsTab !== 'find') rows = rows.filter((u) => ((u.username || '') + ' ' + (u.displayName || '')).toLowerCase().includes(query));
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

  async function findPeople() {
    const query = q.trim();
    if (query.length < 1) {
      people = [];
      return;
    }
    finding = true;
    try {
      const data = await api('/api/users/search?q=' + encodeURIComponent(query));
      people = data.users || [];
    } catch (err) {
      toast(err.message);
    } finally {
      finding = false;
    }
  }

  async function requestUser(user) {
    try {
      await friendAct('request', { username: user.username });
      toast('Friend request sent');
    } catch (err) { toast(err.message); }
  }
</script>

<div class="friends-bar">
  <div class="tabs">
    <button class="tab" class:on={ui.mode === 'friends' && ui.friendsTab === 'online'} onclick={() => showFriends('online')}>Online</button>
    <button class="tab" class:on={ui.mode === 'friends' && ui.friendsTab === 'all'} onclick={() => showFriends('all')}>All</button>
    <button class="tab" class:on={ui.mode === 'friends' && ui.friendsTab === 'pending'} onclick={() => showFriends('pending')}>
      Pending
      {#if ui.incoming.length}<em class="tab-count">{ui.incoming.length > 99 ? '99+' : ui.incoming.length}</em>{/if}
    </button>
    <button class="tab" class:on={ui.mode === 'friends' && ui.friendsTab === 'blocked'} onclick={() => showFriends('blocked')}>Blocked</button>
    <button class="tab" class:on={ui.mode === 'friends' && ui.friendsTab === 'suggested'} onclick={() => showFriends('suggested')}>Suggested</button>
    <button class="tab add" class:on={ui.mode === 'add'} onclick={showAddFriend}>Add friend</button>
  </div>
  {#if ui.mode === 'friends' && ui.friendsTab !== 'pending'}
    <input class="search" placeholder={ui.friendsTab === 'find' ? 'Find a username' : 'Search'} bind:value={q} oninput={() => { if (ui.friendsTab === 'find') findPeople(); }} />
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
  {:else if ui.friendsTab === 'find'}
    <div class="cat">Find people</div>
    {#if finding}<p class="hint">Searching…</p>{/if}
    {#each people as u (u.id)}
      <div class="friend">
        <Avatar user={u} size={40} />
        <div class="meta">
          <strong><Name user={u} /></strong>
          <span>@{u.username}</span>
        </div>
        <button class="btn sm" onclick={() => requestUser(u)}>Add friend</button>
        <button class="btn icon" title="Message" onclick={() => openDm(u)}><MessageSquare size={16} /></button>
      </div>
    {/each}
    {#if !finding && q.trim() && !people.length}<p class="hint">No one with that name.</p>{/if}
    {#if !q.trim()}<p class="hint">Type a username to find someone.</p>{/if}
  {:else if ui.friendsTab === 'blocked'}
    <div class="cat">Blocked — {list.length}</div>
    {#each list as u (u.id)}
      <div class="friend">
        <Avatar user={u} size={40} />
        <div class="meta"><strong><Name user={u} /></strong><span>Blocked</span></div>
        <button class="btn sm" onclick={() => friendAct('unblock', { userId: u.id })}>Unblock</button>
      </div>
    {/each}
    {#if !list.length}<p class="hint">You have not blocked anyone.</p>{/if}
  {:else if ui.friendsTab === 'suggested'}
    <div class="cat">Suggested — {list.length}</div>
    {#each list as u (u.id)}
      <div class="friend">
        <Avatar user={u} size={40} />
        <div class="meta"><strong><Name user={u} /></strong><span>You share a server</span></div>
        <button class="btn sm" onclick={() => requestUser(u)}>Add friend</button>
        <button class="btn icon" title="Message" onclick={() => openDm(u)}><MessageSquare size={16} /></button>
      </div>
    {/each}
    {#if !list.length}<p class="hint">No suggestions yet. People you share a server with show up here.</p>{/if}
  {:else if ui.friendsTab === 'pending'}
    <div class="cat">Incoming — {ui.incoming.length}</div>
    {#each ui.incoming as u (u.id)}
      <div class="friend friend-hit" role="button" tabindex="0" onclick={() => openPopout(u)} onkeydown={(e) => { if (e.key === 'Enter') openPopout(u); }}>
        <Avatar user={u} size={36} />
        <div class="meta"><strong><Name user={u} /></strong><span>Incoming request</span></div>
        <button class="btn icon" title="Accept" onclick={(e) => { e.stopPropagation(); friendAct('accept', { userId: u.id }); }}><Check size={16} /></button>
        <button class="btn icon" title="Ignore" onclick={(e) => { e.stopPropagation(); friendAct('decline', { userId: u.id }); }}><X size={16} /></button>
      </div>
    {/each}
    <div class="cat">Outgoing — {ui.outgoing.length}</div>
    {#each ui.outgoing as u (u.id)}
      <div class="friend friend-hit" role="button" tabindex="0" onclick={() => openPopout(u)} onkeydown={(e) => { if (e.key === 'Enter') openPopout(u); }}>
        <Avatar user={u} size={36} />
        <div class="meta"><strong><Name user={u} /></strong><span>Request sent</span></div>
        <button class="btn sm" onclick={(e) => { e.stopPropagation(); friendAct('cancel', { userId: u.id }); }}>Cancel</button>
      </div>
    {/each}
    {#if !ui.incoming.length && !ui.outgoing.length}
      <div class="empty-note">
        <strong>No pending requests</strong>
        <p>Friend requests you send or get show up here.</p>
        <button class="btn brand empty-act" type="button" onclick={showAddFriend}>Add friend</button>
      </div>
    {/if}
  {:else}
    <div class="cat">{ui.friendsTab === 'online' ? 'Online' : 'All friends'} — {list.length}</div>
    {#each list as u}
      <div class="friend">
        <Avatar user={u} size={40} />
        <div class="meta">
          <strong><Name user={u} /></strong>
          <span>{u.customStatus || (u.status === 'offline' ? 'Offline' : 'Online')}</span>
        </div>
        <button class="btn icon" title="Message" onclick={() => openDm(u)}><MessageSquare size={16} /></button>
        <button class="btn icon" title="More" onclick={(event) => { event.stopPropagation(); moreId = moreId === u.id ? '' : u.id; }}><MoreHorizontal size={16} /></button>
        {#if moreId === u.id}
          <div class="friend-menu" onclick={(event) => event.stopPropagation()}>
            <button type="button" onclick={() => { moreId = ''; openPopout(u); }}>Profile</button>
            <button type="button" class="danger" onclick={() => { moreId = ''; friendAct('remove', { userId: u.id }); }}>Remove friend</button>
            <button type="button" class="danger" onclick={() => { moreId = ''; friendAct('block', { userId: u.id }); }}>Block</button>
          </div>
        {/if}
      </div>
    {/each}
    {#if !list.length}
      <div class="empty-note">
        {#if ui.friendsTab === 'online' && ui.friends.length}
          <strong>Nobody's online right now</strong>
          <p>Your friends are taking a break. Say hi and they'll see it later.</p>
        {:else}
          <strong>No friends yet</strong>
          <p>Add a friend, then say hi.</p>
        {/if}
        <button class="btn brand empty-act" type="button" onclick={showAddFriend}>Add friend</button>
      </div>
    {/if}
  {/if}
</div>
