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
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
  const token = localStorage.getItem('dc_token') || '';
  if (!token) {
    schedule();
    return;
  }
  const url = wsUrl();
  if (!url) {
    schedule();
    return;
  }
  if (!downSince) downSince = Date.now();
  let ws;
  try { ws = new WebSocket(url); } catch (_) {
    schedule();
    return;
  }
  socket = ws;
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
