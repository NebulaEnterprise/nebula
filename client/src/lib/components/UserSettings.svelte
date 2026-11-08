<script>
  import { X } from '@lucide/svelte';
  import { ui, saveMe, logout, toast, playPing } from '../state.svelte.js';
  import Name from './Name.svelte';
  import ColorBox from './ColorBox.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import { hasMoonBadge } from '../format.js';
  import { api, pinMedia } from '../api.js';
  import { fileToDataUrl, shrinkGif } from '../image.js';

  let page = $state('profile');
  let sound = $state(localStorage.getItem('nebula-sound') !== 'off');

  function toggleSound() {
    sound = !sound;
    localStorage.setItem('nebula-sound', sound ? 'on' : 'off');
    if (sound) playPing();
  }

  const titles = { profile: 'Profile', look: 'Appearance', status: 'Status', notify: 'Notifications' };
  let form = $state({
    username: ui.me?.username || '',
    displayName: ui.me?.displayName || '',
    pronouns: ui.me?.pronouns || '',
    bio: ui.me?.bio || '',
    customStatus: ui.me?.customStatus || '',
    status: ui.me?.status || 'online',
    avatarColor: ui.me?.avatarColor || '#7c6af7',
    accentColor: ui.me?.accentColor || '#7c6af7',
    avatarUrl: ui.me?.avatarUrl || '',
    bannerUrl: ui.me?.bannerUrl || '',
    nameEffect: ui.me?.nameEffect || '',
    nameColors: Array.isArray(ui.me?.nameColors) && ui.me.nameColors.length ? [...ui.me.nameColors] : ['#5ce1ff', '#7c6af7'],
  });

  const effects = [
    ['', 'None'],
    ['plain', 'Plain'],
    ['glow', 'Glow'],
    ['gradient', 'Gradient'],
    ['rainbow', 'Rainbow'],
    ['glitch', 'Glitch'],
    ['sparkle', 'Sparkle'],
  ];

  let savedUrl = { avatarUrl: '', bannerUrl: '' };
  const inflight = { avatarUrl: null, bannerUrl: null };

  function paintPicture(field, url) {
    if (ui.me) ui.me = { ...ui.me, [field]: url };
    ui.members = ui.members.map((m) => (m.id === ui.me?.id ? { ...m, [field]: url } : m));
    if (ui.popout?.user?.id === ui.me?.id) {
      ui.popout = { ...ui.popout, user: { ...ui.popout.user, [field]: url } };
    }
  }

  async function upload(file, kind, input) {
    const field = kind === 'banner' ? 'bannerUrl' : 'avatarUrl';
    const label = kind === 'banner' ? 'Banner' : 'Profile picture';
    if (!file) return;
    const previous = String(form[field] || '');
    const preview = URL.createObjectURL(file);
    form[field] = preview;
    paintPicture(field, preview);
    const job = (async () => {
      const isGif = /image\/gif/i.test(file.type) || /\.gif$/i.test(file.name || '');
      let body = file;
      if (isGif) {
        body = await shrinkGif(file, kind === 'banner'
          ? { max: 480, frames: 20, colors: 32 }
          : { max: 160, frames: 12, colors: 32 });
      } else if (file.size > 600 * 1024) {
        const small = await fileToDataUrl(file, {
          maxW: kind === 'banner' ? 960 : 512,
          maxH: kind === 'banner' ? 540 : 512,
          quality: 0.78,
        });
        body = await (await fetch(small)).blob();
      }
      const data = await api('/api/upload?slot=' + kind, {
        method: 'POST',
        body,
        headers: { 'Content-Type': body.type || file.type || 'application/octet-stream' },
      });
      if (!data.url) throw new Error('The picture did not save');
      pinMedia(data.url, body);
      if (!data.user || data.user[field] !== data.url) {
        await api('/api/me', { method: 'PATCH', body: { [field]: data.url } });
      }
      savedUrl[field] = data.url;
      form[field] = data.url;
      paintPicture(field, data.url);
      toast(label + ' added');
    })().catch((err) => {
      savedUrl[field] = '';
      const back = previous.startsWith('blob:') ? '' : previous;
      form[field] = back;
      paintPicture(field, back);
      toast(err.message || 'Could not upload that picture');
    });
    inflight[field] = job;
    try {
      await job;
    } finally {
      if (inflight[field] === job) inflight[field] = null;
      if (input) input.value = '';
    }
  }

  async function clearPicture(kind) {
    const field = kind === 'banner' ? 'bannerUrl' : 'avatarUrl';
    form[field] = '';
    savedUrl[field] = '';
    paintPicture(field, '');
    try {
      await api('/api/me', { method: 'PATCH', body: { [field]: '' } });
    } catch (err) { toast(err.message); }
  }

  function setNameColor(index, value) {
    const next = [...(form.nameColors || ['#5ce1ff', '#7c6af7'])];
    next[index] = value;
    form.nameColors = next;
  }

  async function save() {
    try {
      await Promise.all([inflight.avatarUrl, inflight.bannerUrl].filter(Boolean));
      const body = { ...form };
      for (const field of ['avatarUrl', 'bannerUrl']) {
        if (String(body[field] || '').startsWith('blob:')) body[field] = savedUrl[field] || '';
      }
      await saveMe(body);
    } catch (err) { toast(err.message); }
  }
</script>

