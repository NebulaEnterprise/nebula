<script>
  import { getApiBase } from '../api.js';

  let { onback = null } = $props();
  let copied = $state('');
  const apiBase = getApiBase() + '/api/bot/v1';
  const site = 'https://nebulaapp.space';

  const starter = `import { Bot } from './nebula.js';

const bot = new Bot('nb_…');

bot.command('ping', 'Is the bot alive?', (msg) => msg.reply('pong'));

bot.on('message', (msg) => {
  if (msg.mentioned) msg.reply('hey');
});

bot.on('ready', (me) => console.log('online as', me.username));
bot.start();`;

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      copied = key;
    } catch {
      copied = '';
    }
  }
</script>

<article class="devdocs">
  {#if onback}
    <button type="button" class="btn sm" onclick={onback}>Back</button>
  {/if}
  <h3>Build bots on Nebula</h3>
  <p>A bot is an account your code drives. It runs on your own computer, nothing is hosted for you, and it talks to Nebula over HTTPS. A bot uses its own account. Automating your personal account is not allowed.</p>

  <h3>Quick start</h3>
  <ol>
    <li>In Nebula, open Settings → Developer, type a name, and press Create. Copy the token. It starts with <code>nb_</code> and is shown once.</li>
    <li>Add the bot to a server you manage, from that same screen or from Server settings → Bots.</li>
    <li>Make a folder. Save <a href="{site}/sdk/nebula.js" target="_blank" rel="noopener">nebula.js</a>, <a href="{site}/sdk/starter.js" target="_blank" rel="noopener">starter.js</a>, and <a href="{site}/sdk/package.json" target="_blank" rel="noopener">package.json</a> into it. Paste the token into starter.js.</li>
    <li>In a terminal in that folder, run <code>node starter.js</code>. You need Node 18 or newer.</li>
    <li>In the server, type <code>/ping</code>. The bot answers pong.</li>
  </ol>
  <p>Give it a picture from Settings → Developer → your bot → Profile, or from code with <code>bot.setAvatar('./avatar.png')</code>.</p>
  <p>Stuck? Open your bot and press Send test event. If the terminal prints the test, it is connected.</p>

  <div class="dev-code">
    <button type="button" class="btn sm" onclick={() => copy(starter, 'js')}>{copied === 'js' ? 'Copied' : 'Copy'}</button>
    <pre>{starter}</pre>
  </div>

  <h3>The library</h3>
  <p><code>nebula.js</code> is one file, with no packages to install. It registers your commands, then waits for events. <code>!</code> works the same as <code>/</code>, so <code>!ping</code> and <code>/ping</code> both run.</p>
  <table>
    <thead><tr><th>Call</th><th>What it does</th></tr></thead>
    <tbody>
      <tr><td><code>new Bot(token)</code></td><td>Uses that token. <code>NEBULA_BOT_TOKEN</code> is read when you leave it empty. <code>NEBULA_API_URL</code> overrides the server.</td></tr>
      <tr><td><code>bot.command(name, description, fn)</code></td><td>A command people type as <code>/name</code>. Names are 1 to 32 letters, numbers, <code>-</code> or <code>_</code>. Up to 100 commands.</td></tr>
      <tr><td><code>bot.on(event, fn)</code></td><td><code>message</code>, <code>test</code>, <code>server_add</code>, <code>server_remove</code>, <code>ready</code>, <code>error</code>.</td></tr>
      <tr><td><code>bot.send(channelId, text, opts)</code></td><td>Posts in a channel. <code>opts.replyTo</code> quotes a message. <code>opts.embeds</code> adds up to 4 cards.</td></tr>
      <tr><td><code>msg.reply(text)</code></td><td>Answers in the same channel and quotes the message. <code>msg.say(text)</code> posts without the quote. <code>msg.args</code> is the rest of the line.</td></tr>
      <tr><td><code>bot.setProfile</code> / <code>bot.setAvatar</code></td><td>Display name, bio, and picture.</td></tr>
      <tr><td><code>bot.servers()</code></td><td>Servers this bot was added to.</td></tr>
      <tr><td><code>bot.api(method, path, body)</code></td><td>Any bot endpoint, with the token added for you.</td></tr>
      <tr><td><code>bot.start()</code> / <code>bot.stop()</code></td><td>Registers commands, then listens until you stop it.</td></tr>
    </tbody>
  </table>

  <h3>API</h3>
  <p>Base URL <code>{apiBase}</code>. Every request sends <code>Authorization: Bot &lt;token&gt;</code>. Bodies and answers are JSON. A bot only sees servers it was added to, and only channels that role can see. Its own messages are not sent back to it.</p>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>What it does</th></tr></thead>
    <tbody>
      <tr><td>GET</td><td><code>/version</code></td><td>API version. No token.</td></tr>
      <tr><td>GET</td><td><code>/me</code></td><td>The bot’s profile.</td></tr>
      <tr><td>PATCH</td><td><code>/me</code></td><td><code>display_name</code> (32) and <code>bio</code> (300).</td></tr>
      <tr><td>PUT</td><td><code>/me/avatar</code></td><td>The picture bytes. PNG, JPG, GIF, or WebP, up to 8 MB.</td></tr>
      <tr><td>GET, PUT</td><td><code>/commands</code></td><td>Read or replace the command list.</td></tr>
      <tr><td>GET</td><td><code>/events?after=&amp;wait=</code></td><td>Events after <code>after</code>. <code>wait</code> holds the request up to 25 seconds. Send the returned <code>last</code> back as <code>after</code>.</td></tr>
      <tr><td>GET</td><td><code>/servers</code></td><td>Servers the bot is in.</td></tr>
      <tr><td>GET</td><td><code>/servers/:id/channels</code></td><td>Channels the bot can see.</td></tr>
      <tr><td>GET</td><td><code>/channels/:id</code></td><td>One channel.</td></tr>
      <tr><td>GET</td><td><code>/channels/:id/messages</code></td><td>Recent messages, oldest first. <code>limit</code> up to 100.</td></tr>
      <tr><td>POST</td><td><code>/channels/:id/messages</code></td><td><code>content</code> up to 2000 characters, optional <code>reply_to</code> and <code>embeds</code>.</td></tr>
    </tbody>
  </table>

  <h3>Events</h3>
  <table>
    <thead><tr><th>type</th><th>data</th></tr></thead>
    <tbody>
      <tr><td><code>message</code></td><td>id, channel_id, channel_name, server_id, author_id, author, content, created_at, mentioned. When it starts with <code>/</code> or <code>!</code> and matches a command: <code>command</code> and <code>args</code>.</td></tr>
      <tr><td><code>server_add</code> / <code>server_remove</code></td><td>server_id and name, when the bot is added or removed.</td></tr>
      <tr><td><code>test</code></td><td>Sent by the Send test event button.</td></tr>
    </tbody>
  </table>

  <h3>Embeds</h3>
  <p>Up to 4 cards on a message. Each can have <code>title</code>, <code>description</code>, <code>url</code>, and <code>color</code> as a number or <code>#rrggbb</code>.</p>
  <pre>{`msg.reply('', { embeds: [{ title: 'Match result', description: 'Blue won 3-1.', color: '#7c5cff' }] });`}</pre>

  <h3>Errors and limits</h3>
  <p>Errors look like <code>{'{'} error, code {'}'}</code>. <code>401</code> means the token is missing or wrong. <code>403</code> means the bot is not in that server, or it cannot see or post in the channel. <code>429</code> means slow down: 30 messages a minute per bot. Make a new token from the bot’s Token section if you lose the old one. The old one stops working.</p>
  <p>Two bots per account. 25 bots per server. 100 commands per bot. Events stay in memory on the server until it restarts, so a bot that was offline catches up only as far as the server still has them.</p>
</article>
