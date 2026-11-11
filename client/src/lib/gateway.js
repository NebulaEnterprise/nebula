import { getApiBase } from './api.js';

const listeners = new Set();
let socket = null;
let sessionId = '';
let seq = 0;
let alive = false;
let downSince = 0;
let opening = false;
let want = null;
let wantKey = '';
let retry = 1000;
let started = false;
let generation = 0;

export function onGateway(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function gatewayReady() {
  return alive;
}

export function gatewayStale() {
  return !alive && !!downSince && Date.now() - downSince > 4000;
}

function emit(packet) {
  for (const fn of listeners) {
    try { fn(packet); } catch (_) {}
  }
}

function wsUrl() {
  const base = getApiBase();
  if (base.startsWith('https://')) return 'wss://' + base.slice('https://'.length) + '/api/gateway';
  if (base.startsWith('http://')) return 'ws://' + base.slice('http://'.length) + '/api/gateway';
  return '';
}

function send(packet) {
  if (!socket || socket.readyState !== 1) return;
  try { socket.send(JSON.stringify(packet)); } catch (_) {}
}

export function subscribeGateway(query) {
  want = query || {};
  const key = JSON.stringify(want);
  if (key === wantKey) return;
  wantKey = key;
  if (alive) send({ op: 14, d: want });
}

export function disconnectGateway() {
  sessionId = '';
  seq = 0;
  alive = false;
  wantKey = '';
  want = {};
  downSince = 0;
  const current = socket;
  socket = null;
  if (current) {
    try { current.close(); } catch (_) {}
  }
}

function schedule() {
  const wait = retry;
  retry = Math.min(8000, retry * 2);
  setTimeout(open, wait);
}

function open() {
  opening = false;
  const gen = generation;
  if (gen !== generation) return;
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
  const token = localStorage.getItem('dc_token') || '';
  if (!token) {
    schedule();
    return;
  }
  const url = wsUrl();
  if (!url || gen !== generation) {
    if (gen === generation) schedule();
    return;
  }
  if (!downSince) downSince = Date.now();
  let ws;
  try { ws = new WebSocket(url); } catch (_) {
    schedule();
    return;
  }
  if (gen !== generation) {
    try { ws.close(); } catch (_) {}
    return;
  }
  socket = ws;
  ws._nebulaGen = gen;
  opening = true;
  let beat = 0;
  let acked = true;
  ws.onmessage = (ev) => {
    let packet;
    try { packet = JSON.parse(ev.data); } catch (_) { return; }
    if (packet.s) seq = packet.s;
    if (packet.op === 10) {
      const interval = Number(packet.d && packet.d.heartbeat_interval) || 45000;
      acked = true;
      if (beat) clearInterval(beat);
      beat = setInterval(() => {
        if (socket !== ws) return;
        if (!acked) {
          try { ws.close(); } catch (_) {}
          return;
        }
        acked = false;
        send({ op: 1, d: seq || null });
      }, interval);
      const current = localStorage.getItem('dc_token') || '';
      if (sessionId && seq) send({ op: 6, d: { token: current, session_id: sessionId, seq } });
      else send({ op: 2, d: { token: current } });
      return;
    }
    if (packet.op === 11) {
      acked = true;
      return;
    }
    if (packet.op === 9) {
      sessionId = '';
      seq = 0;
      send({ op: 2, d: { token: localStorage.getItem('dc_token') || '' } });
      emit({ op: 0, t: 'RESYNC', d: {} });
      return;
    }
    if (packet.op === 7) {
      try { ws.close(); } catch (_) {}
      return;
    }
    if (packet.op !== 0) return;
    if (packet.t === 'READY' || packet.t === 'RESUMED') {
      if (packet.t === 'READY') sessionId = (packet.d && packet.d.session_id) || sessionId;
      alive = true;
      downSince = 0;
      retry = 1000;
      if (want) {
        wantKey = '';
        subscribeGateway(want);
      }
    }
    emit(packet);
  };
  ws.onclose = () => {
    if (beat) clearInterval(beat);
    alive = false;
    if (!downSince) downSince = Date.now();
    if (socket === ws) socket = null;
    opening = false;
    emit({ op: 0, t: 'DISCONNECT', d: {} });
    if (ws._nebulaGen !== generation) return;
    schedule();
  };
  ws.onerror = () => {};
}

export function connectGateway() {
  if (started) return;
  started = true;
  downSince = Date.now();
  open();
}

export function reconnectGateway() {
  generation += 1;
  sessionId = '';
  seq = 0;
  alive = false;
  wantKey = '';
  retry = 1000;
  downSince = Date.now();
  const current = socket;
  socket = null;
  const closed = new Promise((resolve) => {
    if (!current || current.readyState === 3) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 1500);
    current.addEventListener('close', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    try { current.close(); } catch (_) { resolve(); }
  });
  return closed.then(() => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      listeners.delete(wait);
      resolve();
    };
    const wait = (packet) => {
      const type = packet && packet.t;
      if (type === 'READY' || type === 'RESUMED') finish();
    };
    const timer = setTimeout(finish, 4000);
    listeners.add(wait);
    if (!started) {
      started = true;
      downSince = Date.now();
    }
    open();
  }));
}
