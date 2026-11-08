<script>
  import { votePoll, toast } from '../state.svelte.js';

  let { poll, messageId } = $props();
  let picked = $state([]);
  let show = $state(false);
  let busy = $state(false);

  $effect(() => {
    picked = [...(poll?.mine || [])];
    if ((poll?.mine || []).length || poll?.closed) show = true;
  });

  function toggle(id) {
    if (poll.closed) return;
    if (poll.multi) {
      picked = picked.includes(id) ? picked.filter((row) => row !== id) : [...picked, id];
      return;
    }
    picked = [id];
  }

  async function vote() {
    if (!picked.length || busy) return;
    busy = true;
    try {
      await votePoll(messageId, picked);
      show = true;
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  function left(endsAt) {
    const ms = Number(endsAt || 0) - Date.now();
    if (ms <= 0) return 'Final results';
    const hours = Math.ceil(ms / 3600000);
    if (hours < 24) return hours + 'h left';
    return Math.ceil(hours / 24) + 'd left';
  }
</script>

<div class="poll-card">
  <strong>{poll.question}</strong>
  <p class="hint">{poll.multi ? 'Select one or more' : 'Select one answer'}</p>
  {#each poll.options as opt, index}
    {@const count = poll.counts?.[index] || 0}
    {@const pct = poll.total ? Math.round((count / poll.total) * 100) : 0}
    <button type="button" class="poll-opt" class:on={picked.includes(opt.id)} onclick={() => toggle(opt.id)}>
      <span class="poll-mark">{picked.includes(opt.id) ? '●' : '○'}</span>
      <span class="poll-text">{opt.text}</span>
      {#if show}
        <span class="poll-count">{pct}%</span>
        <i style="width:{pct}%"></i>
      {/if}
    </button>
  {/each}
  <div class="poll-foot">
    <span>{poll.total || 0} votes · {left(poll.endsAt)}</span>
    <button type="button" class="btn sm" onclick={() => (show = !show)}>{show ? 'Hide results' : 'Show results'}</button>
    {#if !poll.closed}<button type="button" class="btn sm brand" disabled={busy || !picked.length} onclick={vote}>Vote</button>{/if}
  </div>
</div>
