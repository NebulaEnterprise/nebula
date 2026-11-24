<script>
  import { onMount } from 'svelte';

  const desk = typeof window !== 'undefined' ? window.nebulaDesktop : null;
  let settings = $state({
    startWithWindows: false,
    startInTray: false,
    closeToTray: true,
    hardwareAcceleration: true,
    showPlaying: false,
  });
  let ready = $state(false);

  const rows = [
    { group: 'Starting and closing', id: 'startWithWindows', title: 'Start with Windows', text: 'Nebula opens when you log in.' },
    { id: 'startInTray', title: 'Start in the tray', text: 'When it starts with Windows, stay out of the way until you open it.' },
    { id: 'closeToTray', title: 'Keep running in the tray when I close the window', text: 'Calls and notifications keep working. Off: closing the window quits Nebula.' },
    { group: 'Performance', id: 'hardwareAcceleration', title: 'Hardware acceleration', text: 'Uses your graphics card to draw Nebula. Turn off if you see black boxes or stutter in a game. Takes effect after you quit and open Nebula again.' },
    { group: 'Playing', id: 'showPlaying', title: 'Show what I’m playing', text: 'Off unless you turn it on. When on, the app checks which programs are running every 20 seconds to spot games, and friends and servers see “Playing …”. Only the game’s name leaves this computer.' },
  ];

  onMount(async () => {
    if (!desk || typeof desk.settings !== 'function') return;
    try {
      settings = { ...settings, ...(await desk.settings()) };
    } catch (_) {}
    ready = true;
  });

  async function toggle(id) {
    const next = !settings[id];
    settings = { ...settings, [id]: next };
    if (!desk || typeof desk.setSetting !== 'function') return;
    try {
      settings = { ...settings, ...(await desk.setSetting(id, next)) };
    } catch (_) {
      settings = { ...settings, [id]: !next };
    }
  }
</script>

<div class="sound-page">
  <p class="hint">These are saved on this computer by the Nebula app.</p>
  {#if desk && typeof desk.settings !== 'function'}
    <p class="hint">Update the Nebula desktop app to change these.</p>
  {/if}
  {#each rows as row}
    {#if row.group}<p class="sound-kicker">{row.group}</p>{/if}
    <div class="sound-row">
      <div class="copy">
        <strong>{row.title}</strong>
        <em>{row.text}</em>
      </div>
      <button type="button" class="switch green" class:on={!!settings[row.id]} aria-pressed={!!settings[row.id]} disabled={!!desk && typeof desk.settings === 'function' && !ready} onclick={() => toggle(row.id)}><i></i></button>
    </div>
  {/each}
</div>
