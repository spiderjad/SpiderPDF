# SpiderPDF — guía para Claude Code

**SpiderPDF**: editor de PDF de escritorio (Windows y Mac) propio, **sin servicios externos**.
(La carpeta del proyecto sigue llamándose `pdf-editor`; el producto, el paquete npm y todo lo visible es SpiderPDF.)
El objetivo es poder venderlo cerrado, así que las licencias importan (ver abajo).
Interfaz en **español, inglés y catalán** (ver «Idiomas»); el español es el original. El autor es Diego (programador,
Argentina, trabaja en España).

## Comandos
- `npm test`: pruebas del estado y del motor en Node. Ejecutar siempre tras tocar `src/engine` o `src/state.js`.
- `npm run test:e2e`: compila la interfaz y prueba la **app de Electron real** con Playwright (`_electron.launch`,
  `test/e2e/*.spec.mjs`): firmas, guardado incremental, marcadores, insertar páginas. **Regla: nada que toque Electron
  (proceso principal, preload, IPC, diálogos, guardado, o cualquier cosa que se vea en la ventana) se da por terminado sin
  `npm run test:e2e` en verde.** Las pruebas trabajan con copias en una carpeta temporal (nunca abren `test/fixtures`),
  arrancan con su propia carpeta de datos (`SPIDERPDF_USER_DATA`, así no chocan con una ventana abierta) y sustituyen los
  diálogos nativos desde el proceso principal (`stubOpen`, `stubSaveAs` en `test/e2e/helpers.mjs`).
