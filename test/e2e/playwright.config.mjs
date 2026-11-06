// Pruebas de extremo a extremo con la app de Electron real (Playwright _electron).  npm run test:e2e
// Usan la interfaz compilada (dist/, protocolo app://), como la app empaquetada, y nunca tocan
// test/fixtures: cada prueba trabaja con copias en una carpeta temporal.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  outputDir: '../out/e2e-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1, // una ventana de Electron cada vez
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
