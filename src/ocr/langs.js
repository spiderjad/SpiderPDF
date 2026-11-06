// Idiomas del OCR que lleva la app (datos en ocr/<código>.traineddata.gz, ver vite.config.js). Aparte de
// service.js para que el diálogo no cargue Tesseract.js: se carga solo al reconocer.
export const OCR_LANGS = [
  { code: 'spa', label: 'Español' },
  { code: 'cat', label: 'Català' },
  { code: 'eng', label: 'English' },
];
