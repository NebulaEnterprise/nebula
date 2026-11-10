<script>
  import { onMount } from 'svelte';
  import { ArrowRight, Code2, Lock, Moon, Palette, Sun, Zap } from '@lucide/svelte';
  import { ui } from '../state.svelte.js';
  import { getApiBase } from '../api.js';

  let theme = $state(localStorage.getItem('nebula-home-theme') === 'light' ? 'light' : 'dark');
  let online = $state(null);
  let onlineState = $state('loading');

  const nav = ['Download', 'Developers', 'Plus', 'About'];
  const features = [
    { icon: Zap, title: 'Blazing Fast', text: 'Messages show up as soon as they’re sent, wherever you are.' },
    { icon: Lock, title: 'Private rooms', text: 'Servers and chats stay with the people you let in.' },
    { icon: Palette, title: 'Fully Customizable', text: 'Names, colors, badges, and profiles can look like yours.' },
    { icon: Code2, title: 'Built for communities', text: 'Roles, tags, and channels for the people you talk with.' },
  ];
  const preview = [
    { name: 'princess', time: 'Today at 9:41 PM', text: 'Welcome to Nebula!', tone: '#c084fc' },
    { name: 'Nova', time: 'Today at 9:42 PM', text: 'this is amazing!', tone: '#f0abfc' },
    { name: 'Star', time: 'Today at 9:43 PM', text: 'finally a better place to talk', tone: '#a78bfa' },
  ];

  function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('nebula-home-theme', theme);
  }

  function openAuth(mode) {
    ui.auth = mode;
    ui.authError = '';
    ui.authOk = '';
    ui.mfa = null;
    ui.pending = null;
    ui.authGate = true;
  }

  function toTop() {
    document.querySelector('.home')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadOnline() {
    try {
      const res = await fetch(`${getApiBase()}/api/online`, {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'bypass-tunnel-reminder': 'true',
        },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      const count = Number(data.online);
      if (!res.ok || !Number.isFinite(count)) {
        onlineState = 'error';
        return;
      }
      online = count;
      onlineState = 'ready';
    } catch {
      onlineState = 'error';
    }
  }

  onMount(() => {
    loadOnline();
    const timer = setInterval(loadOnline, 60000);
    return () => clearInterval(timer);
  });
</script>

<div class="home" class:light={theme === 'light'}>
  <div class="sky" aria-hidden="true"></div>
  <header class="bar">
    <button class="logo" type="button" onclick={toTop}>
      <img class="gem" src="./logo.webp?v=3" alt="" />
      Nebula
    </button>
    <nav class="nav" aria-label="Site">
      <button type="button" class="on" onclick={toTop}>Home</button>
      {#each nav as label}
        <span>{label}</span>
      {/each}
    </nav>
    <div class="tools">
      <button class="theme" type="button" onclick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
        {#if theme === 'dark'}
          <Sun size={16} />
        {:else}
          <Moon size={16} />
        {/if}
      </button>
      <button class="signup" type="button" onclick={() => openAuth('register')}>Sign up</button>
      <button class="login" type="button" onclick={() => openAuth('login')}>Login <ArrowRight size={15} /></button>
    </div>
  </header>

  <section class="hero">
    <div class="copy">
      <p class="pill"><span class="dot"></span> The next generation chat platform</p>
      <h1>Connect beyond<br /><em>the stars.</em></h1>
      <p class="lead">Nebula is a fast, secure, and beautiful platform to chat, share, and build with your community.</p>
      <div class="actions">
        <button class="cta" type="button" onclick={() => openAuth('register')}>Sign up</button>
        <button class="ghost" type="button" onclick={() => openAuth('login')}>Login</button>
      </div>
      <p class="live">
        <span class="faces" aria-hidden="true"><i></i><i></i><i></i></span>
        {#if onlineState === 'ready'}
          <strong>{online.toLocaleString()}</strong> online now
          <span class="pulse" aria-hidden="true"></span>
        {:else if onlineState === 'error'}
          Online count unavailable
        {:else}
          Checking who’s online
        {/if}
      </p>
    </div>

    <div class="stage" aria-hidden="true">
      <div class="window">
        <div class="chrome">
          <span></span><span></span><span></span>
          <strong><img src="./logo.webp?v=3" alt="" /> Nebula</strong>
          <em>×</em>
        </div>
        <div class="app">
          <aside>
            <b>Nebula</b>
            <small>Home</small>
            <small class="here"># general</small>
            <small>Announcements</small>
            <small>Gaming</small>
            <small>Music</small>
            <small>Voice</small>
          </aside>
          <div class="thread">
            <header># general</header>
            {#each preview as row}
              <article>
                <i style="background: {row.tone}"></i>
                <div>
                  <strong>{row.name}</strong> <time>{row.time}</time>
                  <p>{row.text}</p>
                </div>
              </article>
            {/each}
            <footer>Message #general</footer>
          </div>
          <aside class="people">
            <header>Members — 3</header>
            {#each preview as row}
              <p><i style="background: {row.tone}"></i> {row.name}</p>
            {/each}
          </aside>
        </div>
      </div>
    </div>
  </section>

  <section class="features">
  {#each features as card}
    {@const Icon = card.icon}
    <article>
      <span class="ico"><Icon size={18} /></span>
        <div>
          <h2>{card.title}</h2>
          <p>{card.text}</p>
        </div>
      </article>
    {/each}
  </section>

  <section class="join">
    <p class="eyebrow">Get Started Today</p>
    <h2>Join Nebula</h2>
    <p>Create an account or log in and talk with the people who are online right now.</p>
    <div class="actions">
      <button class="cta" type="button" onclick={() => openAuth('register')}>Sign up</button>
      <button class="ghost" type="button" onclick={() => openAuth('login')}>Login</button>
    </div>
  </section>
</div>

<style>
  .home {
    position: fixed;
    inset: 0;
    z-index: 30;
    overflow: auto;
    color: #f6f3ff;
    background: #05010d;
  }
  .sky {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      radial-gradient(ellipse at center, transparent 0%, rgba(5, 1, 13, 0.28) 62%, rgba(5, 1, 13, 0.78) 100%),
      url('/space.jpg') center / cover no-repeat;
  }
  .home.light { color: #1b1230; background: #f7f3ff; }
  .home.light .sky {
    background:
      radial-gradient(ellipse at 12% 88%, rgba(167, 112, 255, 0.28), transparent 46%),
      radial-gradient(ellipse at 92% 8%, rgba(186, 140, 255, 0.34), transparent 40%),
      linear-gradient(180deg, #fcfbff 0%, #efe7ff 100%);
  }
  .bar, .hero, .features, .join { position: relative; z-index: 1; }
  .bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 16px;
    width: min(1180px, calc(100% - 32px));
    margin: 18px auto 0;
  }
  .logo, .login, .theme, .nav button {
    border: 0;
    cursor: pointer;
    font: inherit;
  }
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    justify-self: start;
    padding: 0;
    background: none;
    color: inherit;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .gem {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    object-fit: cover;
    background: #000;
    box-shadow: 0 0 18px rgba(160, 100, 255, 0.7);
  }
  .chrome strong { display: inline-flex; align-items: center; gap: 6px; }
  .chrome strong img { width: 22px; height: 22px; object-fit: contain; background: transparent; }
  .nav {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px;
    border-radius: 999px;
    background: rgba(12, 8, 24, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(16px);
  }
  .nav button, .nav span {
    padding: 8px 14px;
    border-radius: 999px;
    color: rgba(244, 240, 255, 0.72);
    font-size: 14px;
    font-weight: 600;
  }
  .nav button {
    background: #f4f1ff;
    color: #1a1028;
  }
  .tools { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
  .theme {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: inherit;
    background: rgba(12, 8, 24, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .signup, .login, .cta, .ghost {
    border: 0;
    cursor: pointer;
    font: inherit;
  }
  .signup {
    display: inline-flex;
    align-items: center;
    padding: 9px 16px;
    border-radius: 999px;
    color: inherit;
    font-weight: 700;
    background: rgba(12, 8, 24, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }
  .login {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: 999px;
    background: #7c3aed;
    color: white;
    font-weight: 700;
    box-shadow: 0 8px 24px rgba(124, 58, 237, 0.45);
  }
  .login:hover, .cta:hover { background: #6d28d9; }
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 520px);
    gap: 28px;
    align-items: center;
    width: min(1180px, calc(100% - 40px));
    margin: 54px auto 10px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 18px;
    padding: 7px 12px 7px 10px;
    border-radius: 999px;
    background: rgba(18, 10, 36, 0.62);
    border: 1px solid rgba(196, 160, 255, 0.28);
    font-size: 13px;
    font-weight: 600;
  }
  .dot, .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #c084fc;
    box-shadow: 0 0 10px #c084fc;
  }
  h1 {
    margin: 0;
    font-size: clamp(46px, 6vw, 78px);
    line-height: 0.95;
    letter-spacing: -0.045em;
    font-weight: 700;
  }
  h1 em {
    font-style: normal;
    background: linear-gradient(90deg, #d8b4fe, #a855f7 40%, #7c3aed);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .lead {
    max-width: 460px;
    margin: 18px 0 0;
    color: rgba(236, 230, 255, 0.78);
    font-size: 16px;
    line-height: 1.55;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px; }
  .join .actions { justify-content: center; }
  .cta, .ghost {
    display: inline-flex;
    align-items: center;
    padding: 12px 18px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 14px;
  }
  .cta { background: #7c3aed; color: white; box-shadow: 0 10px 28px rgba(124, 58, 237, 0.4); }
  .ghost {
    color: inherit;
    background: rgba(10, 6, 20, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }
  .live {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 22px 0 0;
    font-size: 14px;
    color: rgba(236, 230, 255, 0.86);
  }
  .live strong { font-weight: 700; }
  .faces { display: inline-flex; }
  .faces i, .thread i, .people i {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: inline-block;
    border: 2px solid #12081f;
  }
  .faces i:nth-child(1) { background: linear-gradient(145deg, #f9a8d4, #7c3aed); }
  .faces i:nth-child(2) { background: linear-gradient(145deg, #ddd6fe, #6d28d9); margin-left: -8px; }
  .faces i:nth-child(3) { background: linear-gradient(145deg, #c4b5fd, #4c1d95); margin-left: -8px; }
  .pulse { background: #3dd68c; box-shadow: 0 0 0 4px rgba(61, 214, 140, 0.18); }
  .stage { perspective: 1400px; min-height: 360px; }
  .window {
    transform: rotateY(-18deg) rotateX(8deg) rotate(7deg);
    transform-origin: center;
    border-radius: 18px;
    overflow: hidden;
    background: rgba(18, 12, 32, 0.88);
    border: 1px solid rgba(196, 160, 255, 0.28);
    box-shadow: 0 30px 80px rgba(40, 0, 80, 0.45), 0 0 40px rgba(140, 70, 255, 0.18);
    backdrop-filter: blur(8px);
  }
  .chrome {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    font-size: 12px;
  }
  .chrome span { width: 8px; height: 8px; border-radius: 50%; background: #5b4a78; }
  .chrome span:first-child { background: #f87171; }
  .chrome span:nth-child(2) { background: #fbbf24; }
  .chrome span:nth-child(3) { background: #34d399; }
  .chrome strong { margin-left: 8px; }
  .chrome em { margin-left: auto; font-style: normal; opacity: 0.6; }
  .app { display: grid; grid-template-columns: 118px 1fr 108px; min-height: 280px; }
  aside, .thread { padding: 12px; }
  aside { background: rgba(0, 0, 0, 0.22); font-size: 12px; }
  aside b, .thread header, .people header { display: block; margin-bottom: 10px; font-size: 12px; }
  aside small, .people p { display: flex; align-items: center; gap: 6px; margin: 7px 0; opacity: 0.72; }
  aside small.here { opacity: 1; color: #e9d5ff; }
  .thread header { opacity: 0.8; }
  .thread article { display: flex; gap: 8px; margin: 0 0 12px; }
  .thread i { width: 28px; height: 28px; flex: none; }
  .thread strong { font-size: 13px; }
  .thread time { font-size: 10px; opacity: 0.5; }
  .thread p { margin: 2px 0 0; font-size: 13px; }
  .thread footer {
    margin-top: 18px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
  }
  .people i { width: 18px; height: 18px; }
  .features {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    width: min(1180px, calc(100% - 40px));
    margin: 28px auto;
  }
  .features article {
    display: flex;
    gap: 12px;
    min-height: 118px;
    padding: 18px;
    border-radius: 22px;
    background: rgba(14, 8, 28, 0.72);
    border: 1px solid rgba(196, 160, 255, 0.16);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(10px);
  }
  .ico {
    width: 36px;
    height: 36px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 12px;
    color: #e9d5ff;
    background: rgba(124, 58, 237, 0.28);
  }
  .features h2 { margin: 2px 0 6px; font-size: 15px; letter-spacing: -0.02em; }
  .features p, .join p { margin: 0; color: rgba(232, 224, 255, 0.72); font-size: 13px; line-height: 1.45; }
  .join {
    width: min(1180px, calc(100% - 40px));
    margin: 8px auto 48px;
    padding: 42px 24px 36px;
    text-align: center;
    border-radius: 28px;
    background: rgba(10, 6, 22, 0.66);
    border: 1px solid rgba(196, 160, 255, 0.16);
    backdrop-filter: blur(12px);
  }
  .eyebrow {
    display: inline-flex;
    margin: 0 0 12px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(124, 58, 237, 0.22);
    color: #e9d5ff;
    font-size: 12px;
    font-weight: 700;
  }
  .join h2 { margin: 0 0 8px; font-size: clamp(28px, 4vw, 40px); letter-spacing: -0.04em; }
  .home.light .nav, .home.light .theme, .home.light .pill, .home.light .signup, .home.light .ghost, .home.light .features article, .home.light .join {
    background: rgba(255, 255, 255, 0.82);
    border-color: rgba(90, 40, 160, 0.12);
    box-shadow: 0 12px 32px rgba(80, 40, 140, 0.08);
  }
  .home.light .nav span, .home.light .lead, .home.light .live, .home.light .features p, .home.light .join p { color: #5c4d78; }
  .home.light .nav button { background: #1b1230; color: white; }
  .home.light .window { background: #fff; color: #1b1230; border-color: rgba(90, 40, 160, 0.16); }
  .home.light aside { background: #f6f1ff; }
  .home.light .thread footer { background: #f3eefe; color: #8b7aa8; }
  .home.light .faces i, .home.light .thread i { border-color: white; }
  @media (max-width: 980px) {
    .bar { grid-template-columns: auto 1fr; }
    .nav { display: none; }
    .hero, .features { grid-template-columns: 1fr; }
    .stage { min-height: 0; }
    .window { transform: none; }
    .app { grid-template-columns: 1fr; }
    .people { display: none; }
  }
</style>