- `npm run dev`: app Electron con recarga en caliente.
- `npm run web`: la misma interfaz en el navegador (http://localhost:5173), útil para depurar UI.
- `node test/make-fixtures.js`: regenera los PDFs de ejemplo de `test/fixtures`.
- `npm run dist:win` / `npm run dist:mac`: instaladores.

## Arquitectura
- **Motor: solo PDFium** (`@embedpdf/pdfium`, WebAssembly, MIT + Apache 2.0). No añadir pdf-lib al runtime (solo se usa en tests para crear fixtures).
- `src/engine/pdfium-core.js`: clase `PdfCore`. Sin DOM, se prueba en Node. Toda la lógica PDF va aquí.
- `src/engine/pdf.worker.js`: ejecuta `PdfCore` en un Web Worker (la UI nunca se bloquea).
- `src/engine/client.js`: RPC al worker + caché LRU de renders (`renderPage`, `scaleFor`).
- `src/geometry.js`: conversiones de coordenadas compartidas por UI y motor.
- `src/state.js`: reducer puro (páginas, selección, deshacer/rehacer). Probado en Node.
- `src/components/`: Toolbar, OrganizeView (cuadrícula con arrastrar y soltar), ReaderView (lectura con zoom), PageImage.
- `electron/main.cjs`: ventana, menú nativo (solo macOS), diálogos, guardado atómico (temporal + rename), protocolo `app://` con CSP estricta, una sola instancia, asociación de `.pdf`.
- **Menú:** Archivo, Editar y Ver se definen una sola vez en `electron/menu.json` (etiqueta, `cmd` o `role`, `accel`, variantes `mac`, `dev`).
  - macOS: `main.cjs` construye con él el menú nativo, que gestiona los atajos con Cmd.
  - Windows y Linux: sin menú nativo (`Menu.setApplicationMenu(null)`) y ventana con `titleBarStyle: 'hidden'` + `titleBarOverlay`
    (los botones de ventana los pinta el sistema con los colores de `--panel`/`--ink`). `src/components/TitleBar.jsx` dibuja los menús
    (teclado completo: Alt/F10, Alt+letra, flechas, Intro, Esc) y `src/menu.js` deriva de `menu.json` los atajos que maneja `App.jsx`.
  - Las acciones de ventana (`quit`, `toggleDevTools`, `reload`) van por IPC `menu:role` con lista cerrada.
  - Para añadir una opción: entrada en `menu.json` + `case` en `run()` de `App.jsx` + su condición en `enabled`.
- `electron/preload.cjs`: expone `window.desktop`. `src/desktop.js` tiene un sustituto para el navegador.
- **En desarrollo el proceso principal no se recarga nunca y el preload solo al recargar la ventana**; la interfaz sí
  (HMR). Tras cambiar `main.cjs`, `preload.cjs` o el IPC hay que cerrar y volver a abrir la app. Para que no falle en
  silencio: `DESKTOP_API` (en `src/desktop.js`, `apiVersion` en el preload y `DESKTOP_API` en `main.cjs`, **subirlas a la
  vez** al cambiar el IPC); si no coinciden, la app pide reiniciarla. Toda llamada a `desktop.*` nueva debe tolerar que
  falte (preload antiguo) sin romper lo demás.

## Ideas clave (no romper)
1. **Los PDFs abiertos son fuentes inmutables.** La UI trabaja con referencias de página
   `{ key, docId, index, width, height, rot0, rot, source, annots, fields }`.
   Al guardar, `compose(refs)` construye el resultado.
2. **`compose` edita una COPIA del PDF que más páginas aporta** (no un PDF vacío), para conservar
   AcroForm, marcadores y metadatos. Las páginas de otros PDFs se importan; sus formularios
   quedan rellenados pero no interactivos (limitación conocida).
3. **Coordenadas de anotaciones: fracciones de página SIN rotar** (u: 0 izquierda a 1 derecha,
   v: 0 arriba a 1 abajo, sobre el CropBox). Para pintar en pantalla usar `toDisplay` / `rectToDisplay`
   con `R = (rot0 + rot) % 4`. Así la anotación gira con la página.
4. Las imágenes (firmas) guardan `k` = rotación de pantalla al colocarlas; `imageMatrix(k, …)` las deja derechas.
5. Tras crear anotaciones, `applyAnnots` renderiza la página a 1x1 para que PDFium genere y persista el `/AP`.
6. Cada página original aparece como mucho una vez en `refs` (la UI no duplica páginas).

## Reglas del proyecto
- **Nunca capturar la pantalla completa ni otras ventanas.** Solo la ventana de SpiderPDF (por su handle o con las APIs de
  Electron/Playwright: `win.screenshot`, `webContents.capturePage`). Ante la duda, preguntar a Diego.
- **No cerrar procesos que no haya arrancado yo** (Electron, Node, terminales, servidores) sin preguntar antes a Diego.
  Los míos (por ejemplo un `npm run dev` lanzado en segundo plano) sí se pueden parar.
- Versiones de npm **fijadas exactas** y publicadas hace **más de 14 días** (seguridad de la cadena de suministro).
- **Licencias:** nada AGPL/GPL en el producto (no MuPDF, no Ghostscript, no PyMuPDF/pdf2docx). Preferir MIT/Apache/BSD/MPL.
- Electron: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Nada de Node en el renderer.
- Diseño: **spider-ui** (skill `spider-ui`, guía en `node_modules/spider-ui/GUIDE.md`; ver «Diseño»). Sin mayúsculas en etiquetas.
- Textos de la UI: frases cortas, voz activa, el botón dice lo que hace ("Guardar", "Extraer"). **Ningún texto
  visible escrito a mano en el código:** siempre `t('clave')` con su traducción en es, en y ca (ver «Idiomas»).
- Cada función nueva del motor lleva su prueba en `test/engine.test.js`.

## Diseño
Sistema de diseño **spider-ui**, el de todos los proyectos de Diego (repositorio privado `spiderjad/spider-ui`, instalado
como `github:spiderjad/spider-ui#<commit>`, fijado al commit; importado una sola vez en `src/main.jsx`). Antes de tocar
interfaz: leer `node_modules/spider-ui/GUIDE.md` (la skill `spider-ui` lo pide). Lo visual sale del paquete; aquí, solo
disposición.
- **Desde 1.1.0** (añadido para SpiderPDF): modo oscuro (`prefers-color-scheme`, o `data-theme`), tokens `--sp-canvas`,
  `--sp-bg-muted`, `--sp-inverse`… y los componentes `v-btn-ghost`, `v-btn-icon`, `v-toolbar` (`--sub`), `v-segmented`,
  `v-menu`, `v-dialog` y `v-kbd`. Lo que falte y se vaya a repetir en otros proyectos, se propone para el paquete
  (no se inventa aquí). Para publicar un cambio: clonar, editar, comprobar `demo.html` en claro y oscuro (contraste AA),
  subir `version`, push, y en SpiderPDF `npm install github:spiderjad/spider-ui#<commit nuevo>`.
- **Pantallas nuevas o reescritas:** clases `v-*` y CSS propio por pantalla con prefijo y comentario (`hd-` cabecera
  `Toolbar.css`, `tb-` barra de título, `at-` herramientas de Leer, `og-` Organizar, `cfg-` Preferencias). Colores
  solo con `var(--sp-*)`. Modales nuevos: `<dialog class="v-app v-dialog">` con `showModal()` (como `PreferencesDialog`).
- **El resto de la app** (diálogos antiguos con Tailwind): los nombres de siempre (`bg-panel`, `text-muted`, `bg-accent`,
  `bg-desk`, `bg-inverse`…) apuntan a los tokens de spider-ui en `src/index.css`, así que ya tienen su aspecto y su modo
  oscuro. Radios y sombras de Tailwind = los del paquete (6 / 10 px). Al tocarlos, pasarlos a `v-*`.
- **Colores:** botón primario `v-btn-primary` (negro en claro, casi blanco en oscuro: `bg-inverse` en Tailwind); el
  violeta `--sp-primary` (= `--accent`) solo para selección, estado, inserción y marcas («Cambios sin guardar»).
  Foco: `--sp-focus`.
- **Reglas propias:** las páginas son lo único blanco puro (`.paper`) sobre `--sp-canvas` (`--desk`), también en
  oscuro; botones sobre la página siempre oscuros (`--overlay`); campos de formulario del PDF con colores fijos.
- **Fuente:** Inter Variable (`@fontsource-variable/inter` 5.3.0, local); `--sp-font` la incluye desde 1.1.0.
  **Iconos:** lucide `strokeWidth={1.75}`, 16 px. **Movimiento:** 150–200 ms, desactivado con `prefers-reduced-motion`.
- **Cabecera** (`Toolbar.jsx`): archivo · vista (`v-segmented`) · deshacer · páginas · (zoom en Leer) · Exportar ▾,
  Compartir, Guardar. En ventanas estrechas (y antes en Leer) los botones con texto quedan en icono.
- **Organizar** (`OrganizeView.jsx`): fichas con casilla de selección (añade o quita sin perder lo demás), número en
  pastilla, PDF de origen con su color, acciones sobre la miniatura, ficha final «Añadir PDF»; barra superior con
  resumen, «Seleccionar todo / Quitar la selección» y tamaño de miniaturas (pequeñas, medianas, grandes; recordado en
  `spiderpdf:organizar`). Teclado: flechas, Inicio/Fin, Espacio marca, Intro abre.

## Idiomas
Español (original), inglés y catalán. **Todo texto visible pasa por `t()`** (`src/i18n/index.js`).
- Idioma: Preferencias → Idioma (`prefs.lang`: `auto`, `es`, `en`, `ca`). En «Automático», el idioma **principal** del
  sistema (`navigator.languages[0]`, que en Electron es el de Windows/macOS): catalán → ca, español → es, inglés o
  cualquier otro → en. Se aplica antes de pintar (`main.jsx`) y al cambiarlo, sin reiniciar.
- `t('area.componente.clave', { param })`; plurales `clave_one` / `clave_other` con `{ count }` (Intl.PluralRules);
  `useT()` en componentes (repinta al cambiar). Nunca `t()` en el nivel superior de un módulo: en constantes, claves.
  `formatNumber` y `getLocale()` para números y fechas de la interfaz.
- Textos por área en `src/i18n/strings/*.js` (`core`: App, cabecera, herramientas, Organizar, Preferencias, menú;
  `dialogs`, `export`, `reader`, `engine`), cada uno con `{ es, en, ca }`. Menús: etiquetas `{ es, en, ca }` en
  `electron/menu.json`. Proceso principal (diálogos nativos, menú de macOS, firmas): `electron/strings.json` con
  `T()` de `electron/i18n.cjs`; la ventana le manda el idioma con `app:setLang` (`DESKTOP_API` = 9) y al motor con
  `pdf.setLang` (sus errores y avisos).
- `test/i18n.test.js`: mismas claves y `{parámetros}` en los tres idiomas, sin claves repetidas entre áreas, menú y
  `strings.json` completos. Las e2e corren en español (`launch(…, { lang: 'es-ES' })`, `--lang` de Chromium);
  `test/e2e/idiomas.spec.mjs` prueba inglés, catalán, un idioma que no tenemos (→ inglés) y el cambio en Preferencias.
- Estilo: es con tú; en sencillo y en minúsculas salvo la primera; ca central (Softcatalà), imperativo en botones
  (Desa, Obre, Cancel·la). Comillas «» en es y ca, “ ” en en. Glosario: Redactar → Redact → **Censura**.

## Estado actual
**Paso 1 (hecho y probado):** abrir, unir, reordenar arrastrando, girar, eliminar, extraer, deshacer, lectura con zoom.

**Paso 2 (hecho y probado):** anotaciones, formularios y firma gráfica.
- Hecho y probado en el motor (`pdfium-core.js` v2): `compose` sobre copia del original, `fields()`,
  `fillFields()`, `applyAnnots()` (resaltado, tinta, nota), `addImage()` (firma con transparencia),
  `FPDF_FFLDraw` al renderizar. `open()` devuelve `rot0` por página y `hasForm`.
  Pruebas en `test/engine.test.js` (formulario, AcroForm, `/AP`, SMask, firma derecha en 0/90/180/270).
- Las páginas con formulario que vienen de un PDF que **no** es la base se **aplanan** (`FPDFPage_Flatten`)
  antes de importarlas: si no, sus widgets quedan fuera del AcroForm y no se dibujan. Efecto: también se
  aplanan las anotaciones previas de esas páginas.
- Hecho y probado: `src/geometry.js` (`test/geometry.test.js`). Fixture `test/fixtures/formulario.pdf`.
- `npm run dev` desde la terminal de VS Code falla si `ELECTRON_RUN_AS_NODE=1` está definida (la hereda de VS Code):
  quitarla antes (`unset ELECTRON_RUN_AS_NODE` / `Remove-Item Env:ELECTRON_RUN_AS_NODE`).
- Hecho y probado: `state.js` con `rot0`, `annots` y `fields` en cada página; acciones `addAnnot` (asigna `id` y la selecciona),
  `updateAnnot` (con `group: true` agrupa un arrastre en un solo paso de deshacer), `removeAnnot`, `selectAnnot`
  (`annotSel: { key, id }`) y `setField` (escribir seguido en el mismo campo = un paso). La agrupación usa `lastTag` en `commit`.
- Hecho y probado (en navegador): worker/client `pdf.fields(docId, index)` con caché (se limpia al cerrar);
  `pdf.compose(pages)` recibe las páginas del estado y envía `annots` y `fields`. Una firma se guarda en el estado como
  `{ type: 'image', rect, k, src }` (data URL o Blob) y el client la pasa a RGBA antes del worker (sin `fetch`: CSP).
  "Guardar" ya incluye anotaciones y campos.
- Hecho y probado en navegador: UI de anotación en modo Leer.
  - `AnnotToolbar.jsx`: Seleccionar, Resaltar, Lápiz, Nota, Firma y paleta de 4 colores por herramienta (estado `tool`/`colors` en `App.jsx`, no en el reducer).
  - `PageOverlay.jsx` (una por página en `ReaderView`): SVG con las anotaciones; dibuja, mueve (`updateAnnot` + `group`, `endGroup` al soltar),
    redimensiona firmas por la esquina (mantiene proporción); notas como botones HTML con editor (`NoteEditor`);
    campos de formulario como inputs HTML (`.pdf-field`, colores fijos porque el papel es blanco) que giran con la página.
  - Teclado: Supr borra la anotación seleccionada (si no hay, las páginas); Esc deselecciona, luego vuelve a Seleccionar.
  - El borrador de un trazo vive en una ref (no en el estado de React) para no perder el último punto al soltar.
  - Límites conocidos: el resaltado es un rectángulo (no sigue el texto); `hasForm` se guarda por página y solo esas piden `pdf.fields`.
- Hecho y probado en navegador: modal de firma (`SignatureDialog.jsx`), abierto con el botón Firma.
  - Dibujar: pointer events con `getCoalescedEvents`, curvas cuadráticas entre puntos medios, grosor según velocidad
    (o presión con lápiz), tinta negra o azul (cambiar el color repinta todo), Borrar. Se exporta a 2x y se recorta al contenido.
  - Subir imagen: PNG/JPG/WebP (botón o arrastrar), reducida a 1200 px; "Quitar el fondo blanco" (umbral de luminancia con borde suave)
    y recorte; vista previa sobre cuadros (`.checker`).
  - Últimas 5 firmas en `localStorage` (`spiderpdf:firmas`, solo `data:image/`, máx. 400 KB cada una, todo en try/catch).
  - Diálogo accesible: `aria-modal`, foco atrapado, Esc cierra y devuelve el foco; con un diálogo abierto `App.jsx` ignora los atajos globales.
  - Lógica pura en `src/signature.js` con pruebas en `test/signature.test.js`.
- Hecho y probado en navegador: anotaciones y valores de formulario cambiados en las miniaturas (Organizar y barra lateral de Leer).
  `AnnotShapes.jsx` tiene `AnnotShape` (una anotación en SVG, compartida con `PageOverlay`) y `AnnotPreview` (solo lectura).
- **Paso 2 terminado.**

**Paso 3 (hecho y probado):** editar texto existente y redacción real.
- Motor (`pdfium-core.js`, probado en `engine.test.js`):
  - `textRuns(docId, index)`: objetos de texto de primer nivel → `{ objIndex, text, rect, origin (línea base), ptSize, angle, color, fontName, invisible }`.
  - `applyTextEdits(entry, index, { objIndex: { text, from } })`: sustituye cada objeto por uno nuevo con **fuente estándar**
    (Helvetica/Times/Courier según el nombre, negrita/cursiva) y el mismo tamaño, matriz, color y modo de pintado; `''` lo borra.
    Si el texto actual no coincide con `from`, lanza error en vez de tocar nada. Orden descendente de `objIndex`.
  - `redact(entry, index, zonas)`: carácter a carácter (cualquier caja que toque la zona se elimina; el resto del objeto se
    reescribe letra a letra en su origen exacto con fuente estándar); imágenes: píxeles a negro con `blackenImage`
    (o se quitan si quedan dentro); formas dentro: fuera; anotaciones que tocan: fuera; recuadro negro encima.
    Los campos de formulario que tocan la zona se eliminan. Avisos (`core.warnings`) para eso y para contenido agrupado
    (Form XObject) que solo se tapa.
  - **Guardado limpio (`cleanSave`)**: si hay alguna redacción, el resultado no es una copia del original sino un PDF nuevo
    que importa las páginas ya redactadas. Así no viajan objetos sueltos (PDFium guarda los objetos huérfanos, p. ej. las
    apariencias que genera para anotaciones luego borradas), versiones anteriores ni guardados incrementales.
    Se copian metadatos Info y marcadores salvo los que nombran una **palabra borrada entera** (`redactedText`; los trozos
    cortados por el borde de la zona no cuentan), preferencias de vista e idioma. No se copian: XMP, formulario interactivo
    (los campos restantes se aplanan con `EPDFAnnot_Flatten`), adjuntos ni JavaScript.
  - **Un documento con redacciones nunca se guarda sobre el original** (`src/savePlan.js`, probado en `test/save.test.js`):
    Guardar y Ctrl+S abren siempre el diálogo (IPC `dialog:saveAs`, separado de la escritura `file:save`) con
    «<nombre> (redactado).pdf» en la carpeta del original. Si el destino es uno de los PDF de partida (`replacesOriginal`,
    sin distinguir mayúsculas ni barras en Windows), confirmación aparte: «Vas a reemplazar el original. El texto redactado
    no se podrá recuperar.» Tras guardar, la ventana reabre el archivo guardado (acción `open`): se trabaja con la copia
    redactada, sin historial ni zonas pendientes. Sin redacciones, Guardar sigue escribiendo directamente.
  - Prueba forense en `engine.test.js` (+ `test/forensics.js`): descomprime todos los flujos (también dentro de `/ObjStm`
    y los no referenciados) y busca la palabra como texto, hex WinAnsi, hex/bytes UTF-16 y en cadenas troceadas;
    comprueba que no hay huérfanos ni más de un `%%EOF`, metadatos, marcadores, campos, notas y píxeles de imagen.
    Herramienta manual: `node test/scan-pdf.js <palabra> <archivo.pdf>`.
  - `test/make-fixtures.js` exporta sus generadores; las pruebas los usan para no depender de los archivos de `test/fixtures`
    (se pueden haber editado a mano desde la app).
  - En `compose`: las páginas con `textEdits` o anotaciones `redact` se trabajan sobre la copia antes de montar el documento.
    El worker devuelve `{ bytes, warnings }`.
- Estado: `page.textEdits` y acción `setTextEdit` (volver al original quita la edición). Las zonas son anotaciones `{ type: 'redact', rect }`
  (se mueven, borran y deshacen como el resto).
- UI: herramientas Texto (`TextLayer.jsx`: bloques al pasar el ratón, editor en línea anclado en la línea base, vista previa
  tapando el original) y Redactar (rectángulo gris con borde rojo discontinuo; se ve debajo hasta guardar). Guardar con zonas pide confirmación
  y muestra los avisos.
- Capas en Leer (`PageOverlay`, de abajo arriba): resaltados y tinta → notas → firmas → texto editado → campos →
  zonas a redactar, avisos y selección. `LAYER`/`byLayer` en `AnnotShapes.jsx` (las miniaturas usan el mismo orden).
- Zona a redactar pendiente: rayado `--danger` al 18 % + borde sólido 1,5 px; negro al pasar el ratón; etiqueta
  "Se borrará al guardar" al seleccionarla; en miniaturas, negro sólido. Selección única: contorno 1 px `--accent` y asas
  cuadradas en las 4 esquinas solo para lo redimensionable (firma con proporción fija, zona y resaltado libres).
- La redacción se aplica **después** de las anotaciones del usuario: lo que tocan las zonas no se llega a crear (si se creara y
  se borrara, PDFium guardaría el objeto suelto con su contenido) y las firmas que la tocan en parte quedan con esos píxeles en negro.
  `src/conflicts.js` (probado) detecta firmas, notas y textos editados encima de una zona: toast al aparecer, borde `--danger`
  y confirmación extra al guardar.
- Límites conocidos: el texto editado o el que queda junto a una redacción usa fuente estándar (puede verse distinto si el original
  era otra fuente); tras redactar, ese resto queda en objetos de una letra (editar después con Texto va letra a letra);
  no se edita texto dentro de Form XObjects.

**Funciones básicas, tanda 1 (hecha, pendiente del visto bueno en Electron):** texto de la página, seleccionar, copiar y buscar.
- Motor: `textChars(docId, index)` → `{ text, boxes, generated, hasText }`: un carácter de PDFium por posición, caja **holgada**
  (`FPDFText_GetLooseCharBox`: alto de línea completo y espacios con anchura, para que selección y resultados se vean continuos)
  en fracciones sin rotar; `generated` marca los «\r\n» que añade PDFium. `searchPage(docId, index, query)` → `{ hasText, matches: [{ start, end, rects }] }`.
  En páginas giradas las cajas son las mismas (sin rotar) pero PDFium puede cambiar el orden de lectura.
- `src/textGeom.js` (probado en `test/text.test.js`, lo usan motor e interfaz): `normalizeForSearch` (sin mayúsculas ni tildes,
  NFKD, espacios y saltos de línea = un espacio, con mapa a los caracteres originales), `findMatches`, `lineRects` (un
  rectángulo por línea), `caretAt` (primero la línea más cercana en vertical, luego la letra; como un navegador), `charIndexAt`,
  `wordAt`, `selectedText`, `hasRealText`.
- Client: `pdf.textChars` con caché por página (se limpia al cerrar), `pdf.search` sin caché.
- Seleccionar y copiar (`PageOverlay`, herramienta Seleccionar): los caracteres se piden cuando la página se acerca a la vista
  (IntersectionObserver); arrastrar selecciona por caracteres respetando líneas (si se pulsa antes de que lleguen, el arrastre
  espera); doble clic = palabra; cursor de texto sobre las letras. Estado `textSel { key, a, b }` en `App.jsx` (se suelta al
  cambiar de herramienta, vista o páginas; Esc también). Editar → Copiar (Ctrl+C, `cmd: copy`): en un input copia lo del input;
  si no, `navigator.clipboard.writeText` (con respaldo `execCommand`).
- Buscar (Ctrl+F, `cmd: find`, también lupa en la barra en Leer): `SearchBar.jsx` + `useSearch` recorren las páginas de una en
  una en el worker (cancelable, con espera de 180 ms al teclear) y muestran resultados según llegan; «3 de 12», Intro / Mayús+Intro,
  Esc. Todos los resultados en amarillo, el actual en `--accent` con contorno; `ReaderView.scrollToHit` lo centra.
  Páginas sin texto: aviso en la barra («La página 3 es una imagen; la búsqueda necesitará OCR.») y etiqueta sobre la página.
- Fixture nuevo `test/fixtures/escaneo.pdf` (solo imagen), generado por `escaneo()` en `make-fixtures.js`.
- **Renders de páginas** (`PageImage.jsx` + `src/renderDraw.js`, probado en `test/render.test.js`): cada render pide un
  turno y solo el último cuenta (un render obsoleto que falle no marca la página); el aviso se limpia al empezar cada render y
  solo sale si no hay ninguna imagen; si el `ImageBitmap` llega cerrado (expulsado de la caché) se pide uno nuevo una vez
  (`renderPage(page, scale, { fresh: true })`). La caché ya no cierra los bitmaps al expulsarlos sino 5 s después.
  En miniaturas (< 180 px) el aviso es solo un icono con tooltip.
- **Panel lateral de Leer** (`PageSidebar.jsx`): pestañas «Páginas» / «Marcadores» (desactivada hasta la tanda 2), plegable,
  ancho 160–320 px (por defecto 200; arrastrar el borde, flechas sobre el borde, doble clic = 200) guardado en
  `localStorage` `spiderpdf:panel`. Fila actual con `bg-accent-soft` y número en `--accent`; puntos: rojo = redacción
  pendiente, violeta = otros cambios. Arrastrar filas reordena (`move`); con el foco en la lista, flechas/Inicio/Fin cambian de página.
- **Estados de carga** (regla: nada si dura < 300 ms, `useDelayed` en `src/useDelayed.js`; con `prefers-reduced-motion`, sin
  brillo ni giro; todos con `role="status"`/`aria-busy`):
  - Esqueleto de página (`.paper-skeleton`, proporción exacta, brillo) y fundido de 150 ms al llegar la imagen.
  - Abrir: el motor tiene `openAsync(bytes, pw, { onProgress, isCancelled })` (cede el control cada 25 páginas; probado) y
    `hasForm` sale de `FPDF_GetFormType` (inmediato). Worker: mensajes `{ id, progress }` y operación `cancel`; client:
    `pdf.openJob(bytes, pw, onProgress)` → `{ promise, cancel }`. Tarjeta «Abriendo 2 de 3 · nombre», barra real
    «Leyendo páginas… 120 de 300» y «Cancelar» (no deja nada abierto).
  - Guardar/Extraer: `compose(refs, onProgress)`; botón con spinner «Guardando…»/«Extrayendo…» y barra por páginas en la
    barra de estado. Mientras hay tarea se bloquean las acciones de `BLOCKED_WHILE_BUSY` (y sus botones y menús).
  - Arranque: `pdf.ready()`; si PDFium tarda, el estado vacío dice «Preparando el editor…».
  - Buscar: «Buscando… página 45 de 300» bajo el contador.
- Barra de estado: pista de la herramienta y «Página 3 de 6» en dos zonas separadas por una línea.
- Límites: se busca y selecciona en el texto original del PDF (no en textos editados con Texto ni teniendo en cuenta zonas
  redactadas pendientes); la selección es de una sola página; sin OCR las páginas escaneadas no tienen texto.

**Funciones básicas, tanda 2 — Marcadores (hecha, pendiente del visto bueno):**
- Motor: `bookmarks(docId)` → `[{ title, pageIndex, children }]` (`pageIndex` -1 si no lleva a una página: enlaces externos).
  `readOutline` (interno) guarda además la vista de cada destino (XYZ o modo + parámetros); resiste ciclos y árboles enormes.
- `src/outline.js` (puro, probado en `test/outline.test.js`, lo usan motor e interfaz): `mapOutline(pages, trees, names)` lleva cada
  marcador a la posición actual de su página (`pos`, o `missing` si se eliminó); con varios PDFs y alguno con índice, un grupo por
  archivo (`group`, nombre = `page.source`). `pruneOutline`, `activeId` (último marcador con página ≤ la actual; si está plegado,
  su antepasado visible), `visibleNodes`.
- Guardar (`rebuildOutline` en `compose`, paso 4b): si todo viene de un PDF y ningún marcador perdió su página, el índice original
  queda intacto (las páginas movidas siguen enlazadas; se conservan estilos y acciones). Si no, se reconstruye con
  `EPDFBookmark_Clear` + `AppendChild`: cada marcador a su nueva posición con la misma vista; fuera los de páginas eliminadas
  (salvo que tengan hijos vivos). `compose` recibe `source` en cada ref. Fixture `test/fixtures/indice.pdf` (`indice()` y `addOutline()` en `make-fixtures.js`).
- UI: pestaña «Marcadores» (`OutlinePanel.jsx`, la pestaña elegida se recuerda en `spiderpdf:panel`): árbol ARIA con flechas,
  Inicio/Fin, Intro; los grupos empiezan abiertos y los marcadores con hijos cerrados; clic = la página arriba del todo; el
  marcador de la sección visible en `bg-accent-soft`; los de páginas eliminadas en gris, tachados y desactivados. Sin índice:
  «Este PDF no tiene índice».
- Límites: al reconstruir se pierden color/negrita de los marcadores y los que no llevan a una página (enlaces externos);
  el clic deja la página arriba, no la posición exacta del destino XYZ.

**Funciones básicas, tanda 3 — PDFs firmados digitalmente (hecha, pendiente del visto bueno):**
- Motor: `open()` devuelve `signed` (`FPDF_GetSignatureCount`: campos de firma firmados; una firma solo dibujada, como
  «Rellenar y firmar» de Acrobat en un PDF real, no cuenta) y `mdp` (permiso DocMDP de la firma de certificación:
  0 ninguna, 1 nada, 2 formularios, 3 formularios y notas). Las fuentes guardan `signed`, `mdp` y `pageCount`.
- **Guardado incremental**: si el PDF base está firmado y `incrementalPlan(refs, fuente)` lo permite (mismas páginas en el
  mismo orden, ninguna de otro PDF, sin redacciones), `compose` guarda con `FPDF_SaveAsCopy(…, FPDF_INCREMENTAL)`: el
  original queda intacto al principio y los cambios (giros, notas, campos, texto, firma gráfica) van en una revisión al final.
  El worker devuelve `incremental`. PDFium reescribe en la revisión, idénticos, objetos que solo leyó (páginas, fuentes, el
  widget de la firma); nunca el diccionario de la firma.
- `src/signed.js` (puro, `test/signed.test.js`): `incrementalPlan` + `REWRITE_REASONS`/`reasonText` (motivos del diálogo);
  `editPolicy(sources)` (el DocMDP más restrictivo: `pages`, `annots`, `forms`, `content` = texto, firma gráfica y redactar,
  que son contenido de página); `allowedTools`; `allows(policy, acción, state)`; `SIG_STATUS`, `worstStatus`.
  **Toda acción del usuario pasa por `act()` en `App.jsx`**, que filtra con `allows` y avisa con `policy.notice`. Además se
  desactivan girar, eliminar y añadir, las herramientas (`aria-disabled`, el porqué en el title), el arrastre en Organizar y
  en el panel, y los campos quedan de solo lectura si no se permiten. Al abrir un certificado, toast con el aviso.
- **Integridad de las firmas** (`electron/sigverify.cjs`, proceso principal, `node:crypto` + lector DER propio, sin
  dependencias; IPC `pdf:verifySignatures` → `desktop.verifySignatures`; en el navegador devuelve null → «sin comprobar»):
  por cada `/ByteRange` (sin repetir): coherencia (empieza en 0, hueco `<…>` exacto, dentro del archivo), resumen de los
  rangos = messageDigest firmado, y firma CMS verificada con la clave del certificado incluido (RSA PKCS#1 v1.5 y PSS, ECDSA;
  `adbe.pkcs7.detached`, `ETSI.CAdES.detached`, `adbe.pkcs7.sha1`; `adbe.x509.rsa_sha1` → «no se pudo comprobar»).
  Estados: intact / modified (revisiones después del ByteRange) / broken / unknown. Firmante = CN del certificado; fecha =
  signingTime firmado o `/M`. Pruebas en `test/sigverify.test.js`. NO comprueba confianza ni revocación (paso 5).
- UI: `SignatureStatus.jsx` en la barra de estado (peor estado de las firmas de los PDF que aportan páginas,
  `signedSources`), con icono y color (`--danger` si está rota); clic → panel con cada firma (firmante, fecha, estado, motivo).
  Tras guardar (no Extraer) se vuelve a comprobar lo guardado: el estado es el del archivo en el que trabaja la ventana.
- Guardar (`savePlan.js` + `App.save`): sobre un original firmado sin cambios no escribe nada (`skip`). Con cambios:
  incremental → «¿Guardar en el PDF firmado?» (Guardar / Guardar como…); reescritura → «¿Guardar encima del original
  firmado?» con `SIGNED_WARNING` + el motivo, Guardar como… (primario, «<nombre> (modificado).pdf») / Guardar encima.
  En «Guardar como», elegir un original firmado (si no es incremental) o redactado pide «Reemplazar el original». Con
  redacciones manda su regla. `ConfirmDialog.jsx`: confirmación accesible con varias salidas (`ask()` → id o null).
- `test/sign-pdf.js` (solo pruebas): certificado autofirmado RSA o ECDSA, firma CMS, opciones `mdp` y `corrupt`;
  `signatureIntact`/`byteRange`. Fixtures `firmado.pdf` y `certificado.pdf` (formulario con P=2). Si se guarda encima de
  `firmado.pdf` desde la app, la prueba de control falla con «regenera el fixture».
- Límites: confianza y revocación (paso 5); firmas dentro de flujos de objetos comprimidos no se encuentran (Acrobat nunca
  las comprime); al guardar encima reescribiendo, la firma rota sigue en el archivo.
- La comprobación nunca impide abrir el PDF: si falta `desktop.verifySignatures` (preload antiguo) o el manejador IPC
  (proceso principal antiguo), el estado es `outdated` («cierra la aplicación y vuelve a abrirla»). Fue la causa de que las
  firmas no se vieran en una ventana de desarrollo abierta desde antes de añadir la comprobación.
- Saltos en Leer (marcador, miniatura): mientras dura el desplazamiento suave la página actual se queda en la de destino
  (`jumping` en `ReaderView`); antes iba pasando por las intermedias y Eliminar podía quitar una página de paso.

**Bloque 3 — Insertar páginas (hecho, pendiente del visto bueno):**
- Páginas nuevas en el estado: `docId: null`, `index: -1`, `created = { kind: 'blank' }` o `{ kind: 'image', blob, pxW, pxH, name }`
  (`src/insertPages.js`, probado en `test/insert.test.js`): en blanco del tamaño visible de la última página seleccionada (o
  la actual al leer) o A4; imagen a 150 ppp, como mucho A3 en su orientación, y se incrustan como mucho 300 ppp (`pxW/pxH`).
  Se insertan tras la última seleccionada (o la actual al leer, o al final) con la acción `add` (deshacer incluido).
- `compose`: las refs sin `docId` llevan `create: { width, height, image? RGBA }` y se crean con `FPDFPage_New`
  (+ `FPDFPageObj_NewImageObj`/`FPDFImageObj_SetBitmap`, transparencia incluida) en su sitio (`createPage`). Si no hay ningún
  PDF de partida, se parte de `FPDF_CreateNewDocument` (base de «Nuevo documento»). El índice ignora las páginas nuevas;
  en un PDF firmado, insertar obliga a reescribir (`REWRITE_REASONS.inserted`).
- Client: `renderPage` dibuja las páginas nuevas en un OffscreenCanvas (sin worker); `textChars`, `textRuns`, `search`,
  `fields` y `bookmarks` devuelven vacío con `docId == null`; `compose` pasa la imagen a RGBA reducida (`blobToRGBA`).
- UI: botón «Insertar ▾» en Organizar (menú con teclado) y en Editar del menú: `insertBlank`, `insertImage` (selector
  de archivos del sistema, PNG/JPG, varias a la vez). Bloqueado en PDFs certificados.
- Arreglado: `pageText` devolvía basura en páginas sin texto.
- Límites: las imágenes se incrustan como mapa de bits (JPG recomprimido sin pérdida, más pesado); pasar el JPG tal cual
  llega en el bloque 5.

**Funciones básicas: Imprimir y Archivos recientes (hecho, pendiente del visto bueno):**
- Imprimir (Ctrl+P, Archivo → Imprimir…): **diálogo propio** (`PrintDialog.jsx`, como Acrobat): vista previa de cada
  hoja (reutiliza `PageImage` + `AnnotPreview`, colocadas con la misma `sheetLayout` que la impresión), navegable, con
  páginas y hojas; impresora (`print:printers` → `getPrintersAsync`, recuerda la última), copias, papel (A4, Carta, A3,
  Legal), intervalo (todas, actual, selección, «1-3, 5» con `parseRange`), color / blanco y negro, doble cara (desactivada
  en impresoras virtuales; en Windows Electron no dice si una física la admite: `supportsDuplex`), «Ajustar a la página»
  (margen de 5 mm) o «Tamaño real», y orientación automática (las apaisadas giradas 90°). Preferencias en
  `localStorage` `spiderpdf:imprimir`. «Configuración avanzada de la impresora…» = el mismo trabajo con el diálogo del
  sistema (`silent: false`, para bandejas, grapado…).
  Lógica pura en `src/printLayout.js` (probada en `test/print.test.js`). `runPrint` en `App.jsx`: si alguna página tiene
  cambios, `compose()` como al guardar (redacciones pendientes en negro); si no, se renderiza directamente de su PDF.
  Cada página → JPEG 0,92 a 300 ppp (`renderJpeg`, en grises si es blanco y negro: no todos los controladores respetan
  `color: false`) → `print:page` con su caja en la hoja. El proceso principal la guarda en una carpeta temporal y en
  `print:run` imprime **por lotes de 24 hojas** (`PRINT_BATCH`, par por la doble cara), cada lote en una ventana oculta
  sin JavaScript que se destruye (`webContents.print({ silent: true, deviceName, copies, color, duplexMode, pageSize })`);
  con varias copias y varios lotes, repite el documento por copia (intercaladas). Progreso: «Preparando impresión… 120
  de 300» y «Enviando a la impresora… 3 de 13» (`print:progress`). Medido: antes, 100 páginas = 79 s y 2,7 GB (todas
  las imágenes decodificadas a la vez en la ventana de impresión); ahora 300 páginas ≈ 55-90 s con la memoria plana.
  Pruebas e2e: `globalThis.__spiderPdfPrintHook(wc, options)` y `__spiderPdfPrintersHook` (solo sin empaquetar)
  sustituyen la impresora por `printToPDF` y una lista fija; se comprueban las opciones y las hojas (A4, apaisadas
  giradas, sin recortes, redacción en negro, grises, intervalo, lotes y memoria con 300 páginas).
- **Impresoras virtuales** (Microsoft Print to PDF, XPS, OneNote; `needsSystemDialog`): preguntan dónde guardar con su
  propia ventana y, al imprimir en silencio desde Chromium, esa ventana no llega a aparecer y el trabajo termina en
  «Print job canceled» (comprobado). Con ellas «Imprimir» usa el diálogo de Windows con la impresora ya elegida, y el
  diálogo propio lo avisa. En silencio, un «cancel» no es del usuario: se muestra «La impresora no aceptó el trabajo.»
- Nombre de la app: `app.setName(APP_NAME)` y `setAppUserModelId(APP_ID)` al principio de `main.cjs` (ver «Nombre e
  icono»). El diálogo de impresión de Windows y la barra de tareas toman el nombre de la **descripción del ejecutable**:
  en desarrollo es `electron.exe` («Electron»); en la app empaquetada, electron-builder pone «SpiderPDF».
- Recientes (`electron/recents.cjs`, probado en `test/recents.test.js`): `<userData>/recientes.json`, 10 como mucho, el
  último primero, sin repetir (en Windows sin distinguir mayúsculas); `app.addRecentDocument` / `clearRecentDocuments`.
  IPC `recents:list|add|open|clear` y aviso `recents:changed`. `recents:open` solo abre rutas que están en la lista; si el
  archivo ya no existe, lo quita y la interfaz avisa. La interfaz apunta cada PDF abierto (Abrir, Añadir, arrastrar) o
  guardado con ruta (`rememberRecent`). Menú: `{ "submenu": "recents" }` en `menu.json` → `recentItems()` en `menu.js`
  (Windows/Linux, `TitleBar` con submenús: flecha derecha/Intro abre, izquierda/Esc cierra) y menú nativo en macOS
  (`buildMenu` se rehace al cambiar la lista; manda `{ cmd: 'openRecent', arg }`). `DESKTOP_API` = 3.
- `electron/fsutil.cjs`: `writeAtomic` (temporal + rename con reintentos ante EPERM/EACCES/EBUSY). En Windows el rename
  fallaba de vez en cuando porque otro proceso tenía el archivo abierto un instante (lo destapó la e2e de recientes); lo
  usan recientes y **Guardar**. En e2e, el proceso principal escribe `<userData>/e2e.log` (arranque, candado, recientes,
  reintentos) para depurar.
- Límites: con impresoras físicas, cómo se aplica la orientación de cada página depende del controlador; las páginas se
  imprimen como imagen a 300 ppp (el texto no es seleccionable en un «Imprimir a PDF»).

**Nombre e icono: SpiderPDF (hecho, pendiente del visto bueno):**
- `productName` «SpiderPDF», `appId` `com.diego.spiderpdf`, paquete npm `spiderpdf`. En `main.cjs`: `APP_NAME`, `APP_ID`
  (AppUserModelId en Windows) y `WINDOW_ICON` (`build/icon.ico` en Windows, `build/icon.png` en Linux; en macOS lo pone el
  .app). Título de ventana «nombre.pdf – SpiderPDF», `<title>` de `index.html`, barra de título, ventana de impresión,
  instalador NSIS (acceso directo, desinstalador e iconos), README. Claves de `localStorage` `spiderpdf:*`, variable de
  pruebas `SPIDERPDF_USER_DATA`, ganchos `__spiderPdfPrintHook`/`__spiderPdfPrintersHook`.
- **La carpeta de datos cambió** (sale del nombre): `%APPDATA%\SpiderPDF` en vez de `PDF Editor`. Migración una sola
  vez (`electron/migrate.cjs`, marcador `migracion.json`), en el proceso principal tras el candado y antes de abrir
  ventanas: `recientes.json` se combina (los nuevos primero, `mergeRecents`); `Local Storage/` se copia sin `LOCK` y, si
  ya existía, el nuevo se aparta en «Local Storage (antes de migrar)». La interfaz (`src/storageMigration.js`, en
  `main.jsx` antes de pintar) copia `pdf-editor:*` → `spiderpdf:*` si faltan. La carpeta antigua no se toca. En e2e
  solo con `SPIDERPDF_LEGACY_DATA` (`launch(dir, files, extraEnv)`). Pruebas: `test/migrate.test.js`, `migracion.spec.mjs`.
- Iconos en `build/`: originales `spiderpdf-icon.svg` (≥ 48 px), `spiderpdf-icon-small.svg` (16-32 px) y `-1024.png`.
  `npm run icons` (`build/make-icons.cjs`, Electron dibuja cada tamaño desde el vector, sin dependencias) genera
  `icon.ico` (16, 24, 32, 48, 64, 256; ≤ 32 desde el pequeño), `icon.icns` (16-1024) e `icon.png` (256). Van al repositorio;
  `build/icon.ico` e `icon.png` se empaquetan (`files`) para el icono de la ventana. Comprobado con `electron-builder --dir`:
  `SpiderPDF.exe` con descripción «SpiderPDF» y el icono.
- Interfaz: `AppIcon.jsx` (el dibujo pequeño hasta 32 px, el normal desde 48) en la esquina de la barra de título (28 px)
  y en el estado vacío (88 px, `alt` «SpiderPDF»). E2E: `test/e2e/nombre.spec.mjs`.

**Bloque 4 — Texto nuevo (caja de texto) (hecho, pendiente del visto bueno):**
- Anotación `{ type: 'textbox', rect, k, text, style, fallback? }`; `style = { pdf: { objIndex, name, raw } | null, usePdf,
  family: 'sans'|'serif'|'mono', size, bold, italic, color, align }`. Lógica pura en `src/textbox.js` (probada en
  `test/textbox.test.js`): `nearestRun`/`defaultStyle` (fuente, tamaño y color del texto del PDF más cercano),
  `similarFamily`, `familyKey`, `wrapLines`, `missingChars`, `LINE_HEIGHT` = 1,2.
- Fuentes incluidas (OFL, `devDependencies` y empaquetadas con `?url` en `src/engine/fontUrls.js`): Inter, Noto Serif y
  JetBrains Mono (TTF de `@expo-google-fonts`), 4 estilos cada una. Subconjunto con `harfbuzz-subset.wasm` (harfbuzzjs,
  MIT; `src/engine/subset.js`) e incrustadas como CID (`FPDFText_LoadFont(…, 2, 1)`): texto Unicode, seleccionable y que
  se busca en Edge/Acrobat. El worker carga fuentes y subconjuntador solo al guardar con cuadros (`prepareTextFonts`).
- Fuente del PDF: `FPDFTextObj_GetFont` → `CreateTextObj` con la misma fuente. Si le faltan letras (`checkGlyphs`: escribir y
  leer de vuelta con `FPDFTextObj_GetText`), toast «… no tiene «ñ», «€»: se usa Noto Serif, la más parecida.» y `fallback`.
  En pantalla, `src/fonts.js` registra las incluidas y, si el navegador la acepta, la del PDF (`fontData`); los
  subconjuntos de pdf-lib dan «OTS parsing error» y se ve con la incluida.
- Motor: `addTextBox` (dentro de `applyAnnots`, como contenido de página): vuelve a partir líneas con anchuras reales,
  línea base con `FPDFFont_GetAscent/GetDescent`, alineación, color, giro `k`. Pruebas en `engine.test.js` (incluida «Ñandú ¿€?»).
- UI: herramienta «Texto nuevo» (`TextBoxes.jsx`: textarea mientras se escribe; clic = cuadro de una línea que crece,
  arrastrar = ancho fijo; Esc o clic fuera termina; vacío = se descarta). El cuadro se crea al instante y el estilo se
  ajusta cuando llegan los bloques de texto (antes se perdían las primeras teclas). «Texto» pasa a «Editar texto».
  `TextFormatBar.jsx` (fuente, tamaño, negrita, cursiva, color, alineación, traer al frente, enviar atrás, duplicar);
  con ella visible la barra de herramientas queda en iconos (`compact`). Estado: `duplicateAnnot` (Ctrl+D, `cmd: duplicate`)
  y `reorderAnnot`. Cuenta como contenido en PDFs firmados (`signed.js`) y como conflicto con zonas a redactar (`conflicts.js`).
- E2E: `test/e2e/texto.spec.mjs` (fuente y tamaño del PDF; fuente, tamaño, color y negrita del título azul de
  `formulario.pdf`; letras que faltan; formato/mover/duplicar/deshacer).
- Límites: un solo estilo por cuadro (sin texto enriquecido); sin interletrado ni guiones al partir líneas.

**Bloque 4 — Nuevo documento (hecho, pendiente del visto bueno):**
- Archivo → «Nuevo documento…» (Ctrl+N, `cmd: new`) y botón en el estado vacío. `NewDocumentDialog.jsx`: tamaño (A4,
  Carta, A3; grupo de radio con flechas), orientación (vertical u horizontal), páginas (1-500, con − y +; fuera de rango
  desactiva «Crear»), vista previa a escala común (A3 se ve más grande) con taco de hojas si hay varias. Recuerda tamaño y
  orientación en `spiderpdf:nuevo`.
- Lógica pura en `src/newDocument.js` (`PAGE_SIZES`, `newPageSize`, `clampCount`, `newDocumentPages`; pruebas en
  `test/insert.test.js`): páginas `blankPage` sin PDF de origen; acción `open` con `sources: []` y `file: null` (cambios sin
  guardar, sin historial) y pasa a Leer. Con cambios sin guardar pide «Crear sin guardar». Guardar pide dónde
  («documento.pdf»); `compose` parte de `FPDF_CreateNewDocument`. Título «Documento sin guardar» si hay páginas y no archivo.
- E2E: `test/e2e/nuevo.spec.mjs`.

**Paso 4 — OCR (hecho, pendiente del visto bueno):**
- Tesseract.js 7.0.0 + tesseract.js-core 7.0.0 (Apache 2.0) y los idiomas `@tesseract.js-data/{spa,cat,eng}` 1.0.0 (tessdata
  «best_int», Apache 2.0), todo fijado y dentro de la app: el plugin `ocrAssets` de `vite.config.js` los copia con nombre
  fijo a `ocr/` (en desarrollo los sirve el servidor). Nada se descarga (y la CSP `connect-src 'self'` lo impediría).
  Ojo: en 7.0.0 pasar los idiomas como `{ code, data }` falla al inicializar (usa `l.data` en vez de `l.code`): se usa
  `langPath`. `src/ocr/service.js` crea el worker de Tesseract (núcleo SIMD solo LSTM, `workerBlobURL: false`,
  `cacheMethod: 'none'`) y se carga con `import()` solo al reconocer.
- Motor: `imageOnlyPages(docId)` (sin texto real y con imágenes que cubren ≥ 50 %), `pageSize`, `applyOcr(entry, index,
  words, font)`: un objeto de texto por palabra, **invisible** (modo de pintado 3), con Inter en subconjunto (CID, Unicode),
  estirado a lo ancho de la palabra y girado como su línea base. Va en el paso 5 de `compose` sobre el documento final
  (antes de las anotaciones; la redacción posterior también lo borra). Worker: `imageOnlyPages`, `ocrGray` (render a
  300 ppp en gris, menos si pasa de 36 Mpx).
- `src/ocr/` (puro, `test/ocr.test.js`): `image.js` (gris, reducir, girar con `back()` al original, PGM: Tesseract lo lee
  sin canvas), `deskew.js` (perfil de proyección: inclinación hasta ±10° y si las líneas van en vertical; menos de 0,4° no
  se toca), `layer.js` (palabras de Tesseract → línea base en fracciones de la página sin girar, `ocrChars` para la
  interfaz, `dropCovered` para no duplicar texto existente), `run.js` (`ocrPage`: enderezar → reconocer; 0/180 o 90/270 se
  decide por la confianza, con menos de 60 se prueba la otra).
- Estado: `page.ocr` (palabras) con la acción `setOcr` (una tanda = un paso de deshacer, `job`). Cuenta como contenido en
  PDFs certificados (`signed.js`). Client: `pageChars(page)` y `pageSearch(page, q)` añaden la capa sin guardar a
  seleccionar, copiar y buscar; `compose` envía `ocr`.
- UI: aviso bajo la barra («N páginas son imágenes escaneadas…» + «Reconocer texto (OCR)», se puede cerrar), Editar →
  «Reconocer texto (OCR)…», `OcrDialog.jsx` (páginas escaneadas o todo el documento; idiomas, recordados en
  `spiderpdf:ocr`), progreso «Reconociendo texto… página 2 de 3» con «Cancelar» en la barra de estado (se conserva lo hecho).
- Pruebas: motor (albarán recto, torcido 3° y de lado: ángulo, palabras, búsqueda en su sitio, píxeles idénticos, capa de
  la interfaz = la de PDFium) y `test/e2e/ocr.spec.mjs`. Fixture `albaran-escaneado.pdf` (`albaranEscaneado()`, renderizado
  con PDFium). La página «enderezada» no cambia: solo se endereza para reconocer y la capa se coloca sobre la imagen original.
- Límites: las páginas escaneadas siguen siendo imagen (no se comprime ni se limpia); OCR lento en documentos grandes
  (≈ 2-4 s por página); sin detección de columnas o tablas más allá de lo que hace Tesseract.

**Compartir (hecho, pendiente del visto bueno):** botón «Compartir» en la barra y Archivo → «Compartir…».
- `ShareDialog.jsx`: nombre editable, todo o las páginas seleccionadas (por defecto todo), «Quitar información oculta» y
  avisos (`sharePlan` en `src/share.js`, probado en `test/share.test.js`): zonas a redactar que se aplicarán, firma
  digital (válida si el cambio va en revisión incremental, rota si no o si se limpia), contraseña. Destinos: WhatsApp,
  Enviar a IA, Correo, Copiar archivo, Mostrar en el Explorador; el resultado se explica en el propio diálogo (`shareResult`).
- La copia: sin cambios, todo y sin limpiar = **el archivo tal cual** (la firma sigue intacta); si no, `compose` (con la
  protección elegida). Se reutiliza mientras no cambien documento ni opciones.
- Proceso principal (`electron/share.cjs`): carpeta `%TEMP%\SpiderPDF-compartir-<pid>\<id>\<nombre>.pdf`, borrada al cerrar
  (`will-quit`) y, al arrancar, las de procesos que ya no existen. La interfaz solo maneja ids (`share:prepare` →
  `share:copyFile|mail|reveal|whatsapp|ai`); `safeName` quita rutas y caracteres prohibidos. `DESKTOP_API` = 5.
- **Ayudante nativo** `electron/helper/SpiderPdfHelper.cs` (C# 5, `csc.exe` de .NET Framework 4.8; `npm run helper` →
  `build/helper/SpiderPdfHelper.exe`, no va al repositorio; se compila en `dist:win` (`--force`) y antes de las e2e;
  electron-builder lo copia a `resources/helper/`). Órdenes: `copy-file` (CF_HDROP + «Preferred DropEffect» copiar, hilo
  STA) y `mail` (MAPISendMailW, y la versión ANSI si el cliente no tiene la Unicode; `sin-cliente` → la interfaz propone
  «Copiar archivo», p. ej. con el Outlook nuevo). Responde una línea JSON. La firma con certificado añadirá sus órdenes.
- WhatsApp: copia el archivo y abre `whatsapp://` si está registrado (`app.getApplicationNameForProtocol`); si no, WhatsApp
  Web y la carpeta para arrastrarlo. «Enviar a IA»: igual con Claude (`claude://` / claude.ai/new) o ChatGPT (`chatgpt://` /
  chatgpt.com); la IA se elige en **Editar → Preferencias…** (Ctrl+,; `PreferencesDialog.jsx`, `src/prefs.js`,
  `spiderpdf:prefs`). SpiderPDF no envía nada: copia y abre; pega el usuario.
- «Quitar información oculta» = `compose(…, { hidden: true })`: el guardado limpio de la redacción (`cleanSave`) sin
  metadatos Info, sin notas (Text/Popup), adjuntos ni sonidos, formularios aplanados; lo visible no cambia (probado).
- E2E `test/e2e/compartir.spec.mjs`: portapapeles real (se lee con PowerShell), el resto con
  `globalThis.__spiderPdfShareHook` (`installed`, `openExternal`, `reveal`, `mail`; solo sin empaquetar).
- Pendiente: «Compartir de Windows» (necesita WinRT desde el ayudante; no está), macOS (menú Compartir nativo); correo
  real y WhatsApp/IA de verdad se prueban a mano.

**Contraseñas (hecho, pendiente de que Diego las pruebe en Edge y Acrobat):**
- PDFium cifra (`EPDF_SetEncryption`: AES-256, revisión 6) y quita (`EPDF_RemoveEncryption`). La contraseña con la que se
  abrió vive solo en el worker (`entry.password`/`ownerPassword`); a la interfaz llega `security = { encrypted, revision,
  owner, perms, userPerms }`. La protección nueva va al worker (`pdf.setProtection` → token; `state.security`).
- `src/security.js` (probado en `test/security.test.js`): bits de /P (sin imprimir hay que quitar también el bit 12, si no
  PDFium vuelve a activar imprimir), `permsPolicy` entra en `editPolicy` (nivel `protected`, más `print` y `copy`).
- `PasswordDialog.jsx` (Mostrar, reintentos, «La contraseña no es correcta»), `ProtectDialog.jsx`, Archivo → Proteger con
  contraseña… / Quitar la contraseña / Desbloquear permisos…; «Protegido» en la barra de estado.
- Redactar (o limpiar) un protegido crea un PDF nuevo: **qpdf `--copy-encryption`** le copia la protección del original
  (mismas contraseñas y permisos). qpdf 12.4.2 compilado a wasm por nosotros (`npm run qpdf:build`: `build/qpdf/build.sh`
  en `emscripten/emsdk:6.0.12` fijada por digest; zlib y libjpeg de los ports; cripto propia de qpdf). Reproducible
  (dos compilaciones, mismo SHA-256). `src/engine/qpdf/` con `SHA256SUMS` (lo comprueba `security.test.js`).
- Pruebas: motor (redactar un protegido abierto con cada contraseña, forense tras descifrar) y `contrasenas.spec.mjs`
  (también busca las contraseñas en la carpeta de datos: no aparecen).

**Reducir tamaño (hecho, pendiente del visto bueno):** Archivo → «Reducir tamaño…» (`ReduceDialog.jsx`).
- Niveles (`src/reduce.js`, probado en `test/reduce.test.js`): Alta calidad 300 ppp / JPEG 0,85, Equilibrado 150 / 0,75,
  Mínimo tamaño 96 / 0,6. El diálogo **calcula de verdad** cada nivel al elegirlo (cancela el anterior; caché por nivel) y
  muestra «12,4 MB → 3,1 MB (−75 %)» (`sizeChange`; antes = el archivo en disco si no hay cambios, si no lo compuesto).
  «Guardar copia…» escribe esos mismos bytes («<nombre> (reducido).pdf»; reemplazar un original pide confirmación). El
  documento abierto no cambia. Avisos: firma digital (se rompe), contraseña (se mantiene), zonas a redactar (se aplican).
  Desactivado si la política no permite cambiar el contenido (certificado o protegido sin editar).
- Worker `reduce`: compose (con la protección) → `reducePdf` (`src/engine/reduce.js`) → `PdfCore.reduceImages`:
  agrupa las imágenes por huella de sus datos (FNV de los bytes sin decodificar), la resolución de cada grupo es la del uso
  que se ve más grande (`FPDFImageObj_GetImageMetadata`), reduce por media de áreas (`src/engine/resample.js`), JPEG con
  OffscreenCanvas (en las pruebas, jpeg-js 0.4.4, BSD, solo devDependency), `EPDFImageObj_SetJpeg` en cada uso y
  `FPDFPage_GenerateContent` (sin él no se guarda el cambio). Si las copias pesarían más que la original, no se toca.
  Se dejan: transparencia (`FPDFPageObj_HasTransparency` **no ve las SMask**: se dibuja con `GetRenderedBitmap` y se mira
  el alfa), 1 bit, CMYK/separaciones/Lab, y lo que no gana. Después qpdf (`QPDF_OPTIMIZE`: flujos de objetos, Flate al
  máximo, sin objetos sueltos; con la contraseña conserva la protección). Si no baja, se devuelve el original.
- Pruebas: motor (baja de verdad y más en cada nivel, ninguna imagen original suelta, texto y rectángulo idénticos píxel
  a píxel, foto a 150 ppp, PNG con transparencia intacto, protegido conserva la protección) y `test/e2e/reducir.spec.mjs`.
- Límites: imágenes dentro de Form XObjects no se reducen; los JPEG ya por debajo de la resolución no se recomprimen.

**Marcadores desde el índice impreso y enlaces (hecho, pendiente del visto bueno):**
- `src/toc.js` (puro, `test/toc.test.js`): `textLines` (líneas por geometría: vuelve a unir el número que PDFium separa
  del título), `parseTocLine` (título + relleno de puntos/hueco + número, también romanos), `tocEntries` (con relleno,
  las líneas sin él solo cuentan entre la primera y la última que lo llevan: fuera cabecera «Página 3 de 16» y pie; sin
  relleno, columna de números alineada a la derecha; números casi siempre crecientes; título partido en dos líneas se
  une), niveles por numeración (2, 2.1, A.2) o por sangría, `guessOffset` (cada entrada vota por las páginas que
  contienen su título, sin contar las del índice; en empate el desfase más cercano a 0), `findTocPages` (primera página
  que lo parece entre las 15 primeras y las que la siguen), `treeFromLevels`/`levelsFromTree`.
- Estado: `state.outline` = índice creado `[{ title, key, children }]` (key = página del estado, sigue a su página al
  reordenar) o null (el de los PDF). Acción `setOutline`; el historial guarda `{ pages, outline }` por paso. En
  `signed.js`, `setOutline` necesita `policy.pages` (no en certificados). `outline.js`: `mapCustomOutline`, `outlineForSave`.
- Motor: `compose(refs, …, { outline })` → `writeOutline` sustituye el índice (EPDFBookmark_Clear + AppendChild, destino
  «ajustar»); en un PDF firmado va en la revisión incremental y la firma sigue verificando (probado). Llega por
  `pdf.compose`/`pdf.reduceJob` (`outline: state.outline`) en Guardar, Compartir y Reducir.
- UI: pestaña Marcadores sin índice → busca la página de índice: «La página 3 parece un índice» + «Crear índice desde la
  página 3» (y «Usar otra página» / «Crear índice desde una página…»). `TocDialog.jsx`: página del índice, «La página
  impresa 1 es la N del PDF» (calculado; «Calculado: 11 de 12 títulos están en su página»), lista editable (título, nivel
  con subir/bajar, página, quitar, «Añadir entrada»), valida páginas fuera de rango. Con índice creado: pie «Editar el índice».
- Probado con el PDF real de Seidor (propuesta MTS, en OneDrive, no se copia al repo): página 3, 17 entradas, desfase 0.
  Fixtures `indice-impreso.pdf` (`indiceImpreso()`, desfase +1, título partido, cabecera y pie numerados) y `enlaces.pdf`.
- Enlaces: motor `links(docId, index)` → `[{ rect, pageIndex } | { rect, uri }]` (FPDFLink_Enumerate; /Dest o acción
  GoTo, URI; se ignoran lanzar, JavaScript y otros archivos). `PageOverlay` (herramienta Seleccionar): clic sin arrastrar
  sobre un enlace lo sigue (arrastrar desde él no), cursor de mano, y un botón invisible enfocable por enlace (teclado).
  Internos → posición ACTUAL de su página (`ReaderView.followLink`); si se eliminó, aviso. Web/correo → confirmación
  «¿Abrir el enlace?» y IPC `link:open` (solo http, https y mailto; hook e2e `__spiderPdfLinkHook`). `DESKTOP_API` = 6.
- E2E: `test/e2e/indice-impreso.spec.mjs`.
- Límites: el índice creado sustituye al de los PDF (al unir otro PDF después, su índice no se añade); los marcadores
  llevan a la página entera (no a la altura del título); no crea enlaces clicables en las líneas del índice impreso.

**Paso 6, tanda 1 — Exportar a Excel (hecho, pendiente del visto bueno):** Archivo → «Exportar a Excel…» (`cmd: exportExcel`,
necesita `policy.copy`).
- Motor: `rules(docId, index)` → segmentos rectos horizontales y verticales de los trazados de primer nivel (con
  trazo, o rellenos finos = líneas dibujadas como rectángulo); los rellenos gruesos (fondo de celda) no cuentan.
- `src/tables.js` (puro, `test/tables.test.js` con PDFium y ExcelJS de verdad): `words`, `lines`, `cellsOf` (hueco >
  0,55 × alto de letra = otra columna); `grids` (líneas que se cruzan, ≥ 2 × 2 celdas) + `fillGrid` (palabras a su
  celda por el centro; las líneas pegadas encima de la rejilla, dentro de su anchura, son su cabecera sin bordes, como
  la azul de Seidor); tablas por alineación (`streamBlocks`: líneas seguidas con ≥ 2 trozos, columnas = huecos que nada
  cruza en el cuerpo, ≥ 3 columnas para no tomar «clave valor» como tabla; continuación sin primera columna se une a la
  fila anterior); `joinContinued` (última de una página + primera de la siguiente, mismas columnas y misma cabecera o
  ninguna; la repetida se quita); `hasHeader`; `numberStyle` ('es'/'en' por mayoría); `parseCell` (1.234,56, %, €, $,
  fechas d/m/a y a-m-d → Date UTC; códigos con ceros delante o letras quedan como texto); `displayCell` (vista previa).
- `src/export/xlsx.js`: `buildXlsx(ExcelJS, tablas, { mode: 'table' | 'page' })` (una hoja por tabla o por página),
  cabecera en negrita con fondo, fija y con filtro, anchos por contenido, formatos numéricos y de fecha.
  `src/export/scan.js`: `scanTables(pages)` (pageChars con OCR + `pdf.rules`; tamaño sin girar).
- ExcelJS 4.4.0 (MIT; jszip se usa como MIT; 139 dependencias, ninguna de menos de 14 días) se carga con `import()`
  solo al exportar (trozo aparte de 930 KB, funciona con la CSP).
- `ExcelDialog.jsx`: busca con progreso, lista de tablas (página, filas × columnas, cabecera; casilla para incluirla),
  vista previa como en Excel, «Una por tabla / Una por página», «Unir las tablas que siguen en la página siguiente»;
  «Exportar…» → IPC `export:save` (diálogo con filtro xlsx/docx, `writeAtomic`) y «Abrir en Excel» → `export:open`
  (solo lo exportado en la sesión; hook e2e `__spiderPdfOpenPathHook`). `DESKTOP_API` = 7.
- Fixtures `factura.pdf` (rejilla, `FACTURA`) y `albaran-lineas.pdf` (sin líneas, dos páginas, descripción partida,
  `ALBARAN_LINEAS`). Probado también con la propuesta de Seidor (5 tablas; honorarios de la página 11 con su cabecera).
  E2E `test/e2e/excel.spec.mjs`.
- Límites: celdas combinadas se ven como celdas sueltas; tablas sin líneas de solo 2 columnas no se detectan; se exporta
  el texto original del PDF (no los textos editados con «Editar texto»).
- Al exportar, el diálogo se cierra y el aviso trae «Abrir en Excel» (avisos con botón: `notify(texto, tipo, { label, run })`,
  duran 7 s). Antes se quedaba abierto con el estado «Exportado» y Diego lo vio como un fallo.

**Paso 6, tanda 2 — Exportar a Word (hecho, pendiente del visto bueno):** botón «Exportar ▾» en la barra (Word arriba,
Excel debajo, con iconos propios en `FileBadges.jsx`: hoja + pastilla azul «W» / verde «X», **no** los logotipos de
Microsoft) y Archivo → «Exportar a Word…» (`cmd: exportWord`, necesita `policy.copy`). `DropMenu` en `Toolbar.jsx` sirve
para «Insertar» y «Exportar».
- Motor (`engine.test.js`): `charStyles(docId, index)` → por carácter de textChars: tamaño (de la matriz del objeto:
  `FPDFText_GetFontSize` da 327 pt en PDFs de Chrome), negrita/cursiva, color y fuente. `fontInfo` lee negrita y cursiva
  del **propio archivo de la fuente** (`src/engine/fontTraits.js`: OS/2 usWeightClass, fsSelection y nombre completo),
  porque muchos PDF llaman a sus fuentes «CIDFont+F1» y `FPDFFont_GetWeight` devuelve miles; nombres genéricos → familia
  (`FPDFFont_GetFamilyName`). `pageImages(docId, index)` → imágenes de primer nivel con su caja, a ≤ 200 ppp; con
  transparencia se dibujan con su máscara a su resolución propia (se agranda la matriz un momento para
  `GetRenderedBitmap`). `readBitmap` común con `imageRGBA`. El worker las codifica (PNG con alfa, JPEG 0,9 sin).
  PDFium marca con `\u0002` la palabra partida con guion al final de línea.
- `src/export/docLayout.js` (puro, `test/docx.test.js`): `styledWords` (trozos de estilo; viñetas de Symbol/Wingdings
  U+F0xx → «•»), `analyzePage` (líneas sin las de las tablas, tablas e imágenes en orden vertical; la imagen de página
  entera con texto encima = escaneo con OCR: fuera), `layoutDocument`: cuerpo = tamaño con más letras; título = la letra
  más grande si sale ≤ 2 veces en la 1.ª página; Título 1-3 por tamaño (≥ 1,15 × cuerpo); línea corta toda en negrita =
  título débil; listas (viñeta o «1.», «a)», «iv.»; continuación alineada con el texto del elemento); párrafo nuevo con más
  espacio del normal (1,3 × el interlineado), más sangría o línea anterior acabada en punto antes del margen; líneas con
  huecos («clave … valor») sueltas con tabuladores (`tabStops`: a la derecha si el trozo acaba en el margen); sangría;
  centrado. `splitRunning`: líneas repetidas arriba/abajo (12 %) en ≥ la mitad de las páginas → encabezado/pie de Word
  (`pageNumber` si el número cambia → campos PAGE y NUMPAGES); imágenes repetidas en el mismo sitio (membrete, logos) fuera,
  salvo las de página entera (escaneos). Texto casi blanco (sobre una franja de color) → color normal.
