/**
 * Voice rooms for Nebula.
 * Put this file next to server.js, then add this line ABOVE the
 * "API route not found" handler:
 *
 *   require('./voice')(app, { auth, guilds, users, findChannel, can, PERM, publicUser });
 */
module.exports = function mountVoice(app, ctx) {
  const { auth, guilds, users, findChannel, can, PERM, publicUser } = ctx;
  const rooms = new Map();

  function key(serverId, channelId) {
    return String(serverId) + '\n' + String(channelId);
  }

  function roomFor(serverId, channelId) {
    const id = key(serverId, channelId);
    if (!rooms.has(id)) rooms.set(id, { members: new Map(), signals: [] });
    return rooms.get(id);
  }

  function prune(room) {
    const now = Date.now();
    for (const [id, member] of room.members) {
      if (now - member.seen > 20000) room.members.delete(id);
    }
    room.signals = room.signals.filter((signal) => now - signal.at < 20000);
  }

  function present(member) {
    const user = publicUser(users[member.userId]) || {
      id: member.userId,
      username: 'Someone',
      displayName: 'Someone',
    };
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      avatarUrl: user.avatarUrl || '',
      avatarColor: user.avatarColor || '#7c5cff',
      muted: !!member.muted,
      deafened: !!member.deafened,
      speaking: !!member.speaking && !member.muted && !member.deafened,
    };
  }

  function locate(req, res) {
    const serverId = String((req.body && req.body.serverId) || req.query.serverId || '');
    const found = findChannel(String(req.params.channelId || ''), serverId);
    if (!found || found.channel.type !== 'voice') {
      res.status(404).json({ error: 'Voice channel not found' });
      return null;
    }
    if (!found.guild.members || !found.guild.members[req.user.id]) {
      res.status(403).json({ error: 'You are not in this server' });
      return null;
    }
    if (!can(found.guild, req.user, PERM.VIEW, found.channel)) {
      res.status(403).json({ error: 'You cannot join this channel' });
      return null;
    }
    return found;
  }

  function dropUser(userId, exceptKey) {
    for (const [id, room] of rooms) {
      if (id === exceptKey) continue;
      room.members.delete(userId);
    }
  }

  app.get('/api/voice/overview', auth, (req, res) => {
    const serverId = String(req.query.serverId || '');
    const guild = guilds.servers[serverId];
    if (!guild || !guild.members || !guild.members[req.user.id]) {
      return res.status(403).json({ error: 'You are not in this server' });
    }
    const out = {};
    for (const channel of guild.channels || []) {
      if (channel.type !== 'voice') continue;
      const room = rooms.get(key(serverId, channel.id));
      if (!room) continue;
      prune(room);
      if (!room.members.size) continue;
      out[channel.id] = [...room.members.values()].map(present);
    }
    res.json({ ok: true, rooms: out });
  });

  app.post('/api/voice/:channelId/join', auth, (req, res) => {
    const found = locate(req, res);
    if (!found) return;
    const id = key(found.guild.id, found.channel.id);
    dropUser(req.user.id, id);
    const room = roomFor(found.guild.id, found.channel.id);
    const prev = room.members.get(req.user.id);
    room.members.set(req.user.id, {
      userId: req.user.id,
      muted: prev ? prev.muted : false,
      deafened: prev ? prev.deafened : false,
      speaking: false,
      seen: Date.now(),
    });
    res.json({ ok: true, members: [...room.members.values()].map(present) });
  });

  app.post('/api/voice/:channelId/leave', auth, (req, res) => {
    const serverId = String((req.body && req.body.serverId) || '');
    const room = rooms.get(key(serverId, req.params.channelId));
    if (room) room.members.delete(req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/voice/:channelId/state', auth, (req, res) => {
    const serverId = String((req.body && req.body.serverId) || '');
    const room = rooms.get(key(serverId, req.params.channelId));
    const member = room && room.members.get(req.user.id);
    if (!member) return res.status(404).json({ error: 'You are not in this call' });
    if (req.body.muted != null) member.muted = !!req.body.muted;
    if (req.body.deafened != null) member.deafened = !!req.body.deafened;
    if (req.body.speaking != null) member.speaking = !!req.body.speaking;
    member.seen = Date.now();
    res.json({ ok: true });
  });

  app.post('/api/voice/:channelId/signal', auth, (req, res) => {
    const serverId = String((req.body && req.body.serverId) || '');
    const room = rooms.get(key(serverId, req.params.channelId));
    if (!room || !room.members.has(req.user.id)) {
      return res.status(404).json({ error: 'You are not in this call' });
    }
    const to = String(req.body.to || '');
    if (!room.members.has(to)) return res.status(404).json({ error: 'That person left the call' });
    room.signals.push({
      from: req.user.id,
      to,
      kind: String(req.body.kind || ''),
      payload: req.body.payload || null,
      at: Date.now(),
    });
    if (room.signals.length > 500) room.signals.splice(0, room.signals.length - 500);
    room.members.get(req.user.id).seen = Date.now();
    res.json({ ok: true });
  });

  app.get('/api/voice/:channelId/sync', auth, (req, res) => {
    const found = locate(req, res);
    if (!found) return;
    const room = roomFor(found.guild.id, found.channel.id);
    prune(room);
    const member = room.members.get(req.user.id);
    if (member) member.seen = Date.now();
    const mine = room.signals.filter((signal) => signal.to === req.user.id);
    room.signals = room.signals.filter((signal) => signal.to !== req.user.id);
    res.json({
      ok: true,
      joined: !!member,
      members: [...room.members.values()].map(present),
      signals: mine.map((signal) => ({ from: signal.from, kind: signal.kind, payload: signal.payload })),
    });
  });
};
