// Icono de SpiderPDF. Dos dibujos: el pequeño (trazos gruesos) hasta 32 px y el normal desde 48 px.
import smallUrl from '../../build/spiderpdf-icon-small.svg?url';
import normalUrl from '../../build/spiderpdf-icon.svg?url';

export default function AppIcon({ size = 24, alt = '', className = '' }) {
  return (
    <img
      src={size <= 32 ? smallUrl : normalUrl}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={`shrink-0 select-none ${className}`}
    />
  );
}
