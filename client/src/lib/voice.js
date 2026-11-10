import { api, getApiBase } from './api.js';
import { ui, toast } from './state.svelte.js';

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let stream = null;
let screenStream = null;
export let localScreen = null;
export let remoteScreen = null;
let poll = null;
let peers = new Map();
let iceQueue = new Map();
let levelTimer = null;
let audioCtx = null;
let speaking = false;

function bumpScreen() {
  if (!ui.voice) return;
  ui.voice.sharing = !!screenStream;
  ui.voice.screenTick = Date.now();
}

function dropScreenTracks() {
  const current = screenStream;
  screenStream = null;
  localScreen = null;
  if (!current) return;
  current.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

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
  dropScreenTracks();
  remoteScreen = null;
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
  if (screenStream) screenStream.getTracks().forEach((track) => pc.addTrack(track, screenStream));
  pc.onicecandidate = (event) => {
    if (!event.candidate || !ui.voice) return;
    sendSignal(id, 'ice', event.candidate.toJSON()).catch(() => {});
  };
  pc.ontrack = (event) => {
    if (event.track && event.track.kind === 'video') {
      remoteScreen = event.streams[0] || new MediaStream([event.track]);
      event.track.onended = () => {
        remoteScreen = null;
        bumpScreen();
      };
      bumpScreen();
      return;
    }
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

async function renegotiate(id) {
  const peer = peers.get(id);
  if (!peer || peer.pc.signalingState !== 'stable') return;
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
    if (!ui.voice) return;
    let next = false;
    if (!ui.voice.muted && !ui.voice.deafened) {
      analyser.getByteFrequencyData(bins);
      let total = 0;
      for (const value of bins) total += value;
      next = total / bins.length > 16;
    }
    speaking = next;
    if (ui.voice.speaking === next) return;
    ui.voice.speaking = next;
    const room = ui.voiceRooms[ui.voice.channelId];
    if (!room || !ui.me) return;
    ui.voiceRooms = {
      ...ui.voiceRooms,
      [ui.voice.channelId]: room.map((member) => (
        String(member.id) === String(ui.me.id) ? { ...member, speaking: next } : member
      )),
    };
  }, 200);
}

async function dropOutgoing(missed) {
  const call = ui.outgoingCall;
  ui.outgoingCall = null;
  if (!call) return;
  try {
    await api('/api/calls/' + encodeURIComponent(call.id) + '/cancel', { method: 'POST', body: { drop: !missed } });
  } catch (_) {}
}

async function connectCall(channelId, name, person, callId) {
  if (ui.voice && ui.voice.channelId === channelId && ui.voice.serverId === 'call') return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch (_) {
    await dropOutgoing(false);
    toast('Allow the microphone to start the call');
    return;
  }
  try {
    await api('/api/voice/' + encodeURIComponent(channelId) + '/join', {
      method: 'POST',
      body: { serverId: 'call' },
    });
  } catch (err) {
    stopLocal();
    await dropOutgoing(false);
    toast(err.message || 'Could not start the call');
    return;
  }
  ui.voice = {
    serverId: 'call',
    channelId,
    name,
    person: person || null,
    callId: callId || null,
    muted: false,
    deafened: false,
    speakingSent: false,
    sharing: false,
    screenTick: 0,
  };
  watchMic();
  try { await sync(); } catch (_) {}
  poll = setInterval(() => { sync().catch(() => {}); }, 1000);
}

export async function startCall(user) {
  const person = user && user.id ? user : (ui.mode === 'dm' ? ui.dmUser : null);
  let channelId = '';
  let name = 'Call';
  if (person && ui.me && String(person.id) !== String(ui.me.id)) {
    channelId = 'dm:' + [ui.me.id, person.id].sort().join(':');
    name = person.displayName || person.username || 'Call';
  } else if (ui.mode === 'group' && ui.group) {
    channelId = 'group:' + ui.group.id;
    name = ui.group.name || 'Group call';
  } else {
    return;
  }
  await leaveVoice();
  if (person && ui.me) {
    try {
      const data = await api('/api/calls', { method: 'POST', body: { userId: person.id } });
      ui.outgoingCall = data.call;
    } catch (err) {
      toast(err.message || 'Could not start the call');
      return;
    }
  }
  await connectCall(channelId, name, person && person.id ? person : null, ui.outgoingCall && ui.outgoingCall.id);
}

export async function answerCall() {
  const call = ui.incomingCall;
  if (!call) return;
  try {
    await api('/api/calls/' + encodeURIComponent(call.id) + '/answer', { method: 'POST', body: {} });
  } catch (err) {
    toast(err.message || 'Could not answer');
    return;
  }
  ui.incomingCall = null;
  await leaveVoice();
  await connectCall(call.channelId, call.from?.displayName || call.from?.username || 'Call', call.from || null, call.id);
}

export async function declineCall() {
  const call = ui.incomingCall;
  ui.incomingCall = null;
  if (!call) return;
  try {
    await api('/api/calls/' + encodeURIComponent(call.id) + '/decline', { method: 'POST', body: {} });
  } catch (_) {}
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
  if (voice && voice.callId) {
    try { await api('/api/calls/' + encodeURIComponent(voice.callId) + '/end', { method: 'POST', body: {} }); } catch (_) {}
  }
  await dropOutgoing(true);
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

let sharingBusy = false;

export async function toggleShare() {
  if (!ui.voice || sharingBusy) return;
  sharingBusy = true;
  try {
  if (screenStream) {
    const video = screenStream.getVideoTracks();
    dropScreenTracks();
    for (const [id, peer] of peers) {
      for (const sender of [...peer.pc.getSenders()]) {
        if (sender.track && video.includes(sender.track)) {
          try { peer.pc.removeTrack(sender); } catch (_) {}
        }
      }
      await renegotiate(id);
    }
    bumpScreen();
    return;
  }
  let next = null;
  try {
    next = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (_) {
    toast('Allow screen sharing to show your screen');
    return;
  }
  screenStream = next;
  localScreen = next;
  const track = next.getVideoTracks()[0];
  if (track) track.onended = () => { toggleShare().catch(() => {}); };
  for (const [id, peer] of peers) {
    if (track) peer.pc.addTrack(track, next);
    await renegotiate(id);
  }
  bumpScreen();
  } finally {
    sharingBusy = false;
  }
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
