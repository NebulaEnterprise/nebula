<script>
  import { onMount } from 'svelte';
  import { callDevices, setCallMic, setCallSpeaker, setCallProcessing } from '../voice.js';
  import { toast } from '../state.svelte.js';
  import { pttChord, setPttChord, chordFromEvent, chordLabel, setRecordingBind } from '../keybinds.js';

  let mics = $state([]);
  let speakers = $state([]);
  let micId = $state(localStorage.getItem('nebula-mic') || '');
  let speakerId = $state(localStorage.getItem('nebula-speaker') || '');
  let output = $state(Number(localStorage.getItem('nebula-output') || '100'));
  let board = $state(Number(localStorage.getItem('nebula-board') || '100'));
  let noise = $state(localStorage.getItem('nebula-noise') !== 'off');
  let echo = $state(localStorage.getItem('nebula-echo') !== 'off');
  let gain = $state(localStorage.getItem('nebula-gain') !== 'off');
  let mode = $state(localStorage.getItem('nebula-input') === 'ptt' ? 'ptt' : 'voice');
  let ptt = $state(chordLabel(pttChord()).join(' + ') || 'V');
  let arming = $state(false);
  let joinMuted = $state(localStorage.getItem('nebula-join-muted') === '1');
  let level = $state(0);
  let testing = $state(false);
  let tester = null;

  onMount(() => {
    const onKey = (event) => {
      if (!arming) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        arming = false;
        setRecordingBind(false);
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return;
      setPttChord(chord);
      ptt = chordLabel(chord).join(' + ');
      arming = false;
      setRecordingBind(false);
    };
    window.addEventListener('keydown', onKey, true);
    callDevices().then((data) => {
      mics = data.mics || [];
      speakers = data.speakers || [];
      micId = data.micId || '';
      speakerId = data.speakerId || '';
      noise = data.noise !== false;
      echo = data.echo !== false;
    }).catch(() => {});
    return () => {
      setRecordingBind(false);
      window.removeEventListener('keydown', onKey, true);
      stopTest();
    };
  });

  function armPtt() {
    arming = true;
    setRecordingBind(true);
  }

  function deviceLabel(row, fallback) {
    return row.label || fallback;
  }

  async function pickMic(event) {
    micId = event.currentTarget.value;
    try { await setCallMic(micId); }
    catch (err) { toast(err.message || 'Could not switch microphone'); }
  }

  async function pickSpeaker(event) {
    speakerId = event.currentTarget.value;
    try { await setCallSpeaker(speakerId); }
    catch (err) { toast(err.message || 'Could not switch speakers'); }
  }

  function setOutput(event) {
    output = Number(event.currentTarget.value);
    localStorage.setItem('nebula-output', String(output));
  }

  function setBoard(event) {
    board = Number(event.currentTarget.value);
    localStorage.setItem('nebula-board', String(board));
  }

  function setMode(next) {
    mode = next;
    localStorage.setItem('nebula-input', next);
  }

  function toggle(kind) {
    if (kind === 'noise') noise = !noise;
    if (kind === 'echo') echo = !echo;
    if (kind === 'gain') gain = !gain;
    if (kind === 'join') joinMuted = !joinMuted;
    localStorage.setItem('nebula-gain', gain ? 'on' : 'off');
    localStorage.setItem('nebula-join-muted', joinMuted ? '1' : '0');
    setCallProcessing({ noise, echo, gain });
  }

  function stopTest() {
    testing = false;
    level = 0;
    if (!tester) return;
    tester.stream.getTracks().forEach((track) => track.stop());
    tester.context.close().catch(() => {});
    tester = null;
  }

  async function testMic() {
    if (testing) return stopTest();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: { exact: micId } } : true,
        video: false,
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const monitor = context.createGain();
      monitor.gain.value = 0.35;
      source.connect(monitor);
      monitor.connect(context.destination);
      const data = new Uint8Array(analyser.fftSize);
      tester = { stream, context };
      testing = true;
      const tick = () => {
        if (!testing || !tester) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const n = (value - 128) / 128;
          sum += n * n;
        }
        level = Math.min(100, Math.round(Math.sqrt(sum / data.length) * 280));
        requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      toast(err.message || 'Allow the microphone to test it');
    }
  }
