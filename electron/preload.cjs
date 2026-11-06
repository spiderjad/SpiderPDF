const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, cb) {
  const handler = (_event, value) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  apiVersion: 9, // = DESKTOP_API de src/desktop.js y de main.cjs (subirlas a la vez)
  mainApiVersion: () => ipcRenderer.invoke('app:apiVersion'),
  openPdfs: () => ipcRenderer.invoke('dialog:open'),
  pendingFiles: () => ipcRenderer.invoke('files:pending'),
  savePdf: (opts) => ipcRenderer.invoke('file:save', opts),
  chooseSavePath: (opts) => ipcRenderer.invoke('dialog:saveAs', opts),
  chooseFolder: (opts) => ipcRenderer.invoke('dialog:chooseFolder', opts),
  setLang: (lang) => ipcRenderer.send('app:setLang', String(lang)),
  pathForFile: (file) => webUtils.getPathForFile(file),
  verifySignatures: (bytes) => ipcRenderer.invoke('pdf:verifySignatures', bytes),
  recents: () => ipcRenderer.invoke('recents:list'),
  addRecent: (path) => ipcRenderer.invoke('recents:add', String(path)),
  openRecent: (path) => ipcRenderer.invoke('recents:open', String(path)),
  clearRecents: () => ipcRenderer.invoke('recents:clear'),
  onRecents: (cb) => subscribe('recents:changed', cb),
  printers: () => ipcRenderer.invoke('print:printers'),
  printBegin: (opts) => ipcRenderer.invoke('print:begin', opts),
  printPage: (id, page) => ipcRenderer.invoke('print:page', id, page),
  printRun: (id) => ipcRenderer.invoke('print:run', id),
  printCancel: (id) => ipcRenderer.invoke('print:cancel', id),
  onPrintProgress: (cb) => subscribe('print:progress', cb),
  setDirty: (dirty) => ipcRenderer.send('state:dirty', dirty),
  setTitle: (title) => ipcRenderer.send('state:title', title),
  onMenu: (cb) => subscribe('menu', cb),
  menuRole: (role) => ipcRenderer.send('menu:role', String(role)),
  onFiles: (cb) => subscribe('files:incoming', cb),
  openLink: (url) => ipcRenderer.invoke('link:open', String(url)),
  exportSave: (o) => ipcRenderer.invoke('export:save', o),
  exportOpen: (path) => ipcRenderer.invoke('export:open', String(path)),
  sharePrepare: (o) => ipcRenderer.invoke('share:prepare', o),
  shareCopyFile: (id) => ipcRenderer.invoke('share:copyFile', id),
  shareMail: (id, subject) => ipcRenderer.invoke('share:mail', id, subject),
  shareReveal: (id) => ipcRenderer.invoke('share:reveal', id),
  shareWhatsApp: (id) => ipcRenderer.invoke('share:whatsapp', id),
  shareAi: (id, provider) => ipcRenderer.invoke('share:ai', id, provider),
});
