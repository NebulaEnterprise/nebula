<script>
  import { ui, sendSticker, sendGif, insertEmoji, loadPacks } from '../state.svelte.js';
  import { api, fileUrl } from '../api.js';
  import { EMOJI, NAMED } from '../emoji.js';

  let { onpick = null } = $props();
  const reacting = $derived(typeof onpick === 'function');
  const frequent = ['💯', '👍', '👎', '❤️', '☝️', '👀', '😩', '😂', '✅', '❌'];

  let tab = $state(ui.picker || 'emoji');
  $effect(() => {
    if (ui.picker) tab = ui.picker;
  });
  let query = $state('');
  let gifs = $state([]);
  let gifError = $state('');
  let klipy = $state(false);
  let busy = $state(false);
  let cat = $state('People');
  let gifFav = $state(false);
  let favs = $state([]);

  function favStoreKey() {
    return 'nebula-gif-favs:' + (ui.me?.id || 'local');
  }

  function readFavs() {
    try {
      const rows = JSON.parse(localStorage.getItem(favStoreKey()) || '[]');
      return Array.isArray(rows) ? rows.filter((row) => row && row.url).slice(0, 80) : [];
    } catch (_) {
      return [];
    }
  }

  function writeFavs(rows) {
    favs = rows.slice(0, 80);
    try { localStorage.setItem(favStoreKey(), JSON.stringify(favs)); } catch (_) {}
  }

  function isFav(url) {
    return favs.some((row) => row.url === url);
  }

  function toggleFav(gif, event) {
    event.preventDefault();
    event.stopPropagation();
    if (!gif?.url) return;
    if (isFav(gif.url)) writeFavs(favs.filter((row) => row.url !== gif.url));
    else writeFavs([{ id: gif.id || gif.url, url: gif.url, preview: gif.preview || gif.url, title: gif.title || '' }, ...favs]);
  }

  const shownFavs = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return favs;
    return favs.filter((row) => String(row.title || '').toLowerCase().includes(q));
  });

  $effect(() => {
    ui.me?.id;
    favs = readFavs();
  });

  const packs = $derived(ui.packs || []);
  const stickerPacks = $derived(packs.filter((pack) => (pack.stickers || []).length));
  const emojiPacks = $derived(packs.filter((pack) => (pack.emoji || []).length));
  const people = $derived.by(() => {
    const q = query.trim().toLowerCase().replaceAll(':', '');
    if (!q) return (EMOJI.find((row) => row[0] === cat) || EMOJI[0])[1];
    const hits = [];
    for (const [name, glyph] of Object.entries(NAMED)) {
      if (name.includes(q)) hits.push(glyph);
    }
    return hits.length ? hits : (EMOJI.find((row) => row[0] === cat) || EMOJI[0])[1].filter((glyph) => glyph.includes(q));
  });

  const serverEmoji = $derived.by(() => {
    const rows = [];
    const seen = new Set();
    const add = (pack, item) => {
      const name = String(item?.name || '');
      if (!name || seen.has(name)) return;
      seen.add(name);
      rows.push({ pack, name, url: item.url });
    };
    for (const pack of emojiPacks) for (const item of pack.emoji || []) add(pack.name, item);
    for (const item of ui.emoji || []) add(ui.serverMeta?.name || 'This server', item);
    return rows;
  });

  function choose(token) {
    if (reacting) onpick(token);
    else insertEmoji(token);
  }

  $effect(() => {
    loadPacks();
  });

  $effect(() => {
    if (tab !== 'gif') return;
    const q = query;
    const handle = setTimeout(async () => {
      busy = true;
      gifError = '';
      try {
        const data = await api('/api/gifs?q=' + encodeURIComponent(q.trim()));
        gifs = data.gifs || [];
        klipy = !!data.klipy;
      } catch (err) {
        gifError = err.message || 'GIF search is unavailable';
        gifs = [];
        klipy = false;
      } finally {
        busy = false;
      }
    }, 280);
    return () => clearTimeout(handle);
  });
</script>

