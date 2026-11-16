<script>
  import { ui, login, requestCode, verify, cancelAdd, savedAccounts, switchAccount, submitMfa, loginWithPasskey, unlockAccount, finishSetup } from '../state.svelte.js';
  import { recoveryCode } from '../vault.js';
  import Avatar from './Avatar.svelte';
  let email = $state('');
  let username = $state('');
  let password = $state('');
  let code = $state('');
  let mfaCode = $state('');
  let secret = $state('');
  let method = $state('pass');
  let generated = $state(recoveryCode());
  let saved = $state(false);
  let busy = $state(false);

  function chosenSecret() {
    if (method === 'code') {
      if (!saved) throw new Error('Save the recovery code before you continue');
      return generated;
    }
    if (String(secret).trim().length < 8) throw new Error('Use a passphrase of at least 8 characters');
    return secret.trim();
  }

  async function run(fn) {
    busy = true;
    ui.authError = '';
    try { await fn(); }
    catch (err) { ui.authError = err.message; }
    finally { busy = false; }
  }
</script>

<div class="auth">
  <form class="auth-card" onsubmit={(e) => e.preventDefault()}>
    <div class="mark"><img src="./logo.webp?v=3" alt="" /></div>
    <h1>Nebula</h1>
    <p class="sub">Nebula is a community chat. This account exists only here.</p>
    {#if ui.auth === 'login'}
      <p class="sub">Log in and pick up where you left off.</p>
      <div class="field"><label>Email or username</label><input bind:value={email} autocomplete="username" /></div>
      <div class="field"><label>Password</label><input bind:value={password} type="password" autocomplete="current-password" /></div>
      <p class="sub">A correct email and password still need your recovery code or passphrase.</p>
      <button class="btn brand" disabled={busy} onclick={() => run(() => login(email, password))}>Log in</button>
      <button class="btn" disabled={busy} onclick={() => run(() => loginWithPasskey())}>Sign in with a passkey</button>
      <p class="auth-switch">New here? <button type="button" onclick={() => (ui.auth = 'register')}>Create an account</button></p>
      {#if ui.addingAccount}
        <p class="auth-switch"><button type="button" onclick={() => run(() => cancelAdd())}>Back</button></p>
      {:else}
        <p class="auth-switch"><button type="button" onclick={() => (ui.authGate = false)}>Back to home</button></p>
      {/if}
    {:else if ui.auth === 'register'}
      <p class="sub">Create an account. If this server can send email, you’ll get a code. If it can’t, the account opens right away.</p>
      <div class="field"><label>Email</label><input bind:value={email} type="email" autocomplete="email" /></div>
      <div class="field"><label>Username</label><input bind:value={username} maxlength="32" autocomplete="username" /></div>
      <div class="field"><label>Password</label><input bind:value={password} type="password" autocomplete="new-password" /></div>
      <p class="sub">Pick how you will unlock this account. Email and password alone will not open it.</p>
      <div class="field">
        <label>Unlock method</label>
        <select bind:value={method}>
          <option value="pass">Passphrase</option>
          <option value="code">Recovery code</option>
        </select>
      </div>
      {#if method === 'pass'}
        <div class="field"><label>Passphrase</label><input bind:value={secret} type="password" autocomplete="new-password" /></div>
      {:else}
        <div class="field"><label>Recovery code</label><input value={generated} readonly /></div>
        <label class="check"><input type="checkbox" bind:checked={saved} /> I saved this code somewhere safe</label>
        <button class="btn" type="button" onclick={() => (generated = recoveryCode())}>Make another code</button>
      {/if}
      <button class="btn brand" disabled={busy} onclick={() => run(() => requestCode(email, username, password, chosenSecret(), method))}>Continue</button>
      <p class="auth-switch">Already have one? <button type="button" onclick={() => (ui.auth = 'login')}>Log in</button></p>
      {#if !ui.addingAccount}
        <p class="auth-switch"><button type="button" onclick={() => (ui.authGate = false)}>Back to home</button></p>
      {/if}
    {:else if ui.auth === 'locked'}
      <p class="sub">Email and password were accepted. Enter the recovery code or passphrase to open the account.</p>
      <div class="field"><label>Recovery code or passphrase</label><input bind:value={secret} type="password" autocomplete="current-password" /></div>
      <button class="btn brand" disabled={busy} onclick={() => run(() => unlockAccount(secret.trim()))}>Open account</button>
      <p class="auth-switch"><button type="button" onclick={() => (ui.auth = 'login')}>Back</button></p>
    {:else if ui.auth === 'setup'}
      <p class="sub">This account needs a recovery code or passphrase before it can be opened. You will enter it every time you sign in.</p>
      <div class="field">
        <label>Unlock method</label>
        <select bind:value={method}>
          <option value="pass">Passphrase</option>
          <option value="code">Recovery code</option>
        </select>
      </div>
      {#if method === 'pass'}
        <div class="field"><label>Passphrase</label><input bind:value={secret} type="password" autocomplete="new-password" /></div>
      {:else}
        <div class="field"><label>Recovery code</label><input value={generated} readonly /></div>
        <label class="check"><input type="checkbox" bind:checked={saved} /> I saved this code somewhere safe</label>
      {/if}
      <button class="btn brand" disabled={busy} onclick={() => run(() => finishSetup(chosenSecret(), method, password))}>Save and continue</button>
    {:else if ui.auth === 'mfa'}
      <p class="sub">Authenticator is on for this account. Enter the 6-digit code from the app.</p>
      <div class="field"><label>Code</label><input class="code" bind:value={mfaCode} maxlength="6" inputmode="numeric" autocomplete="one-time-code" /></div>
      <button class="btn brand" disabled={busy} onclick={() => run(() => submitMfa(mfaCode.trim()))}>Confirm</button>
      {#if (ui.mfa?.methods || []).includes('passkey')}
        <button class="btn" disabled={busy} onclick={() => run(() => loginWithPasskey())}>Use a passkey instead</button>
      {/if}
      <p class="auth-switch"><button type="button" onclick={() => { ui.auth = 'login'; ui.mfa = null; }}>Back</button></p>
      {#if !ui.addingAccount}
        <p class="auth-switch"><button type="button" onclick={() => { ui.authGate = false; ui.mfa = null; }}>Back to home</button></p>
      {/if}
    {:else}
      <p class="sub">Enter the 6-digit code sent to {ui.pending?.email}.</p>
      <div class="field"><label>Code</label><input class="code" bind:value={code} maxlength="6" inputmode="numeric" /></div>
      <button class="btn brand" disabled={busy} onclick={() => run(() => verify(code.trim()))}>Verify</button>
      <p class="auth-switch"><button type="button" onclick={() => (ui.auth = 'register')}>Back</button></p>
      {#if !ui.addingAccount}
        <p class="auth-switch"><button type="button" onclick={() => (ui.authGate = false)}>Back to home</button></p>
      {/if}
    {/if}
    <p class="note" class:err={!!ui.authError} class:ok={!!ui.authOk && !ui.authError}>{ui.authError || ui.authOk}</p>
  </form>
  {#if ui.auth === 'login' && savedAccounts().length}
    <aside class="auth-rail">
      {#each savedAccounts() as row (row.id)}
        <button type="button" onclick={() => run(() => switchAccount(row.id))} disabled={busy}>
          <Avatar user={row} size={64} dot={false} />
          <span>{row.displayName || row.username}</span>
        </button>
      {/each}
    </aside>
  {/if}
</div>
