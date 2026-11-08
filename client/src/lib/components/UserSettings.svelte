<script>
  import { X } from '@lucide/svelte';
  import { ui, saveMe, logout, toast, playPing } from '../state.svelte.js';
  import Name from './Name.svelte';
  import ColorBox from './ColorBox.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import TagPill from './TagPill.svelte';
  import { ownedBadges, shortBio } from '../format.js';
  import { api, pinMedia } from '../api.js';
  import { fileToDataUrl, shrinkGif } from '../image.js';

  let sound = $state(localStorage.getItem('nebula-sound') !== 'off');

  function toggleSound() {
    sound = !sound;
    localStorage.setItem('nebula-sound', sound ? 'on' : 'off');
    if (sound) playPing();
  }

  const titles = { profile: 'Profile', look: 'Appearance', notify: 'Notifications', privacy: 'Privacy' };

  async function toggleLastSeen() {
    const hideLastSeen = !ui.me?.hideLastSeen;
    try {
      const data = await api('/api/me', { method: 'PATCH', body: { hideLastSeen } });
      ui.me = { ...ui.me, ...data.user, hideLastSeen };
      toast(hideLastSeen ? 'Last seen hidden' : 'Last seen shown');
    } catch (err) {
      toast(err.message);
    }
  }
  const page = $derived(ui.userPage || 'profile');
  let form = $state({
    username: ui.me?.username || '',
    displayName: ui.me?.displayName || '',
    pronouns: ui.me?.pronouns || '',
    bio: shortBio(ui.me?.bio),
    shownBadges: Array.isArray(ui.me?.shownBadges) ? [...ui.me.shownBadges] : null,
    showcaseServerId: ui.me?.showcaseServerId || '',
    showcaseBadge: ui.me?.showcaseBadge || '',
    customStatus: ui.me?.customStatus || '',
    status: ui.me?.status || 'online',
    avatarColor: ui.me?.avatarColor || '#7c6af7',
    accentColor: ui.me?.accentColor || '#7c6af7',
    avatarUrl: ui.me?.avatarUrl || '',
    bannerUrl: ui.me?.bannerUrl || '',
    nameEffect: ui.me?.nameEffect || '',
    nameColors: Array.isArray(ui.me?.nameColors) && ui.me.nameColors.length ? [...ui.me.nameColors] : ['#5ce1ff', '#7c6af7'],
    profileColors: Array.isArray(ui.me?.profileColors) && ui.me.profileColors.length >= 2 ? [...ui.me.profileColors] : ['#7c3aed', '#c084fc'],
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

  let aboutDraft = $state(ui.me?.aboutMe || '');
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

  const badgeNames = { early: 'Early Supporter', staff: 'Nebula staff', developer: 'Developer' };

  function badgeOn(id) {
    if (!Array.isArray(form.shownBadges)) return ownedBadges(ui.me).includes(id);
    return form.shownBadges.includes(id);
  }

  function toggleBadge(id) {
    const current = Array.isArray(form.shownBadges) ? [...form.shownBadges] : ownedBadges(ui.me);
    form.shownBadges = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  }

  const showcaseChoice = $derived((ui.me?.tagChoices || []).find((choice) => choice.serverId === form.showcaseServerId) || null);

  function setNameColor(index, value) {
    const next = [...(form.nameColors || ['#5ce1ff', '#7c6af7'])];
    next[index] = value;
    form.nameColors = next;
  }

  function setProfileColor(index, value) {
    const next = [...(form.profileColors || ['#7c3aed', '#c084fc'])];
    next[index] = value;
    form.profileColors = next;
  }

  async function save() {
    try {
      await Promise.all([inflight.avatarUrl, inflight.bannerUrl].filter(Boolean));
      const body = { ...form, bio: shortBio(form.bio), aboutMe: aboutDraft };
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
      <button class:on={page === 'profile'} onclick={() => (ui.userPage = 'profile')}>Profile</button>
      <button class:on={page === 'look'} onclick={() => (ui.userPage = 'look')}>Appearance</button>
      <button class:on={page === 'notify'} onclick={() => (ui.userPage = 'notify')}>Notifications</button>
      <button class:on={page === 'privacy'} onclick={() => (ui.userPage = 'privacy')}>Privacy</button>
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
          {:else if page === 'notify'}
            <div class="field">
              <label>Notification sound</label>
              <button type="button" class="btn" class:brand={sound} onclick={toggleSound}>{sound ? 'On' : 'Off'}</button>
              <p class="hint">Plays a sound for every new message and every mention, including while this tab is in the background.</p>
            </div>
          {:else if page === 'privacy'}
            <div class="field">
              <label>Last seen</label>
              <button type="button" class="btn" class:brand={!ui.me?.hideLastSeen} onclick={toggleLastSeen}>{ui.me?.hideLastSeen ? 'Hidden' : 'Shown'}</button>
              <p class="hint">Turn this off to hide the last seen time on your profile. People still see when you are online, idle, or offline.</p>
            </div>
          {:else if page === 'look'}
            <p class="label">Profile color</p>
            <p class="hint">Two separate shades. The first is the main color. The second is the other tone on your profile card.</p>
            <div class="shade-preview" style="background: linear-gradient(90deg, {form.profileColors[0]}, {form.profileColors[1]})"></div>
            <ColorBox colors={form.profileColors} slots={2} onpick={setProfileColor} />
            <div style="height:16px"></div>
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
            <div class="field">
              <label>Bio</label>
              <textarea bind:value={form.bio} maxlength="29" rows="2" placeholder="Shows in the bubble beside your picture"></textarea>
            </div>
            <div class="field">
              <label>About me</label>
              <textarea bind:value={aboutDraft} maxlength="190" rows="4" placeholder="Shows under your name"></textarea>
            </div>
            <button class="btn brand" style="width:auto" onclick={async () => { try { await saveMe({ aboutMe: aboutDraft }); } catch (err) { toast(err.message); } }}>Save about me</button>
            <p class="label">Badge</p>
            {#if ownedBadges(ui.me).length}
              <div class="pick-row">
                {#each ownedBadges(ui.me) as id}
                  <button type="button" class="pick-card" class:on={badgeOn(id)} onclick={() => toggleBadge(id)}>
                    {#if id === 'early'}<MoonBadge />{:else if id === 'staff'}<StaffBadge rank={ui.me?.staff || ''} />{:else}<DevBadge on={true} />{/if}
                    <span>{badgeNames[id]}</span>
                  </button>
                {/each}
              </div>
              <p class="hint">Turn a badge on or off. Only the ones you leave on show on your profile.</p>
            {:else}
              <p class="hint">You do not have a badge yet.</p>
            {/if}
            <p class="label">Showcase badge</p>
            <div class="pick-row">
              <button type="button" class="pick-card" class:on={!form.showcaseBadge} onclick={() => (form.showcaseBadge = '')}>None</button>
              {#each ownedBadges(ui.me) as id}
                <button type="button" class="pick-card" class:on={form.showcaseBadge === id} onclick={() => (form.showcaseBadge = id)}>
                  {#if id === 'early'}<MoonBadge />{:else if id === 'staff'}<StaffBadge rank={ui.me?.staff || ''} />{:else}<DevBadge on={true} />{/if}
                  <span>{badgeNames[id]}</span>
                </button>
              {/each}
            </div>
            <p class="hint">This badge sits right next to your name in the member list and in chat.</p>
            <p class="label">Showcase role</p>
            <div class="pick-row">
              <button type="button" class="pick-card" class:on={!form.showcaseServerId} onclick={() => (form.showcaseServerId = '')}>None</button>
              {#each ui.me?.tagChoices || [] as choice}
                <button type="button" class="pick-card" class:on={form.showcaseServerId === choice.serverId} onclick={() => (form.showcaseServerId = choice.serverId)}>
                  <TagPill tag={choice} />
                  <span>{choice.name}</span>
                </button>
              {/each}
            </div>
            <p class="hint">The tag you pick shows next to your name in the member list and in chat.</p>
            <div style="height:16px"></div>
            <button class="btn brand" style="width:auto" onclick={save}>Save changes</button>
          {/if}
          {#if page !== 'look' && page !== 'notify' && page !== 'privacy'}
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
            {#if shortBio(form.bio)}<div class="bio-bubble"><span>{shortBio(form.bio)}</span></div>{/if}
            <div class="preview-av" style="background:{form.avatarColor}">
              {#if form.avatarUrl}<Photo url={form.avatarUrl} />{:else}{(form.displayName || form.username || '?').charAt(0).toUpperCase()}{/if}
            </div>
            <div class="pad">
              <strong><Name user={{ displayName: form.displayName || form.username, username: form.username, nameEffect: form.nameEffect, nameColors: form.nameColors }} /></strong>
              <div class="handle">
                <span>@{form.username}{form.pronouns ? ' · ' + form.pronouns : ''}</span>
                {#if badgeOn('early')}<MoonBadge />{/if}
                {#if badgeOn('staff')}<StaffBadge rank={ui.me?.staff || ''} />{/if}
                {#if badgeOn('developer')}<DevBadge on={true} />{/if}
                <TagPill tag={showcaseChoice} />
              </div>
              {#if aboutDraft}<p class="about-copy">{aboutDraft}</p>{/if}
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