<div class="picker" class:picker-pop={reacting}>
  {#if !reacting}
  <div class="picker-tabs">
    <button type="button" class:on={tab === 'gif'} onclick={() => (tab = 'gif')}>GIFs</button>
    <button type="button" class:on={tab === 'sticker'} onclick={() => (tab = 'sticker')}>Stickers</button>
    <button type="button" class:on={tab === 'emoji'} onclick={() => (tab = 'emoji')}>Emoji</button>
  </div>
  {/if}

  {#if reacting || tab === 'emoji'}
    <div class="picker-search">
      <input bind:value={query} placeholder={reacting ? 'Find the perfect reaction' : 'Find an emoji'} />
    </div>
    <div class="picker-grid emoji-grid">
      {#if reacting && query.trim()}
        {#each people as glyph}
          <button type="button" onclick={() => choose(glyph)}>{glyph}</button>
        {/each}
        {#each serverEmoji.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase().replaceAll(':', ''))) as item}
          <button type="button" title={':' + item.name + ':'} onclick={() => choose(':' + item.name + ':')}>
            <img src={fileUrl(item.url)} alt={item.name} />
          </button>
        {/each}
      {:else if reacting}
        <p class="picker-label">Frequently Used</p>
        {#each frequent as glyph}
          <button type="button" onclick={() => choose(glyph)}>{glyph}</button>
        {/each}
        {#each serverEmoji as item, index}
          {#if index === 0 || item.pack !== serverEmoji[index - 1].pack}
            <p class="picker-label">{item.pack}</p>
          {/if}
          <button type="button" title={':' + item.name + ':'} onclick={() => choose(':' + item.name + ':')}>
            <img src={fileUrl(item.url)} alt={item.name} />
          </button>
        {/each}
        {#each EMOJI as row}
          <p class="picker-label">{row[0]}</p>
          {#each row[1] as glyph}
            <button type="button" onclick={() => choose(glyph)}>{glyph}</button>
          {/each}
        {/each}
      {:else if cat === 'Servers'}
        {#each emojiPacks as pack}
          <p class="picker-label">{pack.name}</p>
          {#each pack.emoji as item}
            <button type="button" title={':' + item.name + ':'} onclick={() => choose(':' + item.name + ':')}>
              <img src={fileUrl(item.url)} alt={item.name} />
            </button>
          {/each}
        {/each}
      {:else}
        {#each people as glyph}
          <button type="button" onclick={() => choose(glyph)}>{glyph}</button>
        {/each}
      {/if}
    </div>
    {#if !reacting}
    <div class="picker-cats">
      {#each EMOJI as row}
        <button type="button" class:on={cat === row[0]} title={row[0]} onclick={() => (cat = row[0])}>{row[1][0]}</button>
      {/each}
      {#if emojiPacks.length}<button type="button" class:on={cat === 'Servers'} title="Servers" onclick={() => (cat = 'Servers')}>✨</button>{/if}
    </div>
    {/if}
  {:else if tab === 'sticker'}
    <div class="picker-grid sticker-grid">
      {#if !stickerPacks.length}
        <p class="hint">No stickers yet. A server owner can upload them in server settings.</p>
      {/if}
      {#each stickerPacks as pack}
        <p class="picker-label">{pack.name}</p>
        {#each pack.stickers as item}
          <button type="button" title={item.name} onclick={() => sendSticker(item.name)}>
            <img src={item.url} alt={item.name} />
          </button>
        {/each}
      {/each}
    </div>
  {:else}
    <div class="picker-search gif-search">
      {#if gifFav}
        <button type="button" class="gif-back" aria-label="Back" onclick={(e) => { e.stopPropagation(); gifFav = false; }}>←</button>
      {/if}
      <input bind:value={query} placeholder={gifFav ? 'Search Favorites' : 'Search GIFs'} />
      {#if !gifFav}
        <button type="button" class="gif-fav-tab" onclick={(e) => { e.stopPropagation(); gifFav = true; }}>★ Favorites</button>
      {/if}
    </div>
    <div class="picker-grid gif-grid">
      {#if gifFav}
        {#if !shownFavs.length}<p class="hint">No favorite GIFs yet. Tap the star on a GIF.</p>{/if}
        {#each shownFavs as gif (gif.url)}
          {@render gifTile(gif)}
        {/each}
      {:else}
        {#if !query.trim()}
          <button type="button" class="gif-fav-card" onclick={(e) => { e.stopPropagation(); gifFav = true; }}>
            <span class="gif-fav-label"><span class="gif-fav-mark">★</span> Favorites</span>
          </button>
        {/if}
        {#if busy && !gifs.length}<p class="hint">Searching…</p>{/if}
        {#if gifError}<p class="hint">{gifError}</p>{/if}
        {#if !busy && !gifError && !gifs.length}<p class="hint">No GIFs for that search.</p>{/if}
        {#each gifs as gif (gif.url)}
          {@render gifTile(gif)}
        {/each}
      {/if}
    </div>
    {#if klipy}
      <a class="klipy-credit" href="https://klipy.com" target="_blank" rel="noreferrer">KLIPY</a>
    {/if}
  {/if}
</div>

{#snippet gifTile(gif)}
  <div class="gif-tile">
    <button type="button" class="gif-send" title={gif.title || 'GIF'} onclick={() => sendGif(gif.url)}>
      <img
        src={gif.preview || gif.url}
        alt=""
        width="220"
        height="120"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        onerror={(e) => {
          const img = e.currentTarget;
          if (img.dataset.tried || !gif.url || img.getAttribute('src') === gif.url) return;
          img.dataset.tried = '1';
          img.src = gif.url;
        }}
      />
    </button>
    <button
      type="button"
      class="gif-star"
      class:on={isFav(gif.url)}
      aria-label={isFav(gif.url) ? 'Remove favorite' : 'Favorite GIF'}
      onclick={(e) => toggleFav(gif, e)}
    >★</button>
  </div>
{/snippet}
