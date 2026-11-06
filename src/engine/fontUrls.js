// URLs (empaquetadas por Vite) de las fuentes incluidas y del subconjuntador. Solo navegador/worker:
// en Node las pruebas leen los mismos archivos de node_modules (ver src/textbox.js → fontFile).
import sans400 from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url';
import sans400i from '@expo-google-fonts/inter/400Regular_Italic/Inter_400Regular_Italic.ttf?url';
import sans700 from '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf?url';
import sans700i from '@expo-google-fonts/inter/700Bold_Italic/Inter_700Bold_Italic.ttf?url';
import serif400 from '@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf?url';
import serif400i from '@expo-google-fonts/noto-serif/400Regular_Italic/NotoSerif_400Regular_Italic.ttf?url';
import serif700 from '@expo-google-fonts/noto-serif/700Bold/NotoSerif_700Bold.ttf?url';
import serif700i from '@expo-google-fonts/noto-serif/700Bold_Italic/NotoSerif_700Bold_Italic.ttf?url';
import mono400 from '@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf?url';
import mono400i from '@expo-google-fonts/jetbrains-mono/400Regular_Italic/JetBrainsMono_400Regular_Italic.ttf?url';
import mono700 from '@expo-google-fonts/jetbrains-mono/700Bold/JetBrainsMono_700Bold.ttf?url';
import mono700i from '@expo-google-fonts/jetbrains-mono/700Bold_Italic/JetBrainsMono_700Bold_Italic.ttf?url';
import hbSubsetWasm from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';

/** Clave (familyKey) → URL del TTF. */
export const FONT_URLS = {
  'sans-400': sans400, 'sans-400-i': sans400i, 'sans-700': sans700, 'sans-700-i': sans700i,
  'serif-400': serif400, 'serif-400-i': serif400i, 'serif-700': serif700, 'serif-700-i': serif700i,
  'mono-400': mono400, 'mono-400-i': mono400i, 'mono-700': mono700, 'mono-700-i': mono700i,
};

export const HB_SUBSET_WASM = hbSubsetWasm;
