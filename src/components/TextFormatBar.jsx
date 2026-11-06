import { Bold, BringToFront, Copy, Italic, SendToBack, TextAlignCenter, TextAlignEnd, TextAlignStart } from 'lucide-react';
import { FAMILIES, usesPdfFont } from '../textbox.js';

const mod = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';

/**
 * Formato del cuadro de texto seleccionado (en la barra de herramientas de Leer): fuente (la del PDF o una
 * incluida), tamaño, negrita, cursiva, color, alineación, orden y duplicar.
 * onStyle(cambios del estilo), onFont(valor del selector), onDuplicate, onOrder('front' | 'back').
 */
export default function TextFormatBar({ annot, onStyle, onFont, onDuplicate, onOrder }) {
  const st = annot.style;
  const fontValue = usesPdfFont(annot) ? 'pdf' : st.family;
  const toggle = (on, label, Icon, onClick, title) => (
    <button type="button" aria-pressed={on} aria-label={label} title={title ?? label} onClick={onClick}
      className={`grid size-8 place-items-center rounded-lg transition-colors ${on ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-hover hover:text-ink'}`}>
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
  const pdfName = st.pdf?.name;
  // La fuente del PDF no trae otra variante: pedir negrita o cursiva pasa a la incluida más parecida.
  const variantTitle = (label) => (usesPdfFont(annot) ? `${label} (con ${FAMILIES[st.family].label}: «${pdfName}» no tiene esa variante)` : label);

  return (
    <div role="toolbar" aria-label="Formato del texto" className="ml-2 flex min-w-0 items-center gap-1 border-l border-line pl-3">
      <label className="sr-only" htmlFor="tb-fuente">Fuente</label>
      <select
        id="tb-fuente"
        value={fontValue}
        onChange={(e) => onFont(e.target.value)}
        className="h-8 max-w-48 rounded-lg border border-line bg-panel px-2 text-sm"
        title={annot.fallback ? `«${pdfName}» del PDF no tiene todas las letras: se usa ${FAMILIES[st.family].label}` : undefined}
      >
        {st.pdf && <option value="pdf">{pdfName} (del PDF)</option>}
        {Object.entries(FAMILIES).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="tb-tamano">Tamaño en puntos</label>
      <input
        id="tb-tamano"
        type="number"
        min={4}
        max={200}
        step={0.5}
        value={st.size}
        onChange={(e) => { const v = Number(e.target.value); if (v >= 4 && v <= 200) onStyle({ size: v }); }}
        className="tabnum h-8 w-16 rounded-lg border border-line bg-panel px-2 text-sm"
        title="Tamaño (pt)"
      />
      {toggle(!!st.bold, 'Negrita', Bold, () => onStyle({ bold: !st.bold, usePdf: false }), variantTitle('Negrita'))}
      {toggle(!!st.italic, 'Cursiva', Italic, () => onStyle({ italic: !st.italic, usePdf: false }), variantTitle('Cursiva'))}
      <label className="grid size-8 cursor-pointer place-items-center rounded-lg hover:bg-hover" title="Color del texto">
        <span className="sr-only">Color del texto</span>
        <input type="color" value={st.color} onChange={(e) => onStyle({ color: e.target.value })} className="size-5 cursor-pointer rounded border-0 bg-transparent p-0" />
      </label>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <div role="radiogroup" aria-label="Alineación" className="flex items-center">
        {[['left', 'Alinear a la izquierda', TextAlignStart], ['center', 'Centrar', TextAlignCenter], ['right', 'Alinear a la derecha', TextAlignEnd]].map(([v, label, Icon]) => (
          <button key={v} type="button" role="radio" aria-checked={st.align === v} aria-label={label} title={label} onClick={() => onStyle({ align: v })}
            className={`grid size-8 place-items-center rounded-lg transition-colors ${st.align === v ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-hover hover:text-ink'}`}>
            <Icon size={16} strokeWidth={1.75} />
          </button>
        ))}
      </div>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      {toggle(false, 'Traer al frente', BringToFront, () => onOrder('front'))}
      {toggle(false, 'Enviar atrás', SendToBack, () => onOrder('back'))}
      {toggle(false, 'Duplicar', Copy, onDuplicate, `Duplicar (${mod}D)`)}
    </div>
  );
}
