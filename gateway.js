const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HEARTBEAT_MS = 45000;
const SESSION_MS = 5 * 60 * 1000;

function sendFrame(socket, opcode, payload) {
  if (!socket || socket.destroyed) return;
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = body.length;
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  try { socket.write(Buffer.concat([header, body])); } catch (_) {}
}

function attachGateway(httpServer, api) {
  const sessions = new Map();

  function expire() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (!session.conn && session.until && session.until < now) sessions.delete(id);
    }
  }

  function write(session, packet) {
    if (!session.conn || session.conn.destroyed) return;
    sendFrame(session.conn, 1, packet);
  }

  function deliver(session, type, data) {
    if (data == null) return;
    session.seq += 1;
    const packet = JSON.stringify({ op: 0, t: type, s: session.seq, d: data });
    session.log.push({ seq: session.seq, packet });
    if (session.log.length > 150) session.log.shift();
    write(session, packet);
  }

  function fanout(match, type, build) {
    expire();
    for (const session of sessions.values()) {
      if (!session.user || !match(session)) continue;
      try {
        const data = typeof build === 'function' ? build(session.user, session) : build;
        if (data) deliver(session, type, data);
      } catch (_) {}
    }
  }

  function liveCount(userId) {
    let n = 0;
    for (const session of sessions.values()) {
      if (session.user && String(session.user.id) === String(userId) && session.conn) n += 1;
    }
    return n;
  }

  function dropConn(session) {
    if (!session || !session.conn) return;
    const user = session.user;
    session.conn = null;
    session.until = Date.now() + SESSION_MS;
    if (user && !liveCount(user.id) && api.presence) api.presence(user, false);
  }

  function bind(socket, session) {
    const user = session.user;
    const was = user ? liveCount(user.id) : 0;
    session.conn = socket;
    session.until = 0;
    socket._nebula = session;
    if (user && !was && api.presence) api.presence(user, true);
  }

  function hello(socket) {
    sendFrame(socket, 1, JSON.stringify({ op: 10, d: { heartbeat_interval: HEARTBEAT_MS } }));
  }

  function invalid(socket, resumable) {
    sendFrame(socket, 1, JSON.stringify({ op: 9, d: !!resumable }));
  }

  function identify(socket, token) {
    const user = token ? api.identify(String(token)) : null;
    if (!user) {
      invalid(socket, false);
      return;
    }
    const session = {
      id: crypto.randomBytes(16).toString('hex'),
      user,
      token: String(token),
      seq: 0,
      log: [],
      roomId: '',
      serverId: '',
      conn: null,
      until: 0,
      beat: Date.now(),
    };
    sessions.set(session.id, session);
    bind(socket, session);
    const extra = api.ready ? api.ready(user) : {};
    deliver(session, 'READY', Object.assign({ session_id: session.id }, extra || {}));
  }

  function resume(socket, body) {
    const token = String(body && body.token || '');
    const id = String(body && body.session_id || '');
    const seq = Number(body && body.seq) || 0;
    const session = sessions.get(id);
    const user = token ? api.identify(token) : null;
    if (!session || !user || String(user.id) !== String(session.user.id) || session.token !== token) {
      invalid(socket, false);
      return;
    }
    const oldest = session.log.length ? session.log[0].seq : session.seq;
    if (seq && session.log.length && seq < oldest - 1) {
      invalid(socket, false);
      return;
    }
    bind(socket, session);
    session.beat = Date.now();
    for (const row of session.log) {
      if (row.seq > seq) write(session, row.packet);
    }
    deliver(session, 'RESUMED', api.ready ? api.ready(user) : {});
  }

  function subscribe(session, data) {
    const watch = api.watch(session.user, data || {});
    if (!watch || !watch.roomId) {
      session.roomId = '';
      session.serverId = '';
      return;
    }
    session.roomId = watch.roomId;
    session.serverId = watch.serverId || '';
  }

  function onText(socket, text) {
    let packet;
    try { packet = JSON.parse(text); } catch (_) { return; }
    const session = socket._nebula;
    if (session) session.beat = Date.now();
    const op = Number(packet && packet.op);
    if (op === 1) {
      sendFrame(socket, 1, JSON.stringify({ op: 11 }));
      return;
    }
    if (!session) {
      if (op === 2) identify(socket, packet.d && packet.d.token);
      else if (op === 6) resume(socket, packet.d || {});
      return;
    }
    if (op === 14) subscribe(session, packet.d || {});
  }

  function listen(socket) {
    let buf = Buffer.alloc(0);
    let frag = [];
    let fragOp = 0;
    const fail = () => { try { socket.destroy(); } catch (_) {} };
    socket.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      try {
        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f;
          const fin = (buf[0] & 0x80) !== 0;
          const masked = (buf[1] & 0x80) !== 0;
          let len = buf[1] & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            const big = buf.readBigUInt64BE(2);
            if (big > 1048576n) return fail();
            len = Number(big);
            offset = 10;
          }
          if (!masked) return fail();
          if (buf.length < offset + 4 + len) return;
          const mask = buf.subarray(offset, offset + 4);
          const raw = Buffer.alloc(len);
          for (let i = 0; i < len; i++) raw[i] = buf[offset + 4 + i] ^ mask[i & 3];
          buf = buf.subarray(offset + 4 + len);
          if (opcode === 8) {
            sendFrame(socket, 8, raw);
            socket.end();
            return;
          }
          if (opcode === 9) {
            sendFrame(socket, 10, raw);
            continue;
          }
          if (opcode === 10) continue;
          if (opcode === 1 || opcode === 0) {
            if (opcode === 1) {
              frag = [raw];
              fragOp = 1;
            } else frag.push(raw);
            if (!fin) continue;
            const text = Buffer.concat(frag).toString('utf8');
            frag = [];
            if (fragOp === 1) onText(socket, text);
          }
        }
      } catch (_) { fail(); }
    });
    socket.on('close', () => dropConn(socket._nebula));
    socket.on('error', () => dropConn(socket._nebula));
    socket.on('end', () => dropConn(socket._nebula));
  }

  setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (!session.conn) continue;
      if (now - session.beat > HEARTBEAT_MS * 2) {
        try { session.conn.end(); } catch (_) {}
        dropConn(session);
      }
    }
    expire();
  }, 15000).unref?.();

  httpServer.on('upgrade', (req, socket, head) => {
    const path = String(req.url || '').split('?')[0];
    if (path !== '/api/gateway') {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(String(key) + GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + accept,
      '',
      '',
    ].join('\r\n'));
    listen(socket);
    hello(socket);
    if (head && head.length) socket.emit('data', head);
    setTimeout(() => {
      if (!socket._nebula && !socket.destroyed) socket.end();
    }, 15000).unref?.();
  });

  return {
    room(roomId, type, build) {
      if (!roomId) return;
      fanout((session) => session.roomId === roomId, type, build);
    },
    guild(serverId, type, data) {
      if (!serverId) return;
      fanout((session) => session.serverId === serverId, type, data);
    },
    all(type, build) {
      fanout(() => true, type, build);
    },
    users(ids, type, build) {
      const want = new Set((ids || []).map(String));
      if (!want.size) return;
      fanout((session) => session.user && want.has(String(session.user.id)), type, build);
    },
  };
}

module.exports = { attachGateway };
