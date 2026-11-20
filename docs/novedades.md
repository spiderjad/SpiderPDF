# Novedades de SpiderPDF

Cada versión, lo que cambia para quien usa SpiderPDF. `npm run release:win` copia la sección de la versión al texto de
su release en GitHub (la página de descarga): lo que pone aquí es lo que se ve en la web.

## 1.0.0

Primera versión estable.

- **HTML a PDF desde la línea de órdenes**, sin abrir ninguna ventana:
  `SpiderPDF --html-a-pdf informe.html informe.pdf` (también varios archivos de una vez). Respeta el tamaño de página,
  los márgenes, la cabecera y el pie del CSS (`@page`, con «página n de total»), los estilos e imágenes que están junto
  al HTML y no parte las filas de las tablas. Pensado para generar la documentación de TIC sin Chrome.
- Al instalar, hay que aceptar los términos y condiciones (en inglés).
- El instalador y la aplicación indican el autor: Diego Pennisi.
- Más seguridad: la aplicación instalada ya no se puede usar como intérprete de Node.

## 0.3.0

- **Sellos**: Recibido, Pagado, Aprobado… con fecha y nombre, texto propio o una imagen; girar, escalar y aplicar a
  varias páginas.
- **Marca de agua** de texto o imagen: centrada o en mosaico, delante o detrás, en las páginas que elijas.
- **Exportar como imagen** (PNG o JPG, con la resolución que quieras) y **copiar una página como imagen** con el clic
  derecho.
- **Guardar una copia** sin tocar el original.
- Herramienta **Borrar**: quita una imagen del PDF (una firma escaneada, un logotipo) o deja una zona en blanco.
- **Tema claro u oscuro** en Preferencias.

## 0.2.1

- Ruedita de Preferencias en la barra de título, junto a «Ver».

## 0.2.0

- **Pestañas y varias ventanas**: cada PDF en su pestaña; arrastra una pestaña fuera para llevarla a otra ventana.
  Opción de volver a abrir las pestañas de la última vez.
- **Dividir PDF**: cada N páginas, por intervalos, por marcadores o por tamaño máximo.
- **Actualizaciones automáticas**: SpiderPDF busca versiones nuevas, las descarga y se instalan al reiniciar.

## 0.1.0

Primera versión: leer y organizar PDFs (unir, reordenar, girar, eliminar, extraer), anotar, rellenar formularios,
firmar, editar y añadir texto, redactar (censura), buscar, marcadores, insertar páginas, imprimir, OCR, contraseñas,
reducir tamaño, compartir y exportar a Word y Excel, en español, inglés y catalán.
