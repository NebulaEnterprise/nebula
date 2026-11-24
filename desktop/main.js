const { app, BaseWindow, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, shell, session, desktopCapturer, ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveLink, pageUrl, DEFAULT_URL } = require('./link');

const BAR = 40;
const ICON = path.join(__dirname, 'build', 'icon.png');
const GAMES = [
  [/roblox/i, 'Roblox'],
  [/minecraft/i, 'Minecraft'],
  [/fortnite/i, 'Fortnite'],
  [/valorant/i, 'Valorant'],
  [/league of legends|leagueclient/i, 'League of Legends'],
  [/(^|[^a-z])cs2([^a-z]|$)|csgo/i, 'Counter-Strike 2'],
  [/gta5|gta v|gtav/i, 'GTA V'],
  [/r5apex/i, 'Apex Legends'],
  [/overwatch/i, 'Overwatch'],
  [/rocketleague/i, 'Rocket League'],
  [/osu!/i, 'osu!'],
  [/among us|amongus/i, 'Among Us'],
  [/terraria/i, 'Terraria'],
  [/stardew/i, 'Stardew Valley'],
  [/eldenring/i, 'Elden Ring'],
  [/cyberpunk2077/i, 'Cyberpunk 2077'],
  [/baldursgate3|bg3/i, "Baldur's Gate 3"],
  [/helldivers2/i, 'Helldivers 2'],
  [/dota2/i, 'Dota 2'],
  [/wow\.exe|world of warcraft/i, 'World of Warcraft'],
  [/ffxiv/i, 'Final Fantasy XIV'],
  [/genshinimpact/i, 'Genshin Impact'],
  [/destiny2/i, 'Destiny 2'],
  [/rustclient|rust\.exe/i, 'Rust'],
  [/escapefromtarkov/i, 'Escape from Tarkov'],
  [/league of legends/i, 'League of Legends'],
];

function settingsPath() {
  try { return path.join(app.getPath('userData'), 'desktop-settings.json'); }
  catch (_) { return ''; }
}

function readSettings() {
  const defaults = {
    startWithWindows: false,
    startInTray: false,
    closeToTray: true,
    hardwareAcceleration: true,
    showPlaying: false,
  };
  try {
    const file = settingsPath();
    if (!file || !fs.existsSync(file)) return defaults;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch (_) {
    return defaults;
  }
}

const settings = readSettings();
if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();

app.setName('Nebula');
app.setAppUserModelId('lol.nebulaspace.desktop');

let mainWindow = null;
let contentView = null;
let tray = null;
let quitting = false;
let playTimer = null;
let barHeight = BAR;
let pickerWindow = null;
let loadedScript = '';
let pendingUpdate = false;
let picking = null;
let link = { url: DEFAULT_URL, server: '', config: '' };
let linkCheckedAt = 0;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function isPictureLink(url) {
  try {
    return new URL(url).pathname.startsWith('/preview/');
  } catch (_) {
    return false;
  }
}

function isSiteUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const allowed = new Set(['www.nebulaspace.lol', 'nebulaspace.lol']);
    try { allowed.add(new URL(link.url).hostname); } catch (_) {}
    return allowed.has(parsed.hostname);
  } catch (_) {
    return false;
  }
}

async function refreshLink(force) {
  if (!force && Date.now() - linkCheckedAt < 60000) return false;
  linkCheckedAt = Date.now();
  const before = link.url + '|' + link.server;
  try {
    link = await resolveLink(app.getPath('userData'));
  } catch (_) {}
  return before !== link.url + '|' + link.server;
}

function page() {
  return contentView && contentView.webContents;
}

function layout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = mainWindow.getContentBounds();
  if (contentView) contentView.setBounds({ x: 0, y: 0, width, height });
}

function sendChromeState() {
  const contents = page();
  if (!contents || contents.isDestroyed() || !mainWindow) return;
  contents.send('win-state', mainWindow.isMaximized());
  contents.send('win-full', !!mainWindow.isFullScreen());
}

async function inCall() {
  const contents = page();
  if (!contents || contents.isDestroyed()) return false;
  try {
    return await contents.executeJavaScript(`(() => {
      if (document.querySelector('.in-call, .call-board, .call-stage, .call-controls')) return true;
      for (const video of document.querySelectorAll('video')) {
        if (video.srcObject) return true;
      }
      return false;
    })()`, true);
  } catch (_) {
    return false;
  }
}

async function currentScript() {
  const contents = page();
  if (!contents || contents.isDestroyed()) return '';
  try {
    return await contents.executeJavaScript(`(() => {
      const el = document.querySelector('script[src*="/assets/index-"]');
      return el ? el.getAttribute('src') || '' : '';
    })()`, true);
  } catch (_) {
    return '';
  }
}

