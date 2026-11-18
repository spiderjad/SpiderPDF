import './Choice.css';

/**
 * Grupo de opciones con aspecto de control segmentado (v-segmented de spider-ui) y semántica de radio: flechas para
 * cambiar, como los nativos. options: [[valor, texto]]. Lo usan Marca de agua y Exportar como imagen.
 */
export default function Choice({ label, value, options, onChange, disabled = false }) {
  const keys = options.map((o) => o[0]);
  const move = (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = keys[(keys.indexOf(value) + d + keys.length) % keys.length];
    onChange(next);
    e.currentTarget.parentElement.querySelector(`[data-value="${next}"]`)?.focus();
  };
  return (
    <div className="v-segmented ch-seg" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id} type="button" role="radio" aria-checked={value === id} data-value={id} tabIndex={value === id ? 0 : -1}
          className="v-segmented__item" disabled={disabled} onClick={() => onChange(id)} onKeyDown={move}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
