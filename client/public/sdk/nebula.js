// Nebula bot library. Node 18 or newer. No dependencies.
// The token is the one from Settings → Developer. It starts with nb_.

const DEFAULT_API = (typeof process !== 'undefined' && process.env && (process.env.NEBULA_API_URL || process.env.NEBULA_API))
  || 'https://scowling-anthill-civil.ngrok-free.dev/api/bot/v1';

export class Bot {
  constructor(token, opts = {}) {
    this.token = String(token || (typeof process !== 'undefined' && process.env && process.env.NEBULA_BOT_TOKEN) || '').trim();
    this.apiBase = String(opts.api || DEFAULT_API).replace(/\/$/, '');
    this.log = opts.log !== false;
    this.commands = [];
    this.listeners = new Map();
    this.running = false;
    this.me = null;
    this._after = 0;
    this._session = Math.floor(Math.random() * 1e9);
    this._poll = 0;
  }

  command(name, description, fn) {
    const clean = String(name || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(clean)) throw new Error('Command names use letters, numbers, - or _');
    this.commands = this.commands.filter((row) => row.name !== clean);
    this.commands.push({ name: clean, description: String(description || '').slice(0, 100), fn });
    return this;
  }

  on(event, fn) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
    return this;
  }

  async emit(event, data) {
    const list = this.listeners.get(event) || [];
    for (const fn of list) {
      try { await fn(data); }
      catch (err) { await this.emit('error', err); }
    }
  }

  async api(method, path, body) {
    const headers = {
      Authorization: 'Bot ' + this.token,
      'ngrok-skip-browser-warning': 'true',
      'bypass-tunnel-reminder': 'true',
    };
    let payload;
    if (body != null && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) && !(body instanceof Uint8Array)) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    } else if (body != null) {
      headers['Content-Type'] = 'application/octet-stream';
      payload = body;
    }
    const res = await fetch(this.apiBase + path, { method, headers, body: payload });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || ('Nebula answered ' + res.status));
      err.code = data.code || '';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async send(channelId, text, opts = {}) {
    const body = { content: text == null ? '' : String(text) };
    if (opts.replyTo) body.reply_to = opts.replyTo;
    if (opts.embeds) body.embeds = opts.embeds;
    const data = await this.api('POST', '/channels/' + encodeURIComponent(channelId) + '/messages', body);
    return data.message || data;
  }

  async setProfile(profile) {
    const body = {};
    if (profile && profile.displayName != null) body.display_name = profile.displayName;
    if (profile && profile.bio != null) body.bio = profile.bio;
    this.me = await this.api('PATCH', '/me', body);
    return this.me;
  }

  async setAvatar(file) {
    let bytes = file;
    if (typeof file === 'string') {
      const fs = await import('node:fs/promises');
      bytes = await fs.readFile(file);
    }
    this.me = await this.api('PUT', '/me/avatar', bytes);
    return this.me;
  }

  servers() { return this.api('GET', '/servers').then((data) => data.servers || []); }
  server(id) { return this.api('GET', '/servers/' + encodeURIComponent(id)); }
  members(serverId, after) {
    const q = after ? '?after=' + encodeURIComponent(after) : '';
    return this.api('GET', '/servers/' + encodeURIComponent(serverId) + '/members' + q).then((data) => data.members || []);
  }
  member(serverId, userId) { return this.api('GET', '/servers/' + encodeURIComponent(serverId) + '/members/' + encodeURIComponent(userId)); }
  setNickname(serverId, userId, nick) {
    return this.api('PATCH', '/servers/' + encodeURIComponent(serverId) + '/members/' + encodeURIComponent(userId), { nickname: nick || '' });
  }
  roles(serverId) { return this.api('GET', '/servers/' + encodeURIComponent(serverId) + '/roles').then((data) => data.roles || []); }
  createRole(serverId, body) { return this.api('POST', '/servers/' + encodeURIComponent(serverId) + '/roles', body).then((data) => data.role); }
  deleteRole(serverId, roleId) { return this.api('DELETE', '/servers/' + encodeURIComponent(serverId) + '/roles/' + encodeURIComponent(roleId)); }
  addRole(serverId, userId, roleId) {
    return this.api('PUT', '/servers/' + encodeURIComponent(serverId) + '/members/' + encodeURIComponent(userId) + '/roles/' + encodeURIComponent(roleId));
  }
  removeRole(serverId, userId, roleId) {
    return this.api('DELETE', '/servers/' + encodeURIComponent(serverId) + '/members/' + encodeURIComponent(userId) + '/roles/' + encodeURIComponent(roleId));
  }
  kick(serverId, userId) { return this.api('POST', '/servers/' + encodeURIComponent(serverId) + '/kick', { user_id: userId }); }
  bans(serverId) { return this.api('GET', '/servers/' + encodeURIComponent(serverId) + '/bans').then((data) => data.bans || []); }
  ban(serverId, userId, reason) { return this.api('POST', '/servers/' + encodeURIComponent(serverId) + '/bans', { user_id: userId, reason: reason || '' }); }
  unban(serverId, userId) { return this.api('DELETE', '/servers/' + encodeURIComponent(serverId) + '/bans/' + encodeURIComponent(userId)); }
  timeout(serverId, userId, minutes) { return this.api('POST', '/servers/' + encodeURIComponent(serverId) + '/timeouts', { user_id: userId, minutes: minutes || 0 }); }
  invites(serverId) { return this.api('GET', '/servers/' + encodeURIComponent(serverId) + '/invites').then((data) => data.invites || []); }
  voice(serverId) { return this.api('GET', '/servers/' + encodeURIComponent(serverId) + '/voice').then((data) => data.voice || []); }
  channels(serverId, opts = {}) {
    const q = opts.type ? '?type=' + encodeURIComponent(opts.type) : '';
    return this.api('GET', '/servers/' + encodeURIComponent(serverId) + '/channels' + q).then((data) => data.channels || []);
  }
  channel(id) { return this.api('GET', '/channels/' + encodeURIComponent(id)); }
  createChannel(serverId, name, opts = {}) {
    return this.api('POST', '/servers/' + encodeURIComponent(serverId) + '/channels', Object.assign({ name }, opts)).then((data) => data.channel);
  }
  editChannel(id, body) { return this.api('PATCH', '/channels/' + encodeURIComponent(id), body); }
  deleteChannel(id) { return this.api('DELETE', '/channels/' + encodeURIComponent(id)); }
  createCategory(serverId, name) { return this.api('POST', '/servers/' + encodeURIComponent(serverId) + '/categories', { name }).then((data) => data.category); }
  deleteCategory(serverId, id) { return this.api('DELETE', '/servers/' + encodeURIComponent(serverId) + '/categories/' + encodeURIComponent(id)); }
  messages(channelId, limit) {
    return this.api('GET', '/channels/' + encodeURIComponent(channelId) + '/messages?limit=' + (limit || 50)).then((data) => data.messages || []);
  }
  message(channelId, messageId) { return this.api('GET', '/channels/' + encodeURIComponent(channelId) + '/messages/' + encodeURIComponent(messageId)); }
  edit(channelId, messageId, text, opts = {}) {
    const body = {};
    if (text != null) body.content = text;
    if (opts.embeds) body.embeds = opts.embeds;
    return this.api('PATCH', '/channels/' + encodeURIComponent(channelId) + '/messages/' + encodeURIComponent(messageId), body);
  }
  delete(channelId, messageId) { return this.api('DELETE', '/channels/' + encodeURIComponent(channelId) + '/messages/' + encodeURIComponent(messageId)); }
  bulkDelete(channelId, ids) { return this.api('POST', '/channels/' + encodeURIComponent(channelId) + '/messages/bulk-delete', { ids }); }
  pin(channelId, messageId) { return this.api('PUT', '/channels/' + encodeURIComponent(channelId) + '/messages/' + encodeURIComponent(messageId) + '/pin'); }
  unpin(channelId, messageId) { return this.api('DELETE', '/channels/' + encodeURIComponent(channelId) + '/messages/' + encodeURIComponent(messageId) + '/pin'); }
  react(channelId, messageId, emoji) {
    return this.api('PUT', '/channels/' + encodeURIComponent(channelId) + '/messages/' + encodeURIComponent(messageId) + '/reactions/' + encodeURIComponent(emoji));
  }
  unreact(channelId, messageId, emoji) {
    return this.api('DELETE', '/channels/' + encodeURIComponent(channelId) + '/messages/' + encodeURIComponent(messageId) + '/reactions/' + encodeURIComponent(emoji));
  }
  reactions(channelId, messageId) {
    return this.api('GET', '/channels/' + encodeURIComponent(channelId) + '/messages/' + encodeURIComponent(messageId) + '/reactions').then((data) => data.reactions || []);
  }
  threads(channelId) { return this.api('GET', '/channels/' + encodeURIComponent(channelId) + '/threads').then((data) => data.threads || []); }
  createThread(channelId, name, opts = {}) {
    return this.api('POST', '/channels/' + encodeURIComponent(channelId) + '/threads', Object.assign({ name }, opts)).then((data) => data.thread);
  }
  user(id) { return this.api('GET', '/users/' + encodeURIComponent(id)); }
  webhooks(channelId) { return this.api('GET', '/channels/' + encodeURIComponent(channelId) + '/webhooks').then((data) => data.webhooks || []); }
  createWebhook(channelId, name) { return this.api('POST', '/channels/' + encodeURIComponent(channelId) + '/webhooks', { name }); }
  deleteWebhook(id) { return this.api('DELETE', '/webhooks/' + encodeURIComponent(id)); }

  async start() {
    if (!this.token.startsWith('nb_')) throw new Error('Paste the bot token from Settings → Developer');
    this.running = true;
    this.me = await this.api('GET', '/me');
    await this.api('PUT', '/commands', {
      commands: this.commands.map((row) => ({ name: row.name, description: row.description })),
    });
    if (this.log) console.log('online as', this.me.username || this.me.display_name);
    if (!this._signals && typeof process !== 'undefined') {
      this._signals = true;
      const bye = () => {
        this.running = false;
        this.api('POST', '/offline', {}).catch(() => {}).finally(() => process.exit(0));
      };
      process.once('SIGINT', bye);
      process.once('SIGTERM', bye);
    }
    await this.emit('ready', this.me);
    while (this.running) {
      try {
        this._poll += 1;
        const data = await this.api('GET', '/events?after=' + this._after + '&wait=25&poll=' + this._session + '-' + this._poll);
        if (typeof data.last === 'number') this._after = data.last;
        for (const ev of data.events || []) {
          if (ev.id) this._after = ev.id;
          const msg = this.wrap(ev);
          await this.emit(ev.type, msg);
          if (ev.type === 'message' && msg.command) {
            const cmd = this.commands.find((row) => row.name === msg.command);
            if (cmd) await cmd.fn(msg);
          }
        }
      } catch (err) {
        if (!this.running) break;
        if (this.log) console.error(err.message || err);
        await this.emit('error', err);
        await new Promise((resolve) => setTimeout(resolve, err.status === 429 ? 5000 : 2000));
      }
    }
  }

  stop() {
    this.running = false;
    return this.api('POST', '/offline', {}).catch(() => {});
  }

  wrap(ev) {
    const data = Object.assign({}, ev.data || {});
    data.type = ev.type;
    data.id = data.id || ev.id;
    const channelId = data.channel_id;
    data.reply = (text, opts) => this.send(channelId, text, Object.assign({ replyTo: data.id }, opts));
    data.say = (text, opts) => this.send(channelId, text, opts);
    data.args = data.args || '';
    data.argv = data.args ? String(data.args).split(/\s+/) : [];
    return data;
  }
}