<div class="overlay" role="presentation" onclick={() => (ui.userSettings = false)}>
  <div class="settings" role="dialog" onclick={(e) => e.stopPropagation()}>
    <aside class="set-nav">
      <div class="group">User settings</div>
      <button class:on={page === 'profile'} onclick={() => (page = 'profile')}>Profile</button>
      <button class:on={page === 'look'} onclick={() => (page = 'look')}>Appearance</button>
      <button class:on={page === 'status'} onclick={() => (page = 'status')}>Status</button>
      <button class:on={page === 'notify'} onclick={() => (page = 'notify')}>Notifications</button>
      <div class="group">Account</div>
      <button class="danger" onclick={logout}>Log out</button>
    </aside>
    <div class="set-main">
      <div class="row" style="border:0;padding-top:0">
        <h2>{titles[page] || 'Settings'}</h2>
        <button class="btn icon" onclick={() => (ui.userSettings = false)}><X size={18} /></button>
      </div>
      <div class="grid-2">
        <div>
          {#if page === 'profile'}
            <div class="field"><label>User id</label><input value={ui.me?.uid ?? '—'} disabled /></div>
            <div class="field"><label>Username</label><input bind:value={form.username} maxlength="32" /></div>
            <div class="field"><label>Display name</label><input bind:value={form.displayName} maxlength="32" /></div>
            <div class="field"><label>Pronouns</label><input bind:value={form.pronouns} maxlength="40" placeholder="they/them" /></div>
            <div class="field"><label>Bio</label><textarea bind:value={form.bio} maxlength="190" rows="4"></textarea></div>
          {:else if page === 'notify'}
            <div class="field">
              <label>Notification sound</label>
              <button type="button" class="btn" class:brand={sound} onclick={toggleSound}>{sound ? 'On' : 'Off'}</button>
              <p class="hint">Plays a sound for every new message and every mention, including while this tab is in the background.</p>
            </div>
          {:else if page === 'look'}
            <section class="look-block">
              <div class="look-row">
                <div class="look-av" style="background:{form.avatarColor}">
                  {#if form.avatarUrl}<Photo url={form.avatarUrl} />{:else}{(form.displayName || form.username || '?').charAt(0).toUpperCase()}{/if}
                </div>
                <div>
                  <strong>Profile picture</strong>
                  <p>PNG, JPG, GIF, or WebP.</p>
                  <div class="look-actions">
                    <label class="btn brand sm look-btn">Upload picture
                      <input type="file" accept="image/*" onchange={(e) => upload(e.target.files[0], 'avatar', e.target)} />
                    </label>
                    {#if form.avatarUrl}<button type="button" class="btn sm" onclick={() => clearPicture('avatar')}>Remove</button>{/if}
                  </div>
                </div>
              </div>
              {#if !form.avatarUrl}
                <p class="label">Avatar color</p>
                <ColorBox colors={[form.avatarColor]} slots={1} onpick={(_, c) => (form.avatarColor = c)} />
              {/if}
            </section>
            <section class="look-block">
              <strong>Banner</strong>
              <p>A GIF, PNG, JPG, or WebP across the top of your profile.</p>
              <div class="look-banner">
                {#if form.bannerUrl}<Photo url={form.bannerUrl} fill />{/if}
              </div>
              <div class="look-actions">
                <label class="btn brand sm look-btn">Upload banner
                  <input type="file" accept="image/gif,image/png,image/jpeg,image/webp,.gif" onchange={(e) => upload(e.target.files[0], 'banner', e.target)} />
                </label>
                {#if form.bannerUrl}<button type="button" class="btn sm" onclick={() => clearPicture('banner')}>Remove</button>{/if}
              </div>
            </section>
          {:else}
            <div class="field"><label>Custom status</label><input bind:value={form.customStatus} maxlength="128" placeholder="What's going on?" /></div>
            <p class="label">Online status</p>
            <div class="actions">
              {#each [['online', 'Online'], ['idle', 'Idle'], ['dnd', 'Do not disturb'], ['offline', 'Invisible']] as [id, label]}
                <button class="btn sm" class:brand={form.status === id} onclick={() => (form.status = id)}>{label}</button>
              {/each}
            </div>
          {/if}
          {#if page !== 'look' && page !== 'notify'}
            <div style="height:16px"></div>
            <button class="btn brand" style="width:auto" onclick={save}>Save changes</button>
          {/if}
        </div>
        <div>
          <p class="label">Preview</p>
          <div class="preview-card">
            <div class="preview-banner">
              {#if form.bannerUrl}<Photo url={form.bannerUrl} fill />{/if}
            </div>
            {#if form.bio}<div class="bio-bubble"><span>{form.bio}</span></div>{/if}
            <div class="preview-av" style="background:{form.avatarColor}">
              {#if form.avatarUrl}<Photo url={form.avatarUrl} />{:else}{(form.displayName || form.username || '?').charAt(0).toUpperCase()}{/if}
            </div>
            <div class="pad">
              <strong><Name user={{ displayName: form.displayName || form.username, username: form.username, nameEffect: form.nameEffect, nameColors: form.nameColors }} /></strong>
              <div class="handle">
                <span>@{form.username}{form.pronouns ? ' · ' + form.pronouns : ''}</span>
                {#if hasMoonBadge(ui.me)}<MoonBadge />{/if}
              </div>
            </div>
          </div>
        </div>
        {#if page === 'look'}
          <div>
            <p class="label">Name effect</p>
            <div class="effect-picks">
              {#each effects as [id, label]}
                <button type="button" class="effect-pick" class:on={form.nameEffect === id} onclick={() => (form.nameEffect = id)}>
                  <Name user={{ displayName: form.displayName || form.username || 'Name', nameEffect: id, nameColors: form.nameColors }} />
                  <span>{label}</span>
                </button>
              {/each}
            </div>
            <div style="height:16px"></div>
            <button class="btn brand" style="width:auto" onclick={save}>Save changes</button>
          </div>
          <ColorBox colors={form.nameColors} slots={form.nameEffect === 'plain' ? 1 : 2} onpick={setNameColor} />
        {/if}
      </div>
    </div>
  </div>
</div>
