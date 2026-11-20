<script>
  import { getApiBase } from '../api.js';

  let { onback = null } = $props();
  let copied = $state('');
  const apiBase = getApiBase() + '/api/bot/v1';
  const site = 'https://nebulaapp.space';

  const sections = [
    ['dev-start', 'Start'],
    ['dev-library', 'Library'],
    ['dev-api', 'API'],
    ['dev-events', 'Events'],
    ['dev-embeds', 'Embeds'],
    ['dev-welcome', 'Welcome bot'],
    ['dev-limits', 'Limits'],
  ];

  const starter = `import { Bot } from './nebula.js';

const bot = new Bot('nb_PASTE_YOUR_TOKEN');

bot.command('ping', 'Is the bot alive?', (msg) => msg.reply('pong'));

bot.on('message', (msg) => {
  if (msg.mentioned) msg.reply('hey');
});

bot.on('ready', (me) => console.log('online as', me.username));
bot.on('error', (err) => console.error(err));

bot.start();`;

  const embedSample = `msg.reply('', {
  embeds: [{
    title: 'Match result',
    description: 'Blue won 3-1.',
    color: '#7c5cff',
  }],
});`;

  const welcome = `import { Bot } from './nebula.js';

const bot = new Bot('nb_PASTE_YOUR_TOKEN');
const rooms = new Map();

async function welcomeChannel(serverId) {
  if (rooms.has(serverId)) return rooms.get(serverId);
  const data = await bot.api('GET', '/servers/' + encodeURIComponent(serverId) + '/channels?type=text');
  const list = data.channels || [];
  const named = list.find((ch) => /^(welcome|general|lobby)$/i.test(ch.name));
  const channel = named || list[0];
  if (!channel) return '';
  rooms.set(serverId, channel.id);
  return channel.id;
}

bot.command('setwelcome', 'Welcome new people in this channel', async (msg) => {
  rooms.set(msg.server_id, msg.channel_id);
  await msg.reply('I will welcome new people in this channel.');
});

bot.on('member_join', async (ev) => {
  if (!ev.server_id || ev.user_id === (bot.me && bot.me.id)) return;
  const channelId = await welcomeChannel(ev.server_id);
  if (!channelId) return;
  const name = ev.username ? '@' + ev.username : (ev.display_name || 'someone new');
  const count = ev.member_count ? ' You are member ' + ev.member_count + '.' : '';
  await bot.send(channelId, '', {
    embeds: [{
      title: 'Welcome to ' + (ev.server_name || 'the server'),
      description: 'Welcome ' + name + '.' + count,
      color: '#c084fc',
    }],
  });
});

bot.on('ready', (me) => console.log('welcome bot online as', me.username));
bot.on('error', (err) => console.error(err));
bot.start();`;

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