</script>

<div class="sound-page">
  <div class="voice-devices">
    <label>Microphone
      <select value={micId} onchange={pickMic}>
        <option value="">Default</option>
        {#each mics as row}
          <option value={row.deviceId}>{deviceLabel(row, 'Microphone')}</option>
        {/each}
      </select>
    </label>
    <label>Speakers
      <select value={speakerId} onchange={pickSpeaker}>
        <option value="">Default</option>
        {#each speakers as row}
          <option value={row.deviceId}>{deviceLabel(row, 'Speakers')}</option>
        {/each}
      </select>
    </label>
  </div>

  <p class="sound-kicker">Output volume {output}%</p>
  <input class="sound-range" type="range" min="0" max="100" value={output} oninput={setOutput} aria-label="Output volume" />
  <p class="sound-kicker">Soundboard volume {board}%</p>
  <input class="sound-range" type="range" min="0" max="100" value={board} oninput={setBoard} aria-label="Soundboard volume" />
  <p class="hint">Sounds people play in calls. Slide to 0 to mute them.</p>

  <p class="sound-kicker">Mic test</p>
  <div class="mic-test">
    <button type="button" class="btn brand sm" onclick={testMic}>{testing ? 'Stop' : 'Test mic'}</button>
    <span class="mic-track"><i style="width:{level}%"></i></span>
  </div>
  <p class="hint">Say something: the bar moves and you hear yourself (use headphones).</p>

  <p class="sound-kicker">Input mode</p>
  <div class="voice-modes">
    <button type="button" class:on={mode === 'voice'} onclick={() => setMode('voice')}>
      <strong>Voice activity</strong>
      <span>Your mic is on while you’re not muted.</span>
    </button>
    <button type="button" class:on={mode === 'ptt'} onclick={() => setMode('ptt')}>
      <strong>Push to talk</strong>
      <span>Hold {ptt} to talk while you are in a call and not typing.</span>
    </button>
  </div>
  <div class="sound-row">
    <div class="copy">
      <strong>Push to talk key</strong>
      <em>Click the key, then press the key or shortcut you want to hold.</em>
    </div>
    <button type="button" class="bind-keys bind-edit" class:on={arming} onclick={armPtt}>
      <kbd>{arming ? 'Press a key' : ptt}</kbd>
    </button>
  </div>

  <p class="sound-kicker">Voice processing</p>
  <div class="sound-row">
    <div class="copy"><strong>Noise suppression</strong><em>Your browser’s filter. It softens fans, keyboards and steady background noise.</em></div>
    <button type="button" class="switch" class:on={noise} aria-pressed={noise} onclick={() => toggle('noise')}><i></i></button>
  </div>
  <div class="sound-row">
    <div class="copy"><strong>Echo cancellation</strong><em>Stops others hearing themselves through your speakers.</em></div>
    <button type="button" class="switch" class:on={echo} aria-pressed={echo} onclick={() => toggle('echo')}><i></i></button>
  </div>
  <div class="sound-row">
    <div class="copy"><strong>Automatic gain</strong><em>Keeps your volume even. Turn off for music or a good mic.</em></div>
    <button type="button" class="switch" class:on={gain} aria-pressed={gain} onclick={() => toggle('gain')}><i></i></button>
  </div>

  <p class="sound-kicker">Joining calls</p>
  <div class="sound-row">
    <div class="copy"><strong>Join calls muted</strong><em>Your mic starts off in every call. Unmute when you’re ready.</em></div>
    <button type="button" class="switch" class:on={joinMuted} aria-pressed={joinMuted} onclick={() => toggle('join')}><i></i></button>
  </div>
</div>
