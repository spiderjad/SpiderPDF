import { useEffect, useRef, useState } from 'react';
import {
  FolderOpen, FilePlus2, LayoutGrid, BookOpen, Undo2, Redo2, RotateCcw, RotateCw,
  Trash2, FileOutput, ZoomIn, ZoomOut, MoveHorizontal, Save, LoaderCircle, Search,
  FilePlus, File as FileIcon, ImagePlus, ChevronDown, Share2, FileDown,
} from 'lucide-react';
import { WordBadge, ExcelBadge } from './FileBadges.jsx';
import { useT } from '../i18n/index.js';
import { formatAccel } from '../menu.js';
import './Toolbar.css';

/**
 * Cabecera de la app (spider-ui: v-toolbar, v-btn-ghost, v-btn-icon, v-segmented, v-menu, v-btn-primary).
 * De izquierda a derecha: archivo · vista · deshacer · páginas · (zoom en Leer) · exportar, compartir y guardar.
 * En ventanas estrechas los botones con texto se quedan en icono (Toolbar.css); el nombre sigue en title y aria-label.
 */
export default function Toolbar({ state, hasTargets, busy, run, savingLabel, canPages = true, canExport = true }) {
  const t = useT();
  const has = state.pages.length > 0;
  const pageOps = hasTargets && !busy && canPages; // un PDF certificado no deja girar ni quitar páginas
  const k = (accel) => ` (${formatAccel(accel)})`;

  return (
    <header className={`v-toolbar hd-bar ${state.mode === 'read' ? 'hd-bar--read' : ''}`}>
      <div className="v-toolbar__group">
        <Ghost onClick={() => run('open')} title={t('core.toolbar.open') + k('CmdOrCtrl+O')} icon={FolderOpen} disabled={busy} label={t('core.toolbar.open')} />
        <Ghost onClick={() => run('add')} title={t('core.toolbar.addTitle') + k('CmdOrCtrl+Shift+O')} icon={FilePlus2} disabled={!has || busy || !canPages} label={t('core.toolbar.add')} />
      </div>

      <span className="v-toolbar__sep" aria-hidden="true" />

      <div role="tablist" aria-label={t('core.toolbar.view')} className="v-segmented">
        <ViewTab active={state.mode === 'organize'} onClick={() => run('organize')} icon={LayoutGrid} disabled={!has} title={t('core.toolbar.organize') + k('CmdOrCtrl+1')}>{t('core.toolbar.organize')}</ViewTab>
        <ViewTab active={state.mode === 'read'} onClick={() => run('read')} icon={BookOpen} disabled={!has} title={t('core.toolbar.read') + k('CmdOrCtrl+2')}>{t('core.toolbar.read')}</ViewTab>
      </div>

      <span className="v-toolbar__sep" aria-hidden="true" />

      <div className="v-toolbar__group">
        <Icon onClick={() => run('undo')} label={t('core.toolbar.undo') + k('CmdOrCtrl+Z')} icon={Undo2} disabled={!state.past.length || busy} />
        <Icon onClick={() => run('redo')} label={t('core.toolbar.redo')} icon={Redo2} disabled={!state.future.length || busy} />
      </div>

      <span className="v-toolbar__sep" aria-hidden="true" />

      <div className="v-toolbar__group">
        <Icon onClick={() => run('rotateLeft')} label={t('core.toolbar.rotateLeft') + k('CmdOrCtrl+L')} icon={RotateCcw} disabled={!pageOps} />
        <Icon onClick={() => run('rotateRight')} label={t('core.toolbar.rotateRight') + k('CmdOrCtrl+R')} icon={RotateCw} disabled={!pageOps} />
        <Icon onClick={() => run('delete')} label={t('core.toolbar.delete')} icon={Trash2} disabled={!pageOps} />
        <Ghost onClick={() => run('extract')} title={t('core.toolbar.extractTitle') + k('CmdOrCtrl+E')} icon={FileOutput} disabled={!state.selected.size || busy || !canPages} label={t('core.toolbar.extract')} />
        {state.mode === 'organize' && (
          <DropMenu
            run={run}
            label={t('core.toolbar.insert')}
            icon={FilePlus}
            title={t('core.toolbar.insertTitle')}
            disabled={!has || busy || !canPages}
            items={[
              { cmd: 'insertBlank', label: t('core.insert.blank'), hint: t('core.insert.blankHint'), icon: FileIcon },
              { cmd: 'insertImage', label: t('core.insert.image'), hint: t('core.insert.imageHint'), icon: ImagePlus },
            ]}
          />
        )}
      </div>

      <span className="v-toolbar__spacer" />

      {state.mode === 'read' && has && (
        <>
          <div className="v-toolbar__group">
            <Icon onClick={() => run('find')} label={t('core.toolbar.find') + k('CmdOrCtrl+F')} icon={Search} />
            <span className="v-toolbar__sep" aria-hidden="true" />
            <Icon onClick={() => run('zoomOut')} label={t('core.toolbar.zoomOut')} icon={ZoomOut} />
            <button type="button" onClick={() => run('zoomFit')} title={t('core.toolbar.zoomFit')} className="v-btn-ghost hd-zoom">
              {Math.round(state.zoom * 100)} %
            </button>
            <Icon onClick={() => run('zoomIn')} label={t('core.toolbar.zoomIn')} icon={ZoomIn} />
            <Icon onClick={() => run('zoomFit')} label={t('core.toolbar.zoomFit')} icon={MoveHorizontal} />
          </div>
          <span className="v-toolbar__sep" aria-hidden="true" />
        </>
      )}

      <div className="v-toolbar__group">
        <DropMenu
          run={run}
          label={t('core.toolbar.export')}
          icon={FileDown}
          title={canExport ? t('core.toolbar.exportTitle') : t('core.toolbar.exportLocked')}
          disabled={!has || busy || !canExport}
          align="right"
          wide
          items={[
            { cmd: 'exportWord', label: t('core.export.word'), ext: '.docx', hint: t('core.export.wordHint'), badge: WordBadge },
            { cmd: 'exportExcel', label: t('core.export.excel'), ext: '.xlsx', hint: t('core.export.excelHint'), badge: ExcelBadge },
          ]}
        />
        <Ghost onClick={() => run('share')} title={t('core.toolbar.shareTitle')} icon={Share2} disabled={!has || busy} label={t('core.toolbar.share')} />
      </div>
      <button type="button" onClick={() => run('save')} disabled={!has || busy} title={t('core.toolbar.save') + k('CmdOrCtrl+S')} className="v-btn-primary hd-save">
        {savingLabel ? <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden="true" /> : <Save size={16} strokeWidth={1.75} aria-hidden="true" />}
        <span aria-live="polite">{savingLabel ?? t('core.toolbar.save')}</span>
      </button>
    </header>
  );
}

