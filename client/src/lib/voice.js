import { api, getApiBase } from './api.js';
import { ui, toast, privacyStop, showFriendGate } from './state.svelte.js';

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
let roomTicket = 0;
let syncTicket = 0;
let seenRev = 0;
let leaving = false;
let aloneSince = 0;

function directCall(voice = ui.voice) {
  return !!(voice && voice.serverId === 'call' && String(voice.channelId || '').startsWith('dm:'));
}

function newerRev(rev) {
  const n = Number(rev) || 0;
  if (!n) return true;
  if (n < seenRev) return false;
  seenRev = n;
  return true;
}

export function resetVoiceClock() {
  seenRev = 0;
}

function paintList(channelId, listed) {
  const mine = String(ui.me?.id || '');
  const here = !!(ui.voice && ui.voice.channelId === channelId);
  let rows = Array.isArray(listed) ? listed : [];
  if (!here && mine) rows = rows.filter((person) => String(person.id) !== mine);
  if (!here) return rows;
  rows = rows.map((person) => (
    String(person.id) === mine
      ? { ...person, sharing: !!ui.voice.sharing, speaking: !!ui.voice.speaking, muted: !!ui.voice.muted, deafened: !!ui.voice.deafened }
      : person
  ));
  if (mine && !rows.some((person) => String(person.id) === mine)) {
    rows = [{
      id: ui.me.id,
      displayName: ui.me.displayName || ui.me.username,
      username: ui.me.username,
      avatarUrl: ui.me.avatarUrl || '',
      avatarColor: ui.me.avatarColor,
      sharing: !!ui.voice.sharing,
      speaking: !!ui.voice.speaking,
      muted: !!ui.voice.muted,
      deafened: !!ui.voice.deafened,
    }, ...rows];
  }
  return rows;
}

function publishScreens() {
  ui.screen = { at: Date.now(), local: !!localScreen, remote: !!remoteScreen };
  if (!ui.voice) return;
  ui.voice.sharing = !!screenStream;
  ui.voice.screenTick = Date.now();
  const room = ui.voiceRooms[ui.voice.channelId];
  if (!room || !ui.me) return;
  ui.voiceRooms = {
    ...ui.voiceRooms,
    [ui.voice.channelId]: room.map((member) => (
      String(member.id) === String(ui.me.id) ? { ...member, sharing: !!screenStream } : member
    )),
  };
}

function bumpScreen() {
  publishScreens();
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
  const next = Object.assign({}, ui.voiceRooms);
  if (!members.length && !(ui.voice && ui.voice.channelId === channelId)) delete next[channelId];
  else next[channelId] = members;
  ui.voiceRooms = next;
}

function postLeave(voice) {
  if (!voice) return;
  const token = localStorage.getItem('dc_token') || '';
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  const body = JSON.stringify({ serverId: voice.serverId || '', channelId: voice.channelId || '' });
  const send = (path) => fetch(getApiBase() + path, { method: 'POST', keepalive: true, headers, body }).catch(() => {});
  send('/api/voice/leave');
  if (voice.channelId) send('/api/voice/' + encodeURIComponent(voice.channelId) + '/leave');
}

