<script>
  import { Hash, Volume2, Home } from '@lucide/svelte';
  import { ui, pickChannel, openVoiceRoom, guildAction, toast, openServerSettings } from '../state.svelte.js';
  import { lobbyFrom, LOBBY_COPY } from '../lobby.js';
  import Avatar from './Avatar.svelte';

  const lobby = $derived(lobbyFrom(ui.lobby));
  const sections = $derived(lobby.sections.filter((row) => row.on));
  const main = $derived(sections.filter((row) => row.id !== 'top' && row.place !== 'side'));
  const side = $derived(sections.filter((row) => row.place === 'side'));
  const picked = $derived.by(() => {
    const byId = new Map((ui.channels || []).map((ch) => [ch.id, ch]));
    const chosen = lobby.channelIds.map((id) => byId.get(id)).filter(Boolean);
    if (chosen.length) return chosen.slice(0, 6);
    return (ui.channels || []).filter((ch) => ch.type === 'text').slice(0, 6);
  });
  const live = $derived((ui.channels || []).filter((ch) => ch.type === 'voice' && (ui.voiceRooms[ch.id] || []).length));
  const rules = $derived((ui.channels || []).find((ch) => ch.id === ui.rulesChannelId));
  const staff = $derived((ui.members || []).filter((member) => (member.roles || []).some((role) => /owner|admin|manager|moderator/i.test(role.id || role.name || ''))).slice(0, 8));
  const questions = $derived((ui.onboarding?.questions || ui.settings?.onboarding?.questions || []).filter((item) => item.q && item.roleId));

  function md(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.+?)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\n/g, '<br>');
  }
  function openChannel(ch) {
    ui.lobbyOpen = false;
    if (ch.type === 'voice') openVoiceRoom(ch);
    else pickChannel(ch);
  }
  async function takeRole(roleId) {
    try {
      await guildAction({ type: 'onboard', roleIds: [roleId] });
      toast('Role added');
    } catch (err) {
      toast(err.message);
    }
  }
</script>

<div class="lobby-page">
  <header class="lobby-hero">
    <span class="lobby-mark"><Home size={22} /></span>
    <div>
      <h2>{ui.serverMeta?.name || 'Server'}</h2>
      {#if lobby.tagline}<p>{lobby.tagline}</p>{/if}
      {#if lobby.buttons.length}
        <div class="lobby-buttons">
          {#each lobby.buttons as button, i}
            {#if button.kind === 'channel'}
              {@const ch = (ui.channels || []).find((row) => row.id === button.channelId)}
              <button type="button" class="btn" class:brand={i === 0} onclick={() => ch && openChannel(ch)}>{button.label}</button>
            {:else}
              <a class="btn" class:brand={i === 0} href={button.url} target="_blank" rel="noreferrer">{button.label}</a>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </header>
  <div class="lobby-grid">
    <div class="lobby-main">
      {#each main as block (block.id)}
        <section>
          <h3>{LOBBY_COPY[block.id].title}</h3>
          {#if block.id === 'about'}
            {#if ui.about}<div class="lobby-copy">{@html md(ui.about)}</div>
            {:else}<p class="hint">{LOBBY_COPY.about.empty}</p>{/if}
          {:else if block.id === 'channels'}
            <div class="lobby-chips">
              {#each picked as ch (ch.id)}
                <button type="button" onclick={() => openChannel(ch)}>
                  {#if ch.type === 'voice'}<Volume2 size={14} />{:else}<Hash size={14} />{/if}
                  {ch.name}
                </button>
              {:else}<p class="hint">{LOBBY_COPY.channels.empty}</p>{/each}
            </div>
          {:else if block.id === 'live'}
            {#if live.length}
              {#each live as ch (ch.id)}
                <button type="button" class="lobby-line" onclick={() => openChannel(ch)}>
                  <Volume2 size={14} /> {ch.name}
                  <em>{(ui.voiceRooms[ch.id] || []).length} here</em>
                </button>
              {/each}
            {:else}<p class="hint">{LOBBY_COPY.live.empty}</p>{/if}
          {:else if block.id === 'giveaways'}
            <p class="hint">{LOBBY_COPY.giveaways.empty}</p>
          {:else if block.id === 'feed'}
            {#if lobby.posts.length}
              {#each lobby.posts as post, i (post.url || i)}
                <a class="lobby-post" href={post.url || undefined} target="_blank" rel="noreferrer">
                  {#if post.image}<img src={post.image} alt="" />{/if}
                  <strong>{post.title || lobby.feedName || 'Post'}</strong>
                  {#if post.text}<p>{post.text}</p>{/if}
                </a>
              {/each}
            {:else}<p class="hint">{LOBBY_COPY.feed.empty}</p>{/if}
          {:else if block.id === 'faq'}
            {#if lobby.faqs.length}
              {#each lobby.faqs as item, i (i)}
                <details>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              {/each}
            {:else}<p class="hint">{LOBBY_COPY.faq.empty}</p>{/if}
          {/if}
        </section>
      {/each}
    </div>
    <aside>
      {#each side as block (block.id)}
        <section>
          <h3>{LOBBY_COPY[block.id].title}</h3>
          {#if block.id === 'leaderboard'}
            <p class="hint">{LOBBY_COPY.leaderboard.empty}</p>
          {:else if block.id === 'roles'}
            {#if questions.length}
              {#each questions as item}
                <button type="button" class="btn" onclick={() => takeRole(item.roleId)}>{item.q}</button>
              {/each}
            {:else}
              <p class="hint">{LOBBY_COPY.roles.empty}</p>
              {#if ui.serverMeta?.owner}<button type="button" class="btn" onclick={() => openServerSettings('onboarding')}>Set up</button>{/if}
            {/if}
          {:else if block.id === 'rules'}
            {#if rules}
              <button type="button" class="btn" onclick={() => openChannel(rules)}>#{rules.name}</button>
            {:else}
              <p class="hint">{LOBBY_COPY.rules.empty}</p>
              {#if ui.serverMeta?.owner}<button type="button" class="btn" onclick={() => openServerSettings('overview')}>Pick a channel</button>{/if}
            {/if}
          {:else if block.id === 'staff'}
            {#if staff.length}
              {#each staff as member (member.id)}
                <div class="lobby-person"><Avatar user={member} size={28} /><span>{member.displayName || member.username}</span></div>
              {/each}
            {:else}<p class="hint">{LOBBY_COPY.staff.blurb}</p>{/if}
          {:else if block.id === 'links'}
            {#if (ui.links || []).length}
              {#each ui.links as link}
                <a class="lobby-line" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
              {/each}
            {:else}
              <p class="hint">{LOBBY_COPY.links.empty}</p>
              {#if ui.serverMeta?.owner}<button type="button" class="btn" onclick={() => openServerSettings('overview')}>Add links</button>{/if}
            {/if}
          {/if}
        </section>
      {/each}
    </aside>
  </div>
</div>
