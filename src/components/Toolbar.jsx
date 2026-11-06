import { useEffect, useRef, useState } from 'react';
import {
  FolderOpen, FilePlus2, LayoutGrid, BookOpen, Undo2, Redo2, RotateCcw, RotateCw,
  Trash2, FileOutput, ZoomIn, ZoomOut, MoveHorizontal, Save, LoaderCircle, Search,
  FilePlus, File as FileIcon, ImagePlus, ChevronDown, Share2,
} from 'lucide-react';

const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';

export default function Toolbar({ state, hasTargets, busy, run, savingLabel, canPages = true }) {
  const has = state.pages.length > 0;
  const pageOps = hasTargets && !busy && canPages; // un PDF certificado no deja girar ni quitar páginas
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-2.5">
      <Button onClick={() => run('open')} title={`Abrir (${mod}O)`} icon={FolderOpen} disabled={busy}>Abrir</Button>
      <Button onClick={() => run('add')} title={`Añadir otro PDF al final (${mod}Mayús+O)`} icon={FilePlus2} disabled={!has || busy || !canPages}>Añadir PDF</Button>

      <Divider />

      <div role="tablist" aria-label="Vista" className="flex rounded-lg bg-hover p-0.5">
        <Tab active={state.mode === 'organize'} onClick={() => run('organize')} icon={LayoutGrid} disabled={!has}>Organizar</Tab>
        <Tab active={state.mode === 'read'} onClick={() => run('read')} icon={BookOpen} disabled={!has}>Leer</Tab>
      </div>

      <Divider />

      <IconButton onClick={() => run('undo')} label={`Deshacer (${mod}Z)`} icon={Undo2} disabled={!state.past.length || busy} />
      <IconButton onClick={() => run('redo')} label="Rehacer" icon={Redo2} disabled={!state.future.length || busy} />

      <Divider />

      <IconButton onClick={() => run('rotateLeft')} label="Girar a la izquierda" icon={RotateCcw} disabled={!pageOps} />
      <IconButton onClick={() => run('rotateRight')} label="Girar a la derecha" icon={RotateCw} disabled={!pageOps} />
      <IconButton onClick={() => run('delete')} label="Eliminar (Supr)" icon={Trash2} disabled={!pageOps} />
      <Button onClick={() => run('extract')} title="Guardar las páginas seleccionadas como un PDF nuevo" icon={FileOutput} disabled={!state.selected.size || busy || !canPages}>
        Extraer
      </Button>
      {state.mode === 'organize' && <InsertMenu run={run} disabled={!has || busy || !canPages} />}

      <div className="flex-1" />

      {state.mode === 'read' && has && (
        <div className="mr-2 flex items-center gap-0.5">
          <IconButton onClick={() => run('find')} label={`Buscar (${mod}F)`} icon={Search} />
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <IconButton onClick={() => run('zoomOut')} label="Alejar" icon={ZoomOut} />
          <span className="tabnum w-12 text-center text-xs text-muted">{Math.round(state.zoom * 100)} %</span>
          <IconButton onClick={() => run('zoomIn')} label="Acercar" icon={ZoomIn} />
          <IconButton onClick={() => run('zoomFit')} label="Ajustar al ancho" icon={MoveHorizontal} />
        </div>
      )}

      <Button onClick={() => run('share')} title="Compartir por WhatsApp, correo o copiando el archivo" icon={Share2} disabled={!has || busy}>Compartir</Button>
      <span className="w-1" aria-hidden="true" />
      <button
        type="button"
        onClick={() => run('save')}
        disabled={!has || busy}
        title={`Guardar (${mod}S)`}
        className="flex h-8 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent transition-[background-color,scale] hover:bg-accent/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        {savingLabel ? <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden="true" /> : <Save size={16} strokeWidth={1.75} />}
        <span aria-live="polite">{savingLabel ?? 'Guardar'}</span>
      </button>
    </header>
  );
}

const INSERT_ITEMS = [
  { cmd: 'insertBlank', label: 'Página en blanco', hint: 'Del tamaño de la página seleccionada, o A4', icon: FileIcon },
  { cmd: 'insertImage', label: 'Imagen como página…', hint: 'PNG o JPG; la página toma su tamaño', icon: ImagePlus },
];

/** «Insertar ▾»: páginas nuevas tras la selección. Menú con teclado (flechas, Intro, Esc). */
function InsertMenu({ run, disabled }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const menu = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector('[role="menuitem"]')?.focus();
    const away = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [open]);

  const choose = (cmd) => { setOpen(false); btn.current?.focus(); run(cmd); };
  const onKey = (e) => {
    const items = [...menu.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
  };

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title="Insertar páginas nuevas tras la selección"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-ink transition-[background-color,scale] hover:bg-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        <FilePlus size={16} strokeWidth={1.75} className="text-muted" />
        Insertar
        <ChevronDown size={14} strokeWidth={1.75} className={`text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Insertar" onKeyDown={onKey} className="motion-pop absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-line bg-panel p-1 shadow-pop">
          {INSERT_ITEMS.map(({ cmd, label, hint, icon: Icon }) => (
            <button
              key={cmd}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => choose(cmd)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
            >
              <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <span className="mx-1.5 h-5 w-px bg-line" aria-hidden="true" />;
}

function Button({ icon: Icon, children, ...props }) {
  return (
    <button type="button" {...props} className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-ink transition-[background-color,scale] hover:bg-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50">
      <Icon size={16} strokeWidth={1.75} className="text-muted" />
      {children}
    </button>
  );
}

function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button type="button" title={label} aria-label={label} {...props} className="grid size-8 place-items-center rounded-lg text-ink transition-[background-color,scale] hover:bg-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50">
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

function Tab({ active, icon: Icon, children, ...props }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      {...props}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${active ? 'bg-panel text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink'}`}
    >
      <Icon size={15} strokeWidth={1.75} />
      {children}
    </button>
  );
}