- `src/export/docx.js`: `buildDocx(docx, layout, { images, pageBreaks })` con estilos de verdad (Title, Heading1-3 con el
  tamaño del PDF, numeración y viñetas de Word, una numeración por lista), fuente del cuerpo (`wordFont`: Helvetica →
  Arial, Times → Times New Roman, «CIDFont» → familia), tamaño de página y márgenes del PDF, tablas (cabecera con fondo y
  repetida, anchos por contenido, números a la derecha), imágenes a su tamaño, salto de página por página del PDF
  (opcional). `src/export/scanDoc.js`: `scanDocument(pages)` (pageChars con OCR + charStyles + rules + pageImages; las
  páginas insertadas desde imagen llevan su imagen).
- `WordDialog.jsx`: lee con progreso, «Contenido encontrado» (títulos, párrafos, listas, tablas, imágenes), opciones
  (cada página del PDF en una nueva; incluir imágenes), vista previa en una hoja (encabezado y pie en gris); si hay páginas
  escaneadas sin texto, «Reconocer el texto primero» → diálogo de OCR → al terminar vuelve a Exportar a Word (`afterOcr`).
  Guardar por `export:save` (`kind: 'docx'`), aviso con «Abrir en Word».
- docx 9.13.0 (MIT; jszip, nanoid, hash.js) con `overrides` `@types/node` 26.6.5 (la 26.6.6 tenía 9 días). Trozo aparte
  de 452 KB con `import()`. ExcelJS y docx pasan a `devDependencies` (van dentro del bundle de Vite; así no se empaqueta
  su `node_modules`).
