export const player = $state({ key: '', playing: false });

export function parseStamp(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Math.min(Number(raw), 21600);
  const clock = raw.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (clock) {
    const h = Number(clock[1] || 0);
    const m = Number(clock[2] || 0);
    const s = Number(clock[3] || 0);
    return Math.min(h * 3600 + m * 60 + s, 21600);
  }
  const loose = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (loose && (loose[1] || loose[2] || loose[3])) {
    return Math.min(Number(loose[1] || 0) * 3600 + Number(loose[2] || 0) * 60 + Number(loose[3] || 0), 21600);
  }
  return 0;
}

export function formatStamp(value) {
  const sec = Math.max(0, Math.floor(Number(value) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? h + ':' + mm + ':' + ss : m + ':' + ss;
}

function stampInUrl(url) {
  const t = url.searchParams.get('t') || url.searchParams.get('start') || '';
  return parseStamp(t);
}

export function parseSong(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const uri = raw.match(/^spotify:track:([A-Za-z0-9]{10,})/);
  if (uri) return { kind: 'spotify', id: uri[1], uri: 'spotify:track:' + uri[1], start: 0 };
  let url;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] || '';
    if (/^[\w-]{6,}$/.test(id)) return { kind: 'youtube', id, start: stampInUrl(url) };
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    let id = url.searchParams.get('v') || '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (!id && (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live')) id = parts[1] || '';
    if (/^[\w-]{6,}$/.test(id)) return { kind: 'youtube', id, start: stampInUrl(url) };
  }
  if (host === 'open.spotify.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const at = parts.indexOf('track');
    const id = at >= 0 ? parts[at + 1] : '';
    if (/^[A-Za-z0-9]{10,}$/.test(id)) return { kind: 'spotify', id, uri: 'spotify:track:' + id, start: 0 };
  }
  return null;
}

export function hasSong(url) {
  return !!parseSong(url);
}

export function warmSong(url) {
  const song = parseSong(url);
  if (!song) return;
  if (song.kind === 'youtube') loadYouTube();
  else spotifyReady(song.uri);
}

function songKey(song, startAt) {
  return song.kind + ':' + song.id + ':' + startAt;
}

export function playing(url, start) {
  const song = parseSong(url);
  if (!song) return false;
  const startAt = Number(start) > 0 ? Number(start) : (song.start || 0);
  return player.playing && player.key === songKey(song, startAt);
}

let ytPlayer = null;
let ytApi = null;
let spotifyController = null;
let spotifyApi = null;
let active = null;
let loopedAt = 0;

function loadYouTube() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return ytApi;
}

function loadSpotify() {
  if (spotifyApi) return spotifyApi;
  spotifyApi = new Promise((resolve) => {
    const prev = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => {
      if (prev) prev(api);
      resolve(api);
    };
    if (!document.querySelector('script[data-nebula-spotify]')) {
      const script = document.createElement('script');
      script.src = 'https://open.spotify.com/embed/iframe-api/v1';
      script.async = true;
      script.dataset.nebulaSpotify = '1';
      document.body.appendChild(script);
    }
  });
  return spotifyApi;
}

function still(key) {
  return active && active.key === key;
}

function pauseAll() {
  player.playing = false;
  try { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); } catch { /* player not ready */ }
  try { if (spotifyController && spotifyController.pause) spotifyController.pause(); } catch { /* embed not ready */ }
}

function playYouTube(id, startAt, key) {
  const go = (YT) => {
  if (!still(key)) return;
  const onState = (event) => {
    if (!active || active.song.kind !== 'youtube') return;
    if (event.data === YT.PlayerState.PLAYING) player.playing = true;
    if (event.data === YT.PlayerState.ENDED) {
      event.target.seekTo(active.startAt, true);
      event.target.playVideo();
    }
  };
  if (!ytPlayer) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:0;opacity:0;pointer-events:none;';
    document.body.appendChild(host);
    ytPlayer = new YT.Player(host, {
      width: 200,
      height: 200,
      videoId: id,
      playerVars: {
        autoplay: 1,
        start: startAt,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
      },
      events: {
        onReady: (event) => {
          if (!still(key)) return;
          event.target.seekTo(startAt, true);
          event.target.playVideo();
        },
        onStateChange: onState,
      },
    });
    return;
  }
  ytPlayer.loadVideoById({ videoId: id, startSeconds: startAt });
  };
  if (window.YT && window.YT.Player) go(window.YT);
  else loadYouTube().then((YT) => go(YT));
}

async function spotifyReady(uri) {
  const api = await loadSpotify();
  if (spotifyController) return spotifyController;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;width:300px;height:80px;left:-9999px;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(host);
  await new Promise((resolve) => {
    api.createController(host, { uri, width: 300, height: 80 }, (controller) => {
      spotifyController = controller;
      controller.addListener('playback_update', (event) => {
        const data = event.data || {};
        if (data.isPaused === false && active && active.song.kind === 'spotify') player.playing = true;
        if (data.isPaused !== false && (!active || active.song.kind !== 'spotify')) player.playing = false;
        if (!active || active.song.kind !== 'spotify') return;
        const pos = Number(data.position) || 0;
        const dur = Number(data.duration) || 0;
        if (data.isPaused === false && dur > 1500 && pos >= dur - 900 && Date.now() - loopedAt > 1500) {
          loopedAt = Date.now();
          try { controller.seek(active.startAt || 0); } catch { /* seek unsupported */ }
          try { controller.play(); } catch { /* playback blocked */ }
        }
      });
      resolve();
    });
  });
}

async function playSpotify(uri, startAt, key) {
  await spotifyReady(uri);
  if (!still(key) || !spotifyController) return;
  if (spotifyController.loadEntity) spotifyController.loadEntity(uri, false, startAt || 0);
  else if (spotifyController.loadUri) spotifyController.loadUri(uri);
  if (startAt) {
    try { spotifyController.seek(startAt); } catch { /* track seek may be ignored */ }
  }
  spotifyController.play();
}

export function toggleSong(url, start) {
  const song = parseSong(url);
  if (!song) return;
  const startAt = Number(start) > 0 ? Math.min(Number(start), 21600) : (song.start || 0);
  const key = songKey(song, startAt);
  if (player.key === key && player.playing) {
    active = null;
    pauseAll();
    return;
  }
  pauseAll();
  active = { song, startAt, key };
  player.key = key;
  player.playing = true;
  if (song.kind === 'youtube') playYouTube(song.id, startAt, key);
  else playSpotify(song.uri, startAt, key);
}
