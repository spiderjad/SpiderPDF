# Publicar una versión nueva de SpiderPDF (Windows)

Las copias instaladas buscan versiones nuevas en las **Releases de GitHub** de `spiderjad/SpiderPDF` (electron-updater,
proveedor `github`). Al arrancar la comprueban (salvo que en Preferencias se haya desactivado), la descargan en segundo
plano y muestran **«Reiniciar para actualizar»** en la barra de pestañas. Si no se reinicia, se instala al salir.

## Una vez: el token de GitHub

Crea un *fine-grained token* en GitHub → Settings → Developer settings → Personal access tokens:
- Repositorio: solo `spiderjad/SpiderPDF`.
- Permiso: **Contents: Read and write**.

No lo guardes en el repositorio ni en archivos del proyecto: se pasa como variable de entorno al publicar.

## Cada versión

1. Sube `version` en `package.json` (por ejemplo `0.1.0` → `0.1.1`). Las copias instaladas solo se actualizan a una
   versión **mayor** que la suya.
2. Comprueba que todo está en verde: `npm test` y `npm run test:e2e`.
3. En PowerShell, desde la carpeta del proyecto:
   ```powershell
   $env:GH_TOKEN = 'github_pat_…'
   npm run release:win
   Remove-Item Env:GH_TOKEN
   ```
   Compila, crea el instalador y lo sube a un **borrador** de release `v0.1.1` con tres archivos:
   `SpiderPDF-Setup-0.1.1.exe`, su `.blockmap` (para descargar solo lo que cambió) y `latest.yml` (versión y SHA-512).
4. Prueba el instalador del borrador en un equipo (o una máquina virtual).
5. En GitHub → Releases → el borrador → escribe las novedades → **Publish release**. Desde ese momento, las copias
   instaladas la encuentran al arrancar (o con Preferencias → Actualizaciones → «Buscar ahora»).

## Si algo sale mal

- Un borrador no lo ve nadie: se puede borrar y repetir.
- Una versión ya publicada con un fallo: no la borres ni cambies sus archivos (quien ya la descargó la tiene). Publica
  otra mayor con el arreglo.
- `npm run dist:win` sigue sirviendo para compilar sin publicar nada (`--publish never`).

## Notas

- **La primera versión con actualizaciones se instala a mano.** Las copias de antes no saben buscarlas.
- Sin firma de código, la actualización se protege con HTTPS y el SHA-512 de `latest.yml`, que vienen de la misma
  release: protege la cuenta de GitHub con doble factor. Con firma Authenticode, electron-updater comprobaría además que
  el instalador nuevo es del mismo editor.
- macOS: instalar actualizaciones exige la firma de Apple (Developer ID); hasta tenerla, en Mac no se buscan.
- La app solo pide `latest.yml` y, si hay versión nueva, el instalador. No manda datos del usuario.
