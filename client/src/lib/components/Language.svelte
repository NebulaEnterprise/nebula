<script>
  import { Check } from '@lucide/svelte';
  import { languages, locale, applyLanguage, t } from '../i18n.svelte.js';

  let q = $state('');
  const rows = $derived.by(() => {
    const query = q.trim().toLowerCase();
    if (!query) return languages;
    return languages.filter((row) => {
      const blob = (row.native + ' ' + row.english + ' ' + row.code).toLowerCase();
      return blob.includes(query);
    });
  });
</script>

<section class="lang-page">
  <h2>{t('App language')}</h2>
  <p>{t('Pick a language. Menus, buttons, and the rest of Nebula follow it.')}</p>
  <input class="lang-search" placeholder={t('Search languages')} bind:value={q} />
  <div class="lang-list">
    {#each rows as row (row.code)}
      <button type="button" class="lang-row" class:on={locale.code === row.code} onclick={() => applyLanguage(row.code)}>
        <span>
          <strong>{row.native}</strong>
          <em>{row.english}{row.dir === 'rtl' ? ' · ' + t('Right to left') : ''}</em>
        </span>
        {#if locale.code === row.code}<Check size={16} />{/if}
      </button>
    {/each}
  </div>
</section>
