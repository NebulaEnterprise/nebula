import { Bot } from './nebula.js';

// Paste the token from Settings → Developer. Put this file next to nebula.js.
const bot = new Bot('nb_PASTE_YOUR_TOKEN');

// Channel chosen with /setwelcome. Until then, #welcome, #general, or the first text channel.
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
  console.log('member joined', ev.username || ev.display_name, 'in', ev.server_name || ev.server_id);
  const channelId = await welcomeChannel(ev.server_id);
  if (!channelId) {
    console.log('no welcome channel for', ev.server_id);
    return;
  }
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

bot.start();
