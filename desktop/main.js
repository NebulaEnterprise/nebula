const { app, BaseWindow, BrowserWindow, WebContentsView, Menu, shell, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');

const SITE = 'https://www.nebulaspace.lol/';
const SITE_HOSTS = new Set(['www.nebulaspace.lol', 'nebulaspace.lol']);
const BAR = 40;
const ICON = path.join(__dirname, 'build', 'icon.png');

app.setName('Nebula');
app.setAppUserModelId('lol.nebulaspace.desktop');

let mainWindow = null;
let titleView = null;
let contentView = null;
let barHeight = BAR;
let pickerWindow = null;
let loadedScript = '';
let pendingUpdate = false;
let picking = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function isSiteUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && SITE_HOSTS.has(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function page() {
  return contentView && contentView.webContents;
}

function layout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = mainWindow.getContentBounds();
  const bar = barHeight;
  if (titleView) titleView.setBounds({ x: 0, y: 0, width, height: bar });
  if (contentView) contentView.setBounds({ x: 0, y: bar, width, height: Math.max(0, height - bar) });
}

function sendChromeState() {
  if (!titleView || titleView.webContents.isDestroyed() || !mainWindow) return;
  titleView.webContents.send('win-state', mainWindow.isMaximized());
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
  const response = await fetch(SITE + '?desktop=' + Date.now(), { cache: 'no-store' });
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
  const contents = page();
  if (!contents || contents.isDestroyed()) return;
  if (!isSiteUrl(contents.getURL())) return;
  let remote = '';
  try {
    remote = await remoteScript();
  } catch (_) {
    return;
  }
  const remoteName = scriptName(remote);
  if (!remoteName) return;
  const localName = scriptName(loadedScript || await currentScript());
  if (!localName || localName === remoteName) {
    pendingUpdate = false;
    return;
  }
  if (await inCall()) {
    pendingUpdate = true;
    return;
  }
  pendingUpdate = false;
  loadedScript = '';
  contents.loadURL(SITE);
}

function showError() {
  const contents = page();
  if (!contents || contents.isDestroyed()) return;
  contents.loadFile(path.join(__dirname, 'error.html'));
}

function openSite() {
  const contents = page();
  if (!contents || contents.isDestroyed()) return;
  contents.loadURL(SITE);
}

function createWindow() {
  mainWindow = new BaseWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 640,
    title: 'Nebula',
    backgroundColor: '#08090c',
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
  titleView = new WebContentsView({
    webPreferences: { ...shared, preload: path.join(__dirname, 'title-preload.js') },
  });
  contentView = new WebContentsView({
    webPreferences: { ...shared, preload: path.join(__dirname, 'preload.js'), spellcheck: true },
  });
  mainWindow.contentView.addChildView(contentView);
  mainWindow.contentView.addChildView(titleView);

  const contents = contentView.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isSiteUrl(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    if (isSiteUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
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
  });

  titleView.webContents.on('did-finish-load', sendChromeState);
  mainWindow.on('resize', layout);
  mainWindow.on('maximize', sendChromeState);
  mainWindow.on('unmaximize', sendChromeState);
  mainWindow.on('enter-full-screen', () => { barHeight = 0; layout(); });
  mainWindow.on('leave-full-screen', () => { barHeight = BAR; layout(); });
  mainWindow.on('focus', () => { maybeUpdate(); });
  mainWindow.on('closed', () => {
    mainWindow = null;
    titleView = null;
    contentView = null;
  });

  layout();
  titleView.webContents.loadFile(path.join(__dirname, 'titlebar.html'));
  contents.loadFile(path.join(__dirname, 'splash.html')).then(openSite).catch(openSite);
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
        { label: 'About Nebula', click: () => shell.openExternal(SITE) },
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

ipcMain.on('retry', () => openSite());
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
    setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
      maybeUpdate();
    }, 10 * 60 * 1000);
    setInterval(() => {
      if (pendingUpdate) maybeUpdate();
    }, 15000);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
