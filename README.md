# SpiderPDF

Editor de PDF de escritorio propio (Windows y macOS), sin servicios externos. El motor es **PDFium** (el de Chrome)
compilado a WebAssembly, licencia Apache 2.0 / MIT: se puede vender cerrado.

## Qué hace ya
- Abrir uno o varios PDFs (botón, arrastrando a la ventana o doble clic en un .pdf)
- Unir PDFs: "Añadir PDF" o soltarlos entre dos páginas
- Reordenar arrastrando (también varias páginas a la vez)
- Girar, eliminar y extraer páginas a un PDF nuevo
- Deshacer / rehacer ilimitado (100 pasos)
- Modo lectura con zoom y ajuste al ancho
- Tema claro y oscuro según el sistema
- Aviso al cerrar con cambios sin guardar

## Empezar
Requiere Node 20 o superior.

    npm install
    npm test        # pruebas del motor y del estado
    npm run dev     # abre la app de escritorio en modo desarrollo
    npm run web     # la misma interfaz en el navegador (http://localhost:5173)

## Generar instaladores
    npm run dist:win   # .exe (ejecutar en Windows)
    npm run dist:mac   # .dmg (ejecutar en Mac)

Sin firma de código, Windows y macOS avisarán al instalar. Eso se resuelve al final.

## Estructura
    electron/main.cjs        ventana, menú, diálogos, guardado seguro, asociación .pdf
    electron/preload.cjs     puente mínimo y seguro entre Electron y la interfaz
    src/engine/pdfium-core.js  núcleo PDF (sin DOM, probado en Node)
    src/engine/pdf.worker.js   PDFium corre en un Worker: la interfaz nunca se congela
    src/engine/client.js       llamadas al worker y caché de renders
    src/state.js             estado: páginas, selección, deshacer
    src/components/          barra, vista Organizar, vista Leer
    test/                    pruebas y PDFs de ejemplo (node test/make-fixtures.js)

## Idea clave
Los PDFs abiertos no se modifican. La app trabaja con una lista de referencias
de página (documento, número, giro) y al guardar construye un PDF nuevo con ellas.
Por eso unir, reordenar, deshacer y extraer son operaciones baratas y seguras.
