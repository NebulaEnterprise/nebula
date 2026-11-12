<script>
  import { ChevronLeft, ChevronRight, X, Check, User, AtSign, Tags, Smile, Clock, Circle, Palette, Bell, Lock, Shield, Eye, EyeOff, Image, Music, Moon, Sun, Sparkles, Droplet, Monitor, Award, Code, Flag } from '@lucide/svelte';
  import { ui, nowClock, saveMe, logout, toast, playPing, developerMode, setDeveloperMode, staffReport } from '../state.svelte.js';
  import { profileSeen } from '../seen.js';
  import Avatar from './Avatar.svelte';
  import Name from './Name.svelte';
  import ColorBox from './ColorBox.svelte';
  import ColorWheel from './ColorWheel.svelte';
  import Photo from './Photo.svelte';
  import MoonBadge from './MoonBadge.svelte';
  import StaffBadge from './StaffBadge.svelte';
  import DevBadge from './DevBadge.svelte';
  import TagPill from './TagPill.svelte';
  import SongButton from './SongButton.svelte';
  import { parseSong, parseStamp, formatStamp } from '../song.svelte.js';
  import { ownedBadges, shortBio } from '../format.js';
  import { api, pinMedia } from '../api.js';
  import Security from './Security.svelte';
  import Select from './Select.svelte';
  import { fileToDataUrl, shrinkGif } from '../image.js';

  let sound = $state(localStorage.getItem('nebula-sound') !== 'off');

  function toggleSound() {
    sound = !sound;
    localStorage.setItem('nebula-sound', sound ? 'on' : 'off');
    if (sound) playPing();
  }

  const titles = { profile: 'Profile', look: 'Appearance', notify: 'Notifications', privacy: 'Privacy', account: 'Account', advanced: 'Advanced', admin: 'Admin' };
  const reasonLabel = { harassment: 'Harassment or bullying', hate: 'Hate speech or slurs', sexual: 'Sexual content', child: 'Child safety', threats: 'Threats or violence', 'self-harm': 'Self-harm or suicide', spam: 'Spam or scams', illegal: 'Something illegal', other: 'Something else' };
  let devOn = $state(developerMode());
  let viewing = $state(null);
  let accountDialog = $state('');
  let accountBusy = $state(false);
  let showPw = $state(false);
  let draftUser = $state('');
  let nameStatus = $state('');
  let nameClean = $state('');
  let draftEmail = $state('');
  let emailPassword = $state('');
  let currentPassword = $state('');
  let nextPassword = $state('');
  let confirmPassword = $state('');
  let securityOpen = $state(false);
  let lookOpen = $state('');
  let accentSlot = $state(0);
  let nameSlot = $state(0);

  function cleanName(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 32);
  }

  const nameMessage = $derived(
    nameStatus === 'available' ? (nameClean && nameClean !== draftUser.trim().toLowerCase() ? `That username is available as ${nameClean}.` : 'That username is available.')
    : nameStatus === 'taken' ? 'That username is taken.'
    : nameStatus === 'yours' ? 'This is your current username.'
    : nameStatus === 'checking' ? 'Checking that username…'
    : nameStatus === 'invalid' ? 'Use letters, numbers, dots, or underscores.'
    : ''
  );
  const nameReady = $derived(nameStatus === 'available' || nameStatus === 'yours');

  function openAccount(kind) {
    accountDialog = kind;
    draftUser = ui.me?.username || '';
    nameClean = cleanName(draftUser);
    nameStatus = nameClean ? 'yours' : 'invalid';
    draftEmail = ui.me?.email || '';
    emailPassword = '';
    currentPassword = '';
    nextPassword = '';
    confirmPassword = '';
    showPw = false;
  }

  async function saveUsername() {
    const username = cleanName(draftUser);
    if (!username) return toast('Username required');
    if (nameStatus === 'taken') return toast('That username is taken');
    if (nameStatus === 'checking') return;
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
      toast('Sign-in email updated');
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

  const messageOptions = [
    { value: 'everyone', label: 'Everyone' },
    { value: 'servers', label: 'People in my servers and friends' },
    { value: 'friends', label: 'Friends' },
  ];
  const groupOptions = [
    { value: 'everyone', label: 'Everyone' },
    { value: 'mutual', label: 'Friends of friends' },
    { value: 'friends', label: 'Friends' },
    { value: 'nobody', label: 'Nobody' },
  ];
  const callOptions = [
    { value: 'everyone', label: 'Everyone' },
    { value: 'servers', label: 'People in my servers and friends' },
    { value: 'friends', label: 'Friends' },
    { value: 'nobody', label: 'Nobody' },
  ];
  const shareOptions = callOptions;

  async function setPrivacy(body, ok) {
    try {
      const data = await api('/api/me', { method: 'PATCH', body });
      ui.me = { ...ui.me, ...(data.user || {}), ...body };
      if (ok) toast(ok);
    } catch (err) {
      toast(err.message);
    }
  }
  const page = $derived(ui.userPage || 'profile');
  $effect(() => {
    if (page !== 'account') securityOpen = false;
    if (page !== 'look') lookOpen = '';
    if (page === 'admin' && ui.me?.canAdmin) {
      api('/api/staff/reports').then((data) => { ui.staffReports = data.reports || []; }).catch(() => {});
    }
  });
  $effect(() => {
    if (accountDialog !== 'username') return;
    const typed = draftUser;
    const clean = cleanName(typed);
    nameClean = clean;
    if (!clean) {
      nameStatus = 'invalid';
      return;
    }
    if (clean === (ui.me?.username || '')) {
      nameStatus = 'yours';
      return;
    }
    nameStatus = 'checking';
    let cancel = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api('/api/username-available?name=' + encodeURIComponent(clean));
        if (cancel) return;
        nameClean = data.username || clean;
        nameStatus = data.reason || (data.available ? 'available' : 'taken');
      } catch {
        if (!cancel) nameStatus = 'invalid';
      }
    }, 280);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
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

  function openPicture(kind) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'banner' ? 'image/gif,image/png,image/jpeg,image/webp,.gif' : 'image/*';
    input.style.cssText = 'position:fixed;left:-1000px;top:0;width:1px;height:1px;opacity:0';
    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      input.remove();
    };
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      close();
      if (file) upload(file, kind);
    });
    input.addEventListener('cancel', close);
    document.body.appendChild(input);
    input.click();
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
  const shownCount = $derived(ownedBadges(ui.me).filter((id) => badgeOn(id)).length);
  const badgeLabel = $derived(ownedBadges(ui.me).length ? (shownCount ? shownCount + ' on' : 'Off') : 'None');
  const showcaseLabel = $derived(form.showcaseBadge ? badgeNames[form.showcaseBadge] : 'None');
  const roleLabel = $derived(showcaseChoice?.name || 'None');
  const songLabel = $derived(String(form.songUrl || '').trim() ? (form.songAutoplay ? 'Plays on open' : 'Saved') : 'Add');
  function setNameColor(index, value) {
    const next = [...(form.nameColors || ['#5ce1ff', '#7c6af7'])];
    next[index] = value;
    form.nameColors = next;
  }

  const accentPresets = [
    '#c026d3', '#ec4899', '#3b82f6', '#22d3ee', '#22c55e', '#eab308', '#f97316', '#ef4444',
    '#d8b4fe', '#818cf8', '#67e8f9', '#86efac', '#2dd4bf', '#fbbf24', '#fb923c', '#fb7185',
  ];

  function sameHex(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  function setProfileColor(index, value) {
    const next = [...(form.profileColors || ['#7c3aed', '#c084fc'])];
    next[index] = value;
    form.profileColors = next;
    if (index === 0) form.accentColor = value;
  }

  function setAllBadges(on) {
    form.shownBadges = on ? [...ownedBadges(ui.me)] : [];
  }

  function togglePanel(id) {
    lookOpen = lookOpen === id ? '' : id;
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
      <button class:on={page === 'look'} onclick={() => { ui.userPage = 'look'; lookOpen = ''; }}><Palette size={16} /> Appearance</button>
      <button class:on={page === 'notify'} onclick={() => (ui.userPage = 'notify')}><Bell size={16} /> Notifications</button>
      <button class:on={page === 'privacy'} onclick={() => (ui.userPage = 'privacy')}><Lock size={16} /> Privacy</button>
      <button class:on={page === 'advanced'} onclick={() => (ui.userPage = 'advanced')}><Code size={16} /> Advanced</button>
      {#if ui.me?.canAdmin}
        <div class="group">Nebula staff</div>
        <button class:on={page === 'admin'} onclick={() => (ui.userPage = 'admin')}><Flag size={16} /> Admin</button>
      {/if}
      <div class="group">Account</div>
      <button class:on={page === 'account'} onclick={() => (ui.userPage = 'account')}><Shield size={16} /> Account</button>
      <button class="danger set-logout" onclick={logout}>Log out</button>
    </aside>
    <div class="set-main" class:look-main={page === 'look'}>
      <div class="set-head">
        {#if page === 'look' && lookOpen === 'badges'}
          <div class="look-intro">
            <button type="button" class="look-back" onclick={() => (lookOpen = '')} aria-label="Back to Appearance"><ChevronLeft size={18} /></button>
            <i class="look-mark"><Award size={18} /></i>
            <div>
              <h2>Badges</h2>
              <p>Choose what shows on your profile and next to your name.</p>
            </div>
          </div>
        {:else if page === 'look'}
          <div class="look-intro">
            <i class="look-mark"><Palette size={18} /></i>
            <div>
              <h2>Appearance</h2>
              <p>Customize how your profile and interface look.</p>
            </div>
          </div>
        {:else}
          <div>
            <h2>{titles[page] || 'Settings'}</h2>
          </div>
        {/if}
        <button class="btn icon" onclick={() => (ui.userSettings = false)}><X size={18} /></button>
      </div>
      {#if page === 'account'}
        {#if !securityOpen}
          <section class="acct-section">
            <h3>Account Info</h3>
            <div class="acct-row">
              <span>Username</span>
              <strong>{ui.me?.username}</strong>
              <button type="button" class="btn sm" onclick={() => openAccount('username')}>Edit</button>
            </div>
            <div class="acct-row">
              <span>Email</span>
              <strong>Not stored</strong>
              <button type="button" class="btn sm" onclick={() => openAccount('email')}>Edit</button>
            </div>
          </section>
          <div class="acct-rule"></div>
        {/if}
        <section class="acct-section">
          {#if !securityOpen}
            <h3>Password & Security</h3>
            <div class="acct-row">
              <span>Password</span>
              <strong>••••••••</strong>
              <button type="button" class="btn sm" onclick={() => openAccount('password')}>Edit</button>
            </div>
          {/if}
          <Security bind:open={securityOpen} />
        </section>
      {:else}
      <div class="grid-2" class:look-layout={page === 'look'}>
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
              <div class="row">
                <button type="button" class="btn" class:brand={(ui.me?.lastSeenPrivacy || (ui.me?.hideLastSeen ? 'nobody' : 'everyone')) === 'everyone'} onclick={() => setPrivacy({ lastSeenPrivacy: 'everyone' }, 'Last seen shown to everyone')}>Everyone</button>
                <button type="button" class="btn" class:brand={(ui.me?.lastSeenPrivacy || (ui.me?.hideLastSeen ? 'nobody' : 'everyone')) === 'nobody'} onclick={() => setPrivacy({ lastSeenPrivacy: 'nobody' }, 'Last seen hidden')}>Nobody</button>
              </div>
              <p class="hint">People you hide your last seen from only see “recently”, “within a week”, or “within a month”. You see the same kind of time for them. Sending, reading, or typing still shows you online for 30 seconds.</p>
            </div>
            <div class="field">
              <label>Who can message you</label>
              <div class="privacy-pick">
                <Select value={ui.me?.dmPrivacy || 'servers'} options={messageOptions} onpick={(value) => setPrivacy({ dmPrivacy: value }, 'Message privacy updated')} />
              </div>
              <p class="hint">Friends can always message you. Blocked people never can.</p>
            </div>
            <div class="field">
              <label>Who can add you to group chats</label>
              <div class="privacy-pick">
                <Select value={ui.me?.groupPrivacy || 'friends'} options={groupOptions} onpick={(value) => setPrivacy({ groupPrivacy: value }, 'Group privacy updated')} />
              </div>
              <p class="hint">With Nobody, no one can put you in a group chat, not even friends. You can still make your own.</p>
            </div>
            <div class="field">
              <label>Who can call you</label>
              <div class="privacy-pick">
                <Select value={ui.me?.callPrivacy || 'everyone'} options={callOptions} onpick={(value) => setPrivacy({ callPrivacy: value }, 'Call privacy updated')} />
              </div>
              <p class="hint">Friends can always call you, unless you pick Nobody. Blocked people never can.</p>
            </div>
            <div class="field">
              <label>Who can send links</label>
              <div class="privacy-pick">
                <Select value={ui.me?.linkPrivacy || 'everyone'} options={shareOptions} onpick={(value) => setPrivacy({ linkPrivacy: value }, 'Link privacy updated')} />
              </div>
              <p class="hint">Friends can always send you links, unless you pick Nobody. Blocked people never can.</p>
            </div>
            <div class="field">
              <label>Who can send media</label>
              <div class="privacy-pick">
                <Select value={ui.me?.mediaPrivacy || 'everyone'} options={shareOptions} onpick={(value) => setPrivacy({ mediaPrivacy: value }, 'Media privacy updated')} />
              </div>
              <p class="hint">Friends can always send you photos, videos, GIFs, and files, unless you pick Nobody. Blocked people never can.</p>
            </div>
            <div class="field">
              <label>Who can see your stories</label>
              <div class="privacy-pick">
                <Select value={ui.me?.storyPrivacy || 'everyone'} options={shareOptions} onpick={(value) => setPrivacy({ storyPrivacy: value }, 'Story privacy updated')} />
              </div>
              <p class="hint">Stories stay on your profile for 24 hours. Friends can always see them, unless you pick Nobody. Blocked people never can.</p>
            </div>
          {:else if page === 'advanced'}
            <div class="field">
              <div class="look-line">
                <div class="copy">
                  <strong>Developer Mode</strong>
                  <em>Adds Copy Server, Channel, Category, Message and User ID to right-click menus, for building bots with the Nebula API.</em>
                </div>
                <button type="button" class="switch" class:on={devOn} aria-pressed={devOn} onclick={() => { devOn = !devOn; setDeveloperMode(devOn); }}><i></i></button>
              </div>
            </div>
          {:else if page === 'admin'}
            <div class="report-list">
              {#each ui.staffReports.filter((report) => report.status !== 'closed') as report (report.id)}
                <article class="report-row">
                  <div>
                    <strong>@{report.target?.username || 'unknown'}</strong>
                    <span>{reasonLabel[report.reason] || report.reason || 'Report'} · {report.status}</span>
                    {#if report.excerpt}<p>Message: {report.excerpt}</p>{/if}
                    {#if report.text}<p>{report.text}</p>{/if}
                  </div>
                  <div class="report-acts">
                    <button class="btn sm" onclick={() => viewing = report}>View</button>
                    {#if report.status !== 'handled'}<button class="btn sm" onclick={() => staffReport(report.id, 'handle')}>Handle</button>{/if}
                    {#if report.status !== 'closed'}<button class="btn sm" onclick={() => { staffReport(report.id, 'close'); if (viewing?.id === report.id) viewing = null; }}>Close</button>{/if}
                  </div>
                </article>
              {:else}
                <p class="hint">No reports yet.</p>
              {/each}
            </div>
            {#if viewing}
              <div class="report-view">
                <strong>Report on @{viewing.target?.username}</strong>
                <p>{reasonLabel[viewing.reason] || 'Report'}</p>
                {#if viewing.excerpt}<p>Message: {viewing.excerpt}</p>{/if}
                <p>{viewing.text || 'No extra details.'}</p>
                <p class="hint">From @{viewing.reporter?.username || 'someone'} · {viewing.status}</p>
                <div class="report-acts">
                  <button class="btn sm" onclick={() => staffReport(viewing.id, 'view')}>Mark viewed</button>
                  <button class="btn sm" onclick={() => staffReport(viewing.id, 'handle')}>Handle</button>
                  <button class="btn sm" onclick={() => { const id = viewing.id; viewing = null; staffReport(id, 'close'); }}>Close</button>
                  <button class="btn sm" onclick={() => (viewing = null)}>Back</button>
                </div>
              </div>
            {/if}
          {:else if page === 'look' && lookOpen === 'badges'}
            <section class="look-sec">
              <div class="look-line">
                <div class="copy">
                  <strong>Show badges</strong>
                  <em>Display badges on your profile.</em>
                </div>
                <button type="button" class="switch" class:on={shownCount > 0} aria-pressed={shownCount > 0} onclick={() => setAllBadges(shownCount === 0)}><i></i></button>
              </div>
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
              <p class="look-kicker">Next to your name</p>
              <div class="pick-row">
                <button type="button" class="pick-card" class:on={!form.showcaseBadge} onclick={() => (form.showcaseBadge = '')}>None</button>
                {#each ownedBadges(ui.me) as id}
                  <button type="button" class="pick-card" class:on={form.showcaseBadge === id} onclick={() => (form.showcaseBadge = id)}>
                    {#if id === 'early'}<MoonBadge />{:else if id === 'staff'}<StaffBadge rank={ui.me?.staff || ''} />{:else}<DevBadge on={true} />{/if}
                    <span>{badgeNames[id]}</span>
                  </button>
                {/each}
              </div>
              <p class="look-kicker">Server tag</p>
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
            <button type="button" class="btn brand look-save" onclick={save}>Save changes</button>
          {:else if page === 'look'}
            <section class="look-sec">
              <h3><Sparkles size={16} class="sec-ico" /> Theme</h3>
              <div class="theme-grid">
                <button type="button" class="theme-card" class:on={form.profileStyle === 'solid'} onclick={() => (form.profileStyle = 'solid')}>
                  {#if form.profileStyle === 'solid'}<span class="tick"><Check size={11} strokeWidth={3} /></span>{/if}
                  <Moon size={22} />
                  Solid
                </button>
                <button type="button" class="theme-card" class:on={form.profileStyle === 'gradient'} onclick={() => (form.profileStyle = 'gradient')}>
                  {#if form.profileStyle === 'gradient'}<span class="tick"><Check size={11} strokeWidth={3} /></span>{/if}
                  <Sun size={22} />
                  Gradient
                </button>
                <button type="button" class="theme-card" class:on={form.profileStyle === 'glow'} onclick={() => (form.profileStyle = 'glow')}>
                  {#if form.profileStyle === 'glow'}<span class="tick"><Check size={11} strokeWidth={3} /></span>{/if}
                  <Sparkles size={22} />
                  Glow
                </button>
                <button type="button" class="theme-card" class:on={form.profileStyle === 'rainbow'} onclick={() => (form.profileStyle = 'rainbow')}>
                  {#if form.profileStyle === 'rainbow'}<span class="tick"><Check size={11} strokeWidth={3} /></span>{/if}
                  <Palette size={22} />
                  Rainbow
                </button>
              </div>
            </section>
            <section class="look-sec">
              <h3><Droplet size={16} class="sec-ico" /> Accent color</h3>
              <div class="accent-row">
                <div class="swatches">
                  {#each accentPresets as hex}
                    <button type="button" class="swatch" class:on={sameHex(form.profileColors[accentSlot] || form.profileColors[0], hex)} style="background:{hex}" aria-label={hex} onclick={() => setProfileColor(accentSlot, hex)}></button>
                  {/each}
                </div>
                <div class="accent-wheel">
                  <ColorWheel value={form.profileColors[accentSlot] || '#7c6af7'} onpick={(c) => setProfileColor(accentSlot, c)} />
                  {#if form.profileStyle !== 'solid'}
                    <div class="colorbox-swatches">
                      {#each [0, 1] as i}
                        <button type="button" class="colorbox-swatch" class:on={accentSlot === i} style="background:{form.profileColors[i] || '#7c6af7'}" aria-label={i === 0 ? 'First color' : 'Second color'} onclick={() => (accentSlot = i)}></button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </section>
            <section class="look-sec">
              <h3><Monitor size={16} class="sec-ico" /> Display settings</h3>
              <div class="look-block">
                <strong>Display name style</strong>
                <em>Choose how your name is displayed.</em>
                <div class="choice-picks font-picks">
                  {#each fonts as [id, label, family]}
                    <button type="button" class="choice-btn" class:on={form.nameFont === id} onclick={() => (form.nameFont = id)}>
                      <span style="font-family:{family}">{label}</span>
                    </button>
                  {/each}
                </div>
              </div>
              <div class="look-block">
                <strong>Name effect</strong>
                <em>Color treatment on your display name.</em>
                <div class="effect-side">
                  <div class="accent-wheel">
                    <ColorWheel value={form.nameColors[form.nameEffect && form.nameEffect !== 'plain' ? nameSlot : 0] || '#5ce1ff'} onpick={(c) => setNameColor(form.nameEffect && form.nameEffect !== 'plain' ? nameSlot : 0, c)} />
                    {#if form.nameEffect && form.nameEffect !== 'plain'}
                      <div class="colorbox-swatches">
                        {#each [0, 1] as i}
                          <button type="button" class="colorbox-swatch" class:on={nameSlot === i} style="background:{form.nameColors[i] || '#5ce1ff'}" aria-label={i === 0 ? 'First color' : 'Second color'} onclick={() => (nameSlot = i)}></button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                  <div class="choice-picks" style="--fx1:{form.nameColors[0] || '#5ce1ff'};--fx2:{form.nameColors[1] || '#7c6af7'}">
                    {#each effects as [id, label]}
                      <button type="button" class="choice-btn" class:on={form.nameEffect === id} onclick={() => (form.nameEffect = id)}>
                        <Name user={{ displayName: form.displayName || form.username || 'Name', nameEffect: id, nameFont: form.nameFont }} />
                        <span class="choice-label">{label}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            </section>
            <section class="look-sec">
              <h3><Award size={16} class="sec-ico" /> Badges</h3>
              <button type="button" class="bg-row" onclick={() => (lookOpen = 'badges')}>
                <span class="copy">
                  <strong>Badges</strong>
                  <em>{badgeLabel} · {showcaseLabel} · {roleLabel}</em>
                </span>
                <ChevronRight size={16} class="row-chev" />
              </button>
            </section>
            <section class="look-sec">
              <h3><Image size={16} class="sec-ico" /> Background</h3>
              <button type="button" class="bg-row" onclick={() => togglePanel('banner')}>
                <span class="bg-thumb" style="background:{form.accentColor || 'var(--brand)'}">
                  {#if form.bannerUrl}<Photo url={form.bannerUrl} fill />{/if}
                </span>
                <span class="copy">
                  <strong>{form.bannerUrl ? 'Profile banner' : 'Default background'}</strong>
                  <em>{form.bannerUrl ? 'Your picture across the top of the profile.' : 'Uses your accent color until you set a banner.'}</em>
                </span>
                <ChevronRight size={16} class="row-chev" />
              </button>
              {#if lookOpen === 'banner'}
                <div class="look-panel">
                  <div class="look-banner">
                    {#if form.bannerUrl}<Photo url={form.bannerUrl} fill />{:else}<span class="banner-empty">No banner yet</span>{/if}
                  </div>
                  <div class="look-actions">
                    <button type="button" class="btn brand sm look-btn" onclick={() => openPicture('banner')}>Change banner</button>
                    {#if form.bannerUrl}<button type="button" class="btn sm" onclick={() => clearPicture('banner')}>Remove</button>{/if}
                  </div>
                </div>
              {/if}
            </section>
            <section class="look-sec">
              <h3><User size={16} class="sec-ico" /> Profile</h3>
              <button type="button" class="bg-row" onclick={() => togglePanel('avatar')}>
                <span class="bg-thumb avatar-thumb" style="background:{form.avatarColor}">
                  {#if form.avatarUrl}<Photo url={form.avatarUrl} />{:else}{(form.displayName || form.username || '?').charAt(0).toUpperCase()}{/if}
                </span>
                <span class="copy"><strong>Avatar</strong><em>{form.avatarUrl ? 'Photo' : 'Color'}</em></span>
                <ChevronRight size={16} class="row-chev" />
              </button>
              {#if lookOpen === 'avatar'}
                <div class="look-panel">
                  <div class="look-actions">
                    <button type="button" class="btn brand sm look-btn" onclick={() => openPicture('avatar')}>Change avatar</button>
                    {#if form.avatarUrl}<button type="button" class="btn sm" onclick={() => clearPicture('avatar')}>Remove</button>{/if}
                  </div>
                  {#if !form.avatarUrl}
                    <p class="look-kicker">Fallback color</p>
                    <ColorBox colors={[form.avatarColor]} slots={1} onpick={(_, c) => (form.avatarColor = c)} />
                  {/if}
                </div>
              {/if}
              <button type="button" class="bg-row" onclick={() => togglePanel('aliases')}>
                <span class="copy"><strong>Aliases</strong><em>{aliasLabel}</em></span>
                <ChevronRight size={16} class="row-chev" />
              </button>
              {#if lookOpen === 'aliases'}
                <div class="look-panel">
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
                </div>
              {/if}
              <button type="button" class="bg-row" onclick={() => togglePanel('bio')}>
                <span class="copy"><strong>Bio</strong><em>{bioLabel}</em></span>
                <ChevronRight size={16} class="row-chev" />
              </button>
              {#if lookOpen === 'bio'}
                <div class="look-panel">
                  <textarea bind:value={form.bio} maxlength="29" rows="2" placeholder="A short line"></textarea>
                </div>
              {/if}
              <button type="button" class="bg-row" onclick={() => togglePanel('about')}>
                <span class="copy"><strong>About me</strong><em>{aboutLabel}</em></span>
                <ChevronRight size={16} class="row-chev" />
              </button>
              {#if lookOpen === 'about'}
                <div class="look-panel">
                  <textarea bind:value={aboutDraft} maxlength="190" rows="4" placeholder="Say a little about yourself"></textarea>
                </div>
              {/if}
              <button type="button" class="bg-row" onclick={() => togglePanel('song')}>
                <span class="copy"><strong>Profile song</strong><em>{songLabel}</em></span>
                <ChevronRight size={16} class="row-chev" />
              </button>
              {#if lookOpen === 'song'}
                <div class="look-panel">
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
                  <div class="look-line">
                    <div class="copy">
                      <strong>Play on open</strong>
                      <em>Start your profile song when the profile opens.</em>
                    </div>
                    <button type="button" class="switch" class:on={form.songAutoplay} aria-pressed={form.songAutoplay} onclick={() => (form.songAutoplay = !form.songAutoplay)}><i></i></button>
                  </div>
                </div>
              {/if}
            </section>
            <button type="button" class="btn brand look-save" onclick={save}>Save changes</button>
          {/if}
          {#if page !== 'look' && page !== 'notify' && page !== 'privacy' && page !== 'advanced' && page !== 'admin'}
            <div style="height:16px"></div>
            <button class="btn brand" style="width:auto" onclick={save}>Save changes</button>
          {/if}
        </div>
        <div class="preview-sticky" class:look-preview={page === 'look'}>
          {#if page === 'look'}
            <header class="preview-label"><Eye size={16} /> Preview</header>
          {:else}
            <p class="label">Preview</p>
          {/if}
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
              <section class="profile-panel">
                <div class="profile-row"><span><User size={14} /> Display name</span><strong>{form.displayName || form.username}</strong></div>
                <div class="profile-row"><span><AtSign size={14} /> Username</span><strong>@{form.username}</strong></div>
                {#if form.aliases.some((name) => String(name || '').trim())}
                  <div class="profile-row alias-row">
                    <span><Tags size={14} /> Aliases</span>
                    <strong class="alias-names">@{form.aliases.filter((name) => String(name || '').trim()).join(', @')}</strong>
                  </div>
                {/if}
                {#if String(form.pronouns || '').trim()}
                  <div class="profile-row"><span><Smile size={14} /> Pronouns</span><strong>{form.pronouns}</strong></div>
                {/if}
              </section>
              <section class="profile-panel">
                <div class="profile-row"><span><Clock size={14} /> Last seen</span><strong>{profileSeen(ui.me, nowClock.t)}</strong></div>
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
          <div class="field name-check" class:ok={nameStatus === 'available' || nameStatus === 'yours'} class:bad={nameStatus === 'taken' || nameStatus === 'invalid'}>
            <label>Username</label>
            <div class="name-field">
              <input bind:value={draftUser} maxlength="32" autocomplete="off" spellcheck="false" />
              {#if nameStatus === 'available' || nameStatus === 'yours'}
                <span class="name-mark ok" aria-label="Available"><Check size={14} strokeWidth={3} /></span>
              {:else if nameStatus === 'taken' || nameStatus === 'invalid'}
                <span class="name-mark bad" aria-label="Unavailable"><X size={14} strokeWidth={3} /></span>
              {/if}
            </div>
            {#if nameMessage}<p class="name-status" class:ok={nameStatus === 'available' || nameStatus === 'yours'} class:bad={nameStatus === 'taken' || nameStatus === 'invalid'}>{nameMessage}</p>{/if}
          </div>
          <div class="modify-actions">
            <button type="button" class="btn" onclick={() => (accountDialog = '')}>Cancel</button>
            <button type="button" class="btn brand" disabled={accountBusy || !nameReady} onclick={saveUsername}>Done</button>
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
