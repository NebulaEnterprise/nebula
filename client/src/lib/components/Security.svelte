<script>
  import { ChevronLeft, MonitorSmartphone } from '@lucide/svelte';
  import { ui, logout, toast } from '../state.svelte.js';
  import { api } from '../api.js';

  let { open = $bindable(false) } = $props();

  let view = $state('home');
  let info = $state(null);
  let busy = $state(false);

  const count = $derived(info?.sessionCount ?? ui.me?.sessionCount ?? 0);
  const people = $derived(count === 1 ? '1 person' : `${count} people`);

  function show(next) {
    view = next;
    open = next !== 'home';
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
      toast('Logged that session out');
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
  <div class="acct-line">
    <div>
      <span>Logged in</span>
      <p>{people}</p>
    </div>
    <button type="button" class="acct-edit" onclick={() => show('devices')}>View</button>
  </div>
{:else}
  <button type="button" class="crumb" onclick={() => show('home')}><ChevronLeft size={16} /> Account</button>
  <section class="look-card">
    <h3>Logged in</h3>
    <p class="hint">{people} {count === 1 ? 'is' : 'are'} currently logged in to this account.</p>
    {#each info?.sessions || [] as row (row.id)}
      <div class="device-row">
        <MonitorSmartphone size={16} />
        <div>
          <strong>{row.current ? 'This session' : 'Signed-in session'}</strong>
          <span>{ago(row.lastSeen)}</span>
        </div>
        <button type="button" class="btn sm" disabled={busy} onclick={() => removeSession(row)}>Log out</button>
      </div>
    {/each}
  </section>
{/if}
