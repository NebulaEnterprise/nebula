<script>
  import { ui, login, requestCode, verify, cancelAdd, savedAccounts, switchAccount } from '../state.svelte.js';
  import Avatar from './Avatar.svelte';
  let email = $state('');
  let username = $state('');
  let password = $state('');
  let code = $state('');
  let busy = $state(false);

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
    <div class="mark">N</div>
    <h1>Nebula</h1>
    <p class="sub">Nebula is a community chat. This account exists only here.</p>
    {#if ui.auth === 'login'}
      <p class="sub">Log in and pick up where you left off.</p>
      <div class="field"><label>Email or username</label><input bind:value={email} autocomplete="username" /></div>
      <div class="field"><label>Password</label><input bind:value={password} type="password" autocomplete="current-password" /></div>
      <button class="btn brand" disabled={busy} onclick={() => run(() => login(email, password))}>Log in</button>
      <p class="auth-switch">New here? <button type="button" onclick={() => (ui.auth = 'register')}>Create an account</button></p>
      {#if ui.addingAccount}
        <p class="auth-switch"><button type="button" onclick={() => run(() => cancelAdd())}>Back</button></p>
      {/if}
    {:else if ui.auth === 'register'}
      <p class="sub">Create an account. If this server can send email, you’ll get a code. If it can’t, the account opens right away.</p>
      <div class="field"><label>Email</label><input bind:value={email} type="email" autocomplete="email" /></div>
      <div class="field"><label>Username</label><input bind:value={username} maxlength="32" autocomplete="username" /></div>
      <div class="field"><label>Password</label><input bind:value={password} type="password" autocomplete="new-password" /></div>
      <button class="btn brand" disabled={busy} onclick={() => run(() => requestCode(email, username, password))}>Continue</button>
      <p class="auth-switch">Already have one? <button type="button" onclick={() => (ui.auth = 'login')}>Log in</button></p>
    {:else}
      <p class="sub">Enter the 6-digit code sent to {ui.pending?.email}.</p>
      <div class="field"><label>Code</label><input class="code" bind:value={code} maxlength="6" inputmode="numeric" /></div>
      <button class="btn brand" disabled={busy} onclick={() => run(() => verify(code.trim()))}>Verify</button>
      <p class="auth-switch"><button type="button" onclick={() => (ui.auth = 'register')}>Back</button></p>
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
