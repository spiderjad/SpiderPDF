// Actualizaciones automáticas (proceso principal) con electron-updater, desde las versiones publicadas en GitHub
// (spiderjad/SpiderPDF, ver build.publish en package.json). Solo en la app instalada para Windows: en desarrollo no
// hay app-update.yml, y en macOS instalar exige la firma de Apple (Developer ID).
//
// Estado que ve la interfaz («update:changed»): { status, current (versión instalada), version?, percent?, message? }
//   unsupported  aquí no se puede actualizar (desarrollo, macOS, navegador)
//   idle         todavía no se ha buscado
//   checking     buscando
//   latest       no hay versión nueva
//   downloading  hay una versión nueva y se descarga en segundo plano (version, percent)
//   ready        descargada: botón «Reiniciar para actualizar» → install(); si no, se instala al salir
//   error        no se pudo buscar o descargar (sin conexión, GitHub caído…): message
// Lo único que no es puro es el autoUpdater que se le pasa: test/updater.test.js usa uno simulado.
'use strict';

/** La comprobación automática, como mucho cada 4 horas (cada ventana la pide al arrancar). */
const AUTO_EVERY = 4 * 60 * 60 * 1000;

/** Primera línea del error, corta (los de red traen cabeceras y trazas enteras). */
function shortMessage(e) {
  const s = String(e?.message ?? e ?? '').split('\n')[0].trim();
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

function createUpdater({ autoUpdater, enabled, current, onChange = () => {}, log = () => {}, now = Date.now }) {
  let state = { status: enabled ? 'idle' : 'unsupported', current };
  let lastAuto = -Infinity;
  const set = (next) => {
    state = { current, ...next };
    onChange(state);
  };
  const busy = () => ['checking', 'downloading', 'ready'].includes(state.status);

  if (enabled) {
    autoUpdater.autoDownload = true; // en segundo plano: el botón aparece cuando ya se puede instalar
    autoUpdater.autoInstallOnAppQuit = true; // si no se reinicia, se instala al salir
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => { if (!busy()) set({ status: 'checking' }); });
    autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: String(info?.version ?? ''), percent: 0 }));
    autoUpdater.on('download-progress', (p) => {
      if (state.status !== 'downloading') return;
      const percent = Math.max(0, Math.min(100, Math.floor(Number(p?.percent) || 0)));
      if (percent !== state.percent) set({ ...state, percent });
    });
    autoUpdater.on('update-not-available', () => set({ status: 'latest' }));
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: String(info?.version ?? state.version ?? '') }));
    autoUpdater.on('error', (e) => {
      log('actualizaciones: error', shortMessage(e));
      if (state.status !== 'ready') set({ status: 'error', message: shortMessage(e) });
    });
  }

  return {
    get state() { return state; },
    /** Buscar. auto: la de al arrancar (no más de una cada AUTO_EVERY, aunque haya varias ventanas). */
    async check({ auto = false } = {}) {
      if (!enabled || busy()) return state;
      if (auto) {
        if (now() - lastAuto < AUTO_EVERY) return state;
        lastAuto = now();
      }
      try {
        await autoUpdater.checkForUpdates();
      } catch (e) {
        if (state.status !== 'ready') set({ status: 'error', message: shortMessage(e) });
      }
      return state;
    },
    /** Cierra la app e instala la versión descargada (en silencio) y la vuelve a abrir. → false si no hay ninguna. */
    install() {
      if (state.status !== 'ready') return false;
      autoUpdater.quitAndInstall(true, true);
      return true;
    },
  };
}

module.exports = { createUpdater, shortMessage, AUTO_EVERY };
