// npm run qpdf:build → compila qpdf a WebAssembly en la imagen de Emscripten fijada por su digest (ver build.sh).
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const IMAGE = 'emscripten/emsdk@sha256:77638e6c215a65f25a704c0c831d5c2463a8c0468a58c6cb82489dbe621dfa05'; // 6.0.12
const repo = path.resolve(__dirname, '..', '..');
const r = spawnSync('docker', ['run', '--rm', '-v', `${repo}:/repo`, IMAGE, 'bash', '/repo/build/qpdf/build.sh'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
