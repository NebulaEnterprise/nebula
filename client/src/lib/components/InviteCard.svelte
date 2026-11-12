<script module>
  const loaded = new Map();
</script>

<script>
  import { api } from '../api.js';
  import { openServer, toast } from '../state.svelte.js';
  import Photo from './Photo.svelte';

  let { slug = '' } = $props();
  let card = $state(null);
  let missing = $state(false);
  let joining = $state(false);

  function load(code) {
    if (!loaded.has(code)) {
      loaded.set(code, api('/api/invites/' + encodeURIComponent(code)).then((data) => data.invite || null).catch(() => null));
    }
    return loaded.get(code);
  }

  $effect(() => {
    const code = String(slug || '').toLowerCase();
    if (!code) return;
    let stop = false;
    missing = false;
    card = null;
    load(code).then((invite) => {
      if (stop) return;
      if (!invite) missing = true;
      else card = invite;
    });
    return () => { stop = true; };
  });

  async function join() {
    if (!card || joining) return;
    if (card.joined && card.serverId) {
      await openServer(card.serverId);
      return;
    }
    joining = true;
    try {
      const data = await api('/api/invites/' + encodeURIComponent(slug) + '/join', { method: 'POST', body: {} });
      if (data.pending) toast('Request sent. An owner has to accept you.');
      else if (data.server) {
        card = { ...card, joined: true, serverId: data.server.id, members: Math.max(card.members, 1) };
        await openServer(data.server.id);
      }
    } catch (err) {
      toast(err.message || 'Could not join that server');
    } finally {
      joining = false;
    }
  }
</script>

{#if card}
  <article class="invite-card">
    <div class="invite-banner" style="background:{card.color || '#5865f2'}">
      {#if card.bannerUrl}<Photo url={card.bannerUrl} fill />{/if}
    </div>
    <div class="invite-face" style="background:{card.color || '#5865f2'}">
      {#if card.iconUrl}<Photo url={card.iconUrl} />{:else}{card.icon || '?'}{/if}
    </div>
    <div class="invite-copy">
      <strong>{card.name}</strong>
      <p>
        <i class:on={card.online > 0}></i>
        <span>{card.online} Online</span>
        <span>{card.members} {card.members === 1 ? 'Member' : 'Members'}</span>
      </p>
    </div>
    <button type="button" class="invite-join" disabled={joining} onclick={join}>
      {joining ? 'Joining…' : card.joined ? 'Open' : 'Join'}
    </button>
  </article>
{:else if missing}
  <p class="invite-missing">Invite expired</p>
{/if}