- Fixture `informe.pdf` (`informe()`, `INFORME`). Probado con la propuesta de Seidor (16 páginas: encabezado y pie de
  Word con «Página N de M», honorarios como tabla, títulos, logotipos de cada página quitados) y el RFP de Collell (Calibri
  y Calibri Bold reconocidas aunque se llamen «CIDFont+F1/F2», viñetas). E2E `test/e2e/word.spec.mjs` (también el camino OCR).
- Límites: una sola columna de texto (dos columnas se mezclan por línea); cuadros de texto, columnas de periódico y
  texto girado salen como párrafos normales; las celdas de las tablas sin negritas; tamaño de página del documento = el
  de la primera página; títulos sobre una franja de color sin la franja; dibujos vectoriales (gráficos) no se exportan.

**Preferencias (hecho, pendiente del visto bueno):** Editar → Preferencias… (Ctrl+,; `PreferencesDialog.jsx`).
- `src/prefs.js` (`spiderpdf:prefs`, probado en `test/share.test.js`): `lang` (ver «Idiomas»), `ai`, `userName`
  (≤ 80, sin caracteres de control; autor de lo exportado a Word y Excel), `outputDir` ('' = la carpeta del original)
  y `quality` (clave de `REDUCE_LEVELS`, el nivel con el que se abre «Reducir tamaño»). `outputFolder(prefs, carpetaOriginal)`.
