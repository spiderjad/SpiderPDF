// Enlaces de la versión web (pdf.spiderjad.com): el instalador de Windows de ESTA versión (la web y el .exe van a la
// par: npm run web:deploy no sube nada si ese instalador aún no está publicado en GitHub) y las novedades.
// Lo usan la interfaz (EmptyState en App.jsx, solo con __WEB__) y build/web-deploy.cjs.
export const REPO = 'https://github.com/spiderjad/SpiderPDF';

/** Instalador de Windows de esa versión en las Releases de GitHub (nombre que pone electron-builder). */
export const installerUrl = (version) => `${REPO}/releases/download/v${version}/SpiderPDF-Setup-${version}.exe`;

/** Novedades de cada versión (docs/novedades.md, el mismo texto que la release). */
export const NEWS_URL = `${REPO}/blob/main/docs/novedades.md`;