async function remoteScript() {
  const response = await fetch(link.url + (link.url.includes('?') ? '&' : '?') + 'desktop=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) return '';
  const html = await response.text();
  const match = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  return match ? match[0] : '';
}

function scriptName(value) {
  const match = String(value || '').match(/index-[A-Za-z0-9_-]+\.js/);
  return match ? match[0] : '';
}

async function maybeUpdate() {
  /* Do not reload the window while someone is using it. */
}

function showError() {
  const contents = page();
  if (!contents || contents.isDestroyed()) return;
  contents.loadFile(path.join(__dirname, 'error.html'));
}

function openSite() {
  const contents = page();
  if (!contents || contents.isDestroyed()) return;
  contents.loadURL(pageUrl(link));
}

function createWindow() {
  mainWindow = new BaseWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 640,
    title: 'Nebula',
    backgroundColor: '#14081f',
    icon: ICON,
    frame: false,
    thickFrame: true,
    roundedCorners: true,
    darkTheme: true,
    autoHideMenuBar: true,
    show: false,
  });

  const shared = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
  contentView = new WebContentsView({
    webPreferences: { ...shared, preload: path.join(__dirname, 'preload.js'), spellcheck: true },
  });
  mainWindow.contentView.addChildView(contentView);

  const contents = contentView.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:')) return { action: 'deny' };
    if (isPictureLink(url) || !isSiteUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  const stopHistory = (event, cmd) => {
    if (cmd === 'browser-backward' || cmd === 'browser-forward') event.preventDefault();
  };
  contents.on('app-command', stopHistory);
  mainWindow.on('app-command', stopHistory);
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) {
      event.preventDefault();
      return;
    }
    if (isPictureLink(url) || !isSiteUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  contents.on('did-fail-load', (_event, code, _desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    showError();
  });
  contents.on('did-finish-load', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const stayHidden = process.argv.includes('--hidden') && settings.startInTray;
    if (!mainWindow.isVisible() && !stayHidden) mainWindow.show();
    if (!isSiteUrl(contents.getURL())) return;
    loadedScript = await currentScript();
    contents.focus();
    sendChromeState();
  });

  mainWindow.on('resize', layout);
  mainWindow.on('maximize', sendChromeState);
  mainWindow.on('unmaximize', sendChromeState);
  mainWindow.on('enter-full-screen', () => { barHeight = 0; sendChromeState(); });
  mainWindow.on('leave-full-screen', () => { barHeight = BAR; sendChromeState(); });
  mainWindow.on('close', (event) => {
    if (quitting || !settings.closeToTray) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    contentView = null;
  });

  layout();
  contents.loadFile(path.join(__dirname, 'splash.html')).then(async () => {
    await refreshLink(true);
    openSite();
  }).catch(openSite);
}

function buildMenu() {
  const view = [
    {
      label: 'Reload',
      accelerator: 'CmdOrCtrl+R',
      click: () => { const contents = page(); if (contents) contents.reload(); },
    },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    {
      label: 'Toggle Full Screen',
      accelerator: 'F11',
      click: () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); },
    },
  ];
  if (!app.isPackaged) view.push({ type: 'separator' }, { role: 'toggleDevTools' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Nebula',
      submenu: [
        { label: 'About Nebula', click: () => shell.openExternal(link.url) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { label: 'View', submenu: view },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ]));
}

function chooseSource(sources) {
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
  return new Promise((resolve) => {
    picking = resolve;
    pickerWindow = new BrowserWindow({
      width: 720,
      height: 540,
      parent: mainWindow || undefined,
      modal: !!mainWindow,
      frame: false,
      resizable: false,
      title: 'Share your screen',
      backgroundColor: '#121318',
      icon: ICON,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const finish = (id) => {
      if (!picking) return;
      const done = picking;
      picking = null;
      done(id || null);
    };
    pickerWindow.on('closed', () => {
      pickerWindow = null;
      finish(null);
    });
    ipcMain.removeAllListeners('source-chosen');
    ipcMain.removeAllListeners('source-cancel');
    ipcMain.on('source-chosen', (_event, id) => {
      finish(id);
      if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
    });
    ipcMain.on('source-cancel', () => {
      finish(null);
      if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
    });
    pickerWindow.loadFile(path.join(__dirname, 'picker.html'));
    pickerWindow.webContents.on('did-finish-load', () => {
      if (!pickerWindow || pickerWindow.isDestroyed()) return;
      pickerWindow.webContents.send('sources', sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumb: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
      })));
    });
  });
}

