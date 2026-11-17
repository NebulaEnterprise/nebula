const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nebulaDesktop', {
  retry() {
    ipcRenderer.send('retry');
  },
  openImage(payload) {
    return ipcRenderer.invoke('open-image', payload);
  },
  pictureLinks: true,
  overlayTitle: true,
  platform: process.platform,
  minimize() { ipcRenderer.send('win-min'); },
  toggleMax() { ipcRenderer.send('win-max'); },
  close() { ipcRenderer.send('win-close'); },
  onState(fn) { ipcRenderer.on('win-state', (_event, maximized) => fn(!!maximized)); },
  onFull(fn) { ipcRenderer.on('win-full', (_event, full) => fn(!!full)); },
  onSources(fn) {
    ipcRenderer.on('sources', (_event, rows) => fn(rows));
  },
  choose(id) {
    ipcRenderer.send('source-chosen', id);
  },
  cancel() {
    ipcRenderer.send('source-cancel');
  },
});
