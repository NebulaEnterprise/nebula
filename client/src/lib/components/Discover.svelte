<script>
  import { ChevronLeft, Compass, Flame, Gamepad2, GraduationCap, LayoutGrid, Music, Plus, Search, Star, Users } from '@lucide/svelte';
  import { ui, openServer } from '../state.svelte.js';
  import { memberLine, serverFace } from '../serverface.js';

  let q = $state('');
  let cat = $state('all');
  const cats = [
    ['all', 'All', LayoutGrid],
    ['gaming', 'Gaming', Gamepad2],
    ['anime', 'Anime', Star],
    ['music', 'Music', Music],
    ['tech', 'Tech', Compass],
    ['social', 'Social', Users],
    ['education', 'Education', GraduationCap],
    ['other', 'Other', Plus],
  ];
  const words = ['gaming', 'anime', 'music', 'tech', 'social', 'education'];

  function blob(server) {
    return ((server.name || '') + ' ' + (server.about || '') + ' ' + (server.topic || '')).toLowerCase();
  }

  const list = $derived.by(() => {
    const query = q.trim().toLowerCase();
    return (ui.servers || []).filter((server) => {
      const text = blob(server);
      if (query && !text.includes(query) && !(server.name || '').toLowerCase().includes(query)) return false;
      if (cat === 'all') return true;
      if (cat === 'other') return !words.some((word) => text.includes(word));
      return text.includes(cat);
    });
  });

  function add() {
    ui.dialog = { kind: 'add-server' };
  }

  function openFirst() {
    if (list[0]) openServer(list[0].id);
    else add();
  }
</script>

<div class="hub discover">
  <div class="hub-main">
    <header class="hub-top">
      <button type="button" class="phone-back" title="Back" onclick={() => (ui.phone = 'browse')}><ChevronLeft size={22} /></button>
      <div>
        <h1><Compass size={22} /> Discover</h1>
        <p>Find communities you already belong to, and start a new one.</p>
      </div>
      <label class="hub-search slim">
        <Search size={16} />
        <input placeholder="Search servers..." bind:value={q} />
      </label>
    </header>
    <button type="button" class="feature" onclick={openFirst}>
      <img src="./look/cat.jpg" alt="" />
      <span>
        <em><Star size={14} /> Featured</em>
        <strong>Join the Nebula community</strong>
        <small>Open a server you are in, or create one of your own.</small>
        <b>Explore now</b>
      </span>
    </button>
    <div class="cat-row">
      {#each cats as [id, label, Icon]}
        <button type="button" class:on={cat === id} onclick={() => (cat = id)}><Icon size={14} /> {label}</button>
      {/each}
    </div>
    <section>
      <div class="hub-label"><Flame size={15} /> Popular servers <button type="button" class="hub-see" onclick={() => (q = '', cat = 'all')}>See all</button></div>
      {#if list.length}
        <div class="pop-grid">
          {#each list as server (server.id)}
            {@const face = serverFace(server)}
            <article>
              <span class="hub-mini lg" style="--srv:{face.color}">
                {#if face.image}<img src={face.image} alt="" />{:else}{face.mark}{/if}
              </span>
              <strong>{server.name}</strong>
              <small>{memberLine(server) || 'A server you are in'}</small>
              <button type="button" onclick={() => openServer(server.id)}>Open</button>
            </article>
          {/each}
        </div>
      {:else}
        <div class="hub-empty">
          <strong>{q || cat !== 'all' ? 'Nothing in this category' : 'No servers to show yet'}</strong>
          <p>Servers you join show up here. You can also create one.</p>
          <button type="button" class="hub-create" onclick={add}>Create a server</button>
        </div>
      {/if}
    </section>
  </div>
  <aside class="hub-aside discover-side">
    <div class="trend">
      <div class="hub-label"><Flame size={15} /> Trending servers</div>
      {#each list.slice(0, 5) as server, i (server.id)}
        {@const face = serverFace(server)}
        <button type="button" onclick={() => openServer(server.id)}>
          <span class="hub-mini" style="--srv:{face.color}">
            {#if face.image}<img src={face.image} alt="" />{:else}{face.mark}{/if}
          </span>
          <span>
            <strong>{server.name}</strong>
            <small>{memberLine(server) || 'Your server'}</small>
          </span>
          <em>{i + 1}</em>
        </button>
      {:else}
        <p class="hint">Join a server and it will be listed here.</p>
      {/each}
    </div>
    <div class="make">
      <img src="./look/ring.png" alt="" />
      <strong><Star size={14} /> Create your own server</strong>
      <p>Build a community, chat, and grow together.</p>
      <button type="button" onclick={add}><Plus size={16} /> Create server</button>
    </div>
  </aside>
</div>