function chromeBins() {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    return [
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
  }
  if (process.platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
}

function openInChrome(file) {
  for (const bin of chromeBins()) {
    if (!fs.existsSync(bin)) continue;
    try {
      const child = spawn(bin, [file], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      return true;
    } catch (_) {}
  }
  return false;
}

ipcMain.handle('open-image', async (_event, payload) => {
  const type = String(payload && payload.type || '');
  const ext = type === 'image/png' ? '.png' : type === 'image/gif' ? '.gif' : type === 'image/webp' ? '.webp' : '.jpg';
  const bytes = payload && payload.bytes;
  const data = Buffer.from(bytes || []);
  if (!data.length || data.length > 25 * 1024 * 1024) return false;
  const file = path.join(app.getPath('temp'), 'nebula-' + Date.now().toString(36) + ext);
  fs.writeFileSync(file, data);
  if (openInChrome(file)) return true;
  const opened = await shell.openPath(file);
  return !opened;
});

ipcMain.on('retry', async () => {
  await refreshLink(true);
  openSite();
});
ipcMain.on('win-min', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('win-max', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win-close', () => { if (mainWindow) mainWindow.close(); });

function writeSettings() {
  const file = settingsPath();
  if (!file) return;
  try { fs.writeFileSync(file, JSON.stringify(settings)); } catch (_) {}
}

function applyLogin() {
  try {
    const hidden = !!(settings.startWithWindows && settings.startInTray);
    app.setLoginItemSettings({
      openAtLogin: !!settings.startWithWindows,
      openAsHidden: hidden,
      args: hidden ? ['--hidden'] : [],
    });
  } catch (_) {}
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function ensureTray() {
  const want = !!(settings.closeToTray || settings.startInTray);
  if (!want) {
    if (tray) {
      tray.destroy();
      tray = null;
    }
    return;
  }
  if (tray) return;
  let image = nativeImage.createFromPath(ICON);
  if (image.isEmpty()) image = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
  image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('Nebula');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Nebula', click: showMain },
    { type: 'separator' },
    { label: 'Quit Nebula', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showMain);
}

function listProcesses() {
  return new Promise((resolve) => {
    const done = (err, stdout) => resolve(err ? '' : String(stdout || ''));
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, done);
      return;
    }
    execFile('ps', ['-ax', '-o', 'comm='], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, done);
  });
}

function gameFromProcesses(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const cell = line.split(',')[0].replace(/^"|"$/g, '').trim();
    const base = cell.split(/[\\/]/).pop() || cell;
    if (!base || /nebula|electron|chrome|code|cursor/i.test(base)) continue;
    for (const [pattern, label] of GAMES) {
      if (pattern.test(base)) return label;
    }
  }
  return '';
}

function pushPlaying(name) {
  const contents = page();
  if (!contents || contents.isDestroyed()) return;
  contents.send('playing', name || '');
}

async function scanPlaying() {
  if (!settings.showPlaying) {
    pushPlaying('');
    return '';
  }
  const name = gameFromProcesses(await listProcesses());
  pushPlaying(name);
  return name;
}

function armPlaying() {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  if (!settings.showPlaying) {
    pushPlaying('');
    return;
  }
  scanPlaying();
  playTimer = setInterval(scanPlaying, 20000);
}

const SETTING_KEYS = new Set(['startWithWindows', 'startInTray', 'closeToTray', 'hardwareAcceleration', 'showPlaying']);

ipcMain.handle('desktop-settings', () => ({ ...settings }));
ipcMain.handle('desktop-setting', (_event, payload) => {
  const key = payload && payload.key;
  if (!SETTING_KEYS.has(key)) return { ...settings };
  settings[key] = !!payload.value;
  writeSettings();
  if (key === 'startWithWindows' || key === 'startInTray') applyLogin();
  if (key === 'closeToTray' || key === 'startInTray') ensureTray();
  if (key === 'showPlaying') armPlaying();
  return { ...settings };
});
ipcMain.handle('desktop-playing', () => scanPlaying());

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (gotLock) {
  app.whenReady().then(() => {
    const allowed = new Set([
      'media',
      'mediaKeySystem',
      'notifications',
      'display-capture',
      'audioCapture',
      'videoCapture',
      'fullscreen',
      'pointerLock',
      'clipboard-sanitized-write',
      'clipboard-read',
    ]);
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(allowed.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true,
        });
        const id = await chooseSource(sources);
        const source = sources.find((row) => row.id === id);
        if (!source) {
          callback(null);
          return;
        }
        callback(request && request.audioRequested ? { video: source, audio: 'loopback' } : { video: source });
      } catch (_) {
        callback(null);
      }
    });

    buildMenu();
    applyLogin();
    ensureTray();
    createWindow();
    armPlaying();
  });
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (quitting || !settings.closeToTray) {
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