<article class="devdocs">
  {#if onback}
    <button type="button" class="btn sm" onclick={onback}>Back</button>
  {/if}
  <header class="devdocs-head">
    <p class="devdocs-kicker">Developers</p>
    <h2>Build bots on Nebula</h2>
    <p>A bot is an account your code drives. It runs on your own computer. Nothing is hosted for you. It talks to Nebula over HTTPS with a token that starts with <code>nb_</code>. A bot uses its own account. Automating a personal account is not allowed.</p>
  </header>

  <div class="devdocs-layout">
    <nav class="dev-toc" aria-label="Guide">
      {#each sections as [id, label] (id)}
        <button type="button" onclick={() => jump(id)}>{label}</button>
      {/each}
    </nav>

    <div class="devdocs-body">
      <section id="dev-start">
        <h3>Start</h3>
        <ol>
          <li>In Nebula, open Settings, then Developer. Type a name and press Create. Copy the token. It is shown once.</li>
          <li>Add the bot to a server you manage, from that same screen or from Server settings, then Bots.</li>
          <li>Make a folder. Save <a href="{site}/sdk/nebula.js" target="_blank" rel="noopener">nebula.js</a>, <a href="{site}/sdk/starter.js" target="_blank" rel="noopener">starter.js</a>, <a href="{site}/sdk/welcome.js" target="_blank" rel="noopener">welcome.js</a>, and <a href="{site}/sdk/package.json" target="_blank" rel="noopener">package.json</a> into it. Paste the token into the script, replacing <code>nb_PASTE_YOUR_TOKEN</code>.</li>
          <li>In a terminal in that folder, run <code>node starter.js</code>. You need Node 18 or newer. <code>package.json</code> marks the folder as a module, so the import works.</li>
          <li>In the server, type <code>/ping</code>. The bot answers pong. <code>!ping</code> runs the same command.</li>
        </ol>
        <p>Give it a picture from Settings, then Developer, then your bot, then Profile. From code, <code>bot.setAvatar('./avatar.png')</code> does the same thing.</p>
        <p>The terminal should print <code>online as</code> and the bot’s username. If it does not, open the bot and press Send test event. A connected script prints that test. Keep the terminal open. Closing it stops the bot.</p>
        {@render sample('js', 'starter.js', starter)}
      </section>

      <section id="dev-library">
        <h3>The library</h3>
        <p><code>nebula.js</code> is one file, with no packages to install. It registers your commands, then waits for events. Leave the token out of <code>new Bot()</code> and the library reads <code>NEBULA_BOT_TOKEN</code>. Set <code>NEBULA_API_URL</code> when the bot should use a different server than the one baked into <code>nebula.js</code>.</p>
        <div class="dev-table">
          <table>
            <thead><tr><th>Call</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td><code>new Bot(token)</code></td><td>Signs in with that token.</td></tr>
              <tr><td><code>bot.command(name, description, fn)</code></td><td>A command people type as <code>/name</code>. Names are 1 to 32 letters, numbers, <code>-</code>, or <code>_</code>. Up to 100 commands. <code>msg.args</code> is the rest of the line, and <code>msg.argv</code> splits it on spaces.</td></tr>
              <tr><td><code>bot.on(event, fn)</code></td><td><code>message</code>, <code>member_join</code>, <code>test</code>, <code>server_add</code>, <code>server_remove</code>, <code>ready</code>, and <code>error</code>.</td></tr>
              <tr><td><code>bot.send(channelId, text, opts)</code></td><td>Posts in a channel. <code>opts.replyTo</code> quotes a message. <code>opts.embeds</code> adds up to 4 cards. Pass <code>''</code> as the text when the message is only cards.</td></tr>
              <tr><td><code>msg.reply(text, opts)</code></td><td>Answers in the same channel and quotes the message. <code>msg.say(text, opts)</code> posts without the quote. Both accept <code>opts.embeds</code>.</td></tr>
              <tr><td><code>bot.setProfile</code> / <code>bot.setAvatar</code></td><td>Display name, bio, and picture. A path string or raw bytes works for the picture.</td></tr>
              <tr><td><code>bot.servers()</code></td><td>Servers this bot was added to.</td></tr>
              <tr><td><code>bot.api(method, path, body)</code></td><td>Any bot endpoint, with the token added for you. <code>path</code> starts with <code>/me</code> or <code>/channels/…</code>.</td></tr>
              <tr><td><code>bot.start()</code> / <code>bot.stop()</code></td><td>Registers commands, then listens until you stop it.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="dev-api">
        <h3>API</h3>
        <p>Base URL <code>{apiBase}</code>. Every request except <code>/version</code> sends <code>Authorization: Bot &lt;token&gt;</code>. Bodies and answers are JSON, except the avatar upload, which is the raw picture. A bot only sees servers it was added to, and only channels that role can see. Its own messages are not sent back to it.</p>
        <div class="dev-table">
          <table>
            <thead><tr><th>Method</th><th>Path</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td>GET</td><td><code>/version</code></td><td>API version. No token.</td></tr>
              <tr><td>GET</td><td><code>/me</code></td><td>The bot’s profile.</td></tr>
              <tr><td>PATCH</td><td><code>/me</code></td><td><code>display_name</code> up to 32 characters and <code>bio</code> up to 300.</td></tr>
              <tr><td>PUT</td><td><code>/me/avatar</code></td><td>The picture bytes. PNG, JPG, GIF, or WebP, up to 8 MB.</td></tr>
              <tr><td>GET, PUT</td><td><code>/commands</code></td><td>Read or replace the command list. PUT body is <code>{'{'} commands: [{'{'} name, description {'}'}] {'}'}</code>.</td></tr>
              <tr><td>GET</td><td><code>/events?after=&amp;wait=</code></td><td>Events after <code>after</code>. <code>wait</code> holds the request up to 25 seconds. Send the returned <code>last</code> back as <code>after</code>.</td></tr>
              <tr><td>GET</td><td><code>/servers</code></td><td>Servers the bot is in.</td></tr>
              <tr><td>GET</td><td><code>/servers/:id/channels</code></td><td>Channels the bot can see. <code>?type=text</code> keeps voice channels out.</td></tr>
              <tr><td>GET</td><td><code>/channels/:id</code></td><td>One channel.</td></tr>
              <tr><td>GET</td><td><code>/channels/:id/messages</code></td><td>Recent messages, oldest first. <code>limit</code> up to 100.</td></tr>
              <tr><td>POST</td><td><code>/channels/:id/messages</code></td><td><code>content</code> up to 2000 characters, optional <code>reply_to</code> and <code>embeds</code>. Content, embeds, or both.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="dev-events">
        <h3>Events</h3>
        <p>Each event has <code>type</code> and <code>data</code>. The library passes <code>data</code> to your function and adds <code>reply</code> and <code>say</code> when the event has a channel.</p>
        <div class="dev-table">
          <table>
            <thead><tr><th>type</th><th>data</th></tr></thead>
            <tbody>
              <tr><td><code>message</code></td><td><code>id</code>, <code>channel_id</code>, <code>channel_name</code>, <code>server_id</code>, <code>author_id</code>, <code>author</code>, <code>content</code>, <code>created_at</code>, <code>mentioned</code>. When the line starts with <code>/</code> or <code>!</code> and matches a command: <code>command</code> and <code>args</code>.</td></tr>
              <tr><td><code>member_join</code></td><td>Someone other than a bot joined a server the bot is in. <code>server_id</code>, <code>server_name</code>, <code>user_id</code>, <code>username</code>, <code>display_name</code>, <code>member_count</code>.</td></tr>
              <tr><td><code>server_add</code></td><td>The bot was added to a server. <code>server_id</code>, <code>name</code>, <code>member_count</code>.</td></tr>
              <tr><td><code>server_remove</code></td><td>The bot was removed. <code>server_id</code> and <code>name</code>.</td></tr>
              <tr><td><code>test</code></td><td>Sent by the Send test event button.</td></tr>
              <tr><td><code>ready</code></td><td>Local only. Fires after commands are registered. The argument is the bot profile.</td></tr>
              <tr><td><code>error</code></td><td>Local only. A request failed or one of your functions threw.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="dev-embeds">
        <h3>Embeds</h3>
        <p>An embed is the card with a colored bar, a title, and a description. A normal text message has no card. To show the card, send <code>embeds</code> and leave <code>content</code> empty when you do not want a line of text above it. Up to 4 cards. Each can have <code>title</code> (256), <code>description</code> (2000), <code>url</code> (an http or https link), and <code>color</code> as <code>#rrggbb</code> or a number.</p>
        {@render sample('embed', 'embed.js', embedSample)}
      </section>

      <section id="dev-welcome">
        <h3>Welcome bot</h3>
        <p>Save this as <code>welcome.js</code> next to <code>nebula.js</code>, paste your token, and run <code>node welcome.js</code>. When someone joins, the bot posts an embed in <code>#welcome</code>, <code>#general</code>, or <code>#lobby</code>. Type <code>/setwelcome</code> in another channel to use that one instead. The choice lasts until you stop the process. The bot has to be in the server, and this process has to stay running.</p>
        {@render sample('welcome', 'welcome.js', welcome)}
      </section>

      <section id="dev-limits">
        <h3>Errors and limits</h3>
        <p>Errors look like <code>{'{'} error, code {'}'}</code>. <code>401</code> means the token is missing or wrong. <code>403</code> means the bot is not in that server, or it cannot see or post in the channel. <code>429</code> means slow down: 30 messages a minute per bot. Make a new token from the bot’s Token section if you lose the old one. The old one stops working.</p>
        <p>Two bots per account. 25 bots per server. 100 commands per bot. Events stay in memory on the server until it restarts, so a bot that was offline catches up only as far as the server still has them.</p>
      </section>
    </div>
  </div>
</article>
