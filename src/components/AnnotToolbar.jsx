import { MousePointer2, Highlighter, PenLine, StickyNote, Signature, TextCursorInput, EyeOff, Type } from 'lucide-react';
import { useT } from '../i18n/index.js';
import './AnnotToolbar.css';

/** Herramientas de Leer. label y hint son claves de traducción (src/i18n/strings/core.js), no textos. */
export const TOOLS = [
  { id: 'select', label: 'core.tool.select', icon: MousePointer2, hint: 'core.tool.selectHint' },
  { id: 'highlight', label: 'core.tool.highlight', icon: Highlighter, hint: 'core.tool.highlightHint' },
  { id: 'ink', label: 'core.tool.ink', icon: PenLine, hint: 'core.tool.inkHint' },
  { id: 'note', label: 'core.tool.note', icon: StickyNote, hint: 'core.tool.noteHint' },
  { id: 'signature', label: 'core.tool.signature', icon: Signature, hint: 'core.tool.signatureHint' },
  { id: 'textbox', label: 'core.tool.textbox', icon: Type, hint: 'core.tool.textboxHint' },
  { id: 'text', label: 'core.tool.text', icon: TextCursorInput, hint: 'core.tool.textHint' },
  { id: 'redact', label: 'core.tool.redact', icon: EyeOff, hint: 'core.tool.redactHint' },
];

/** Colores por herramienta: [hex, clave del nombre accesible]. Son colores de la anotación (contenido), no de la interfaz. */
export const PALETTES = {
  highlight: [['#FFD400', 'core.color.yellow'], ['#7ED957', 'core.color.green'], ['#FF7EB6', 'core.color.pink'], ['#6CC4FF', 'core.color.blue']],
  ink: [['#121216', 'core.color.black'], ['#1F3A93', 'core.color.blue'], ['#DC2828', 'core.color.red'], ['#7C3BED', 'core.color.violet']],
  note: [['#FFD400', 'core.color.yellow'], ['#7ED957', 'core.color.green'], ['#FF7EB6', 'core.color.pink'], ['#6CC4FF', 'core.color.blue']],
};

/**
 * Barra de herramientas de Leer (spider-ui: v-toolbar--sub, v-btn-ghost con aria-pressed). allowed: ids permitidos
 * (un PDF certificado limita las herramientas); lockedHint explica por qué. children: la barra de formato del texto.
 */
export default function AnnotToolbar({ tool, onTool, colors, onColor, allowed, lockedHint, children }) {
  const t = useT();
  const palette = PALETTES[tool];
  // Con la barra de formato del texto a la derecha no cabe todo: las herramientas quedan solo con icono
  // (el nombre, en la ayuda y para lectores de pantalla).
  const compact = !!children;
  return (
    <div className="v-toolbar v-toolbar--sub at-bar">
      <div role="toolbar" aria-label={t('core.tool.toolbar')} className="v-toolbar__group">
        {TOOLS.map(({ id, label, icon: Icon }) => {
          const active = tool === id;
          const off = allowed && !allowed.has(id);
          const name = t(label);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              aria-disabled={off || undefined}
              aria-label={name}
              title={off ? lockedHint : compact ? name : undefined}
              onClick={() => { if (!off) onTool(id); }}
              className={`v-btn-ghost at-tool ${compact ? 'at-tool--compact' : ''}`}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {!compact && <span className="at-label">{name}</span>}
            </button>
          );
        })}
      </div>

      {palette && (
        <>
          <span className="v-toolbar__sep" aria-hidden="true" />
          <div role="radiogroup" aria-label={t('core.tool.color')} className="v-toolbar__group at-colors">
            {palette.map(([hex, nameKey]) => {
              const active = colors[tool] === hex;
              const name = t(nameKey);
              return (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={name}
                  title={name}
                  onClick={() => onColor(tool, hex)}
                  className={`v-btn-icon v-btn--sm at-swatch ${active ? 'at-swatch--on' : ''}`}
                >
                  <span className="at-dot" style={{ background: hex }} />
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
