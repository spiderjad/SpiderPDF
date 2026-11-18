const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, cb) {
  const handler = (_event, value) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  apiVersion: 13, // = DESKTOP_API de src/desktop.js y de main.cjs (subirlas a la vez)
  mainApiVersion: () => ipcRenderer.invoke('app:apiVersion'),
  openPdfs: () => ipcRenderer.invoke('dialog:open'),
  pendingFiles: () => ipcRenderer.invoke('files:pending'),
  savePdf: (opts) => ipcRenderer.invoke('file:save', opts),
  chooseSavePath: (opts) => ipcRenderer.invoke('dialog:saveAs', opts),
  chooseFolder: (opts) => ipcRenderer.invoke('dialog:chooseFolder', opts),
  setLang: (lang) => ipcRenderer.send('app:setLang', String(lang)),
  setTheme: (theme) => ipcRenderer.send('app:setTheme', String(theme)),
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
  // Pestañas: informar de las abiertas, pasar una a otra ventana, recibir la que llega y recordar la sesión.
  reportTabs: (info) => ipcRenderer.send('tabs:report', info),
  onActivateTab: (cb) => subscribe('tabs:activate', cb),
  detachTab: (snapshot, point) => ipcRenderer.invoke('tab:detach', snapshot, point),
  pendingTab: () => ipcRenderer.invoke('tab:pending'),
  tabAdopted: (ok) => ipcRenderer.send('tab:adopted', !!ok),
  restoreSession: () => ipcRenderer.invoke('session:restore'),
  // Dividir: qué destinos existen ya y «Mostrar en la carpeta».
  filesExist: (paths) => ipcRenderer.invoke('files:exist', paths),
  revealFile: (path) => ipcRenderer.invoke('file:reveal', String(path)),
  // Actualizaciones (GitHub): estado, buscar, reiniciar para instalar y avisos de cambio de estado.
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: (o) => ipcRenderer.invoke('update:check', { auto: !!o?.auto }),
  updateInstall: (o) => ipcRenderer.invoke('update:install', { discard: !!o?.discard }),
  onUpdate: (cb) => subscribe('update:changed', cb),
  openLink: (url) => ipcRenderer.invoke('link:open', String(url)),
  exportSave: (o) => ipcRenderer.invoke('export:save', o),
  exportOpen: (path) => ipcRenderer.invoke('export:open', String(path)),
  sharePrepare: (o) => ipcRenderer.invoke('share:prepare', o),
  shareCopyFile: (id) => ipcRenderer.invoke('share:copyFile', id),
  shareMail: (id, subject) => ipcRenderer.invoke('share:mail', id, subject),
  shareReveal: (id) => ipcRenderer.invoke('share:reveal', id),
  shareSystem: (id) => ipcRenderer.invoke('share:system', id), // solo macOS
  shareWhatsApp: (id) => ipcRenderer.invoke('share:whatsapp', id),
  shareAi: (id, provider) => ipcRenderer.invoke('share:ai', id, provider),
});
