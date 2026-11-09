<script>
  import { ChevronLeft, X, User, AtSign, Tags, Smile, Clock, Circle, Palette, Bell, Lock, Shield, Eye, EyeOff } from '@lucide/svelte';
  import { ui, saveMe, logout, toast, playPing } from '../state.svelte.js';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import ColorBox from './ColorBox.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import TagPill from './TagPill.svelte';
  import SongButton from './SongButton.svelte';
  import { parseSong, parseStamp, formatStamp } from '../song.svelte.js';
  import { ownedBadges, shortBio } from '../format.js';
  import { api, pinMedia } from '../api.js';
  import { fileToDataUrl, shrinkGif } from '../image.js';

  let sound = $state(localStorage.getItem('nebula-sound') !== 'off');

  function toggleSound() {
    sound = !sound;
    localStorage.setItem('nebula-sound', sound ? 'on' : 'off');
    if (sound) playPing();
  }

  const titles = { profile: 'Profile', look: 'Appearance', notify: 'Notifications', privacy: 'Privacy', account: 'Account' };
  let showEmail = $state(false);
  let accountDialog = $state('');
  let accountBusy = $state(false);
  let showPw = $state(false);
  let draftUser = $state('');
  let draftEmail = $state('');
  let emailPassword = $state('');
  let currentPassword = $state('');
  let nextPassword = $state('');
  let confirmPassword = $state('');
  let lookOpen = $state('');

  function maskEmail(email) {
    const [name, host] = String(email || '').split('@');
    if (!host) return 'Add an email';
    return `${'•'.repeat(Math.min(8, Math.max(4, name.length)))}@${host}`;
  }

  function openAccount(kind) {
    accountDialog = kind;
    draftUser = ui.me?.username || '';
    draftEmail = ui.me?.email || '';
    emailPassword = '';
    currentPassword = '';
    nextPassword = '';
    confirmPassword = '';
    showPw = false;
  }

  async function saveUsername() {
    const username = draftUser.trim();
    if (!username) return toast('Username required');
    accountBusy = true;
    try {
      await saveMe({ username });
      form.username = ui.me?.username || username;
      accountDialog = '';
      toast('Username updated');
    } catch (err) {
      toast(err.message);
    } finally {
      accountBusy = false;
    }
  }

  async function saveEmail() {
    accountBusy = true;
    try {
      const data = await api('/api/me/email', { method: 'POST', body: { email: draftEmail, password: emailPassword } });
      ui.me = { ...ui.me, ...data.user };
      accountDialog = '';
      showEmail = true;
      toast('Email updated');
    } catch (err) {
      toast(err.message);
    } finally {
      accountBusy = false;
    }
  }

  async function savePassword() {
    accountBusy = true;
    try {
      await api('/api/me/password', { method: 'POST', body: { current: currentPassword, next: nextPassword, confirm: confirmPassword } });
      accountDialog = '';
      toast('Password updated');
    } catch (err) {
      toast(err.message);
    } finally {
      accountBusy = false;
    }
  }

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
  $effect(() => {
    if (page !== 'look') lookOpen = '';
  });
  let form = $state({
    username: ui.me?.username || '',
    aliases: Array.isArray(ui.me?.aliases) ? [...ui.me.aliases] : [],
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
    nameFont: ['serif', 'mono', 'round', 'script', 'display'].includes(ui.me?.nameFont) ? ui.me.nameFont : '',
    profileStyle: ['solid', 'glow', 'rainbow'].includes(ui.me?.profileStyle) ? ui.me.profileStyle : 'gradient',
    nameColors: Array.isArray(ui.me?.nameColors) && ui.me.nameColors.length ? [...ui.me.nameColors] : ['#5ce1ff', '#7c6af7'],
    profileColors: Array.isArray(ui.me?.profileColors) && ui.me.profileColors.length >= 2 ? [...ui.me.profileColors] : ['#7c3aed', '#c084fc'],
    songUrl: ui.me?.songUrl || '',
    songStart: ui.me?.songStart ? formatStamp(ui.me.songStart) : '',
    songAutoplay: !!ui.me?.songAutoplay,
  });

  const profileStyles = [
    ['solid', 'Solid'],
    ['gradient', 'Gradient'],
    ['glow', 'Glow'],
    ['rainbow', 'Rainbow'],
  ];
  const fonts = [
    ['', 'Default', 'Outfit, sans-serif'],
    ['serif', 'Serif', 'Fraunces, Georgia, serif'],
    ['mono', 'Mono', '"JetBrains Mono", ui-monospace, monospace'],
    ['round', 'Round', 'Nunito, sans-serif'],
    ['script', 'Script', 'Caveat, cursive'],
    ['display', 'Display', 'Bungee, sans-serif'],
  ];
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
  const statusName = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Invisible' };
  const statusColor = { online: '#3ecf8e', idle: '#f0b429', dnd: '#f06a6a', offline: '#8b8e98' };

  function lastSeenLabel(value) {
    const t = Number(value);
    if (!t) return '';
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return '';
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return 'Today at ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + time;
  }

  function joinedLabel(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }
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
      if (isGif && kind !== 'banner') {
        body = await shrinkGif(file, { max: 160, frames: 12, colors: 32 });
      } else if (!isGif && file.size > 600 * 1024) {
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
  const aliasNames = $derived(form.aliases.map((name) => String(name || '').trim()).filter(Boolean));
  const aliasLabel = $derived(aliasNames.length ? (aliasNames.length === 1 ? '@' + aliasNames[0] : aliasNames.length + ' aliases') : 'Add');
  const bioLabel = $derived(shortBio(form.bio) || 'Add');
  const aboutLabel = $derived(String(aboutDraft || '').trim() ? 'Added' : 'Add');
  const styleName = $derived(profileStyles.find((row) => row[0] === form.profileStyle)?.[1] || 'Gradient');
  const fontName = $derived(fonts.find((row) => row[0] === form.nameFont)?.[1] || 'Default');
  const effectName = $derived(effects.find((row) => row[0] === form.nameEffect)?.[1] || 'None');
  const shownCount = $derived(ownedBadges(ui.me).filter((id) => badgeOn(id)).length);
  const badgeLabel = $derived(ownedBadges(ui.me).length ? (shownCount ? shownCount + ' on' : 'Off') : 'None');
  const showcaseLabel = $derived(form.showcaseBadge ? badgeNames[form.showcaseBadge] : 'None');
  const roleLabel = $derived(showcaseChoice?.name || 'None');
  const songLabel = $derived(String(form.songUrl || '').trim() ? (form.songAutoplay ? 'Plays on open' : 'Saved') : 'Add');
  const previewRoles = $derived(ui.mode === 'chat' ? (ui.members.find((m) => m.id === ui.me?.id)?.roles || []).filter((r) => r && r.id !== 'everyone' && r.id !== 'owner').slice().sort((a, b) => (b.position || 0) - (a.position || 0)) : []);

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

  function addAlias() {
    if (form.aliases.length >= 10) return;
    form.aliases = [...form.aliases, ''];
  }

  function setAlias(index, value) {
    form.aliases = form.aliases.map((item, i) => i === index ? value : item);
  }

  function removeAlias(index) {
    form.aliases = form.aliases.filter((_, i) => i !== index);
  }

  async function save() {
    try {
      await Promise.all([inflight.avatarUrl, inflight.bannerUrl].filter(Boolean));
      const songUrl = String(form.songUrl || '').trim();
      if (songUrl && !parseSong(songUrl)) {
        toast('Use a YouTube link');
        return;
      }
      const body = { ...form, bio: shortBio(form.bio), aboutMe: aboutDraft, songUrl, songStart: parseStamp(form.songStart) };
      for (const field of ['avatarUrl', 'bannerUrl']) {
        if (String(body[field] || '').startsWith('blob:')) body[field] = savedUrl[field] || '';
      }
      await saveMe(body);
      form.aliases = Array.isArray(ui.me?.aliases) ? [...ui.me.aliases] : [];
    } catch (err) { toast(err.message); }
  }
</script>

<div class="overlay" role="presentation" onclick={() => (ui.userSettings = false)}>
  <div class="settings" role="dialog" onclick={(e) => e.stopPropagation()}>
    <aside class="set-nav">
      <div class="set-user">
        <Avatar user={ui.me} size={36} />
        <div>
          <strong>{ui.me?.displayName || ui.me?.username}</strong>
          <span>@{ui.me?.username}</span>
        </div>
      </div>
      <div class="group">User settings</div>
      <button class:on={page === 'profile'} onclick={() => (ui.userPage = 'profile')}><User size={16} /> Profile</button>
      <button class:on={page === 'look'} onclick={() => (ui.userPage = 'look')}><Palette size={16} /> Appearance</button>
      <button class:on={page === 'notify'} onclick={() => (ui.userPage = 'notify')}><Bell size={16} /> Notifications</button>
      <button class:on={page === 'privacy'} onclick={() => (ui.userPage = 'privacy')}><Lock size={16} /> Privacy</button>
      <div class="group">Account</div>
      <button class:on={page === 'account'} onclick={() => (ui.userPage = 'account')}><Shield size={16} /> Account</button>
      <button class="danger set-logout" onclick={logout}>Log out</button>
    </aside>
    <div class="set-main">
      <div class="set-head">
        <div>
          <h2>{titles[page] || 'Settings'}</h2>
        </div>
        <button class="btn icon" onclick={() => (ui.userSettings = false)}><X size={18} /></button>
      </div>
      {#if page === 'account'}
        <section class="acct-section">
          <h3>Account Info</h3>
          <div class="acct-row">
            <span>Username</span>
            <strong>{ui.me?.username}</strong>
            <button type="button" class="btn sm" onclick={() => openAccount('username')}>Edit</button>
          </div>
          <div class="acct-row">
            <span>Email</span>
            <strong>{showEmail ? (ui.me?.email || '—') : maskEmail(ui.me?.email)}</strong>
            <button type="button" class="btn ghost sm" onclick={() => (showEmail = !showEmail)}>{showEmail ? 'Hide' : 'Reveal'}</button>
            <button type="button" class="btn sm" onclick={() => openAccount('email')}>Edit</button>
          </div>
        </section>
        <div class="acct-rule"></div>
        <section class="acct-section">
          <h3>Password</h3>
          <div class="acct-row">
            <span>Password</span>
            <strong>••••••••</strong>
            <button type="button" class="btn sm" onclick={() => openAccount('password')}>Edit</button>
          </div>
        </section>
      {:else}
      <div class="grid-2" class:look-grid={page === 'look'}>
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
            {#if !lookOpen}
              <div class="look-home">
              <section class="acct-section">
                <h3>Profile</h3>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'aliases')}><span>Aliases</span><strong>{aliasLabel}</strong></button>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'bio')}><span>Bio</span><strong>{bioLabel}</strong></button>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'about')}><span>About me</span><strong>{aboutLabel}</strong></button>
              </section>
              <div class="acct-rule"></div>
              <section class="acct-section">
                <h3>Pictures</h3>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'avatar')}><span>Avatar</span><strong>{form.avatarUrl ? 'Photo' : 'Color'}</strong></button>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'banner')}><span>Banner</span><strong>{form.bannerUrl ? 'Set' : 'None'}</strong></button>
              </section>
              <div class="acct-rule"></div>
              <section class="acct-section">
                <h3>Theme</h3>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'color')}>
                  <span>Profile color</span>
                  <strong><i class="look-dot" style="background:{form.profileColors[0]}"></i>{styleName}</strong>
                </button>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'name')}>
                  <span>Display name</span>
                  <strong>{fontName} · {effectName}</strong>
                </button>
              </section>
              <div class="acct-rule"></div>
              <section class="acct-section">
                <h3>Song</h3>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'song')}><span>Profile song</span><strong>{songLabel}</strong></button>
              </section>
              <div class="acct-rule"></div>
              <section class="acct-section">
                <h3>Badges</h3>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'badges')}><span>On your profile</span><strong>{badgeLabel}</strong></button>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'showcase')}><span>Next to your name</span><strong>{showcaseLabel}</strong></button>
                <button type="button" class="acct-link" onclick={() => (lookOpen = 'role')}><span>Server tag</span><strong>{roleLabel}</strong></button>
              </section>
              <button class="btn brand sec-btn save-look" onclick={save}>Save changes</button>
              </div>
            {:else}
              <button type="button" class="crumb" onclick={() => (lookOpen = '')}><ChevronLeft size={16} /> Appearance</button>
              {#if lookOpen === 'aliases'}
                <section class="look-card look-editor">
                  <h3>Aliases</h3>
                  <p class="hint">Shown on your profile. You can add 10. These are not usernames.</p>
                  <div class="alias-edit">
                    {#each form.aliases as alias, i}
                      <div class="alias-line">
                        <input value={alias} maxlength="32" placeholder="apple" oninput={(e) => setAlias(i, e.target.value)} />
                        <button type="button" class="btn sm" onclick={() => removeAlias(i)}>Remove</button>
                      </div>
                    {/each}
                  </div>
                  {#if form.aliases.length < 10}
                    <button type="button" class="btn sm" onclick={addAlias}>Add alias</button>
                  {/if}
                </section>
              {:else if lookOpen === 'bio'}
                <section class="look-card look-editor">
                  <h3>Bio</h3>
                  <p class="hint">The short line in the bubble beside your picture.</p>
                  <textarea bind:value={form.bio} maxlength="29" rows="2" placeholder="A short line"></textarea>
                </section>
              {:else if lookOpen === 'about'}
                <section class="look-card look-editor">
                  <h3>About me</h3>
                  <p class="hint">Shown under your name on your profile.</p>
                  <textarea bind:value={aboutDraft} maxlength="190" rows="4" placeholder="Say a little about yourself"></textarea>
                </section>
              {:else if lookOpen === 'avatar'}
                <section class="look-card look-editor">
                  <h3>Avatar</h3>
                  <p class="hint">PNG, JPG, GIF, or WebP. With no photo, the color shows instead.</p>
                  <div class="look-row">
                    <div class="look-av" style="background:{form.avatarColor}">
                      {#if form.avatarUrl}<Photo url={form.avatarUrl} />{:else}{(form.displayName || form.username || '?').charAt(0).toUpperCase()}{/if}
                    </div>
                    <div class="look-actions">
                      <label class="btn brand sm look-btn">Change avatar
                        <input type="file" accept="image/*" onchange={(e) => upload(e.target.files[0], 'avatar', e.target)} />
                      </label>
                      {#if form.avatarUrl}<button type="button" class="btn sm" onclick={() => clearPicture('avatar')}>Remove</button>{/if}
                    </div>
                  </div>
                  {#if !form.avatarUrl}
                    <p class="look-kicker">Fallback color</p>
                    <ColorBox colors={[form.avatarColor]} slots={1} onpick={(_, c) => (form.avatarColor = c)} />
                  {/if}
                </section>
              {:else if lookOpen === 'banner'}
                <section class="look-card look-editor">
                  <h3>Banner</h3>
                  <p class="hint">A GIF, PNG, JPG, or WebP across the top of your profile.</p>
                  <div class="look-banner">
                    {#if form.bannerUrl}<Photo url={form.bannerUrl} fill />{:else}<span class="banner-empty">No banner yet</span>{/if}
                  </div>
                  <div class="look-actions">
                    <label class="btn brand sm look-btn">Change banner
                      <input type="file" accept="image/gif,image/png,image/jpeg,image/webp,.gif" onchange={(e) => upload(e.target.files[0], 'banner', e.target)} />
                    </label>
                    {#if form.bannerUrl}<button type="button" class="btn sm" onclick={() => clearPicture('banner')}>Remove</button>{/if}
                  </div>
                </section>
              {:else if lookOpen === 'color'}
                <section class="look-card look-editor">
                  <h3>Profile color</h3>
                  <p class="hint">The background of your profile card.</p>
                  <div class="style-seg">
                    {#each profileStyles as [id, label]}
                      <button type="button" class:on={form.profileStyle === id} onclick={() => (form.profileStyle = id)}>{label}</button>
                    {/each}
                  </div>
                  <p class="look-kicker">Colors</p>
                  <ColorBox colors={form.profileColors} slots={form.profileStyle === 'solid' ? 1 : 2} onpick={setProfileColor} />
                </section>
              {:else if lookOpen === 'name'}
                <section class="look-card look-editor">
                  <h3>Display name</h3>
                  <p class="hint">Font, effect, and colors used on your name.</p>
                  <p class="look-kicker">Font</p>
                  <div class="effect-picks">
                    {#each fonts as [id, label, family]}
                      <button type="button" class="effect-pick" class:on={form.nameFont === id} onclick={() => (form.nameFont = id)}>
                        <strong style="font-family:{family}">{form.displayName || form.username || 'Name'}</strong>
                        <span>{label}</span>
                      </button>
                    {/each}
                  </div>
                  <p class="look-kicker">Effect</p>
                  <div class="effect-picks">
                    {#each effects as [id, label]}
                      <button type="button" class="effect-pick" class:on={form.nameEffect === id} onclick={() => (form.nameEffect = id)}>
                        <Name user={{ displayName: form.displayName || form.username || 'Name', nameEffect: id, nameFont: form.nameFont, nameColors: form.nameColors }} />
                        <span>{label}</span>
                      </button>
                    {/each}
                  </div>
                  <p class="look-kicker">Colors</p>
                  <ColorBox colors={form.nameColors} slots={form.nameEffect === 'plain' ? 1 : 2} onpick={setNameColor} />
                </section>
              {:else if lookOpen === 'song'}
                <section class="look-card look-editor">
                  <h3>Profile song</h3>
                  <p class="hint">The audio is saved on the server, then the profile plays that copy.</p>
                  <div class="field">
                    <label>YouTube link</label>
                    <input bind:value={form.songUrl} maxlength="300" placeholder="https://www.youtube.com/watch?v=" />
                  </div>
                  {#if ui.me?.songError}
                    <p class="hint" style="color:var(--danger)">{ui.me.songError}</p>
                  {:else if ui.me?.songUrl && !ui.me?.songFile}
                    <p class="hint">Saving the song onto the server…</p>
                  {/if}
                  <div class="field">
                    <label>Start at</label>
                    <input bind:value={form.songStart} maxlength="8" placeholder="0:00" />
                  </div>
                  <p class="hint">Where playback starts, like 1:30.</p>
                  <div class="acct-row">
                    <span>Autoplay</span>
                    <strong>{form.songAutoplay ? 'On' : 'Off'}</strong>
                    <button type="button" class="btn sm sec-btn" onclick={() => (form.songAutoplay = !form.songAutoplay)}>{form.songAutoplay ? 'Turn off' : 'Turn on'}</button>
                  </div>
                  <p class="hint">Starts the song when this profile is opened.</p>
                </section>
              {:else if lookOpen === 'badges'}
                <section class="look-card look-editor">
                  <h3>On your profile</h3>
                  <p class="hint">Turn a badge on or off. Only the ones you leave on show on your profile card.</p>
                  {#if ownedBadges(ui.me).length}
                    <div class="pick-row">
                      {#each ownedBadges(ui.me) as id}
                        <button type="button" class="pick-card" class:on={badgeOn(id)} onclick={() => toggleBadge(id)}>
                          {#if id === 'early'}<MoonBadge />{:else if id === 'staff'}<StaffBadge rank={ui.me?.staff || ''} />{:else}<DevBadge on={true} />{/if}
                          <span>{badgeNames[id]}</span>
                        </button>
                      {/each}
                    </div>
                  {:else}
                    <p class="hint">You do not have a badge yet.</p>
                  {/if}
                </section>
              {:else if lookOpen === 'showcase'}
                <section class="look-card look-editor">
                  <h3>Next to your name</h3>
                  <p class="hint">This badge sits beside your name in the member list and in chat.</p>
                  <div class="pick-row">
                    <button type="button" class="pick-card" class:on={!form.showcaseBadge} onclick={() => (form.showcaseBadge = '')}>None</button>
                    {#each ownedBadges(ui.me) as id}
                      <button type="button" class="pick-card" class:on={form.showcaseBadge === id} onclick={() => (form.showcaseBadge = id)}>
                        {#if id === 'early'}<MoonBadge />{:else if id === 'staff'}<StaffBadge rank={ui.me?.staff || ''} />{:else}<DevBadge on={true} />{/if}
                        <span>{badgeNames[id]}</span>
                      </button>
                    {/each}
                  </div>
                </section>
              {:else if lookOpen === 'role'}
                <section class="look-card look-editor">
                  <h3>Server tag</h3>
                  <p class="hint">The tag you pick shows next to your name in the member list and in chat.</p>
                  <div class="pick-row">
                    <button type="button" class="pick-card" class:on={!form.showcaseServerId} onclick={() => (form.showcaseServerId = '')}>None</button>
                    {#each ui.me?.tagChoices || [] as choice}
                      <button type="button" class="pick-card" class:on={form.showcaseServerId === choice.serverId} onclick={() => (form.showcaseServerId = choice.serverId)}>
                        <TagPill tag={choice} />
                        <span>{choice.name}</span>
                      </button>
                    {/each}
                  </div>
                  {#if !(ui.me?.tagChoices || []).length}
                    <p class="hint">None of your servers have a tag yet.</p>
                  {/if}
                </section>
              {/if}
              <button class="btn brand sec-btn save-look" onclick={save}>Save changes</button>
            {/if}
          {/if}
          {#if page !== 'look' && page !== 'notify' && page !== 'privacy'}
            <div style="height:16px"></div>
            <button class="btn brand" style="width:auto" onclick={save}>Save changes</button>
          {/if}
        </div>
        <div class="preview-sticky">
          <p class="label">Preview</p>
          <div class="preview-card profile-card skin-{form.profileStyle || 'gradient'}" style="--shade-a:{form.profileColors[0]};--shade-b:{form.profileColors[1]}">
            <div class="pop-banner" style="background:{form.accentColor || 'var(--brand)'}">
              {#if form.bannerUrl}<Photo url={form.bannerUrl} fill />{/if}
            </div>
            <div class="pop-body">
              <div class="profile-hero">
                <div class="profile-face">
                  <div class="song-av">
                    <div class="pop-av profile-av" style="background:{form.avatarColor}">
                      {#if form.avatarUrl}<Photo url={form.avatarUrl} />{:else}{(form.displayName || form.username || '?').charAt(0).toUpperCase()}{/if}
                    </div>
                    <SongButton file={ui.me?.songFile || ''} start={parseStamp(form.songStart)} />
                  </div>
                  <i class="profile-dot" style="background:{statusColor[form.status] || statusColor.offline}"></i>
                  {#if shortBio(form.bio)}<div class="bio-bubble"><span>{shortBio(form.bio)}</span></div>{/if}
                </div>
                <h3><Name user={{ displayName: form.displayName || form.username, username: form.username, nameEffect: form.nameEffect, nameFont: form.nameFont, nameColors: form.nameColors }} /></h3>
                <p class="handle">
                  <span>@{form.username}</span>
                  {#if badgeOn('early')}<MoonBadge />{/if}
                  {#if badgeOn('staff')}<StaffBadge rank={ui.me?.staff || ''} />{/if}
                  {#if badgeOn('developer')}<DevBadge on={true} />{/if}
                </p>
                {#if aboutDraft}<p class="profile-status">{aboutDraft}</p>{/if}
              </div>
              {#if previewRoles.length}
                <div class="pop-role-list profile-roles">
                  {#each previewRoles as r}
                    <em class="pop-role"><i style="background:{r.color || '#99aab5'}"></i>{r.name}</em>
                  {/each}
                </div>
              {/if}
              <section class="profile-panel">
                <div class="profile-row"><span><User size={14} /> Display name</span><strong>{form.displayName || form.username}</strong></div>
                <div class="profile-row"><span><AtSign size={14} /> Username</span><strong>@{form.username}</strong></div>
                {#if form.aliases.some((name) => String(name || '').trim())}
                  <div class="profile-row alias-row">
                    <span><Tags size={14} /> Aliases</span>
                    <strong class="alias-names">@{form.aliases.filter((name) => String(name || '').trim()).join(', @')}</strong>
                  </div>
                {/if}
                <div class="profile-row"><span><Smile size={14} /> Pronouns</span><strong>{form.pronouns || '—'}</strong></div>
              </section>
              <section class="profile-panel">
                <div class="profile-row"><span><Clock size={14} /> Last seen</span><strong>{ui.me?.lastSeen ? lastSeenLabel(ui.me.lastSeen) : (ui.me?.hideLastSeen ? 'Hidden' : '—')}</strong></div>
                <div class="profile-row"><span><Circle size={14} /> Online status</span><strong><i style="background:{statusColor[form.status] || statusColor.offline}"></i>{statusName[form.status] || 'Offline'}</strong></div>
              </section>
              <div class="pop-meta">
                <div>
                  <span>Member since</span>
                  <strong>{joinedLabel(ui.me?.createdAt)}</strong>
                </div>
                <div>
                  <span>User id</span>
                  <strong>{ui.me?.uid != null ? `#${ui.me.uid}` : '—'}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/if}
    </div>
  </div>
  {#if accountDialog}
    <div class="poll-overlay" role="presentation" onclick={() => (accountDialog = '')}>
      <div class="poll-sheet acct-dialog" role="dialog" onclick={(e) => e.stopPropagation()}>
        <div class="row">
          <h3>{accountDialog === 'username' ? 'Update your username' : accountDialog === 'email' ? 'Update your email' : 'Update your password'}</h3>
          <button type="button" class="btn icon" onclick={() => (accountDialog = '')}><X size={16} /></button>
        </div>
        {#if accountDialog === 'username'}
          <p class="hint">This is the name people use to find you.</p>
          <div class="field"><label>Username</label><input bind:value={draftUser} maxlength="32" /></div>
          <div class="modify-actions">
            <button type="button" class="btn" onclick={() => (accountDialog = '')}>Cancel</button>
            <button type="button" class="btn brand" disabled={accountBusy} onclick={saveUsername}>Done</button>
          </div>
        {:else if accountDialog === 'email'}
          <p class="hint">Enter your password to confirm this change.</p>
          <div class="field"><label>Email</label><input bind:value={draftEmail} maxlength="120" /></div>
          <div class="field"><label>Password</label><input type={showPw ? 'text' : 'password'} bind:value={emailPassword} /></div>
          <div class="modify-actions">
            <button type="button" class="btn" onclick={() => (accountDialog = '')}>Cancel</button>
            <button type="button" class="btn brand" disabled={accountBusy} onclick={saveEmail}>Done</button>
          </div>
        {:else}
          <p class="hint">Enter your current password and a new password.</p>
          <div class="field">
            <label>Current password</label>
            <input type={showPw ? 'text' : 'password'} bind:value={currentPassword} />
          </div>
          <div class="field">
            <label>New password</label>
            <input type={showPw ? 'text' : 'password'} bind:value={nextPassword} />
          </div>
          <div class="field">
            <label>Confirm new password</label>
            <input type={showPw ? 'text' : 'password'} bind:value={confirmPassword} />
          </div>
          <button type="button" class="btn ghost sm" onclick={() => (showPw = !showPw)}>
            {#if showPw}<EyeOff size={14} /> Hide{:else}<Eye size={14} /> Show{/if}
          </button>
          <div class="modify-actions">
            <button type="button" class="btn" onclick={() => (accountDialog = '')}>Cancel</button>
            <button type="button" class="btn brand" disabled={accountBusy} onclick={savePassword}>Done</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