- La carpeta de salida se usa en Guardar como, Extraer y las copias (`planSave({ outDir })`, probado en
  `test/save.test.js`), Reducir tamaño y Exportar. Guardar sobre el archivo abierto no cambia de carpeta.
- Elegir la carpeta: IPC `dialog:chooseFolder` → `desktop.chooseFolder` (en el navegador no existe: «Elegir…»
  desactivado). La ruta queda en un campo de solo lectura, con «Quitar».
- Nombre demasiado largo: `aria-invalid`, `v-error` y Guardar desactivado. Al abrir, el foco va al nombre.
- Hecha con spider-ui: `v-dialog` (`<dialog>` nativo con `showModal()`), `v-field`, `v-input`, `v-btn-*`; disposición
  en `PreferencesDialog.css` (prefijo `cfg-`). No se importa `spider-ui/tailwind-v4.css`: cambiaría `--font-sans` de
  toda la app. E2E `test/e2e/preferencias.spec.mjs` e `idiomas.spec.mjs`.

## Hoja de ruta
4. Hecho: OCR, Compartir, Contraseñas y Reducir tamaño (ver arriba). Falta que Diego pruebe las contraseñas en Edge
   y Acrobat con `test/out/contrasenas/` y que los reducidos se ven bien.
5. Firma con certificado: **aplazada** (propuesta aprobada con sus ajustes, ver «Paso 5» abajo).
6. Conversiones: Excel y Word hechos (ver «Paso 6, tandas 1 y 2»), pendientes del visto bueno de Diego.
Después: auto-actualización (electron-updater), firma de código (Authenticode y notarización de Apple).

