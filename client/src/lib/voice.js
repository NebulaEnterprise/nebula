import { api, getApiBase } from './api.js';
import { ui, toast } from './state.svelte.js';

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let stream = null;
let poll = null;
let peers = new Map();
let iceQueue = new Map();
let levelTimer = null;
let audioCtx = null;
let speaking = false;

function channelName() {
  const ch = ui.channels.find((item) => item.id === ui.voice?.channelId);
  return ch?.name || 'Voice';
}

function publishRoom(channelId, members) {
  ui.voiceRooms = Object.assign({}, ui.voiceRooms, { [channelId]: members });
}

async function sendSignal(to, kind, payload) {
  const voice = ui.voice;
  if (!voice) return;
  await api('/api/voice/' + voice.channelId + '/signal', {
    method: 'POST',
    body: { serverId: voice.serverId, to, kind, payload },
  });
}

function stopLocal() {
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
}

function closePeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peer.pc.close();
  if (peer.audio) {
    peer.audio.srcObject = null;
    peer.audio.remove();
  }
  peers.delete(id);
  iceQueue.delete(id);
}

function closeAll() {
  for (const id of [...peers.keys()]) closePeer(id);
}

function applyDeaf() {
  const deaf = !!(ui.voice && ui.voice.deafened);
  for (const peer of peers.values()) {
    if (peer.audio) peer.audio.muted = deaf;
  }
}

function ensurePeer(id) {
  let peer = peers.get(id);
  if (peer) return peer;
  const pc = new RTCPeerConnection({ iceServers: ICE });
  if (stream) stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  pc.onicecandidate = (event) => {
    if (!event.candidate || !ui.voice) return;
    sendSignal(id, 'ice', event.candidate.toJSON()).catch(() => {});
  };
  pc.ontrack = (event) => {
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = event.streams[0];
    audio.muted = !!(ui.voice && ui.voice.deafened);
    audio.play().catch(() => {});
    const current = peers.get(id);
    if (current) current.audio = audio;
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') closePeer(id);
  };
  peer = { pc, audio: null, offered: false };
  peers.set(id, peer);
  return peer;
}

async function flushIce(id) {
  const queued = iceQueue.get(id) || [];
  iceQueue.set(id, []);
  const peer = peers.get(id);
  if (!peer) return;
  for (const candidate of queued) {
    try { await peer.pc.addIceCandidate(candidate); } catch (_) {}
  }
}

async function handleSignal(signal) {
  if (!ui.voice || !signal) return;
  if (signal.kind === 'offer') {
    const peer = ensurePeer(signal.from);
    await peer.pc.setRemoteDescription(signal.payload);
    await flushIce(signal.from);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    await sendSignal(signal.from, 'answer', peer.pc.localDescription);
    return;
  }
  if (signal.kind === 'answer') {
    const peer = peers.get(signal.from);
    if (!peer) return;
    if (peer.pc.signalingState !== 'have-local-offer') return;
    await peer.pc.setRemoteDescription(signal.payload);
    await flushIce(signal.from);
    return;
  }
  if (signal.kind === 'ice' && signal.payload) {
    const peer = peers.get(signal.from);
    if (peer && peer.pc.remoteDescription) {
      try { await peer.pc.addIceCandidate(signal.payload); } catch (_) {}
    } else {
      const queued = iceQueue.get(signal.from) || [];
      queued.push(signal.payload);
      iceQueue.set(signal.from, queued);
    }
  }
}

async function offerTo(id) {
  const peer = ensurePeer(id);
  if (peer.offered || peer.pc.signalingState !== 'stable') return;
  peer.offered = true;
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    await sendSignal(id, 'offer', peer.pc.localDescription);
  } catch (_) {
    peer.offered = false;
  }
}

