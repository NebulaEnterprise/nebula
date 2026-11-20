import { Bot } from './nebula.js';

// Paste the token from Settings → Developer. It is shown once.
const bot = new Bot('nb_PASTE_YOUR_TOKEN');

bot.command('ping', 'Is the bot alive?', (msg) => msg.reply('pong'));

bot.on('message', (msg) => {
  if (msg.mentioned) msg.reply('hey');
});

bot.on('ready', (me) => console.log('online as', me.username));
bot.on('error', (err) => console.error(err));

bot.start();