async function sendSignal(to, kind, payload) {
  const voice = ui.voice;
  if (!voice) return;
  await api('/api/voice/' + encodeURIComponent(voice.channelId) + '/signal', {
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
  publishScreens();
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
  if (stream) stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
  if (screenStream) {
    const screenTrack = screenStream.getVideoTracks()[0];
    if (screenTrack) pc.addTrack(screenTrack, screenStream);
  }
  pc.onicecandidate = (event) => {
    if (!event.candidate || !ui.voice) return;
    sendSignal(id, 'ice', event.candidate.toJSON()).catch(() => {});
  };
  pc.ontrack = (event) => {
    if (event.track && event.track.kind === 'video') {
      const show = () => {
        if (!event.track || event.track.readyState === 'ended' || event.track.muted) return;
        remoteScreen = (event.streams && event.streams[0]) || new MediaStream([event.track]);
        publishScreens();
      };
      const hide = () => {
        if (remoteScreen && remoteScreen.getVideoTracks().includes(event.track)) {
          remoteScreen = null;
          publishScreens();
        }
      };
      event.track.onunmute = show;
      event.track.onmute = () => {
        setTimeout(() => { if (event.track.muted || event.track.readyState === 'ended') hide(); }, 700);
      };
      event.track.onended = hide;
      show();
      let tries = 0;
      const watch = setInterval(() => {
        tries += 1;
        if (!event.track || event.track.readyState === 'ended' || tries > 12) {
          clearInterval(watch);
          return;
        }
        show();
      }, 400);
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
    await acceptOffer(signal);
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

async function acceptOffer(signal, attempt = 0) {
  if (!ui.voice || !signal) return;
  const peer = ensurePeer(signal.from);
  if (!peer) return;
  if (peer.pc.signalingState === 'have-local-offer') {
    const polite = String(ui.me?.id || '') > String(signal.from);
    if (!polite) {
      if (attempt < 8) setTimeout(() => { acceptOffer(signal, attempt + 1).catch(() => {}); }, 250);
      return;
    }
    try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch (_) {}
  } else if (peer.pc.signalingState !== 'stable') {
    if (attempt < 8) setTimeout(() => { acceptOffer(signal, attempt + 1).catch(() => {}); }, 250);
    return;
  }
  await peer.pc.setRemoteDescription(signal.payload);
  await flushIce(signal.from);
  const answer = await peer.pc.createAnswer();
  await peer.pc.setLocalDescription(answer);
  await sendSignal(signal.from, 'answer', peer.pc.localDescription);
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

async function renegotiate(id, attempt = 0) {
  const peer = peers.get(id);
  if (!peer) return;
  if (peer.pc.signalingState !== 'stable') {
    if (attempt < 6) setTimeout(() => { renegotiate(id, attempt + 1).catch(() => {}); }, 350);
    return;
  }
  peer.offered = true;
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    await sendSignal(id, 'offer', peer.pc.localDescription);
  } catch (_) {
    peer.offered = false;
  }
}

function videoSender(pc) {
  const direct = pc.getSenders().find((sender) => sender.track && sender.track.kind === 'video');
  if (direct) return direct;
  const transceiver = (pc.getTransceivers?.() || []).find((item) => {
    const kind = item.sender?.track?.kind || item.receiver?.track?.kind;
    return kind === 'video';
  });
  return transceiver ? transceiver.sender : null;
}

async function postSharing(sharing) {
  const voice = ui.voice;
  if (!voice) return;
  try {
    await api('/api/voice/' + encodeURIComponent(voice.channelId) + '/state', {
      method: 'POST',
      body: { serverId: voice.serverId, sharing },
    });
  } catch (_) {}
}

async function sync() {
  const voice = ui.voice;
  if (!voice) return;
  const ticket = ++syncTicket;
  const data = await api('/api/voice/' + encodeURIComponent(voice.channelId) + '/sync?serverId=' + encodeURIComponent(voice.serverId));
  if (ticket !== syncTicket || !ui.voice || ui.voice.channelId !== voice.channelId) return;
  const fresh = newerRev(data.rev);
  if (fresh && data.joined === false && Date.now() - (voice.joinedAt || 0) > 1500) {
    const satTooLong = directCall(voice) && aloneSince && Date.now() - aloneSince >= 3 * 60 * 1000 - 8000;
    publishRoom(voice.channelId, (data.members || []).filter((member) => String(member.id) !== String(ui.me?.id)));
    for (const signal of data.signals || []) {
      try { await handleSignal(signal); } catch (_) {}
    }
    leaveVoice();
    if (satTooLong) toast('The call ended after 3 minutes alone');
    return;
  }
  const members = fresh ? paintList(voice.channelId, data.members || []) : (ui.voiceRooms[voice.channelId] || []);
  if (fresh) publishRoom(voice.channelId, members);
  const others = members.filter((member) => String(member.id) !== String(ui.me?.id));
  const live = new Set(others.map((member) => String(member.id)));
  if (fresh) {
    for (const id of [...peers.keys()]) {
      if (!live.has(String(id))) closePeer(id);
    }
  }
  for (const signal of data.signals || []) {
    try { await handleSignal(signal); } catch (_) {}
  }
  for (const member of others) {
    if (ui.me.id < member.id) await offerTo(member.id);
  }
  if (speaking !== voice.speakingSent) {
    voice.speakingSent = speaking;
    api('/api/voice/' + encodeURIComponent(voice.channelId) + '/state', {
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
    joinedAt: Date.now(),
  };
  ui.streamUi = { view: 'auto', watching: false, hideChat: false };
  watchMic();
  try { await sync(); } catch (_) {}
  poll = setInterval(() => { sync().catch(() => {}); }, 500);
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
  if (person && ui.me && String(person.id) !== String(ui.me.id)) {
    try {
      const data = await api('/api/calls', { method: 'POST', body: { userId: person.id } });
      ui.outgoingCall = data.call;
    } catch (err) {
      if (privacyStop(err.message)) {
        await showFriendGate(person);
        return;
      }
      toast(err.message || 'Could not start the call');
      return;
    }
  }
  await leaveVoice();
  await connectCall(channelId, name, person && person.id ? person : null, ui.outgoingCall && ui.outgoingCall.id);
}

export async function joinOpenCall() {
  let channelId = '';
  let name = 'Call';
  let person = null;
  if (ui.mode === 'dm' && ui.dmUser && ui.me && String(ui.dmUser.id) !== String(ui.me.id)) {
    channelId = 'dm:' + [ui.me.id, ui.dmUser.id].sort().join(':');
    name = ui.dmUser.displayName || ui.dmUser.username || 'Call';
    person = ui.dmUser;
  } else if (ui.mode === 'group' && ui.group) {
    channelId = 'group:' + ui.group.id;
    name = ui.group.name || 'Group call';
  } else {
    return;
  }
  await leaveVoice();
  await connectCall(channelId, name, person, null);
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
  const same = ui.voice && ui.voice.channelId === channel.id && ui.voice.serverId === ui.serverId;
  if (same && stream) {
    ui.streamUi = { view: 'wide', watching: !!ui.streamUi?.watching, hideChat: true };
    return;
  }
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
    await api('/api/voice/' + encodeURIComponent(channel.id) + '/join', {
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
    sharing: false,
    screenTick: 0,
    joinedAt: Date.now(),
  };
  ui.streamUi = { view: 'wide', watching: false, hideChat: true };
  watchMic();
  try { await sync(); } catch (_) {}
  poll = setInterval(() => { sync().catch(() => {}); }, 500);
}

export async function leaveVoice() {
  if (leaving) return;
  leaving = true;
  roomTicket += 1;
  syncTicket += 1;
  const voice = ui.voice;
  try {
    if (poll) clearInterval(poll);
    poll = null;
    closeAll();
    stopLocal();
    speaking = false;
    aloneSince = 0;
    ui.voice = null;
    ui.streamUi = { view: 'auto', watching: false, hideChat: false };
    if (voice) {
      publishRoom(voice.channelId, (ui.voiceRooms[voice.channelId] || []).filter((member) => String(member.id) !== String(ui.me?.id)));
      postLeave(voice);
    }
    if (voice && voice.callId) {
      try { await api('/api/calls/' + encodeURIComponent(voice.callId) + '/end', { method: 'POST', body: {} }); } catch (_) {}
    }
    await dropOutgoing(true);
    if (!voice) return;
    try {
      await api('/api/voice/leave', {
        method: 'POST',
        body: { serverId: voice.serverId, channelId: voice.channelId },
      });
    } catch (_) {
      try {
        await api('/api/voice/' + encodeURIComponent(voice.channelId) + '/leave', {
          method: 'POST',
          body: { serverId: voice.serverId },
        });
      } catch (_) {}
    }
    publishRoom(voice.channelId, (ui.voiceRooms[voice.channelId] || []).filter((member) => String(member.id) !== String(ui.me?.id)));
    await refreshVoiceRooms().catch(() => null);
  } finally {
    leaving = false;
  }
}

let sharingBusy = false;

export async function toggleShare() {
  if (!ui.voice || sharingBusy) return;
  sharingBusy = true;
  try {
  if (screenStream) {
    const current = screenStream;
    dropScreenTracks();
    for (const peer of peers.values()) {
      const sender = peer.pc.getSenders().find((item) => item.track && current.getTracks().includes(item.track)) || videoSender(peer.pc);
      if (sender) {
        try { await sender.replaceTrack(null); } catch (_) {}
      }
    }
    bumpScreen();
    postSharing(false);
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
    const sender = videoSender(peer.pc);
    if (sender && track) {
      const transceiver = (peer.pc.getTransceivers?.() || []).find((item) => item.sender === sender);
      if (transceiver) transceiver.direction = 'sendrecv';
      try { await sender.replaceTrack(track); } catch (_) {}
    } else if (track) {
      peer.pc.addTrack(track, next);
    }
    await renegotiate(id);
  }
  bumpScreen();
  postSharing(true);
  } finally {
    sharingBusy = false;
  }
}

export async function changeShare() {
  if (!ui.voice || !screenStream || sharingBusy) return;
  let next = null;
  try {
    next = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (_) {
    return;
  }
  const track = next.getVideoTracks()[0];
  if (!track) {
    next.getTracks().forEach((item) => item.stop());
    return;
  }
  sharingBusy = true;
  try {
    screenStream.getTracks().forEach((item) => { item.onended = null; item.stop(); });
    screenStream = next;
    localScreen = next;
    track.onended = () => { toggleShare().catch(() => {}); };
    for (const [id, peer] of peers) {
      const sender = videoSender(peer.pc);
      if (sender) {
        try { await sender.replaceTrack(track); } catch (_) {}
      } else {
        peer.pc.addTrack(track, next);
      }
      await renegotiate(id);
    }
    bumpScreen();
  } finally {
    sharingBusy = false;
  }
}

export async function setWatching(on) {
  const voice = ui.voice;
  if (!voice || voice.watchingSent === on) return;
  voice.watchingSent = on;
  try {
    await api('/api/voice/' + encodeURIComponent(voice.channelId) + '/state', {
      method: 'POST',
      body: { serverId: voice.serverId, watching: on },
    });
  } catch (_) {
    voice.watchingSent = !on;
  }
}

export async function toggleMute() {
  if (!ui.voice || !stream) return;
  ui.voice.muted = !ui.voice.muted;
  stream.getAudioTracks().forEach((track) => { track.enabled = !ui.voice.muted && !ui.voice.deafened; });
  if (ui.voice.muted) speaking = false;
  try {
    await api('/api/voice/' + encodeURIComponent(ui.voice.channelId) + '/state', {
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
    await api('/api/voice/' + encodeURIComponent(ui.voice.channelId) + '/state', {
      method: 'POST',
      body: { serverId: ui.voice.serverId, muted: ui.voice.muted, deafened: ui.voice.deafened },
    });
  } catch (_) {}
}

export function applyVoiceSnapshot(snap) {
  if (!snap || typeof snap !== 'object' || !newerRev(snap.rev)) return;
  const next = { ...ui.voiceRooms };
  const call = snap.call || {};
  for (const id of Object.keys(next)) {
    if ((id.startsWith('dm:') || id.startsWith('group:')) && !call[id]) delete next[id];
  }
  for (const [id, listed] of Object.entries(call)) next[id] = paintList(id, listed);
  if (ui.mode === 'chat' && ui.serverId && snap.servers && typeof snap.servers === 'object') {
    const serverRooms = snap.servers[ui.serverId] || {};
    for (const channel of ui.channels || []) {
      if (channel.type !== 'voice') continue;
      const listed = serverRooms[channel.id] || [];
      if (listed.length) next[channel.id] = paintList(channel.id, listed);
      else delete next[channel.id];
    }
  }
  ui.voiceRooms = next;
}

export function syncCall() {
  if (!ui.voice) return Promise.resolve();
  return sync().catch(() => null);
}

export async function refreshVoiceRooms() {
  const ticket = ++roomTicket;
  const dmSide = ui.mode === 'dm' || ui.mode === 'group' || ui.mode === 'friends' || ui.mode === 'add';
  if (dmSide) {
    const data = await api('/api/voice/overview?serverId=call');
    if (ticket !== roomTicket || !newerRev(data.rev)) return data;
    const next = { ...ui.voiceRooms };
    for (const id of Object.keys(next)) {
      if ((id.startsWith('dm:') || id.startsWith('group:')) && !(data.rooms && data.rooms[id])) delete next[id];
    }
    for (const [id, listed] of Object.entries(data.rooms || {})) next[id] = paintList(id, listed);
    ui.voiceRooms = next;
    return data;
  }
  if (!ui.serverId || ui.mode !== 'chat') return null;
  const data = await api('/api/voice/overview?serverId=' + encodeURIComponent(ui.serverId));
  if (ticket !== roomTicket || !newerRev(data.rev)) return data;
  const next = { ...ui.voiceRooms };
  for (const channel of ui.channels || []) {
    if (channel.type !== 'voice') continue;
    next[channel.id] = paintList(channel.id, (data.rooms && data.rooms[channel.id]) || []);
  }
  ui.voiceRooms = next;
  if (ui.voice && ui.voice.serverId !== 'call') ui.voice.name = channelName();
  return data;
}

export function partnerInCall(user) {
  if (!user || !ui.me) return false;
  const id = 'dm:' + [ui.me.id, user.id].sort().join(':');
  return (ui.voiceRooms[id] || []).some((person) => String(person.id) === String(user.id));
}

export function pokeVoice() {
  const jobs = [refreshVoiceRooms().catch(() => null)];
  if (ui.voice) jobs.push(sync().catch(() => null));
  return Promise.all(jobs);
}

export function isLive(userId) {
  if (!userId) return false;
  if (ui.voice && ui.voice.sharing && String(ui.me?.id) === String(userId)) return true;
  for (const room of Object.values(ui.voiceRooms || {})) {
    if ((room || []).some((person) => String(person.id) === String(userId) && person.sharing)) return true;
  }
  return false;
}

if (typeof window !== 'undefined') {
  setInterval(() => {
    if (!ui.voice || !ui.me) {
      aloneSince = 0;
      return;
    }
    if (!directCall()) {
      aloneSince = 0;
      return;
    }
    const room = ui.voiceRooms[ui.voice.channelId] || [];
    const others = room.some((person) => String(person.id) !== String(ui.me.id));
    if (others) {
      aloneSince = 0;
      return;
    }
    if (!aloneSince) aloneSince = Date.now();
    if (Date.now() - aloneSince < 3 * 60 * 1000) return;
    aloneSince = 0;
    toast('The call ended after 3 minutes alone');
    leaveVoice();
  }, 5000);
  window.addEventListener('pagehide', () => {
    if (ui.voice) postLeave(ui.voice);
  });
}
