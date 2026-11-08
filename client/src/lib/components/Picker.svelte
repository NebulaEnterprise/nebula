<script>
  import { ui, sendSticker, sendGif, insertEmoji, loadPacks } from '../state.svelte.js';
  import { api } from '../api.js';
  import { EMOJI, NAMED } from '../emoji.js';

  let tab = $state(ui.picker || 'emoji');
  let query = $state('');
  let gifs = $state([]);
  let gifError = $state('');
  let busy = $state(false);
  let cat = $state('People');

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
      } catch (err) {
        gifError = err.message || 'GIF search is unavailable';
        gifs = [];
      } finally {
        busy = false;
      }
    }, 280);
    return () => clearTimeout(handle);
  });
</script>

<div class="picker">
  <div class="picker-tabs">
    <button type="button" class:on={tab === 'gif'} onclick={() => (tab = 'gif')}>GIFs</button>
    <button type="button" class:on={tab === 'sticker'} onclick={() => (tab = 'sticker')}>Stickers</button>
    <button type="button" class:on={tab === 'emoji'} onclick={() => (tab = 'emoji')}>Emoji</button>
  </div>

  {#if tab === 'emoji'}
    <div class="picker-search">
      <input bind:value={query} placeholder="Find an emoji" />
    </div>
    <div class="picker-cats">
      {#each EMOJI as row}
        <button type="button" class:on={cat === row[0]} onclick={() => (cat = row[0])}>{row[0]}</button>
      {/each}
      {#if emojiPacks.length}<button type="button" class:on={cat === 'Servers'} onclick={() => (cat = 'Servers')}>Servers</button>{/if}
    </div>
    <div class="picker-grid emoji-grid">
      {#if cat === 'Servers'}
        {#each emojiPacks as pack}
          <p class="picker-label">{pack.name}</p>
          {#each pack.emoji as item}
            <button type="button" title={':' + item.name + ':'} onclick={() => insertEmoji(':' + item.name + ':')}>
              <img src={item.url} alt={item.name} />
            </button>
          {/each}
        {/each}
      {:else}
        {#each people as glyph}
          <button type="button" onclick={() => insertEmoji(glyph)}>{glyph}</button>
        {/each}
      {/if}
    </div>
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
    <div class="picker-search">
      <input bind:value={query} placeholder="Search GIFs" />
    </div>
    <div class="picker-grid gif-grid">
      {#if busy && !gifs.length}<p class="hint">Searching…</p>{/if}
      {#if gifError}<p class="hint">{gifError}</p>{/if}
      {#if !busy && !gifError && !gifs.length}<p class="hint">No GIFs for that search.</p>{/if}
      {#each gifs as gif (gif.url)}
        <button type="button" onclick={() => sendGif(gif.url)}>
          <img src={gif.preview || gif.url} alt="" />
        </button>
      {/each}
    </div>
  {/if}
</div>
