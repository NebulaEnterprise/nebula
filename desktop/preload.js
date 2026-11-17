const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nebulaDesktop', {
  retry() {
    ipcRenderer.send('retry');
  },
  openImage(payload) {
    return ipcRenderer.invoke('open-image', payload);
  },
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
