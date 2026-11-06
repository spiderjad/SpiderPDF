import { Component } from 'react';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { t } from '../i18n/index.js';

/**
 * Evita que un fallo al pintar una parte de la interfaz deje toda la ventana en blanco.
 *   fallback="silent": no pinta nada (p. ej. la capa de anotaciones de una página).
 *   sin fallback: muestra un aviso con «Volver a intentar».
 * resetKey: si cambia, se vuelve a intentar sola (p. ej. al cambiar de vista).
 */
export default class ErrorBoundary extends Component {
  state = { error: null, key: undefined };

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error, info) {
    console.error('[SpiderPDF] Error al pintar', this.props.name ?? '', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback === 'silent') return null;
    return (
      <div role="alert" className="grid h-full place-items-center bg-desk p-8">
        <div className="flex max-w-[420px] flex-col items-center rounded-2xl border border-line bg-panel px-8 py-8 text-center shadow-card">
          <span className="mb-4 grid size-11 place-items-center rounded-xl bg-danger-soft text-danger-ink">
            <CircleAlert size={22} strokeWidth={1.75} />
          </span>
          <h2 className="text-base font-semibold">{t('reader.error.title')}</h2>
          <p className="mt-1.5 text-sm text-muted">{t('reader.error.body')}</p>
          <p className="mt-2 max-w-full truncate font-mono text-xs text-muted" title={String(this.state.error?.message ?? '')}>
            {String(this.state.error?.message ?? this.state.error)}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-5 flex h-9 items-center gap-2 rounded-lg bg-inverse px-3.5 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98]"
          >
            <RotateCcw size={16} strokeWidth={1.75} />
            {t('reader.error.retry')}
          </button>
        </div>
      </div>
    );
  }
}
