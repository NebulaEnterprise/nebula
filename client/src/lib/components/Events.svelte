<script>
  import { Calendar, X } from '@lucide/svelte';
  import { ui, guildAction, toast, hasPerm, openServer } from '../state.svelte.js';
  import { PERM } from '../format.js';
  import { readSmallImage } from '../image.js';

  let view = $state('list');
  let current = $state(null);
  let busy = $state(false);
  let name = $state('');
  let where = $state('voice');
  let channelId = $state('');
  let elsewhere = $state('');
  let start = $state('');
  let end = $state('');
  let repeat = $state('once');
  let announceId = $state('');
  let description = $state('');
  let coverUrl = $state('');

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  const voices = $derived((ui.channels || []).filter((ch) => ch.type === 'voice'));
  const texts = $derived((ui.channels || []).filter((ch) => ch.type === 'text'));
  const events = $derived((ui.events || []).filter((ev) => ev.status !== 'cancelled'));
  const canManage = $derived(hasPerm(PERM.MANAGE_SERVER) || !!ui.serverMeta?.owner);

  function pad(n) { return String(n).padStart(2, '0'); }
  function localValue(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
  function blank() {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    next.setMinutes(0, 0, 0);
    name = 'Friday game night';
    where = 'voice';
    channelId = voices[0]?.id || '';
    elsewhere = '';
    start = localValue(next);
    end = '';
    repeat = 'once';
    announceId = texts[0]?.id || '';
    description = '';
    coverUrl = '';
    current = null;
    view = 'edit';
  }
  function edit(ev) {
    current = ev;
    name = ev.title || '';
    where = ev.where === 'elsewhere' ? 'elsewhere' : 'voice';
    channelId = ev.channelId || voices[0]?.id || '';
    elsewhere = ev.elsewhere || '';
    start = ev.start ? localValue(new Date(ev.start)) : '';
    end = ev.end ? localValue(new Date(ev.end)) : '';
    repeat = 'once';
    announceId = ev.announceChannelId || '';
    description = ev.description || '';
    coverUrl = ev.coverUrl || '';
    view = 'edit';
  }
  function whenLabel(ev) {
    const at = ev.start ? new Date(ev.start) : null;
    if (!at || Number.isNaN(at.getTime())) return ev.when || 'Scheduled';
    const diff = at.getTime() - Date.now();
    const mins = Math.round(diff / 60000);
    if (ev.status === 'live') return 'Happening now';
    if (mins < -1) return 'Started ' + at.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    if (mins < 60) return 'in ' + Math.max(1, mins) + ' min';
    if (mins < 60 * 24) return 'in ' + Math.round(mins / 60) + ' hr';
    return at.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function clock(value) {
    if (!value) return '';
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return '';
    return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function channelName(id) {
    return (ui.channels || []).find((ch) => ch.id === id)?.name || '';
  }
  function mine(ev) {
    return String(ev?.hostId || '') === String(ui.me?.id || '');
  }
  function interested(ev) {
    return (ev?.interested || []).some((id) => String(id) === String(ui.me?.id || ''));
  }
  async function run(body) {
    busy = true;
    try {
      const data = await guildAction({ type: 'event', ...body });
      if (Array.isArray(data?.events)) {
        ui.events = data.events;
        if (current?.id) current = data.events.find((ev) => ev.id === current.id) || null;
        if (!current && view === 'detail') view = 'list';
      } else await openServer(ui.serverId, { keepDialog: true });
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    } finally {
      busy = false;
    }
  }
  async function save() {
    const title = name.trim();
    if (!title) { toast('Name the event'); return; }
    const ok = await run({
      id: current?.id || '',
      title,
      description,
      where: where === 'elsewhere' ? 'elsewhere' : 'voice',
      channelId: where === 'voice' ? channelId : '',
      elsewhere: where === 'elsewhere' ? elsewhere : '',
      start: start ? new Date(start).toISOString() : '',
      end: end ? new Date(end).toISOString() : '',
      repeat: 'once',
      announceChannelId: announceId,
      coverUrl,
    });
    if (ok) {
      view = 'list';
      toast(current?.id ? 'Event saved' : 'Event created');
    }
  }
  async function cover(event) {
    try { coverUrl = await readSmallImage(event.target.files?.[0]); }
    catch (err) { toast(err.message); }
  }
  async function share(ev) {
    const text = (ev?.title || 'Event') + ' on ' + (ui.serverMeta?.name || 'Nebula');
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (_) { toast(text); }
  }
</script>

<div class="event-panel">
  {#if view === 'edit'}
    <div class="sheet-h">
      <div>
        <h3>Create event</h3>
        <p class="hint">Times are in your time ({zone})</p>
      </div>
      <button type="button" class="btn icon" onclick={() => (view = current ? 'detail' : 'list')}><X size={16} /></button>
    </div>
    <div class="event-form">
      <label class="field">EVENT NAME
        <input bind:value={name} maxlength="80" />
      </label>
      <p class="label">WHERE</p>
      <div class="event-where">
        <button type="button" class:on={where === 'voice'} onclick={() => (where = 'voice')}>Voice channel</button>
        <button type="button" class:on={where === 'elsewhere'} onclick={() => (where = 'elsewhere')}>Somewhere else</button>
      </div>
      {#if where === 'voice'}
        <select bind:value={channelId}>
          {#each voices as ch}<option value={ch.id}>{ch.name}</option>{/each}
          {#if !voices.length}<option value="">No voice channels</option>{/if}
        </select>
      {:else}
        <input bind:value={elsewhere} maxlength="80" placeholder="A link, a game, or just say where" />
      {/if}
      <div class="event-times">
        <label class="field">STARTS
          <input type="datetime-local" bind:value={start} />
        </label>
        <label class="field">ENDS (OPTIONAL)
          <input type="datetime-local" bind:value={end} />
        </label>
      </div>
      <div class="event-times">
        <label class="field">REPEAT
          <select bind:value={repeat}><option value="once">Just once</option></select>
        </label>
        <label class="field">POST WHEN IT STARTS IN
          <select bind:value={announceId}>
            <option value="">Don't post</option>
            {#each texts as ch}<option value={ch.id}>#{ch.name}</option>{/each}
          </select>
        </label>
      </div>
      <label class="field">DESCRIPTION
        <textarea bind:value={description} maxlength="400" rows="3" placeholder="What's the plan?"></textarea>
      </label>
      <p class="label">COVER IMAGE</p>
      <label class="btn">Add image<input type="file" accept="image/*" onchange={cover} /></label>
      {#if coverUrl}<img class="event-cover" src={coverUrl} alt="" />{/if}
      <div class="event-actions">
        <button type="button" class="btn" onclick={() => (view = 'list')}>Cancel</button>
        <button type="button" class="btn brand" disabled={busy} onclick={save}>{current?.id ? 'Save event' : 'Create event'}</button>
      </div>
    </div>
  {:else if view === 'detail' && current}
    <div class="event-card">
      {#if current.coverUrl}<img class="event-cover" src={current.coverUrl} alt="" />{/if}
      <h3>{current.title}</h3>
      <p><strong>{whenLabel(current)}</strong></p>
      {#if current.end}<p class="hint">Ends {clock(current.end)} · Your time ({zone})</p>{/if}
      <p class="hint">{current.where === 'elsewhere' ? (current.elsewhere || 'Somewhere else') : (channelName(current.channelId) || 'Voice')}</p>
      <p class="hint">Hosted by {current.hostName || 'a member'}{#if current.announceChannelId} · announced in #{channelName(current.announceChannelId)}{/if}</p>
      {#if current.description}<p>{current.description}</p>{/if}
      <div class="event-actions">
        {#if mine(current) || canManage}
          <button type="button" class="btn" onclick={() => edit(current)}>Edit</button>
          <button type="button" class="btn" disabled={busy} onclick={async () => { if (await run({ id: current.id, startNow: true })) { toast('Event started'); view = 'list'; } }}>Start now</button>
          <button type="button" class="btn danger" disabled={busy} onclick={async () => { if (await run({ id: current.id, cancel: true })) { toast('Event cancelled'); view = 'list'; } }}>Cancel event</button>
        {/if}
      </div>
      <div class="event-actions">
        <button type="button" class="btn" onclick={() => (view = 'list')}>All events</button>
        <button type="button" class="btn" onclick={() => share(current)}>Share</button>
        <button type="button" class="btn" class:on={interested(current)} disabled={busy} onclick={() => run({ id: current.id, interest: true })}>
          {interested(current) ? 'Interested' : "I'm interested"} · {(current.interested || []).length}
        </button>
      </div>
    </div>
  {:else}
    <div class="event-empty">
      <button type="button" class="btn icon event-x" title="Close" onclick={() => (ui.dialog = null)}><X size={16} /></button>
      {#if events.length}
        <div class="event-list">
          {#each events as ev (ev.id)}
            <button type="button" onclick={() => { current = ev; view = 'detail'; }}>
              <strong>{ev.title}</strong>
              <em>{whenLabel(ev)}</em>
            </button>
          {/each}
        </div>
      {:else}
        <span><Calendar size={28} /></span>
        <strong>No events yet</strong>
        <p>Plan a game night or a watch party and people can say they're in.</p>
      {/if}
      <button type="button" class="btn brand" onclick={blank}>+ Create event</button>
    </div>
  {/if}
</div>
