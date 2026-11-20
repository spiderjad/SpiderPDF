# SpiderPDF

Editor de PDF de escritorio, **gratuito**, para Windows (macOS en preparación). Todo se hace en tu equipo: tus
documentos no se suben a ningún servicio. Interfaz en español, inglés y catalán.

## Descargar

**[Descargar SpiderPDF para Windows](https://github.com/spiderjad/SpiderPDF/releases/latest)**: en la página de la
última versión, abre «Assets» y descarga `SpiderPDF-Setup-x.y.z.exe`.

- Windows 10 u 11 de 64 bits.
- El instalador aún no está firmado: Windows puede avisar «Windows protegió su PC». Pulsa **Más información →
  Ejecutar de todas formas**.
- Al instalar hay que aceptar los términos y condiciones.
- Después, SpiderPDF se actualiza solo: descarga las versiones nuevas y se instalan al reiniciar.

Sin instalar nada: **[pdf.spiderjad.com](https://pdf.spiderjad.com)**, la misma aplicación en el navegador (los archivos
tampoco salen de tu equipo).

Qué trae cada versión: **[Novedades](docs/novedades.md)**.

## Qué hace

**Organizar páginas**
- Abrir varios PDF, cada uno en su pestaña (y en varias ventanas); unirlos, reordenar arrastrando, girar, eliminar y
  extraer páginas.
- Dividir un PDF: cada N páginas, por intervalos, por marcadores o por tamaño máximo.
- Insertar páginas en blanco o imágenes; crear un documento nuevo.
- Deshacer y rehacer.

**Leer y buscar**
- Lectura con zoom, panel de páginas y de marcadores; enlaces que funcionan.
- Seleccionar y copiar texto, y buscar en todo el documento.
- **OCR**: reconoce el texto de los PDF escaneados (en el equipo, sin internet) para buscarlo y copiarlo.
- Crear los marcadores a partir del índice impreso del documento.

**Editar**
- Resaltar, dibujar a mano, notas, sellos (Recibido, Pagado, Aprobado…) y marca de agua.
- Rellenar formularios.
- Firma dibujada o desde una imagen.
- Editar el texto del PDF y añadir texto nuevo con la misma fuente.
- **Redactar (censura)** de verdad: el texto y las imágenes tapados se eliminan del archivo, no solo se ocultan.
- Borrar imágenes (firmas escaneadas, logotipos) o dejar zonas en blanco.

**Guardar y compartir**
- Respeta los PDF firmados digitalmente: comprueba sus firmas y guarda los cambios sin romperlas cuando es posible.
- Contraseñas: proteger, quitar y desbloquear permisos.
- Reducir el tamaño del archivo.
- Exportar a **Word**, **Excel** e **imágenes** (PNG o JPG); copiar una página como imagen.
- Imprimir con vista previa; compartir por correo, WhatsApp o con una IA (copia el archivo y abre la aplicación).

**Línea de órdenes**
- HTML a PDF sin abrir ninguna ventana (respeta el tamaño de página, la cabecera y el pie del CSS):

      SpiderPDF --html-a-pdf informe.html informe.pdf

  Desde la carpeta de instalación, o con la ruta completa (`"C:\Program Files\SpiderPDF\SpiderPDF.com"` o
  `%LOCALAPPDATA%\Programs\SpiderPDF\SpiderPDF.com`, según cómo se instaló). Admite varios pares de archivos. Código de
  salida 0 si todo fue bien, 1 si falló algún archivo y 2 si la orden está mal escrita.

## Para desarrolladores

Requiere Node 20 o superior.

    npm install
    npm test           # pruebas del motor, del estado y de la lógica
    npm run test:e2e   # pruebas con la app de Electron real
    npm run dev        # la app de escritorio en modo desarrollo
    npm run web        # la misma interfaz en el navegador (http://localhost:5173)

Instaladores: `npm run dist:win` (.exe, en Windows) y `npm run dist:mac` (.dmg, en un Mac). Publicar una versión:
[docs/publicar-version.md](docs/publicar-version.md).

### Estructura
    electron/main.cjs          ventanas, diálogos, guardado seguro, asociación .pdf, línea de órdenes
    electron/preload.cjs       puente mínimo y seguro entre Electron y la interfaz
    src/engine/pdfium-core.js  núcleo PDF (sin DOM, probado en Node)
    src/engine/pdf.worker.js   PDFium corre en un Worker: la interfaz nunca se congela
    src/engine/client.js       llamadas al worker y caché de renders
    src/state.js               estado: páginas, selección, deshacer
    src/components/            interfaz
    test/                      pruebas y PDFs de ejemplo (node test/make-fixtures.js)

### Idea clave
Los PDFs abiertos no se modifican. La app trabaja con una lista de referencias de página (documento, número, giro,
anotaciones) y al guardar construye el PDF resultante con ellas. Por eso unir, reordenar, deshacer y extraer son
operaciones baratas y seguras.

El motor es **PDFium** (el de Chrome) compilado a WebAssembly (Apache 2.0 / BSD). Sin dependencias GPL.
