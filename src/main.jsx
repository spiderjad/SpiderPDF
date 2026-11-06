import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { migrateStorage } from './storageMigration.js';
import { setLang, resolveLang } from './i18n/index.js';
import { loadPrefs } from './prefs.js';
import 'spider-ui/spider-ui.css'; // sistema de diseño spider-ui (clases v-*): una sola vez, antes del CSS propio
import './index.css';

// Antes de pintar: firmas y preferencias guardadas con el nombre anterior de la app.
try { migrateStorage(globalThis.localStorage); } catch { /* sin almacenamiento */ }

// Idioma antes de pintar: el de Preferencias o, en «Automático», el del sistema (src/i18n).
const languages = [...(navigator.languages ?? [navigator.language])];
setLang(resolveLang(loadPrefs().lang, languages), languages);

createRoot(document.getElementById('root')).render(<App />);
