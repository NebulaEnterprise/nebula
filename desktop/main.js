const { app, BaseWindow, BrowserWindow, WebContentsView, Menu, shell, session, desktopCapturer, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveLink, pageUrl, DEFAULT_URL } = require('./link');

const BAR = 40;
const ICON = path.join(__dirname, 'build', 'icon.png');

app.setName('Nebula');
app.setAppUserModelId('lol.nebulaspace.desktop');

let mainWindow = null;
let contentView = null;
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
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
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
    if (!mainWindow.isVisible()) mainWindow.show();
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
    createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
