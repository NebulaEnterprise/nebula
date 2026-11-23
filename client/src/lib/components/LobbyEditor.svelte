<script>
  import { GripVertical } from '@lucide/svelte';
  import { ui, guildAction, toast, openServerSettings } from '../state.svelte.js';
  import { getApiBase } from '../api.js';
  import { lobbyFrom, LOBBY_COPY } from '../lobby.js';

  let showLobby = $state(!!ui.settings?.showLobby);
  let about = $state(ui.settings?.about || '');
  let lobby = $state(lobbyFrom(ui.settings?.lobby));
  let dragId = $state('');
  let busy = $state(false);
  let openId = $state('top');

  const channels = $derived(ui.settings?.channels || ui.channels || []);
  const feedUrl = $derived(lobby.feedId && lobby.feedToken ? getApiBase() + '/api/feeds/' + lobby.feedId + '?token=' + lobby.feedToken : '');
  const boards = [
    { id: 'levels', label: 'Levels' },
    { id: 'week', label: 'Messages this week' },
    { id: 'invites', label: 'Invites' },
  ];

  function setSection(id, patch) {
    lobby.sections = lobby.sections.map((row) => row.id === id ? { ...row, ...patch } : row);
  }
  function move(id) {
    if (!dragId || dragId === id || id === 'top' || dragId === 'top') return;
    const list = lobby.sections.slice();
    const from = list.findIndex((row) => row.id === dragId);
    const to = list.findIndex((row) => row.id === id);
    if (from < 0 || to < 0) return;
    const [row] = list.splice(from, 1);
    list.splice(to, 0, row);
    lobby.sections = list;
    dragId = '';
  }
  function toggleBoard(id) {
    const has = lobby.boards.includes(id);
    const next = has ? lobby.boards.filter((row) => row !== id) : [...lobby.boards, id];
    lobby.boards = next.length ? next : [id];
  }
  function toggleChannel(id) {
    if (lobby.channelIds.includes(id)) lobby.channelIds = lobby.channelIds.filter((row) => row !== id);
    else if (lobby.channelIds.length < 6) lobby.channelIds = [...lobby.channelIds, id];
  }
  async function save(extra = {}) {
    busy = true;
    try {
      const data = await guildAction({
        type: 'settings',
        about,
        showLobby,
        lobby: {
          tagline: lobby.tagline,
          buttons: lobby.buttons,
          channelIds: lobby.channelIds,
          faqs: lobby.faqs.filter((item) => item.q.trim()),
          boards: lobby.boards,
          showBots: lobby.showBots,
          hiddenIds: lobby.hiddenIds,
          feedName: lobby.feedName,
          sections: lobby.sections,
        },
        ...extra,
      });
      if (data?.settings?.lobby) lobby = lobbyFrom(data.settings.lobby);
      toast(extra.makeFeed ? 'Feed ready' : 'Lobby saved');
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }
</script>

<p class="hint">Top to bottom is the lobby's order: grab the handle and drag a block where you want it. Write in the cards, switch off what you don't need. In Classic, the blocks marked Side sit in the right column: tap Side or Main to switch, or drag the cards on the page.</p>

<section class="gset-card">
  <div class="gset-split">
    <div>
      <h3>Show the lobby to members</h3>
      <p class="hint">Off: only you and your managers can see it for now, so you can set it up first.</p>
    </div>
    <button type="button" class="switch" class:on={showLobby} role="switch" aria-checked={showLobby} onclick={() => (showLobby = !showLobby)}><i></i></button>
  </div>
</section>

{#each lobby.sections as block (block.id)}
  {@const copy = LOBBY_COPY[block.id]}
  <section
    class="lobby-block"
    class:off={block.id !== 'top' && !block.on}
    draggable={block.id !== 'top'}
    ondragstart={() => (dragId = block.id)}
    ondragover={(e) => e.preventDefault()}
    ondrop={() => move(block.id)}
  >
    <header>
      {#if block.id === 'top'}<span class="lobby-lock">Always first</span>
      {:else}<button type="button" class="lobby-grip" aria-label="Drag {copy.title}"><GripVertical size={16} /></button>{/if}
      <button type="button" class="lobby-open" onclick={() => (openId = openId === block.id ? '' : block.id)}>
        <strong>{copy.title}</strong>
        <em>{block.id === 'top' ? 'Always first' : block.on ? (block.place === 'side' ? 'Side' : 'Main') : 'Off'}</em>
      </button>
      {#if block.id !== 'top'}
        <button type="button" class="btn sm" onclick={() => setSection(block.id, { place: block.place === 'side' ? 'main' : 'side' })}>{block.place === 'side' ? 'Side' : 'Main'}</button>
        <button type="button" class="switch" class:on={block.on} role="switch" aria-checked={block.on} onclick={() => setSection(block.id, { on: !block.on })}><i></i></button>
      {/if}
    </header>
    {#if openId === block.id}
      <div class="lobby-body">
        <p class="hint">{copy.blurb}</p>
        {#if block.id === 'top'}
          <label class="field">Tagline
            <input bind:value={lobby.tagline} maxlength="120" placeholder="One line under the name, e.g. The comfiest corner for cozy games" />
          </label>
          <p class="label">Buttons</p>
          <p class="hint">Up to 4 under the name. The first one stands out. Link a site or a channel.</p>
          {#each lobby.buttons as button, i}
            <div class="gset-inline">
              <input bind:value={button.label} maxlength="32" placeholder="Label" />
              <select bind:value={button.kind}>
                <option value="url">Site</option>
                <option value="channel">Channel</option>
              </select>
              {#if button.kind === 'channel'}
                <select bind:value={button.channelId}>
                  {#each channels as ch}<option value={ch.id}>{ch.type === 'voice' ? ch.name : '#' + ch.name}</option>{/each}
                </select>
              {:else}
                <input bind:value={button.url} maxlength="200" placeholder="https://" />
              {/if}
              <button type="button" class="btn" onclick={() => (lobby.buttons = lobby.buttons.filter((_, index) => index !== i))}>Remove</button>
            </div>
          {/each}
          {#if lobby.buttons.length < 4}
            <button type="button" class="btn" onclick={() => (lobby.buttons = [...lobby.buttons, { label: '', kind: 'url', url: '', channelId: channels[0]?.id || '' }])}>Add button</button>
          {/if}
        {:else if block.id === 'about'}
          <p class="hint">{copy.empty}</p>
          <textarea bind:value={about} maxlength="2000" rows="5" placeholder="What's this server about? Who's it for, what goes on here?"></textarea>
          <p class="hint">Preview · {about.length}/2000 · Markdown works.</p>
        {:else if block.id === 'channels'}
          <p class="hint">{copy.empty}</p>
          <div class="lobby-picks">
            {#each channels as ch (ch.id)}
              <button type="button" class:on={lobby.channelIds.includes(ch.id)} onclick={() => toggleChannel(ch.id)}>
                {ch.type === 'voice' ? ch.name : '#' + ch.name}
              </button>
            {/each}
          </div>
        {:else if block.id === 'live'}
          <p class="hint">{copy.empty}</p>
        {:else if block.id === 'giveaways'}
          <p class="hint">{copy.empty}</p>
        {:else if block.id === 'feed'}
          <p class="hint">{copy.empty}</p>
          <label class="field">Feed name
            <input bind:value={lobby.feedName} maxlength="60" placeholder="Feed name, e.g. YouTube uploads" />
          </label>
          <button type="button" class="btn brand" disabled={busy} onclick={() => save({ makeFeed: true })}>Make feed</button>
          {#if feedUrl}
            <p class="hint">Apps POST JSON to the URL: &#123;"title", "text", "url", "image"&#125;. Discord webhook tools work too. Links need https, and pictures only show from hosts we allow (YouTube, Twitch, Imgur and a few more).</p>
            <code class="lobby-url">{feedUrl}</code>
          {/if}
        {:else if block.id === 'faq'}
          <p class="hint">{copy.empty}</p>
          {#each lobby.faqs as item, i}
            <div class="gset-inline">
              <input bind:value={item.q} maxlength="160" placeholder="Question" />
              <input bind:value={item.a} maxlength="600" placeholder="Answer" />
              <button type="button" class="btn" onclick={() => (lobby.faqs = lobby.faqs.filter((_, index) => index !== i))}>Remove</button>
            </div>
          {/each}
          {#if lobby.faqs.length < 10}
            <button type="button" class="btn" onclick={() => (lobby.faqs = [...lobby.faqs, { q: '', a: '' }])}>Add question</button>
          {/if}
        {:else if block.id === 'leaderboard'}
          <p class="hint">{copy.empty}</p>
          <div class="lobby-picks">
            {#each boards as board}
              <button type="button" class:on={lobby.boards.includes(board.id)} onclick={() => toggleBoard(board.id)}>{board.label}</button>
            {/each}
          </div>
          <p class="hint">Pick one or more. With more than one, people switch between them with tabs, in the order you picked.</p>
          <div class="gset-line">
            <div>
              <strong>Show bots on leaderboards</strong>
              <p class="hint">Off: bots aren't counted or listed on this server's boards.</p>
            </div>
            <button type="button" class="switch" class:on={lobby.showBots} role="switch" aria-checked={lobby.showBots} onclick={() => (lobby.showBots = !lobby.showBots)}><i></i></button>
          </div>
        {:else if block.id === 'roles'}
          <p class="hint">{copy.empty}</p>
          <button type="button" class="btn" onclick={() => openServerSettings('onboarding')}>Set up</button>
        {:else if block.id === 'rules'}
          <p class="hint">{copy.empty}</p>
          <button type="button" class="btn" onclick={() => openServerSettings('overview')}>Pick a channel</button>
        {:else if block.id === 'staff'}
          <p class="hint">{copy.blurb}</p>
        {:else if block.id === 'links'}
          <p class="hint">{copy.empty}</p>
          <button type="button" class="btn" onclick={() => openServerSettings('overview')}>Add links</button>
        {/if}
      </div>
    {/if}
  </section>
{/each}

<button type="button" class="btn brand" disabled={busy} onclick={() => save()}>Save</button>
