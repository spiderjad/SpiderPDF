import { MousePointer2, Highlighter, PenLine, StickyNote, Signature, TextCursorInput, EyeOff, Type } from 'lucide-react';

export const TOOLS = [
  { id: 'select', label: 'Seleccionar', icon: MousePointer2, hint: 'Haz clic en una anotación para moverla. Supr para borrarla.' },
  { id: 'highlight', label: 'Resaltar', icon: Highlighter, hint: 'Arrastra sobre la página para resaltar.' },
  { id: 'ink', label: 'Lápiz', icon: PenLine, hint: 'Dibuja sobre la página.' },
  { id: 'note', label: 'Nota', icon: StickyNote, hint: 'Haz clic donde quieras dejar una nota.' },
  { id: 'signature', label: 'Firma', icon: Signature, hint: 'Dibuja tu firma o elige una imagen.' },
  { id: 'textbox', label: 'Texto nuevo', icon: Type, hint: 'Haz clic donde quieras escribir o arrastra para hacer un cuadro. Esc o clic fuera para terminar.' },
  { id: 'text', label: 'Editar texto', icon: TextCursorInput, hint: 'Haz clic en un texto del PDF para cambiarlo. Intro para aceptar, Esc para cancelar.' },
  { id: 'redact', label: 'Redactar', icon: EyeOff, hint: 'Arrastra sobre lo que quieras eliminar. Se borra del archivo al guardar.' },
];

/** Colores por herramienta: [hex, nombre accesible]. */
export const PALETTES = {
  highlight: [['#FFD400', 'Amarillo'], ['#7ED957', 'Verde'], ['#FF7EB6', 'Rosa'], ['#6CC4FF', 'Azul']],
  ink: [['#121216', 'Negro'], ['#1F3A93', 'Azul'], ['#DC2828', 'Rojo'], ['#7C3BED', 'Violeta']],
  note: [['#FFD400', 'Amarillo'], ['#7ED957', 'Verde'], ['#FF7EB6', 'Rosa'], ['#6CC4FF', 'Azul']],
};

/** allowed: ids permitidos (un PDF certificado limita las herramientas); lockedHint explica por qué. */
export default function AnnotToolbar({ tool, onTool, colors, onColor, allowed, lockedHint, children }) {
  const palette = PALETTES[tool];
  // Con la barra de formato del texto a la derecha no cabe todo: las herramientas quedan solo con icono
  // (el nombre, en la ayuda y para lectores de pantalla).
  const compact = !!children;
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2.5">
      <div role="toolbar" aria-label="Herramientas de anotación" className="flex items-center gap-0.5">
        {TOOLS.map(({ id, label, icon: Icon }) => {
          const active = tool === id;
          const off = allowed && !allowed.has(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              aria-disabled={off || undefined}
              aria-label={label}
              title={off ? lockedHint : compact ? label : undefined}
              onClick={() => { if (!off) onTool(id); }}
              className={`flex h-8 items-center gap-2 whitespace-nowrap rounded-lg ${compact ? 'px-2' : 'px-2.5'} text-sm font-medium transition-[background-color,color,scale] ${off ? 'cursor-not-allowed opacity-50' : 'active:scale-[0.98]'} ${off ? 'text-ink' : active
                ? 'bg-accent-soft text-accent-ink ring-1 ring-inset ring-accent/15'
                : 'text-ink hover:bg-hover'}`}
            >
              <Icon size={16} strokeWidth={1.75} className={active ? '' : 'text-muted'} />
              {!compact && label}
            </button>
          );
        })}
      </div>

      {palette && (
        <>
          <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
          <div role="radiogroup" aria-label="Color" className="flex items-center gap-1.5">
            {palette.map(([hex, name]) => {
              const active = colors[tool] === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={name}
                  title={name}
                  onClick={() => onColor(tool, hex)}
                  className={`grid size-7 place-items-center rounded-full transition-[scale] active:scale-95 ${active ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : 'hover:bg-hover'}`}
                >
                  <span className="size-4.5 rounded-full border border-black/10" style={{ background: hex }} />
                </button>
              );
            })}
          </div>
        </>
      )}
      {children}
    </div>
  );
}
