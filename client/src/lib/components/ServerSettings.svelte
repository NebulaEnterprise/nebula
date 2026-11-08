<script>
  import {
    X, Image, Palette, Hash, Home, Smile, Sticker, UserRound, AtSign, Shield,
    Flag, ScrollText, Users, DoorOpen, Gavel, Ban, ChevronUp, ChevronDown, Trash2, Copy,
  } from '@lucide/svelte';
  import Select from './Select.svelte';
  import ColorWheel from './ColorWheel.svelte';
  import { ui, guildAction, reloadSettings, toast } from '../state.svelte.js';
  import { ROLE_FLAGS, PERM } from '../format.js';
  import { readSmallImage } from '../image.js';
  import { api } from '../api.js';

  const pages = [
    ['overview', 'Overview', Image],
    ['theme', 'Theme', Palette],
    ['channels', 'Channels', Hash],
    ['lobby', 'Lobby', Home],
    ['emoji', 'Emoji', Smile],
    ['stickers', 'Stickers', Sticker],
    ['onboarding', 'Onboarding', UserRound],
    ['pings', 'Ping roles', AtSign],
    ['safety', 'Safety', Shield],
    ['reports', 'Reports', Flag],
    ['audit', 'Audit log', ScrollText],
    ['members', 'Members', Users],
    ['requests', 'Join requests', DoorOpen],
    ['roles', 'Roles', Gavel],
    ['bans', 'Bans', Ban],
  ];

  let name = $state(ui.settings?.name || '');
  let tag = $state(ui.settings?.tag || '');
  let accent = $state(ui.settings?.theme?.accent || ui.settings?.color || '#7c6af7');
  let tint = $state(ui.settings?.theme?.tint || '');
  let about = $state(ui.settings?.about || '');
  let showLobby = $state(!!ui.settings?.showLobby);
  let iconUrl = $state('');
  let bannerUrl = $state('');
  let assetName = $state('');
  let q = $state('');
  let roleName = $state('');
  let roleColor = $state('#7c6af7');
  let roleBits = $state(PERM.VIEW | PERM.SEND);
  let roleUid = $state('');
  let roleId = $state(ui.settings?.roles?.find((r) => r.id !== 'everyone' && r.id !== 'here' && r.id !== 'owner')?.id || '');
  let banUid = $state('');
  let banReason = $state('');
  let verify = $state(ui.settings?.verification || 'none');
  let joinMode = $state(ui.settings?.joinMode || 'open');
  let joinQ = $state(ui.settings?.joinQuestions?.[0] || '');
  let raidOn = $state(!!ui.settings?.raid?.on);
  let raidDays = $state(ui.settings?.raid?.accountDays || 3);
  let obOn = $state(!!ui.settings?.onboarding?.enabled);
  let obMust = $state(!!ui.settings?.onboarding?.mustFinish);
  let questions = $state((ui.settings?.onboarding?.questions || []).map((item) => ({ ...item })));

  const s = $derived(ui.settings || {});
  const catOptions = $derived([{ value: '', label: 'No category' }, ...(s.categories || []).map((c) => ({ value: c.id, label: c.name }))]);
  const members = $derived((s.members || []).filter((m) => {
    const blob = (m.nick + ' ' + m.displayName + ' ' + m.username + ' ' + m.uid).toLowerCase();
    return !q || blob.includes(q.toLowerCase());
  }));

  async function run(fn) {
    try { await fn(); await reloadSettings(); toast('Saved'); }
    catch (err) { toast(err.message); }
  }

  async function saveOverview() {
    const body = { name, tag, color: accent, theme: { accent, tint: s.theme?.tint || '' } };
    if (iconUrl) body.iconUrl = iconUrl;
    if (bannerUrl) body.bannerUrl = bannerUrl;
    await run(() => guildAction({ type: 'settings', ...body }));
  }

  async function saveMention(role, otherId, on) {
    const mentionBy = new Set(role.mentionBy || []);
    if (on) mentionBy.add(otherId);
    else mentionBy.delete(otherId);
    await run(() => api('/api/servers/' + ui.serverId + '/roles/' + role.id, { method: 'PATCH', body: { mentionBy: [...mentionBy] } }));
  }

  async function assignRole(action) {
    try {
      const mem = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
      const user = (mem.members || []).find((m) => String(m.uid) === roleUid.trim().replace(/^#/, ''));
      if (!user) throw new Error('No member with that id');
      await api('/api/servers/' + ui.serverId + '/members/' + user.id + '/roles', { method: 'POST', body: { roleId, action } });
      await reloadSettings();
      toast(action === 'add' ? 'Role given' : 'Role removed');
    } catch (err) { toast(err.message); }
  }
</script>

<div class="overlay">
  <div class="settings" role="dialog">
    <aside class="set-nav">
      <div class="group">{s.name || 'Server'}</div>
      {#each pages as [id, label, Icon]}
        <button class:on={ui.settingsPage === id} onclick={() => (ui.settingsPage = id)}>
          <Icon size={16} /> {label}
        </button>
      {/each}
    </aside>
    <div class="set-main">
      <div class="row" style="border:0;padding-top:0">
        <h2>{pages.find((p) => p[0] === ui.settingsPage)?.[1]}</h2>
        <button class="btn icon" onclick={() => (ui.serverSettings = false)}><X size={18} /></button>
      </div>

      {#if ui.settingsPage === 'overview'}
        <p class="hint">How the server looks in the sidebar and on invites.</p>
        <div class="grid-2">
          <label class="drop">
            {#if iconUrl || s.iconUrl}<img src={iconUrl || s.iconUrl} alt="" />{:else}<strong>Server icon</strong><span>PNG, WebP, or GIF under 300 KB</span>{/if}
            <input type="file" accept="image/*" onchange={async (e) => { try { iconUrl = await readSmallImage(e.target.files[0]); } catch (err) { toast(err.message); } }} />
          </label>
          <label class="drop">
            {#if bannerUrl || s.bannerUrl}<img src={bannerUrl || s.bannerUrl} alt="" />{:else}<strong>Banner</strong><span>Shown above the channel list</span>{/if}
            <input type="file" accept="image/*" onchange={async (e) => { try { bannerUrl = await readSmallImage(e.target.files[0]); } catch (err) { toast(err.message); } }} />
          </label>
        </div>
        <div class="field"><label>Server name</label><input bind:value={name} maxlength="40" /></div>
        <div class="field"><label>Server tag</label><input bind:value={tag} maxlength="4" placeholder="ILY" /></div>
        <p class="label">Accent</p>
        <ColorWheel value={accent} onpick={(c) => (accent = c)} />
        <div style="height:14px"></div>
        <button class="btn brand" style="width:auto" onclick={saveOverview}>Save</button>

      {:else if ui.settingsPage === 'theme'}
        <p class="hint">Everyone sees these colors while they are in this server.</p>
        <p class="label">Accent</p>
        <ColorWheel value={accent} onpick={(c) => (accent = c)} />
        <p class="label" style="margin-top:14px">Background</p>
        <ColorWheel value={tint || '#181920'} onpick={(c) => (tint = c)} />
        {#if tint}<button type="button" class="btn sm" style="margin-top:8px" onclick={() => (tint = '')}>Default background</button>{/if}
        <div style="height:14px"></div>
        <button class="btn brand" style="width:auto" onclick={() => run(() => guildAction({ type: 'settings', color: accent, theme: { accent, tint } }))}>Save theme</button>
        <button class="btn" onclick={() => run(() => guildAction({ type: 'settings', theme: { accent: '#7c6af7', tint: '' } }))}>Remove theme</button>

      {:else if ui.settingsPage === 'channels'}
        <p class="hint">Move channels up or down, or drop them into a category.</p>
        <button class="btn brand" style="width:auto;margin-bottom:12px" onclick={() => (ui.dialog = { kind: 'category' })}>Create category</button>
        {#each s.categories || [] as cat}
          <div class="row">
            <strong>{cat.name}</strong>
            <button class="btn icon danger" title="Delete category" onclick={() => run(() => guildAction({ type: 'category-delete', categoryId: cat.id }))}><Trash2 size={16} /></button>
          </div>
        {/each}
        {#each s.channels || [] as ch}
          <div class="row">
            <strong style="width:140px">{ch.type === 'voice' ? '🔊' : '#'} {ch.name}</strong>
            <Select value={ch.categoryId || ''} options={catOptions} onpick={(v) => run(() => guildAction({ type: 'set-category', channelId: ch.id, categoryId: v }))} />
            <button class="btn icon" title="Move up" onclick={() => run(() => guildAction({ type: 'move-channel', channelId: ch.id, dir: 'up' }))}><ChevronUp size={16} /></button>
            <button class="btn icon" title="Move down" onclick={() => run(() => guildAction({ type: 'move-channel', channelId: ch.id, dir: 'down' }))}><ChevronDown size={16} /></button>
          </div>
        {/each}

      {:else if ui.settingsPage === 'lobby'}
        <p class="hint">A short note shown above the message box.</p>
        <label class="check"><input type="checkbox" bind:checked={showLobby} /> Show the lobby</label>
        <div class="field"><label>About</label><textarea bind:value={about} maxlength="2000" rows="5"></textarea></div>
        <button class="btn brand" style="width:auto" onclick={() => run(() => guildAction({ type: 'settings', about, showLobby }))}>Save</button>

      {:else if ui.settingsPage === 'emoji' || ui.settingsPage === 'stickers'}
        {@const list = ui.settingsPage === 'emoji' ? (s.emoji || []) : (s.stickers || [])}
        <p class="hint">{list.length} / {ui.settingsPage === 'emoji' ? 50 : 30}. {ui.settingsPage === 'emoji' ? 'People type :name: in chat.' : 'They show up in the sticker button.'}</p>
        <div class="field"><label>Name</label><input bind:value={assetName} maxlength="32" placeholder="wave" /></div>
        <label class="drop">
          <strong>Upload {ui.settingsPage === 'emoji' ? 'emoji' : 'sticker'}</strong>
          <span>Under 300 KB</span>
          <input type="file" accept="image/*" onchange={async (e) => {
            try {
              const url = await readSmallImage(e.target.files[0]);
              await guildAction({ type: ui.settingsPage === 'emoji' ? 'emoji' : 'sticker', name: assetName, url });
              assetName = '';
              await reloadSettings();
              toast('Uploaded');
            } catch (err) { toast(err.message); }
          }} />
        </label>
        {#each list as item}
          <div class="row">
            <img src={item.url} alt="" style="width:36px;height:36px;object-fit:contain" />
            <span class="grow">:{item.name}:</span>
            <button class="btn sm danger" onclick={() => run(() => guildAction({ type: ui.settingsPage === 'emoji' ? 'emoji' : 'sticker', remove: true, id: item.id }))}>Remove</button>
          </div>
        {/each}

      {:else if ui.settingsPage === 'onboarding'}
        <p class="hint">New members can answer a few questions and receive a role.</p>
        <label class="check"><input type="checkbox" bind:checked={obOn} /> Turn on onboarding</label>
        <label class="check"><input type="checkbox" bind:checked={obMust} /> Must finish before chatting</label>
        {#each questions as item, i}
          <div class="row">
            <input class="textin" bind:value={item.q} placeholder="Question" />
            <Select
              value={item.roleId || ''}
              options={(s.roles || []).filter((r) => r.id !== 'everyone' && r.id !== 'owner' && r.id !== 'here').map((r) => ({ value: r.id, label: r.name }))}
              onpick={(v) => (questions[i].roleId = v)}
            />
          </div>
        {/each}
        <div class="actions" style="margin-top:12px">
          <button class="btn" onclick={() => questions.push({ q: '', roleId: '' })}>Add question</button>
          <button class="btn brand" style="width:auto" onclick={() => run(() => guildAction({ type: 'settings', onboarding: { enabled: obOn, mustFinish: obMust, questions } }))}>Save</button>
        </div>

      {:else if ui.settingsPage === 'pings'}
        <p class="hint">Members pick these themselves. A ping role never includes manage permissions.</p>
        <button class="btn" onclick={async () => {
          try {
            const names = ['Announcements', 'Giveaways', 'Updates', 'Events', 'Polls'];
            for (const n of names) {
              if ((s.roles || []).some((r) => r.name === n)) continue;
              await api('/api/servers/' + ui.serverId + '/roles', { method: 'POST', body: { name: n, color: '#7c6af7', permissions: PERM.VIEW } });
            }
            const fresh = (await api('/api/servers/' + ui.serverId + '/settings')).settings;
            const ids = (fresh.roles || []).filter((r) => names.includes(r.name)).map((r) => r.id);
            await guildAction({ type: 'settings', pingRoleIds: [...new Set([...(fresh.pingRoleIds || []), ...ids])] });
            await reloadSettings();
            toast('Template added');
          } catch (err) { toast(err.message); }
        }}>Add the starter roles</button>
        {#each (s.roles || []).filter((r) => r.id !== 'everyone' && r.id !== 'owner' && r.id !== 'here') as r}
          <label class="check">
            <input type="checkbox" checked={(s.pingRoleIds || []).includes(r.id)} onchange={async (e) => {
              const set = new Set(s.pingRoleIds || []);
              if (e.target.checked) set.add(r.id); else set.delete(r.id);
              await run(() => guildAction({ type: 'settings', pingRoleIds: [...set] }));
            }} />
            {r.name}
          </label>
        {/each}

      {:else if ui.settingsPage === 'safety'}
        <p class="hint">Lock the server, slow down raids, and choose who can join.</p>
        <div class="actions">
          <button class="btn sm" onclick={() => run(() => guildAction({ type: 'lock', minutes: 15 }))}>Lock 15 min</button>
          <button class="btn sm" onclick={() => run(() => guildAction({ type: 'lock', minutes: 60 }))}>Lock 1 hour</button>
          <button class="btn sm" onclick={() => run(() => guildAction({ type: 'lock', minutes: 1440 }))}>Lock 1 day</button>
          <button class="btn sm" onclick={() => run(() => guildAction({ type: 'lock', minutes: 0 }))}>Unlock</button>
        </div>
        <label class="check"><input type="checkbox" bind:checked={raidOn} /> Raid mode for new accounts</label>
        <div class="field"><label>Block accounts younger than (days)</label><input type="number" min="0" bind:value={raidDays} /></div>
        <p class="label">Verification</p>
        <Select value={verify} options={['none','low','medium','high'].map((v) => ({ value: v, label: v }))} onpick={(v) => (verify = v)} />
        <p class="label" style="margin-top:12px">Who can join</p>
        <Select value={joinMode} options={[{ value: 'open', label: 'Open invite' }, { value: 'apply', label: 'They apply, you approve' }]} onpick={(v) => (joinMode = v)} />
        <div class="field" style="margin-top:12px"><label>Question on the form</label><input bind:value={joinQ} maxlength="120" /></div>
        <button class="btn brand" style="width:auto" onclick={() => run(() => guildAction({ type: 'settings', raid: { on: raidOn, accountDays: Number(raidDays) || 0, joinHours: 1, durationHours: 6 }, verification: verify, joinMode, joinQuestions: joinQ ? [joinQ] : [] }))}>Save safety</button>

      {:else if ui.settingsPage === 'reports'}
        {#each s.reports || [] as r}
          <div class="row">
            <div class="grow"><strong>{r.status}</strong> {r.text}</div>
            {#if r.status === 'open'}<button class="btn sm" onclick={() => run(() => guildAction({ type: 'report-handle', reportId: r.id }))}>Handled</button>{/if}
          </div>
        {:else}<p class="hint">Nothing to review.</p>{/each}

      {:else if ui.settingsPage === 'audit'}
        {#each s.audit || [] as a}
          <div class="row"><div class="grow"><strong>{a.name}</strong> {a.text}<div class="hint">{a.at}</div></div></div>
        {:else}<p class="hint">No changes yet.</p>{/each}

      {:else if ui.settingsPage === 'members'}
        <input class="textin" placeholder="Search by name" bind:value={q} />
        {#each members as m}
          <div class="row">
            <div class="grow"><strong>{m.nick || m.displayName || m.username}</strong><div class="hint">@{m.username} · {m.uid}</div></div>
            <div class="actions">
              <button class="btn icon" title="Copy id" onclick={() => navigator.clipboard.writeText(String(m.uid || ''))}><Copy size={15} /></button>
              <button class="btn icon" title="Nickname" onclick={async () => {
                const nick = prompt('Nickname', m.nick || '');
                if (nick == null) return;
                await run(() => guildAction({ type: 'nick-other', userId: m.id, nick }));
              }}><AtSign size={15} /></button>
              <button class="btn icon" title="Time out" onclick={async () => {
                const minutes = Number(prompt('Minutes to time out. 0 clears it.', '10'));
                if (Number.isNaN(minutes)) return;
                await run(() => guildAction({ type: 'timeout', userId: m.id, minutes }));
              }}>⏱</button>
              <button class="btn icon danger" title="Kick" onclick={() => confirm('Kick this member?') && run(() => guildAction({ type: 'kick', userId: m.id }))}><DoorOpen size={15} /></button>
              <button class="btn icon danger" title="Ban" onclick={async () => {
                const reason = prompt('Ban reason', '') ?? '';
                await run(() => guildAction({ type: 'ban', userId: m.id, reason }));
              }}><Ban size={15} /></button>
            </div>
          </div>
        {/each}

      {:else if ui.settingsPage === 'requests'}
        {#each s.requests || [] as r}
          <div class="row">
            <div class="grow"><strong>{r.user?.displayName || r.user?.username || 'Someone'}</strong><div class="hint">{r.message}</div></div>
            <button class="btn sm brand" onclick={() => run(() => guildAction({ type: 'request', requestId: r.id, accept: true }))}>Accept</button>
            <button class="btn sm" onclick={() => run(() => guildAction({ type: 'request', requestId: r.id, accept: false }))}>Decline</button>
          </div>
        {:else}<p class="hint">Nobody is waiting.</p>{/each}

      {:else if ui.settingsPage === 'roles'}
        {#each s.roles || [] as r}
          <div class="role-card">
            <div class="row"><span class="color-chip" style="background:{r.color || '#99aab5'}"></span><strong>{r.name}</strong></div>
            <p class="label">Choose who can mention this role</p>
            <div class="mention-by">
              {#each (s.roles || []).filter((other) => other.id !== r.id && other.id !== 'here') as other}
                <label class="check">
                  <input type="checkbox" checked={(r.mentionBy || []).includes(other.id)} onchange={(e) => saveMention(r, other.id, e.target.checked)} />
                  {other.name}
                </label>
              {/each}
            </div>
          </div>
        {/each}
        <div class="field"><label>New role</label><input bind:value={roleName} maxlength="32" placeholder="Moderator" /></div>
        <p class="label">Role color</p>
        <ColorWheel value={roleColor} onpick={(c) => (roleColor = c)} />
        {#each ROLE_FLAGS as [label, bit]}
          <label class="check"><input type="checkbox" checked={!!(roleBits & bit)} onchange={(e) => { roleBits = e.target.checked ? roleBits | bit : roleBits & ~bit; }} /> {label}</label>
        {/each}
        <button class="btn brand" style="width:auto" onclick={async () => {
          try {
            await api('/api/servers/' + ui.serverId + '/roles', { method: 'POST', body: { name: roleName, color: roleColor, permissions: roleBits } });
            roleName = '';
            await reloadSettings();
          } catch (err) { toast(err.message); }
        }}>Add role</button>
        <div class="field" style="margin-top:16px"><label>Member user id</label><input bind:value={roleUid} placeholder="2" /></div>
        <Select value={roleId} options={(s.roles || []).filter((r) => r.id !== 'everyone' && r.id !== 'here').map((r) => ({ value: r.id, label: r.name }))} onpick={(v) => (roleId = v)} />
        <div class="actions" style="margin-top:8px">
          <button class="btn sm brand" onclick={() => assignRole('add')}>Give</button>
          <button class="btn sm" onclick={() => assignRole('remove')}>Remove</button>
        </div>

      {:else if ui.settingsPage === 'bans'}
        {#each s.bans || [] as b}
          <div class="row">
            <span>{b.user?.displayName || b.user?.username || b.userId} {b.reason || ''}</span>
            <button class="btn sm" onclick={() => run(() => guildAction({ type: 'unban', userId: b.userId }))}>Unban</button>
          </div>
        {:else}<p class="hint">No bans.</p>{/each}
        <div class="field"><label>Ban by user id</label><input bind:value={banUid} placeholder="4" /></div>
        <div class="field"><label>Reason</label><input bind:value={banReason} maxlength="200" /></div>
        <button class="btn brand" style="width:auto" onclick={async () => {
          try {
            const mem = await api('/api/members?serverId=' + encodeURIComponent(ui.serverId));
            const user = (mem.members || []).find((m) => String(m.uid) === banUid.trim());
            if (!user) throw new Error('No member with that id');
            await guildAction({ type: 'ban', userId: user.id, reason: banReason });
            await reloadSettings();
          } catch (err) { toast(err.message); }
        }}>Ban</button>
      {/if}
    </div>
  </div>
</div>
