<script>
  import { ChevronDown } from '@lucide/svelte';
  let { value = '', options = [], placeholder = 'Choose', onpick } = $props();
  let open = $state(false);
  let pos = $state({ top: 0, left: 0, width: 180 });
  const label = $derived(options.find((o) => o.value === value)?.label || placeholder);

  function toggle(e) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    pos = { top: r.bottom + 6, left: r.left, width: Math.max(r.width, 180) };
    open = !open;
  }

  function pick(e, v) {
    e.stopPropagation();
    open = false;
    onpick?.(v);
  }
</script>

<svelte:window onclick={() => (open = false)} />

<div class="select">
  <button type="button" class="select-btn" onclick={toggle}>
    <span>{label}</span>
    <ChevronDown size={16} />
  </button>
  {#if open}
    <div class="select-menu floating" style="top:{pos.top}px;left:{pos.left}px;width:{pos.width}px">
      {#each options as opt}
        <button type="button" class:on={opt.value === value} onclick={(e) => pick(e, opt.value)}>{opt.label}</button>
      {/each}
    </div>
  {/if}
</div>
