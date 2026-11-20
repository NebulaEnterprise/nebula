<script>
  import { SITE_ORIGIN } from '../format.js';
  import {
    toc,
    botObject,
    channelObject,
    historyMessage,
    sentMessage,
    embedObject,
    commandObject,
    eventEnvelope,
    sdkRows,
    botEndpoints,
    accountEndpoints,
    events,
    starter,
    embedSample,
    welcome,
    curlSample,
  } from '../bot-docs.js';

  let { onback = null } = $props();
  let copied = $state('');
  const origin = SITE_ORIGIN;
  const apiBase = origin + '/api/bot/v1';
  const site = SITE_ORIGIN;
  const routes = botEndpoints(apiBase);
  const account = accountEndpoints(origin);
  const curl = curlSample(apiBase);

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      copied = key;
    } catch {
      copied = '';
    }
  }

  function jump(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

{#snippet sample(key, label, text)}
  <div class="dev-code">
    <div class="dev-code-bar">
      <span>{label}</span>
      <button type="button" class="btn sm" onclick={() => copy(text, key)}>{copied === key ? 'Copied' : 'Copy'}</button>
    </div>
    <pre>{text}</pre>
  </div>
{/snippet}

{#snippet fields(rows)}
  <div class="dev-table">
    <table>
      <thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead>
      <tbody>
        {#each rows as row (`${row[0]}-${row[1]}`)}
          <tr><td><code>{row[0]}</code></td><td>{row[1]}</td><td>{row[2]}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

{#snippet endpoint(ep)}
  <article class="dev-endpoint" id={ep.id}>
    <h4>
      <span class="dev-method {ep.method.toLowerCase()}">{ep.method}</span>
      <code class="dev-path">{ep.path}</code>
    </h4>
    <p>{ep.summary}</p>
    <p class="dev-authline"><code>{ep.auth}</code></p>
    {#if ep.params?.length}
      <h5>Parameters</h5>
      {@render fields(ep.params)}
    {/if}
    {#if ep.body}
      <h5>Body</h5>
      {@render sample(ep.id + '-body', 'JSON', ep.body)}
    {/if}
    {#if ep.response}
      <h5>Response</h5>
      {#if ep.response.includes('\n')}
        {@render sample(ep.id + '-res', 'JSON', ep.response)}
      {:else}
        <p><code>{ep.response}</code></p>
      {/if}
    {/if}
    {#if ep.errors?.length}
      <h5>Errors</h5>
      <div class="dev-table">
        <table>
          <thead><tr><th>Status</th><th>code</th><th>When</th></tr></thead>
          <tbody>
            {#each ep.errors as err (`${ep.id}-${err[0]}-${err[2]}`)}
              <tr><td>{err[0]}</td><td>{#if err[1]}<code>{err[1]}</code>{/if}</td><td>{err[2]}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </article>
{/snippet}

<article class="devdocs">
  {#if onback}
    <button type="button" class="btn sm" onclick={onback}>Back</button>
  {/if}
  <header class="devdocs-head">
    <p class="devdocs-kicker">Bot API 1.0.0</p>
    <h2>Nebula bot documentation</h2>
    <p>Everything a bot can call. The bot HTTP API lives at <code>{apiBase}</code>. Your own account, used by Settings, lives at <code>{origin}/api</code> and uses a session instead of a bot token.</p>
  </header>

  <div class="devdocs-layout">
    <nav class="dev-toc" aria-label="Documentation">
      {#each toc as item, index (`${item.kind}-${item.id || item.text}-${index}`)}
        {#if item.kind === 'label'}
          <p class="dev-toc-label">{item.text}</p>
        {:else}
          <button type="button" onclick={() => jump(item.id)}>{item.text}</button>
        {/if}
      {/each}
    </nav>

    <div class="devdocs-body">
      <section id="dev-overview">
        <h3>Overview</h3>
        <p>A bot is its own account. Your code holds the token and talks to Nebula over HTTPS. Nebula does not host the process. The program keeps a long poll open, receives events, and posts messages back. Closing the terminal stops the bot.</p>
        <p>A bot only sees servers it was added to, and only channels that server lets it see. It cannot sign in on the website. Its own messages are not sent back to it. Webhook messages are not sent to it either. Two bots per account. 25 bots per server. 100 commands per bot. 30 messages a minute per bot.</p>
        <p>Download <a href="{site}/sdk/nebula.js" target="_blank" rel="noopener">nebula.js</a>, <a href="{site}/sdk/starter.js" target="_blank" rel="noopener">starter.js</a>, <a href="{site}/sdk/welcome.js" target="_blank" rel="noopener">welcome.js</a>, and <a href="{site}/sdk/package.json" target="_blank" rel="noopener">package.json</a>. You need Node 18 or newer. <code>package.json</code> sets <code>"type": "module"</code>, which is what the <code>import</code> needs.</p>
      </section>

      <section id="dev-auth">
        <h3>Authentication</h3>
        <p>Bot routes, except <code>GET /version</code>, require this header:</p>
        {@render sample('auth', 'HTTP', 'Authorization: Bot nb_PASTE_YOUR_TOKEN')}
        <p>The token is shown once, when you create the bot or when you make a new token in Settings → Developer. It starts with <code>nb_</code>. There is one current token. Making a new one kills the old one. The header must be the word <code>Bot</code>, a space, then the token. <code>Bearer</code> is the session used by the account routes, not the bot routes.</p>
        <p>Send JSON as <code>Content-Type: application/json</code>. The avatar route is the exception: its body is the raw picture. Responses are JSON. A failed bot route looks like this:</p>
        {@render sample('err', 'JSON', `{
  "error": "The bot cannot send messages there",
  "code": "missing_permission"
}`)}
        <p>Every bot response includes <code>X-Nebula-API-Version: 1.0.0</code>.</p>
      </section>

      <section id="dev-start">
        <h3>Quick start</h3>
        <ol>
          <li>In Nebula, open Settings → Developer. Name the bot and press Create. Copy the token.</li>
          <li>Add the bot to a server you manage, from that screen or from Server settings → Bots.</li>
          <li>Put <code>nebula.js</code>, <code>starter.js</code>, and <code>package.json</code> in one folder. Replace <code>nb_PASTE_YOUR_TOKEN</code> in <code>starter.js</code>.</li>
          <li>Run <code>node starter.js</code>. The terminal prints <code>online as</code> and the username.</li>
          <li>In the server, type <code>/ping</code>. The bot answers pong. <code>!ping</code> runs the same command.</li>
        </ol>
        <p>If nothing prints, open the bot and press Send test event. A connected script receives a <code>test</code> event. Keep the process running.</p>
        {@render sample('js', 'starter.js', starter)}
      </section>

      <section id="dev-objects">
        <h3>Objects</h3>
        <h4 id="obj-bot">Bot</h4>
        <p>Returned by <code>GET /me</code>, <code>PATCH /me</code>, and <code>PUT /me/avatar</code>.</p>
        {@render fields(botObject)}
        <h4 id="obj-channel">Channel</h4>
        {@render fields(channelObject)}
        <h4 id="obj-history">History message</h4>
        <p>Returned by <code>GET /channels/:id/messages</code>. Shorter than the object you get from sending.</p>
        {@render fields(historyMessage)}
        <h4 id="obj-sent">Sent message</h4>
        <p>The <code>message</code> inside the response from <code>POST /channels/:id/messages</code>.</p>
        {@render fields(sentMessage)}
        <h4 id="obj-embed">Embed</h4>
        <p>A card on a message: a colored bar, a title, and a description. Up to 4 per message. A card needs a title, a description, or a url. The chat draws the bar from the stored number.</p>
        {@render fields(embedObject)}
        <h4 id="obj-command">Command</h4>
        {@render fields(commandObject)}
        <h4 id="obj-event">Event envelope</h4>
        <p>One item in <code>GET /events</code>. <code>data</code> is documented under Events. The library copies <code>data</code> onto the object your listener receives and adds <code>type</code>, <code>reply</code>, and <code>say</code> when the event has a channel.</p>
        {@render fields(eventEnvelope)}
      </section>

      <section id="dev-sdk">
        <h3>JavaScript SDK</h3>
        <p><code>nebula.js</code> is one file. It does not install packages. <code>bot.start()</code> registers commands, then polls. Listeners for one event run in the order you added them. A matching command runs after the <code>message</code> listeners. A thrown listener becomes an <code>error</code> event. On a failed poll the library waits 5 seconds after HTTP 429 and 2 seconds after anything else, then polls again.</p>
        <div class="dev-table">
          <table>
            <thead><tr><th>Call</th><th>What it does</th></tr></thead>
            <tbody>
              {#each sdkRows as row (row[0])}
                <tr><td><code>{row[0]}</code></td><td>{row[1]}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p><code>ready</code> and <code>error</code> are local. They are not returned by <code>GET /events</code>. <code>ready</code> receives the bot object. <code>error</code> receives an Error with <code>message</code>, <code>status</code>, and <code>code</code>.</p>
      </section>

      <section id="dev-http">
        <h3>Bot HTTP API</h3>
        <p>Base URL <code>{apiBase}</code>. Paths below already include it. <code>:id</code> is a single path segment. Encode ids that contain characters other than letters, numbers, and hyphens.</p>
        {#each routes as ep (ep.id)}
          {@render endpoint(ep)}
        {/each}
      </section>

      <section id="dev-account">
        <h3>Account API</h3>
        <p>These routes create and manage bots. They use the session from being signed in to Nebula, not the bot token. The website calls them for you from Settings → Developer and Server settings → Bots. A program that posts as the bot should use the Bot HTTP API above.</p>
        <p>Header: <code>Authorization: Bearer &lt;session&gt;</code>. A missing or old session is <code>401</code> with <code>{'{'} error {'}'}</code> and no <code>code</code>.</p>
        {#each account as ep (ep.id)}
          {@render endpoint(ep)}
        {/each}
      </section>

      <section id="dev-events">
        <h3>Events</h3>
        <p>Events stay in memory on the server that accepted them. The newest few thousand are kept. A restart clears them and starts ids over, so a saved <code>after</code> from before the restart should be treated as 0. A bot that was offline catches up only for events the process still has, and only 100 per poll.</p>
        {#each events as ev (ev.type)}
          <h4 id={'ev-' + ev.type}><code>{ev.type}</code></h4>
          <p>{ev.text}</p>
          {@render fields(ev.fields)}
        {/each}
      </section>

      <section id="dev-examples">
        <h3>Examples</h3>
        <h4>Embed</h4>
        <p>Pass an empty string when you do not want a line of text above the card. <code>msg.reply</code> takes the same options as <code>bot.send</code>.</p>
        {@render sample('embed', 'embed.js', embedSample)}
        <h4>Welcome bot</h4>
        <p>Save this as <code>welcome.js</code> next to <code>nebula.js</code>. It posts an embed in <code>#welcome</code>, <code>#general</code>, or <code>#lobby</code> when someone joins. <code>/setwelcome</code> in another channel uses that channel until the process stops.</p>
        {@render sample('welcome', 'welcome.js', welcome)}
        <h4>Send with curl</h4>
        <p>The same post, without the SDK. Replace <code>CHANNEL_ID</code> with an id from <code>GET /servers/:id/channels</code>.</p>
        {@render sample('curl', 'curl', curl)}
      </section>

      <section id="dev-limits">
        <h3>Errors and limits</h3>
        <div class="dev-table">
          <table>
            <thead><tr><th>Status</th><th>code</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td>400</td><td><code>invalid_request</code></td><td>The body or the command list was rejected. <code>error</code> says which rule.</td></tr>
              <tr><td>401</td><td><code>unauthorized</code></td><td>Bot token missing or wrong. Account routes say Unauthorized or Invalid session and omit <code>code</code>.</td></tr>
              <tr><td>403</td><td><code>missing_permission</code></td><td>The bot is not allowed to see or post, or the channel is read-only. Account routes use a plain <code>error</code> when you lack Manage Server.</td></tr>
              <tr><td>404</td><td><code>not_found</code></td><td>That server, channel, or bot is not visible to this token.</td></tr>
              <tr><td>413</td><td><code>too_large</code></td><td>The picture is over 8 MB.</td></tr>
              <tr><td>429</td><td><code>rate_limited</code></td><td>30 messages in the last minute, or the channel slowmode is still running.</td></tr>
              <tr><td>502</td><td><code>unavailable</code></td><td>The picture could not be stored.</td></tr>
            </tbody>
          </table>
        </div>
        <ul>
          <li>2 bots on one account.</li>
          <li>25 bots in one server.</li>
          <li>100 commands on one bot. Names are 1 to 32 of <code>a-z</code>, <code>0-9</code>, <code>-</code>, <code>_</code>.</li>
          <li>30 messages a minute per bot. A channel can also have its own slowmode, up to 21600 seconds.</li>
          <li>Message text is 2000 characters. Embed title 256. Embed description 2000. Embed url 500. Bio 300. Display name 32.</li>
          <li>4 embeds per message. A channel keeps the newest 500 messages.</li>
          <li>Event polls return at most 100 events. <code>wait</code> cannot be longer than 25 seconds.</li>
          <li>Avatar files are PNG, JPG, GIF, or WebP, up to 8 MB.</li>
        </ul>
      </section>
    </div>
  </div>
</article>
