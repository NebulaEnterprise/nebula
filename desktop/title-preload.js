const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nebulaChrome', {
  platform: process.platform,
  minimize() { ipcRenderer.send('win-min'); },
  toggleMax() { ipcRenderer.send('win-max'); },
  close() { ipcRenderer.send('win-close'); },
  onState(fn) { ipcRenderer.on('win-state', (_event, maximized) => fn(!!maximized)); },
});