/** Botón con icono y texto; en ventanas estrechas, solo el icono (el nombre queda en aria-label). */
function Ghost({ icon: I, label, ...props }) {
  return (
    <button type="button" aria-label={label} {...props} className="v-btn-ghost">
      <I size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="hd-label">{label}</span>
    </button>
  );
}

function Icon({ icon: I, label, ...props }) {
  return (
    <button type="button" title={label} aria-label={label} {...props} className="v-btn-icon">
      <I size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

function ViewTab({ active, icon: I, children, ...props }) {
  return (
    <button type="button" role="tab" aria-selected={active} {...props} className="v-segmented__item">
      <I size={15} strokeWidth={1.75} aria-hidden="true" />
      {children}
    </button>
  );
}

/**
 * Botón con menú («Insertar ▾», «Exportar ▾»). Teclado: flecha abajo lo abre; flechas, Inicio y Fin se mueven;
 * Intro elige; Esc o Tab cierran y devuelven el foco al botón.
 */
function DropMenu({ run, items, label, icon: I, title, disabled, align = 'left', wide = false }) {
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
    const els = [...menu.current.querySelectorAll('[role="menuitem"]')];
    const i = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); els.at(-1).focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
  };

  return (
    <div className="hd-drop">
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        className="v-btn-ghost"
      >
        <I size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="hd-label">{label}</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className={`hd-chevron ${open ? 'hd-chevron--open' : ''}`} />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} onKeyDown={onKey} className={`v-menu motion-pop hd-menu ${align === 'right' ? 'hd-menu--right' : ''} ${wide ? 'hd-menu--wide' : ''}`}>
          {items.map(({ cmd, label: text, hint, ext, icon: ItemIcon, badge: ItemBadge }) => (
            <button key={cmd} type="button" role="menuitem" tabIndex={-1} onClick={() => choose(cmd)} className="v-menu__item hd-menu-item">
              {ItemBadge ? <ItemBadge size={32} /> : <ItemIcon size={16} strokeWidth={1.75} aria-hidden="true" />}
              <span className="v-menu__label">
                <span className="hd-menu-title">{text}{ext && <span className="v-menu__hint"> {ext}</span>}</span>
                <span className="v-menu__desc">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
