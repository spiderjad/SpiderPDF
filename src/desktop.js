// API del escritorio (Electron). Si la app corre en un navegador normal,
// se usa una versión mínima para poder probar la interfaz igualmente.

/**
 * Versión del contrato interfaz ↔ preload ↔ proceso principal. Subirla A LA VEZ aquí, en
 * electron/preload.cjs (apiVersion) y en electron/main.cjs (DESKTOP_API) cada vez que cambie el IPC.
 * En desarrollo la interfaz se recarga sola pero el proceso principal no (y el preload solo al recargar
 * la ventana): si no coinciden, la app pide reiniciarla en vez de fallar en silencio.
 */
export const DESKTOP_API = 5;

let webShare = null;
const web = {
  platform: 'web',
  apiVersion: DESKTOP_API,
  async mainApiVersion() { return DESKTOP_API; },
  openPdfs() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf';
      input.multiple = true;
      input.onchange = async () => resolve(await Promise.all([...input.files].map(fileToEntry)));
      input.click();
    });
  },
  async pendingFiles() { return []; },
  // En el navegador no hay diálogo: se descarga con el nombre propuesto.
  async chooseSavePath({ defaultPath } = {}) { return (defaultPath ?? 'documento.pdf').split(/[\\/]/).pop(); },
  async savePdf({ bytes, suggestedName }) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: suggestedName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { path: null, name: suggestedName };
  },
  // La integridad de las firmas se comprueba en el proceso principal (node:crypto): en el navegador, no.
  async verifySignatures() { return null; },
  // Compartir en el navegador: solo se puede descargar la copia (sin portapapeles de archivos ni correo).
  async sharePrepare({ bytes, name }) { webShare = { bytes, name }; return { id: 'web', name, size: bytes?.byteLength ?? 0 }; },
  async shareCopyFile() { return { ok: false, code: 'sin-ayudante', message: 'En el navegador no se puede copiar un archivo.' }; },
  async shareMail() { return { ok: false, code: 'sin-cliente', message: 'En el navegador no se puede enviar por correo.' }; },
  async shareReveal() { if (webShare) await web.savePdf({ bytes: webShare.bytes, suggestedName: webShare.name }); return { ok: true }; },
  async shareWhatsApp() { window.open('https://web.whatsapp.com/', '_blank', 'noopener'); return { ok: true, desktop: false, copied: false }; },
  async shareAi(_id, provider) {
    window.open(provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://claude.ai/new', '_blank', 'noopener');
    return { ok: true, desktop: false, copied: false, provider };
  },
  // Sin rutas de archivo en el navegador: no hay recientes.
  async recents() { return []; },
  async addRecent() { return []; },
  async openRecent(p) { return { missing: true, name: String(p) }; },
  async clearRecents() { return []; },
  onRecents() { return () => {}; },
  // Imprimir en el navegador: las mismas hojas en un iframe oculto y el diálogo del navegador
  // (no hay lista de impresoras: el navegador elige).
  async printers() { return []; },
  async printBegin(opts) { const id = Date.now(); webPrintJobs.set(id, { opts, pages: [] }); return id; },
  async printPage(id, page) { webPrintJobs.get(id)?.pages.push(page); },
  async printCancel(id) { webPrintJobs.delete(id); },
  onPrintProgress() { return () => {}; },
  async printRun(id) {
    const job = webPrintJobs.get(id);
    webPrintJobs.delete(id);
    if (!job) return { ok: false, error: 'No hay páginas que imprimir.' };
    const { paper, title } = job.opts;
    const urls = job.pages.map((p) => URL.createObjectURL(new Blob([p.jpg], { type: 'image/jpeg' })));
    const frame = Object.assign(document.createElement('iframe'), { title: 'Imprimir' });
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(frame);
    const sheet = ({ box: { rotate, x, y, w, h } }, i) => {
      const [iw, ih] = rotate ? [h, w] : [w, h];
      return `<div class="s"><img src="${urls[i]}" style="left:${x + w / 2 - iw / 2}pt;top:${y + h / 2 - ih / 2}pt;width:${iw}pt;height:${ih}pt;${rotate ? 'transform:rotate(90deg)' : ''}"></div>`;
    };
    frame.srcdoc = `<!doctype html><title>${String(title ?? '').replace(/</g, '')}</title><style>@page{size:${paper.w}pt ${paper.h}pt;margin:0}html,body{margin:0}.s{position:relative;width:${paper.w}pt;height:${paper.h}pt;overflow:hidden;break-after:page}.s:last-child{break-after:auto}.s img{position:absolute}</style>${job.pages.map(sheet).join('')}`;
    await new Promise((r) => { frame.onload = r; });
    frame.contentWindow.print();
    setTimeout(() => { frame.remove(); urls.forEach(URL.revokeObjectURL); }, 60000);
    return { ok: true };
  },
  setDirty() {},
  setTitle(t) { document.title = t; },
  onMenu() { return () => {}; },
  menuRole() {},
  onFiles() { return () => {}; },
};

const webPrintJobs = new Map();

export async function fileToEntry(file) {
  return { name: file.name, path: window.desktop?.pathForFile?.(file) || null, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export const desktop = window.desktop ?? web;
