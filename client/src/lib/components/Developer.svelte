<script>
  import { Code, Plus } from '@lucide/svelte';
  import { ui, toast } from '../state.svelte.js';
  import { api } from '../api.js';
  import { PERM, hasBit } from '../format.js';
  import DeveloperDocs from './DeveloperDocs.svelte';

  let { docs = false } = $props();
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
  let profileName = $state('');
  let profileBio = $state('');

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
    if (!openBot || !confirm('Make a new token? The current one will stop working.')) return;
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
    if (!openBot || !confirm('Delete ' + openBot.name + '? It leaves every server and the token dies.')) return;
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

{#if docs || showDocs}
  <DeveloperDocs onback={docs ? () => (ui.userPage = 'developer') : () => (showDocs = false)} />
{:else}
  <section class="dev-portal">
    <div>
      <strong>Developer Portal</strong>
      <p>Your bots, tokens, and the API, in one place.</p>
    </div>
    <button type="button" class="btn brand dev-open" onclick={() => (showDocs = true)}>Open</button>
  </section>

  <section class="dev-block">
    <div class="dev-row">
      <div>
        <h3>Developer</h3>
        <p>Bots that chat in servers. Run them on your own computer. They talk to Nebula over HTTPS.</p>
        <p class="hint">{bots.length} of {limit} bots.</p>
      </div>
    </div>
    {#if note}<p class="hint">{note}</p>{/if}

    {#if openBot}
      <button type="button" class="btn sm" onclick={() => { openId = ''; freshToken = ''; }}>All bots</button>
      <div class="dev-card">
        <h3>{openBot.displayName || openBot.name}</h3>
        <p class="hint">@{openBot.username} · id {openBot.id}</p>
        {#if freshToken}
          <p>Copy this token now. Nebula will not show it again.</p>
          <code class="dev-token">{freshToken}</code>
          <div class="dev-actions">
            <button type="button" class="btn brand dev-open" onclick={copyToken}>Copy token</button>
            <button type="button" class="btn sm" onclick={() => (freshToken = '')}>I saved it</button>
          </div>
        {:else}
          <p class="hint">Token ending in {openBot.tokenTail || '····'}. The full token is only shown when you create it.</p>
          <button type="button" class="btn sm" onclick={rotate}>New token</button>
        {/if}
      </div>

      <div class="dev-card">
        <h3>Profile</h3>
        <div class="field"><label>Display name</label><input bind:value={profileName} maxlength="32" /></div>
        <div class="field"><label>Bio</label><input bind:value={profileBio} maxlength="300" /></div>
        <div class="dev-actions">
          <button type="button" class="btn brand dev-open" onclick={saveProfile}>Save</button>
          <label class="btn sm">Picture<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onchange={pickAvatar} /></label>
        </div>
      </div>

      <div class="dev-card">
        <h3>Servers</h3>
        <p class="hint">Your own bots can join servers you manage right away.</p>
        <div class="dev-actions">
          <select class="look-select" bind:value={serverPick}>
            <option value="">Pick a server</option>
            {#each manageable.filter((server) => !(openBot.servers || []).some((row) => row.id === server.id)) as server}
              <option value={server.id}>{server.name}</option>
            {/each}
          </select>
          <button type="button" class="btn brand dev-open" disabled={!serverPick} onclick={addServer}>Add</button>
        </div>
        {#each openBot.servers || [] as server (server.id)}
          <div class="dev-row slim">
            <strong>{server.name}</strong>
            <button type="button" class="btn sm" onclick={() => removeServer(server.id)}>Remove</button>
          </div>
        {:else}
          <p class="hint">Not in a server yet.</p>
        {/each}
      </div>

      <div class="dev-card">
        <h3>Get started</h3>
        <p class="hint">Send a test event. If your bot is running, its terminal prints it.</p>
        <div class="dev-actions">
          <button type="button" class="btn brand dev-open" onclick={sendTest}>Send test event</button>
          <button type="button" class="btn sm danger" onclick={removeBot}>Delete bot</button>
        </div>
      </div>
    {:else}
      <div class="dev-actions create">
        <input bind:value={name} maxlength="32" placeholder="Bot name" onkeydown={(e) => { if (e.key === 'Enter') createBot(); }} />
        <button type="button" class="btn brand dev-open" disabled={busy || bots.length >= limit} onclick={createBot}><Plus size={16} /> Create</button>
      </div>
      {#if bots.length}
        <div class="dev-list">
          {#each bots as bot (bot.id)}
            <button type="button" class="dev-bot" onclick={() => { openId = bot.id; freshToken = ''; }}>
              <Code size={18} />
              <span><strong>{bot.displayName || bot.name}</strong><em>@{bot.username}</em></span>
            </button>
          {/each}
        </div>
      {:else if !note}
        <div class="dev-empty">
          <img src="./logo.webp?v=3" alt="" />
          <strong>No bots yet</strong>
          <p>Make one, add it to a server, and it can answer /commands in a few minutes.</p>
          <button type="button" class="btn brand dev-open" disabled={busy} onclick={createBot}>Make a bot</button>
        </div>
      {/if}
    {/if}
  </section>
{/if}
