import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { migrateStorage } from './storageMigration.js';
import './index.css';

// Antes de pintar: firmas y preferencias guardadas con el nombre anterior de la app.
try { migrateStorage(globalThis.localStorage); } catch { /* sin almacenamiento */ }

createRoot(document.getElementById('root')).render(<App />);
