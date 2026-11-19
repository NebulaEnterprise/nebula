<script>
  import { ChevronLeft, Plus, Search, Users } from '@lucide/svelte';
  import { ui, openServer, showDiscover } from '../state.svelte.js';
  import { memberLine, recentServerIds, serverFace } from '../serverface.js';

  let q = $state('');
  const query = $derived(q.trim().toLowerCase());
  const yours = $derived((ui.servers || []).filter((server) => !query || (server.name || '').toLowerCase().includes(query)));
  const recent = $derived.by(() => {
    const byId = new Map((ui.servers || []).map((server) => [String(server.id), server]));
    return recentServerIds().map((id) => byId.get(id)).filter(Boolean).filter((server) => !query || (server.name || '').toLowerCase().includes(query)).slice(0, 6);
  });

  function add() {
    ui.dialog = { kind: 'add-server' };
  }
</script>

<div class="hub">
  <aside class="hub-strip">
    <button type="button" class="hub-plus" title="Add a server" onclick={add}><Plus size={18} /></button>
    {#each ui.servers as server (server.id)}
      {@const face = serverFace(server)}
      {@const note = ui.activity.servers[server.id]}
      <button
        type="button"
        class="hub-ico"
        class:on={ui.serverId === server.id}
        title={server.name}
        style="--srv:{face.color}"
        onclick={() => openServer(server.id)}
      >
        {#if face.image}<img src={face.image} alt="" />{:else}{face.mark}{/if}
        {#if note?.mentions}<em>{note.mentions > 99 ? '99+' : note.mentions}</em>{/if}
      </button>
    {/each}
  </aside>
  <div class="hub-main">
    <header class="hub-top">
      <button type="button" class="phone-back" title="Back" onclick={() => (ui.phone = 'browse')}><ChevronLeft size={22} /></button>
      <h1>Servers</h1>
      <button type="button" class="hub-create" onclick={add}><Plus size={16} /> Create a Server</button>
    </header>
    <label class="hub-search">
      <Search size={16} />
      <input placeholder="Search servers..." bind:value={q} />
    </label>
    <section>
      <div class="hub-label"><Users size={15} /> Your Servers <em>{yours.length}</em></div>
      {#if yours.length}
        <div class="hub-cards">
          {#each yours as server (server.id)}
            {@const face = serverFace(server)}
            <button type="button" class="hub-card" onclick={() => openServer(server.id)}>
              <span class="hub-banner">
                <img src="./look/sky.png" alt="" />
                <span class="hub-face" style="--srv:{face.color}">
                  {#if face.image}<img src={face.image} alt="" />{:else}{face.mark}{/if}
                </span>
              </span>
              <strong>{server.name}</strong>
              {#if memberLine(server)}<small>{memberLine(server)}</small>{:else}<small>Your server</small>{/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="hub-empty">
          <strong>{query ? 'No servers match that' : 'You have not joined a server yet'}</strong>
          <p>{query ? 'Try a different name.' : 'Create one, or join with an invite.'}</p>
        </div>
      {/if}
    </section>
    {#if recent.length}
      <section>
        <div class="hub-label">Recently visited</div>
        <div class="hub-rows">
          {#each recent as server (server.id)}
            {@const face = serverFace(server)}
            <button type="button" class="hub-row" onclick={() => openServer(server.id)}>
              <span class="hub-mini" style="--srv:{face.color}">
                {#if face.image}<img src={face.image} alt="" />{:else}{face.mark}{/if}
              </span>
              <span>
                <strong>{server.name}</strong>
                <small>{memberLine(server) || 'Open server'}</small>
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}
    <section>
      <div class="hub-label">Discover servers <button type="button" class="hub-see" onclick={showDiscover}>See all</button></div>
      <div class="hub-promos">
        <button type="button" class="hub-promo" onclick={showDiscover}>
          <img src="./look/planets.jpg" alt="" />
          <span>
            <strong>Explore new communities</strong>
            <em>Browse Discover</em>
          </span>
        </button>
        <button type="button" class="hub-promo" onclick={showDiscover}>
          <img src="./look/cat.jpg" alt="" />
          <span>
            <strong>Find your people on Nebula</strong>
            <em>Explore now</em>
          </span>
        </button>
      </div>
    </section>
  </div>
  <aside class="hub-aside">
    <img class="hub-moon" src="./look/moon.png" alt="" />
    <h2>Create your own server</h2>
    <p>Build a community, chat, and grow together.</p>
    <button type="button" class="hub-create" onclick={add}><Users size={16} /> Create a Server</button>
  </aside>
</div>
