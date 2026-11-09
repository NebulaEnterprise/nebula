<script>
  import { ChevronLeft, Fingerprint, KeyRound, MonitorSmartphone, ShieldCheck } from '@lucide/svelte';
  import { ui, logout, toast } from '../state.svelte.js';
  import { api } from '../api.js';
  import { createPasskey, passkeysAvailable } from '../webauthn.js';

  let { open = $bindable(false) } = $props();

  let view = $state('home');
  let info = $state(null);
  let busy = $state(false);
  let password = $state('');
  let code = $state('');
  let setup = $state(null);

  const count = $derived(info?.sessionCount ?? ui.me?.sessionCount ?? 0);
  const people = $derived(count === 1 ? '1 person' : `${count} people`);

  function resetForm() {
    password = '';
    code = '';
    setup = null;
  }

  function show(next) {
    view = next;
    open = next !== 'home';
    resetForm();
    if (next !== 'home') load();
  }

  async function load() {
    try {
      const data = await api('/api/me/security');
      info = data;
      if (ui.me) {
        ui.me = {
          ...ui.me,
          mfa: !!data.mfa,
          passkeyCount: data.passkeyCount || 0,
          sessionCount: data.sessionCount || 0,
        };
      }
    } catch (err) {
      toast(err.message);
    }
  }

  function qrSrc() {
    if (!setup?.qr) return '';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(setup.qr);
  }

  function ago(value) {
    const t = Number(value);
    if (!t) return 'Active now';
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return 'Active now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 36) return `${hours}h ago`;
    return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  async function startAuthenticator() {
    busy = true;
    try {
      setup = await api('/api/me/mfa/setup', { method: 'POST', body: { password } });
      code = '';
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function enableAuthenticator() {
    busy = true;
    try {
      const data = await api('/api/me/mfa/enable', { method: 'POST', body: { code } });
      ui.me = { ...ui.me, ...data.user };
      setup = null;
      toast('Authenticator is on');
      await load();
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function disableAuthenticator() {
    busy = true;
    try {
      const data = await api('/api/me/mfa/disable', { method: 'POST', body: { password, code } });
      ui.me = { ...ui.me, ...data.user };
      toast('Authenticator is off');
      resetForm();
      await load();
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function addPasskey() {
    busy = true;
    try {
      const start = await api('/api/me/passkeys/options', { method: 'POST', body: { password } });
      const credential = await createPasskey(start.publicKey);
      const data = await api('/api/me/passkeys', { method: 'POST', body: { challengeId: start.challengeId, credential } });
      ui.me = { ...ui.me, ...data.user };
      info = data;
      password = '';
      toast('Passkey saved');
    } catch (err) {
      toast(err.name === 'NotAllowedError' ? 'Passkey was cancelled' : err.message);
    } finally {
      busy = false;
    }
  }

  async function removePasskey(id) {
    busy = true;
    try {
      const data = await api('/api/me/passkeys/' + id, { method: 'DELETE' });
      ui.me = { ...ui.me, ...data.user };
      info = data;
      toast('Passkey removed');
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function removeSession(row) {
    busy = true;
    try {
      const data = await api('/api/me/sessions/' + row.id, { method: 'DELETE' });
      if (data.current) {
        logout();
        return;
      }
      ui.me = { ...ui.me, ...data.user };
      info = data;
      toast('Logged that device out');
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (ui.userSettings && ui.userPage === 'account') load();
  });
</script>

{#if view === 'home'}
  <button type="button" class="acct-link" onclick={() => show('mfa')}>
    <ShieldCheck size={16} />
    <span>Authenticator</span>
    <strong>{ui.me?.mfa ? 'On' : 'Set up'}</strong>
  </button>
  <button type="button" class="acct-link" onclick={() => show('passkeys')}>
    <Fingerprint size={16} />
    <span>Passkeys</span>
    <strong>{ui.me?.passkeyCount ? `${ui.me.passkeyCount} saved` : 'Add'}</strong>
  </button>
  <button type="button" class="acct-link" onclick={() => show('devices')}>
    <MonitorSmartphone size={16} />
    <span>Logged in</span>
    <strong>{people}</strong>
  </button>
{:else}
  <button type="button" class="crumb" onclick={() => show('home')}><ChevronLeft size={16} /> Account</button>
  {#if view === 'mfa'}
    <section class="look-card">
      <h3>Authenticator app</h3>
      <p class="hint">Use an app to get a 6-digit code when you log in. Password comes first, then the code.</p>
      {#if ui.me?.mfa && !setup}
        <p class="secure-note">Authenticator is on for this account.</p>
        <div class="field"><label>Password</label><input type="password" bind:value={password} autocomplete="current-password" /></div>
        <div class="field"><label>Current code</label><input bind:value={code} maxlength="6" inputmode="numeric" placeholder="000 000" /></div>
        <button type="button" class="btn danger" disabled={busy} onclick={disableAuthenticator}>Turn off</button>
      {:else if !setup}
        <div class="field"><label>Password</label><input type="password" bind:value={password} autocomplete="current-password" /></div>
        <button type="button" class="btn brand sec-btn" disabled={busy} onclick={startAuthenticator}>Continue</button>
      {:else}
        <div class="qr-box">
          <img src={qrSrc()} alt="Authenticator QR code" width="180" height="180" />
          <div>
            <p class="hint">Scan this with your authenticator app, or type the key.</p>
            <code>{setup.secret}</code>
          </div>
        </div>
        <div class="field"><label>6-digit code</label><input bind:value={code} maxlength="6" inputmode="numeric" placeholder="000 000" /></div>
        <button type="button" class="btn brand sec-btn" disabled={busy} onclick={enableAuthenticator}>Activate</button>
      {/if}
    </section>
  {:else if view === 'passkeys'}
    <section class="look-card">
      <h3>Passkeys</h3>
      <p class="hint">Sign in with this device’s fingerprint, face, screen lock, or a security key.</p>
      {#if !passkeysAvailable()}
        <p class="hint">This page is not a secure context, so the browser will not create a passkey here.</p>
      {/if}
      {#each info?.passkeys || [] as key (key.id)}
        <div class="device-row">
          <KeyRound size={16} />
          <div>
            <strong>{key.name}</strong>
            <span>Last used {ago(key.lastUsed)}</span>
          </div>
          <button type="button" class="btn sm" disabled={busy} onclick={() => removePasskey(key.id)}>Remove</button>
        </div>
      {/each}
      <div class="field"><label>Password</label><input type="password" bind:value={password} autocomplete="current-password" /></div>
      <button type="button" class="btn brand sec-btn" disabled={busy || !passkeysAvailable()} onclick={addPasskey}>Add passkey</button>
    </section>
  {:else}
    <section class="look-card">
      <h3>Logged in</h3>
      <p class="hint">{people} {count === 1 ? 'is' : 'are'} currently logged in to this account.</p>
      {#each info?.sessions || [] as row (row.id)}
        <div class="device-row">
          <MonitorSmartphone size={16} />
          <div>
            <strong>{row.label}{row.current ? ' · This device' : ''}</strong>
            <span>{ago(row.lastSeen)}</span>
          </div>
          <button type="button" class="btn sm" disabled={busy} onclick={() => removeSession(row)}>Log out</button>
        </div>
      {/each}
    </section>
  {/if}
{/if}