async function sync() {
  const voice = ui.voice;
  if (!voice) return;
  const data = await api('/api/voice/' + voice.channelId + '/sync?serverId=' + encodeURIComponent(voice.serverId));
  if (!ui.voice || ui.voice.channelId !== voice.channelId) return;
  const members = data.members || [];
  publishRoom(voice.channelId, members);
  const others = members.filter((member) => member.id !== ui.me?.id);
  const live = new Set(others.map((member) => member.id));
  for (const id of [...peers.keys()]) {
    if (!live.has(id)) closePeer(id);
  }
  for (const signal of data.signals || []) {
    try { await handleSignal(signal); } catch (_) {}
  }
  for (const member of others) {
    if (ui.me.id < member.id) await offerTo(member.id);
  }
  if (speaking !== voice.speakingSent) {
    voice.speakingSent = speaking;
    api('/api/voice/' + voice.channelId + '/state', {
      method: 'POST',
      body: { serverId: voice.serverId, speaking },
    }).catch(() => {});
  }
}

function watchMic() {
  if (!stream || !window.AudioContext) return;
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  levelTimer = setInterval(() => {
    if (!ui.voice || ui.voice.muted || ui.voice.deafened) {
      speaking = false;
      return;
    }
    analyser.getByteFrequencyData(bins);
    let total = 0;
    for (const value of bins) total += value;
    speaking = total / bins.length > 16;
  }, 200);
}

export async function joinVoice(channel) {
  if (!channel || channel.type !== 'voice') return;
  if (ui.voice && ui.voice.channelId === channel.id && ui.voice.serverId === ui.serverId) return;
  await leaveVoice();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch (_) {
    toast('Allow the microphone to join the call');
    return;
  }
  try {
    await api('/api/voice/' + channel.id + '/join', {
      method: 'POST',
      body: { serverId: ui.serverId },
    });
  } catch (err) {
    stopLocal();
    const missing = /not found/i.test(err.message || '');
    toast(missing ? 'Update server.js with voice.js, then restart it' : err.message);
    return;
  }
  ui.voice = {
    serverId: ui.serverId,
    channelId: channel.id,
    name: channel.name,
    muted: false,
    deafened: false,
    speakingSent: false,
  };
  watchMic();
  try { await sync(); } catch (_) {}
  poll = setInterval(() => { sync().catch(() => {}); }, 1000);
}

export async function leaveVoice() {
  const voice = ui.voice;
  if (poll) clearInterval(poll);
  poll = null;
  closeAll();
  stopLocal();
  speaking = false;
  ui.voice = null;
  if (!voice) return;
  try {
    await api('/api/voice/' + voice.channelId + '/leave', {
      method: 'POST',
      body: { serverId: voice.serverId },
    });
  } catch (_) {}
  const data = await refreshVoiceRooms().catch(() => null);
  if (!data) publishRoom(voice.channelId, (ui.voiceRooms[voice.channelId] || []).filter((member) => member.id !== ui.me?.id));
}

export async function toggleMute() {
  if (!ui.voice || !stream) return;
  ui.voice.muted = !ui.voice.muted;
  stream.getAudioTracks().forEach((track) => { track.enabled = !ui.voice.muted && !ui.voice.deafened; });
  if (ui.voice.muted) speaking = false;
  try {
    await api('/api/voice/' + ui.voice.channelId + '/state', {
      method: 'POST',
      body: { serverId: ui.voice.serverId, muted: ui.voice.muted },
    });
  } catch (_) {}
}

export async function toggleDeafen() {
  if (!ui.voice || !stream) return;
  ui.voice.deafened = !ui.voice.deafened;
  ui.voice.muted = ui.voice.deafened;
  stream.getAudioTracks().forEach((track) => { track.enabled = !ui.voice.muted; });
  applyDeaf();
  if (ui.voice.deafened) speaking = false;
  try {
    await api('/api/voice/' + ui.voice.channelId + '/state', {
      method: 'POST',
      body: { serverId: ui.voice.serverId, muted: ui.voice.muted, deafened: ui.voice.deafened },
    });
  } catch (_) {}
}

export async function refreshVoiceRooms() {
  if (!ui.serverId) return null;
  const data = await api('/api/voice/overview?serverId=' + encodeURIComponent(ui.serverId));
  ui.voiceRooms = data.rooms || {};
  if (ui.voice && ui.voiceRooms[ui.voice.channelId]) {
    ui.voice.name = channelName();
  }
  return data;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const voice = ui.voice;
    if (!voice) return;
    const token = localStorage.getItem('dc_token') || '';
    fetch(getApiBase() + '/api/voice/' + voice.channelId + '/leave', {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ serverId: voice.serverId }),
    }).catch(() => {});
  });
}
