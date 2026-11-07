<script>
  import { X } from '@lucide/svelte';
  import { ui, saveMe, logout, toast } from '../state.svelte.js';
  import Name from './Name.svelte';
  import ColorWheel from './ColorWheel.svelte';
  import { fileToDataUrl } from '../image.js';

  let page = $state('profile');
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
    ['glow', 'Glow'],
    ['gradient', 'Gradient'],
    ['rainbow', 'Rainbow'],
    ['glitch', 'Glitch'],
  ];

  async function upload(file, kind, input) {
    try {
      if (!file) return;
      const url = await fileToDataUrl(file, { original: true });
      if (kind === 'avatar') form.avatarUrl = url;
      else form.bannerUrl = url;
    } catch (err) { toast(err.message); }
    finally { if (input) input.value = ''; }
  }

  function toHex(value, fallback) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) return '#' + raw.slice(1).split('').map((c) => c + c).join('');
    return fallback;
  }

  function setNameColor(index, value) {
    const next = [...(form.nameColors || ['#5ce1ff', '#7c6af7'])];
    next[index] = value;
    form.nameColors = next;
  }

  async function save() {
    try {
      await saveMe({
        ...form,
        bannerColor: form.accentColor,
      });
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
      <div class="group">Account</div>
      <button class="danger" onclick={logout}>Log out</button>
    </aside>
    <div class="set-main">
      <div class="row" style="border:0;padding-top:0">
        <h2>{page === 'profile' ? 'Profile' : page === 'look' ? 'Appearance' : 'Status'}</h2>
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
          {:else if page === 'look'}
            <section class="look-block">
              <div class="look-row">
                <div class="look-av" style="background:{form.avatarColor}">
                  {#if form.avatarUrl}<img src={form.avatarUrl} alt="" />{:else}{(form.displayName || form.username || '?').charAt(0).toUpperCase()}{/if}
                </div>
                <div>
                  <strong>Profile picture</strong>
                  <p>PNG, JPG, GIF, or WebP.</p>
                  <div class="look-actions">
                    <label class="btn brand sm look-btn">Upload picture
                      <input type="file" accept="image/*" onchange={(e) => upload(e.target.files[0], 'avatar', e.target)} />
                    </label>
                    {#if form.avatarUrl}<button type="button" class="btn sm" onclick={() => (form.avatarUrl = '')}>Remove</button>{/if}
                  </div>
                </div>
              </div>
              {#if !form.avatarUrl}
                <p class="label">Avatar color</p>
                <ColorWheel value={form.avatarColor} onpick={(c) => (form.avatarColor = c)} />
              {/if}
            </section>
            <section class="look-block">
              <strong>Banner</strong>
              <p>This sits across the top of your profile.</p>
              <div class="look-banner" style="background:{form.bannerUrl ? `center/cover url('${form.bannerUrl}')` : form.accentColor}"></div>
              <div class="look-actions">
                <label class="btn brand sm look-btn">Upload banner
                  <input type="file" accept="image/*" onchange={(e) => upload(e.target.files[0], 'banner', e.target)} />
                </label>
                {#if form.bannerUrl}<button type="button" class="btn sm" onclick={() => (form.bannerUrl = '')}>Remove</button>{/if}
              </div>
              {#if !form.bannerUrl}
                <p class="label">Banner color</p>
                <ColorWheel value={form.accentColor} onpick={(c) => (form.accentColor = c)} />
              {/if}
            </section>
            <div class="effect-head">
              <p class="label">Name effect</p>
              <input class="rgb" type="color" aria-label="First color" value={toHex(form.nameColors[0], '#5ce1ff')} oninput={(e) => setNameColor(0, e.target.value)} />
              <input class="rgb" type="color" aria-label="Second color" value={toHex(form.nameColors[1], '#7c6af7')} oninput={(e) => setNameColor(1, e.target.value)} />
            </div>
            <div class="effect-picks">
              {#each effects as [id, label]}
                <button type="button" class="effect-pick" class:on={form.nameEffect === id} onclick={() => (form.nameEffect = id)}>
                  <Name user={{ displayName: form.displayName || form.username || 'Name', nameEffect: id, nameColors: form.nameColors }} />
                  <span>{label}</span>
                </button>
              {/each}
            </div>
          {:else}
            <div class="field"><label>Custom status</label><input bind:value={form.customStatus} maxlength="128" placeholder="What's going on?" /></div>
            <p class="label">Online status</p>
            <div class="actions">
              {#each [['online', 'Online'], ['idle', 'Idle'], ['dnd', 'Do not disturb'], ['offline', 'Invisible']] as [id, label]}
                <button class="btn sm" class:brand={form.status === id} onclick={() => (form.status = id)}>{label}</button>
              {/each}
            </div>
          {/if}
          <div style="height:16px"></div>
          <button class="btn brand" style="width:auto" onclick={save}>Save changes</button>
        </div>
        <div>
          <p class="label">Preview</p>
          <div class="preview-card">
            <div class="preview-banner" style="background:{form.bannerUrl ? `center/cover url('${form.bannerUrl}')` : form.accentColor}"></div>
            <div class="preview-av" style="background:{form.avatarColor}">
              {#if form.avatarUrl}<img src={form.avatarUrl} alt="" />{:else}{(form.displayName || form.username || '?').charAt(0).toUpperCase()}{/if}
            </div>
            <div class="pad">
              <strong><Name user={{ displayName: form.displayName || form.username, username: form.username, nameEffect: form.nameEffect, nameColors: form.nameColors }} /></strong>
              <div class="handle">@{form.username}{form.pronouns ? ' · ' + form.pronouns : ''}</div>
              {#if form.bio}<p>{form.bio}</p>{/if}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