**Paso 5 — APLAZADO por decisión de Diego; decisiones ya aprobadas para cuando se retome:** ayudante nativo en C# (`csc.exe` de .NET Framework 4.8, que trae
Windows), compilado al empaquetar y dentro de la app (se firmará con la firma de código); claves CNG y también CryptoAPI
(CSP antiguos, por los controladores del DNIe); almacén `CurrentUser\My` y PKCS#11 (Pkcs11Interop, Apache 2.0) sin sacar
la clave privada: el proceso principal arma el CMS/PAdES y el ayudante solo firma el resumen. El de Swift (Llavero), más
adelante. .pfx/.p12 con node-forge (como BSD, versión fijada). Sello de tiempo desactivado por defecto: la primera vez se
pregunta «¿Añadir sello de tiempo? (recomendado)» explicando que solo se envía el resumen; DigiCert por defecto,
configurable. Revisión incremental propia (PDFium no firma). Contraseña/PIN solo en memoria, nunca en registros. E2E del
almacén con un certificado «SpiderPDF PRUEBA – borrar» solo en `CurrentUser\My`, borrado siempre en un finally, más un
script para quitarlo a mano.

Idea pendiente — Asistente IA dentro de SpiderPDF (opcional, desactivado por defecto): panel lateral «Preguntar al
documento»: resumir, responder preguntas («¿importe total?», «¿fecha de vencimiento?») con la página de origen, y
extraer datos de facturas y albaranes a una tabla o CSV. Proveedor configurable: Claude u OpenAI con la clave API del
usuario, o un modelo local (Ollama) para que nada salga del equipo. Antes de enviar nada fuera, avisar qué se envía. Las
claves en el almacén seguro del sistema (`safeStorage`/Credential Manager/Llavero), nunca en archivos.
