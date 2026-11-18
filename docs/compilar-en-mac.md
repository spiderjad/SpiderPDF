# Compilar SpiderPDF en un Mac

Guía para generar el instalador de macOS (`.dmg`) y probar la app en un Mac. En Windows no se puede: Apple solo deja
empaquetar apps de Mac en un Mac.

Resultado: `release/SpiderPDF-0.1.0-arm64.dmg` (Mac con chip Apple: M1, M2, M3, M4…) y
`release/SpiderPDF-0.1.0-x64.dmg` (Mac con Intel). La versión sale de `version` en `package.json`.

## 1. Lo que hace falta (una sola vez)

1. **Herramientas de línea de comandos de Xcode.** Abre Terminal y escribe:
   ```bash
   xcode-select --install
   ```
   Si dice que ya están instaladas, sigue.
2. **Node.js 24** (la misma versión que en Windows, 24.14.1). Lo más cómodo es `nvm`:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   # cierra y vuelve a abrir Terminal
   nvm install 24.14.1
   nvm use 24.14.1
   ```
   También vale el instalador de https://nodejs.org (versión 24).
3. **Acceso a GitHub.** El repositorio de SpiderPDF y el de spider-ui son privados; `npm` los descarga con tu
   cuenta. Con la herramienta de GitHub:
   ```bash
   brew install gh        # si no tienes Homebrew: https://brew.sh
   gh auth login          # elige GitHub.com, HTTPS y «Login with a web browser»
   gh auth setup-git
   ```

## 2. Descargar el proyecto e instalar dependencias

```bash
cd ~/Documents
gh repo clone spiderjad/SpiderPDF
cd SpiderPDF
npm ci
```

`npm ci` instala exactamente las versiones del `package-lock.json` (también spider-ui, fijado a su commit).

## 3. Probar antes de compilar

```bash
npm test         # pruebas del motor y de la lógica (unos 2 minutos); deben acabar sin «FALLO»
npm run dev      # abre la app en modo desarrollo
```

En modo desarrollo el Dock y el menú dicen «Electron» en vez de «SpiderPDF»: es normal (lo que se ejecuta es el
programa genérico de Electron). En la app compilada sale «SpiderPDF».

Las pruebas de la app de verdad (`npm run test:e2e`) están hechas para Windows (barra de menús propia, atajos con
Ctrl): en el Mac no hace falta pasarlas; en su lugar, la lista del punto 6.

## 4. Compilar el instalador

```bash
npm run dist:mac
```

Tarda unos minutos la primera vez (descarga Electron para Mac). Al acabar, en la carpeta `release/` están los dos
`.dmg`. Para verlos: `open release`.

La app va **firmada «ad hoc»** (sin certificado de Apple): basta para abrirla en tus Macs, pero no para venderla.

## 5. Instalar y abrir

1. Doble clic en el `.dmg` de tu Mac (arm64 si tiene chip Apple; si no sabes cuál: menú Apple → Acerca de este Mac).
2. Arrastra **SpiderPDF** a la carpeta **Aplicaciones**.
3. Ábrela desde Aplicaciones o Launchpad.

Si la compilaste en ese mismo Mac, se abre sin avisos. Si el `.dmg` llegó de otro Mac (AirDrop, correo, descarga),
macOS dirá **«No se puede abrir SpiderPDF porque Apple no puede comprobar si contiene software malicioso»**:

- Ajustes del Sistema → Privacidad y seguridad → abajo, junto a «Se bloqueó SpiderPDF», pulsa **Abrir igualmente**
  (pide tu contraseña), o
- en Terminal: `xattr -dr com.apple.quarantine /Applications/SpiderPDF.app`

Para quitarla: arrastra SpiderPDF de Aplicaciones a la Papelera.

## 6. Qué probar a mano en el Mac

- **Menú SpiderPDF:** Acerca de SpiderPDF, Preferencias… (⌘,), Ocultar, Salir (⌘Q; si hay cambios sin guardar, pregunta).
- **Menús Archivo, Editar, Ver y Ventana**, con sus atajos: ⌘N, ⌘O, ⌘S, ⇧⌘S, ⌘E, ⌘P, ⌘Z, ⇧⌘Z, ⌘F, ⌘D, ⌘1, ⌘2, ⌘+, ⌘−, ⌘0.
- **Escribir en un campo** (nombre en Preferencias, buscar, un cuadro de texto): ⌘C, ⌘V, ⌘X, ⌘Z y ⌘A actúan sobre
  el texto, no sobre las páginas.
- **Borrar páginas** con la tecla ⌫.
- **Abrir un PDF desde el Finder:** clic derecho → Abrir con → SpiderPDF, con la app cerrada y con la app abierta.
- **Imprimir** (⌘P): con una impresora real; y «Configuración avanzada de la impresora…» abre el diálogo de macOS
  (desde ahí, el botón PDF guarda como PDF).
- **Compartir:**
  - «Copiar archivo» y pegar con ⌘V en el Finder o en un correo.
  - «Correo»: se abre un mensaje nuevo de Mail (o de tu programa de correo) con el PDF adjunto.
  - «Más opciones»: el menú Compartir de macOS (AirDrop, Mensajes, Notas…).
  - «Mostrar en el Finder», WhatsApp y Enviar a IA.
- **Exportar a Word y a Excel** y abrir el resultado.
- **Idioma:** con el Mac en catalán o en inglés (Ajustes del Sistema → General → Idioma y región), la app sale en ese
  idioma; en Preferencias → Idioma se puede elegir otro.
- **Modo oscuro** (Ajustes del Sistema → Aspecto).
- **Cambios sin guardar:** el botón rojo de cerrar la ventana muestra un punto.

Si algo falla, abre la app con `npm run dev`: los errores salen en Terminal y en Ver → Herramientas de desarrollo.

## 7. Diferencias con Windows

- Menú en la barra de arriba del Mac (no dentro de la ventana) y atajos con ⌘ en vez de Ctrl. Los textos de la app
  ya dicen ⌘, ⇧, ⌫ y «Finder» en el Mac.
- Compartir usa el portapapeles y el menú Compartir de macOS; el ayudante de Windows (`SpiderPdfHelper.exe`) no hace
  falta.
- Las impresoras virtuales de Windows (Microsoft Print to PDF…) no existen; en el Mac se guarda como PDF desde el
  diálogo de impresión.

## 8. Pendiente para vender en Mac

- **Firma Developer ID y notarización** (cuenta de Apple Developer, 99 €/año). Sin ellas, cualquier Mac que descargue
  el `.dmg` muestra el aviso del punto 5. Al tenerla: en `package.json` quitar `"identity": "-"`, poner
  `"hardenedRuntime": true` con sus «entitlements» (JIT de V8) y configurar la notarización.
- Firma con certificado digital desde el Llavero (aplazada, como en Windows).
