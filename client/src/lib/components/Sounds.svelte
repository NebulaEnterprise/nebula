<script>
  import { Play } from '@lucide/svelte';
  import {
    PING_CHOICES, notifySounds, setNotifySounds, soundVolume, setSoundVolume,
    soundEnabled, setSoundEnabled, pingChoice, setPingChoice, playEvent,
  } from '../sounds.js';

  let volume = $state(Math.round(soundVolume() * 100));
  let master = $state(notifySounds());
  let flags = $state({});
  let pings = $state({ dm: pingChoice('dm'), mention: pingChoice('mention'), group: pingChoice('group') });

  const groups = [
    {
      id: 'chat',
      label: 'Chat',
      rows: [
        { id: 'message', title: 'New message in a DM or a mention', play: 'message' },
        { id: 'sent', title: 'Message sent', play: 'sent' },
      ],
    },
    {
      id: 'calls',
      label: 'Calls',
      rows: [
        { id: 'call-in', title: 'Incoming call', play: 'call-in' },
        { id: 'call-out', title: 'Outgoing call ringing', play: 'call-out' },
        { id: 'call-end', title: 'Call ended or not answered', play: 'call-end' },
      ],
    },
    {
      id: 'voice',
      label: 'Voice',
      rows: [
        { id: 'voice-join', title: 'You join a voice channel', play: 'voice-join' },
        { id: 'voice-leave', title: 'You leave a voice channel', play: 'voice-leave' },
        { id: 'voice-other-join', title: 'Someone joins your call', play: 'voice-other-join' },
        { id: 'voice-other-leave', title: 'Someone leaves your call', play: 'voice-other-leave' },
        { id: 'voice-move', title: 'You were moved to another channel', play: 'voice-move' },
        { id: 'voice-lost', title: 'Connection lost', play: 'voice-lost' },
        { id: 'voice-back', title: 'Reconnected', play: 'voice-back' },
        { id: 'mute', title: 'Mute', play: 'mute' },
        { id: 'unmute', title: 'Unmute', play: 'unmute' },
        { id: 'deafen', title: 'Deafen', play: 'deafen' },
        { id: 'undeafen', title: 'Undeafen', play: 'undeafen' },
        { id: 'ptt-down', title: 'Push to talk pressed', play: 'ptt-down' },
        { id: 'ptt-up', title: 'Push to talk released', play: 'ptt-up' },
        { id: 'stage', title: 'Invited to speak on a stage', play: 'stage' },
      ],
    },
    {
      id: 'streams',
      label: 'Streams',
      rows: [
        { id: 'share-start', title: 'You start sharing your screen', play: 'share-start' },
        { id: 'share-stop', title: 'You stop sharing your screen', play: 'share-stop' },
        { id: 'stream-start', title: 'Someone starts a stream in your call', play: 'stream-start' },
        { id: 'stream-stop', title: 'Someone stops their stream', play: 'stream-stop' },
        { id: 'watch-start', title: 'You start watching a stream', play: 'watch-start' },
        { id: 'watch-stop', title: 'You stop watching a stream', play: 'watch-stop' },
      ],
    },
    {
      id: 'other',
      label: 'Other',
      rows: [
        { id: 'friend', title: 'Friend request', play: 'friend' },
        { id: 'clip', title: 'Clip saved', play: 'clip' },
        { id: 'error', title: 'Something went wrong', play: 'error' },
      ],
    },
  ];

  function onVolume(event) {
    volume = Number(event.currentTarget.value);
    setSoundVolume(volume / 100);
  }

  function toggleMaster() {
    master = !master;
    setNotifySounds(master);
    if (master) playEvent('message', { preview: true });
  }

  function on(id) {
    return flags[id] !== false && soundEnabled(id);
  }

  function toggle(id, play) {
    const next = !on(id);
    flags = { ...flags, [id]: next };
    setSoundEnabled(id, next);
    if (next) playEvent(play, { preview: true });
  }

  function pickPing(slot, value) {
    pings = { ...pings, [slot]: value };
    setPingChoice(slot, value);
    if (value !== 'off') playEvent(slot, { preview: true });
  }
</script>

<div class="sound-page">
  <p class="sound-kicker">Sound volume {volume}%</p>
  <input class="sound-range" type="range" min="0" max="100" value={volume} oninput={onVolume} aria-label="Sound volume" />
  <p class="hint">How loud the app’s own sounds are. Calls and the soundboard have their own volume in Voice & Audio.</p>

  <div class="sound-row">
    <div class="copy">
      <strong>Notification sounds</strong>
      <em>Off: no ping for new messages. Same switch as in your status menu.</em>
    </div>
    <button type="button" class="switch" class:on={master} aria-pressed={master} onclick={toggleMaster}><i></i></button>
  </div>

  <p class="sound-kicker">Ping sounds</p>
  <p class="hint">Pick a different ping for DMs, mentions and group chats. Saved on this device.</p>
  {#each [
    ['dm', 'DMs', 'A new message in a DM'],
    ['mention', 'Mentions', 'Someone @mentions you or replies to you in a server'],
    ['group', 'Group chats', 'A new message in a group DM'],
  ] as [slot, title, text]}
    <div class="sound-row">
      <button type="button" class="sound-play" aria-label={'Play ' + title} onclick={() => playEvent(slot, { preview: true })}><Play size={14} /></button>
      <div class="copy">
        <strong>{title}</strong>
        <em>{text}</em>
      </div>
      <select class="sound-select" value={pings[slot]} onchange={(event) => pickPing(slot, event.currentTarget.value)}>
        {#each PING_CHOICES as choice}
          <option value={choice.id}>{choice.label}</option>
        {/each}
      </select>
    </div>
  {/each}

  {#each groups as group}
    <p class="sound-kicker">{group.label}</p>
    {#each group.rows as row}
      <div class="sound-row">
        <button type="button" class="sound-play" aria-label={'Play ' + row.title} onclick={() => playEvent(row.play, { preview: true })}><Play size={14} /></button>
        <div class="copy"><strong>{row.title}</strong></div>
        <button type="button" class="switch" class:on={on(row.id)} aria-pressed={on(row.id)} onclick={() => toggle(row.id, row.play)}><i></i></button>
      </div>
    {/each}
  {/each}
</div>
