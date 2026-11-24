<script>
  import { Plus, X, LayoutGrid, KeyRound, BookOpen, Braces, CircleHelp, Code } from '@lucide/svelte';
  import { ui, toast, developerMode, setDeveloperMode } from '../state.svelte.js';
  import { api } from '../api.js';
  import { PERM, hasBit } from '../format.js';
  import DeveloperDocs from './DeveloperDocs.svelte';

  let { docs = false, portal = false, onopen = () => {} } = $props();
  let bots = $state([]);
  let limit = $state(2);
  let name = $state('');
  let busy = $state(false);
  let note = $state('');
  let openId = $state('');
  let freshToken = $state('');
  let servers = $state([]);
  let serverPick = $state('');
  let showDocs = $state(false);
  let tab = $state('apps');
  let naming = $state(false);
  let ask = $state('');
  let profileName = $state('');
  let profileBio = $state('');
  let devOn = $state(developerMode());

  const openBot = $derived(bots.find((bot) => bot.id === openId) || null);
  const manageable = $derived(servers.filter((server) => server.owner || hasBit(server.permissions || 0, PERM.MANAGE_SERVER)));

  async function load() {
    note = '';
    try {
      const data = await api('/api/me/bots');
      bots = data.bots || [];
      limit = data.limit || 2;
      const mine = await api('/api/servers');
      servers = mine.servers || [];
    } catch (err) {
      note = err.status === 404 ? 'Bots need the updated server. Replace server.js and start it again.' : err.message;
    }
  }

  $effect(() => {
    if (docs) return;
    load();
  });

  $effect(() => {
    profileName = openBot?.displayName || openBot?.name || '';
    profileBio = openBot?.bio || '';
  });

  async function createBot() {
    const next = name.trim();
    if (next.length < 2) return toast('Name the bot with at least 2 characters');
    busy = true;
    try {
      const data = await api('/api/me/bots', { method: 'POST', body: { name: next } });
      freshToken = data.bot?.token || '';
      openId = data.bot?.id || '';
      name = '';
      await load();
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function copyToken() {
    if (!freshToken) return;
    try { await navigator.clipboard.writeText(freshToken); toast('Token copied'); }
    catch { toast(freshToken); }
  }

  async function rotate() {
    if (!openBot) return;
    ask = '';
    try {
      const data = await api('/api/me/bots/' + openBot.id + '/token', { method: 'POST', body: {} });
      freshToken = data.bot?.token || '';
      await load();
      toast('New token ready. Copy it now.');
    } catch (err) {
      toast(err.message);
    }
  }

  async function saveProfile() {
    if (!openBot) return;
    try {
      await api('/api/me/bots/' + openBot.id, { method: 'PATCH', body: { displayName: profileName, bio: profileBio } });
      await load();
      toast('Profile saved');
    } catch (err) {
      toast(err.message);
    }
  }

  async function pickAvatar(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file || !openBot) return;
    try {
      const data = await api('/api/upload?slot=file&name=' + encodeURIComponent(file.name || 'avatar.png'), {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!data.url) throw new Error('The picture did not save');
      await api('/api/me/bots/' + openBot.id, { method: 'PATCH', body: { avatarUrl: data.url } });
      await load();
      toast('Picture saved');
    } catch (err) {
      toast(err.message);
    }
  }

  async function addServer() {
    if (!openBot || !serverPick) return;
    try {
      await api('/api/me/bots/' + openBot.id + '/servers', { method: 'POST', body: { serverId: serverPick } });
      serverPick = '';
      await load();
      toast('Bot added');
    } catch (err) {
      toast(err.message);
    }
  }

  async function removeServer(serverId) {
    if (!openBot) return;
    try {
      await api('/api/me/bots/' + openBot.id + '/servers/' + serverId, { method: 'DELETE' });
      await load();
    } catch (err) {
      toast(err.message);
    }
  }

  async function sendTest() {
    if (!openBot) return;
    try {
      await api('/api/me/bots/' + openBot.id + '/test', { method: 'POST', body: {} });
      toast('Test event sent');
    } catch (err) {
      toast(err.message);
    }
  }

  async function removeBot() {
    if (!openBot) return;
    ask = '';
    try {
      await api('/api/me/bots/' + openBot.id, { method: 'DELETE' });
      openId = '';
      freshToken = '';
      await load();
    } catch (err) {
      toast(err.message);
    }
  }
</script>

{#if !portal && !docs}
  <div class="dev-home">
    <article class="dev-portal-card dev-mode">
      <div>
        <h3>Developer Mode</h3>
        <p>Adds Copy Server, Channel, Category, Message and User ID to right-click menus, for building bots with the Nebula API.</p>
      </div>
      <button type="button" class="switch" class:on={devOn} aria-pressed={devOn} onclick={() => { devOn = !devOn; setDeveloperMode(devOn); }}><i></i></button>
    </article>
    <article class="dev-portal-card">
      <div>
        <h3>Developer Portal</h3>
        <p>Your bots, tokens, the API reference and the starter file in one place.</p>
      </div>
      <button type="button" class="dev-open" onclick={() => onopen()}>Open</button>
    </article>
    <header class="dev-home-head">
      <div>
        <h2>Developer</h2>
        <p>Bots that chat in servers. Run them on your own computer. <button type="button" class="dev-docs-link" onclick={() => { tab = 'api'; onopen(); }}>Docs</button></p>
        <p class="dev-count">{bots.length} of {limit} bots.</p>
      </div>
      <button type="button" class="dev-open" disabled={busy || bots.length >= limit} onclick={() => { naming = true; openId = ''; onopen(); }}>New bot</button>
    </header>
    {#if note}<p class="portal-note">{note}</p>{/if}
    {#if bots.length}
      <div class="dev-bot-list">
        {#each bots as bot (bot.id)}
          <button type="button" class="dev-bot" onclick={() => { openId = bot.id; freshToken = ''; onopen(); }}>
            <Code size={18} />
            <span><strong>{bot.displayName || bot.name}</strong><em>@{bot.username}</em></span>
          </button>
        {/each}
      </div>
    {:else if !note}
      <div class="dev-empty">
        <img src="./logo.webp?v=3" alt="" />
        <strong>No bots yet</strong>
        <p>Make one, add it to a server and it can answer /commands in a few minutes.</p>
        <button type="button" class="dev-open" disabled={busy} onclick={() => { naming = true; onopen(); }}>Make a bot</button>
      </div>
    {/if}
  </div>
{:else}
<div class="portal">
  <aside class="portal-nav">
    <div class="portal-brand">
      <img src="./logo.webp?v=3" alt="" />
      <div><strong>Developer</strong><span>Portal</span></div>
    </div>
    <button type="button" class:on={tab === 'apps' && !showDocs && !docs} onclick={() => { tab = 'apps'; showDocs = false; }}><LayoutGrid size={18} /> Apps</button>
    <button type="button" class:on={tab === 'login'} onclick={() => { tab = 'login'; showDocs = false; }}><KeyRound size={18} /> Login with Nebula</button>
    <button type="button" class:on={tab === 'start'} onclick={() => { tab = 'start'; showDocs = false; }}><BookOpen size={18} /> Get started</button>
    <button type="button" class:on={tab === 'api' || showDocs || docs} onclick={() => { tab = 'api'; showDocs = false; }}><Braces size={18} /> API reference</button>
    <button type="button" class:on={tab === 'help'} onclick={() => { tab = 'help'; showDocs = false; }}><CircleHelp size={18} /> Help & roadmap</button>
  </aside>
  <div class="portal-main">
    <button type="button" class="portal-x" title="Close" onclick={() => (ui.userSettings = false)}><X size={18} /></button>
    {#if docs || showDocs}
      <DeveloperDocs onback={docs ? () => { ui.userPage = 'developer'; } : () => { showDocs = false; tab = 'api'; }} />
    {:else if tab === 'apps'}
      <header class="portal-top">
        <div>
          <h2>Developer</h2>
          <p>Bots that chat in servers. Run them on your own computer. They talk to Nebula over HTTPS.</p>
          <p class="portal-count">{bots.length} of {limit} bots.</p>
        </div>
        <button type="button" class="portal-go" disabled={busy || bots.length >= limit} onclick={() => { naming = true; openId = ''; }}><Plus size={16} /> New bot</button>
      </header>
      {#if note}<p class="portal-note">{note}</p>{/if}
      {#if openBot}
        <button type="button" class="portal-back" onclick={() => { openId = ''; freshToken = ''; ask = ''; }}>All bots</button>
        <section class="portal-card wide">
          <h3>{openBot.displayName || openBot.name}</h3>
          <p>@{openBot.username} · id {openBot.id}</p>
          {#if freshToken}
            <p>Copy this token now. Nebula will not show it again.</p>
            <code class="dev-token">{freshToken}</code>
            <div class="portal-row">
              <button type="button" class="portal-go" onclick={copyToken}>Copy token</button>
              <button type="button" class="portal-quiet" onclick={() => (freshToken = '')}>I saved it</button>
            </div>
          {:else}
            <p>Token ending in {openBot.tokenTail || '····'}. The full token is only shown when you create it.</p>
            {#if ask === 'rotate'}
              <p>Make a new token? The current one will stop working.</p>
              <div class="portal-row">
                <button type="button" class="portal-go" onclick={rotate}>New token</button>
                <button type="button" class="portal-quiet" onclick={() => (ask = '')}>Cancel</button>
              </div>
            {:else}
              <button type="button" class="portal-quiet" onclick={() => (ask = 'rotate')}>New token</button>
            {/if}
          {/if}
        </section>
        <section class="portal-card wide">
          <h3>Profile</h3>
          <label>Display name<input bind:value={profileName} maxlength="32" /></label>
          <label>Bio<input bind:value={profileBio} maxlength="300" /></label>
          <div class="portal-row">
            <button type="button" class="portal-go" onclick={saveProfile}>Save</button>
            <label class="portal-quiet">Picture<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onchange={pickAvatar} /></label>
          </div>
        </section>
        <section class="portal-card wide">
          <h3>Servers</h3>
          <p>Your own bots can join servers you manage right away.</p>
          <div class="portal-row">
            <select bind:value={serverPick}>
              <option value="">Pick a server</option>
              {#each manageable.filter((server) => !(openBot.servers || []).some((row) => row.id === server.id)) as server}
                <option value={server.id}>{server.name}</option>
              {/each}
            </select>
            <button type="button" class="portal-go" disabled={!serverPick} onclick={addServer}>Add</button>
          </div>
          {#each openBot.servers || [] as server (server.id)}
            <div class="portal-row between">
              <strong>{server.name}</strong>
              <button type="button" class="portal-quiet" onclick={() => removeServer(server.id)}>Remove</button>
            </div>
          {:else}
            <p>Not in a server yet.</p>
          {/each}
        </section>
        <section class="portal-card wide">
          <h3>Try it</h3>
          <p>Send a test event. If your bot is running, its terminal prints it.</p>
          <div class="portal-row">
            <button type="button" class="portal-go" onclick={sendTest}>Send test event</button>
            {#if ask === 'delete'}
              <span>Delete {openBot.name}? It leaves every server and the token dies.</span>
              <button type="button" class="portal-go danger" onclick={removeBot}>Delete</button>
              <button type="button" class="portal-quiet" onclick={() => (ask = '')}>Cancel</button>
            {:else}
              <button type="button" class="portal-quiet danger" onclick={() => (ask = 'delete')}>Delete bot</button>
            {/if}
          </div>
        </section>
      {:else if naming || bots.length}
        {#if naming}
          <div class="portal-row name-row">
            <input bind:value={name} maxlength="32" placeholder="Bot name" onkeydown={(e) => { if (e.key === 'Enter') createBot(); }} />
            <button type="button" class="portal-go" disabled={busy || bots.length >= limit} onclick={createBot}>Create</button>
          </div>
        {/if}
        {#if bots.length}
          <div class="portal-bots">
            {#each bots as bot (bot.id)}
              <button type="button" class="portal-bot" onclick={() => { openId = bot.id; freshToken = ''; naming = false; }}>
                <Code size={18} />
                <span><strong>{bot.displayName || bot.name}</strong><em>@{bot.username}</em></span>
              </button>
            {/each}
          </div>
        {:else if !note}
          <div class="portal-empty">
            <img src="./logo.webp?v=3" alt="" />
            <strong>No bots yet</strong>
            <p>Make one, add it to a server and it can answer /commands in a few minutes.</p>
          </div>
        {/if}
      {:else if !note}
        <div class="portal-empty">
          <img src="./logo.webp?v=3" alt="" />
          <strong>No bots yet</strong>
          <p>Make one, add it to a server and it can answer /commands in a few minutes.</p>
          <button type="button" class="portal-go" disabled={busy} onclick={() => (naming = true)}>Make a bot</button>
        </div>
      {/if}
    {:else if tab === 'login'}
      <header class="portal-top"><div><h2>Login with Nebula</h2><p>A bot is its own account. People stay signed in to Nebula. Your code holds the bot token and talks to Nebula over HTTPS.</p></div></header>
      <div class="portal-cards">
        <article class="portal-card"><h3>Bot token</h3><p>The token starts with nb_. Send it as <code>Authorization: Bot &lt;token&gt;</code>. Nebula shows the full token once, when you create the bot or make a new one.</p></article>
        <article class="portal-card"><h3>Your account</h3><p>Creating bots uses the account you are signed in with. A program that posts as the bot uses the bot token, not your password or session.</p></article>
        <article class="portal-card"><h3>Add it to a server</h3><p>Open the bot under Apps and add a server you manage. It can read and post where @everyone can.</p></article>
      </div>
    {:else if tab === 'start'}
      <header class="portal-top"><div><h2>Get started</h2><p>A bot only sees what you tell it to do. Nebula does not host the process.</p></div></header>
      <div class="portal-cards">
        <article class="portal-card"><h3>1. Make a bot</h3><p>Apps, then New bot. Copy the token. Making a new token kills the old one.</p></article>
        <article class="portal-card"><h3>2. Add a server</h3><p>Put the bot in a server you manage. It shows up in the member list with a BOT tag.</p></article>
        <article class="portal-card"><h3>3. Run the SDK</h3><p>Use nebula.js on your computer. Keep a long poll open, answer events, and post messages back. Closing the terminal stops the bot.</p></article>
      </div>
    {:else if tab === 'api'}
      <header class="portal-top"><div><h2>API reference</h2><p>Every endpoint, with request and response shapes. Header <code>Authorization: Bot &lt;token&gt;</code>.</p></div></header>
      <div class="portal-cards">
        <button type="button" class="portal-card" onclick={() => (showDocs = true)}><h3>Read the reference</h3><p>All endpoints, grouped</p></button>
        <button type="button" class="portal-card" onclick={() => (showDocs = true)}><h3>Guide & SDK</h3><p>Quick start, SDK methods, events, embeds</p></button>
        <a class="portal-card" href="./sdk/nebula.js" download="nebula.js"><h3>nebula.js</h3><p>One file, no dependencies</p></a>
      </div>
    {:else}
      <header class="portal-top"><div><h2>Help & roadmap</h2></div></header>
      <div class="portal-cards">
        <article class="portal-card"><h3>Nebula Official</h3><p>Ask questions and show your bot in the server you are already in.</p></article>
        <article class="portal-card"><h3>Roadmap</h3><p>Bots can post, react, and read events. Hosting and a public OpenAPI file are next.</p></article>
        <article class="portal-card"><h3>Bot rules</h3><p>No selfbots: use a bot account. One token per bot. Do not share the token.</p></article>
      </div>
    {/if}
  </div>
</div>
{/if}
