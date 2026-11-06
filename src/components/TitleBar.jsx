import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import AppIcon from './AppIcon.jsx';
import { formatAccel } from '../menu.js';

/**
 * Barra de título de Windows y Linux: icono, menús (Archivo, Editar, Ver) y nombre del documento.
 * Los botones de minimizar, maximizar y cerrar los pinta el sistema a la derecha (Window Controls Overlay).
 * Teclado como en Windows: Alt o F10 activan la barra, Alt+letra abre un menú,
 * flechas para moverse, Intro para elegir, Esc para salir.
 */
export default function TitleBar({ model, title, dirty, isEnabled, onCommand }) {
  const [open, setOpen] = useState(null);      // índice del menú abierto
  const [active, setActive] = useState(-1);    // elemento resaltado dentro del menú
  const barRef = useRef(null);
  const topRefs = useRef([]);
  const altAlone = useRef(false);
  const restoreFocus = useRef(null);
  const [kbd, setKbd] = useState(false);   // activada con teclado: se ven el foco y las letras subrayadas
  const [sub, setSub] = useState(null);       // elemento con submenú abierto (p. ej. «Abrir reciente»)
  const [subActive, setSubActive] = useState(-1);

  // Un elemento con submenú siempre se puede abrir (aunque solo muestre «Sin archivos recientes»).
  const itemEnabled = (it) => (it.items ? it.items.length > 0 : isEnabled(it));
  const enabledIn = (items) => items.map((it, i) => (!it.sep && itemEnabled(it) ? i : -1)).filter((i) => i >= 0);
  const enabledItems = (m) => enabledIn(model[m].items);
  const subItems = () => (open !== null && sub !== null ? model[open].items[sub]?.items ?? [] : []);

  const openSub = (i, first = false) => {
    setSub(i);
    setSubActive(first ? (enabledIn(model[open].items[i].items)[0] ?? -1) : -1);
  };
  const closeSub = () => { setSub(null); setSubActive(-1); };

  const openMenu = (m, first = false) => {
    setOpen(m);
    closeSub();
    setActive(first ? (enabledItems(m)[0] ?? -1) : -1);
    topRefs.current[m]?.focus();
  };

  const close = (refocus = true) => {
    setOpen(null);
    setActive(-1);
    closeSub();
    setKbd(false);
    if (refocus) {
      const el = restoreFocus.current;
      restoreFocus.current = null;
      if (el && el !== document.body && document.contains(el)) el.focus(); else topRefs.current.forEach((b) => b?.blur());
    }
  };

  const choose = (it, i) => {
    if (it.sep || !itemEnabled(it)) return;
    if (it.items) { openSub(i, true); return; } // un submenú se abre, no se ejecuta
    close();
    onCommand(it);
  };

  // Cerrar al hacer clic fuera o al perder la ventana el foco.
  useEffect(() => {
    if (open === null) return undefined;
    const onDown = (e) => { if (!barRef.current?.contains(e.target)) close(false); };
    const onBlur = () => close(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('blur', onBlur); };
  }, [open]);

  // Alt sola o F10: activar la barra. Alt+letra: abrir ese menú.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Alt') { altAlone.current = !e.repeat; return; }
      altAlone.current = false;
      if (e.key === 'F10' && !e.shiftKey) {
        e.preventDefault();
        restoreFocus.current ??= document.activeElement;
        setKbd(true);
        topRefs.current[0]?.focus();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
        const m = model.findIndex((menu) => menu.label[0].toLowerCase() === e.key.toLowerCase());
        if (m >= 0) { e.preventDefault(); restoreFocus.current ??= document.activeElement; setKbd(true); openMenu(m, true); }
      }
    };
    const onKeyUp = (e) => {
      if (e.key !== 'Alt' || !altAlone.current) return;
      altAlone.current = false;
      e.preventDefault();
      if (barRef.current?.contains(document.activeElement)) { close(); return; }
      restoreFocus.current = document.activeElement;
      setKbd(true);
      topRefs.current[0]?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [model]);

  const onSubKey = (e) => {
    const list = subItems();
    const items = enabledIn(list);
    const pos = items.indexOf(subActive);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (items.length) setSubActive(items[(pos + 1) % items.length]); return true;
      case 'ArrowUp': e.preventDefault(); if (items.length) setSubActive(items[(pos - 1 + items.length) % items.length]); return true;
      case 'ArrowLeft':
      case 'Escape': e.preventDefault(); e.stopPropagation(); closeSub(); return true;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (subActive >= 0) choose(list[subActive], subActive);
        return true;
      case 'ArrowRight': e.preventDefault(); return true;
      default: return false;
    }
  };

  const onBarKey = (e, m) => {
    if (sub !== null && onSubKey(e)) return;
    const n = model.length;
    const items = open === null ? [] : enabledItems(open);
    const pos = items.indexOf(active);
    const activeItem = open !== null && active >= 0 ? model[open].items[active] : null;
    if (activeItem?.items && e.key === 'ArrowRight') { e.preventDefault(); openSub(active, true); return; }
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); open === null ? topRefs.current[(m + 1) % n]?.focus() : openMenu((open + 1) % n, true); break;
      case 'ArrowLeft': e.preventDefault(); open === null ? topRefs.current[(m - 1 + n) % n]?.focus() : openMenu((open - 1 + n) % n, true); break;
      case 'ArrowDown':
        e.preventDefault();
        if (open === null) openMenu(m, true);
        else if (items.length) setActive(items[(pos + 1) % items.length]);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (open === null) { openMenu(m); setActive(enabledItems(m).at(-1) ?? -1); }
        else if (items.length) setActive(items[(pos - 1 + items.length) % items.length]);
        break;
      case 'Home': if (open !== null && items.length) { e.preventDefault(); setActive(items[0]); } break;
      case 'End': if (open !== null && items.length) { e.preventDefault(); setActive(items.at(-1)); } break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open !== null && active >= 0) choose(model[open].items[active], active);
        else openMenu(m, true);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (open !== null) { setOpen(null); setActive(-1); } else close();
        break;
      case 'Tab': close(false); break;
      default: {
        // Letra: saltar al siguiente elemento que empieza por ella.
        if (open === null || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) break;
        const k = e.key.toLowerCase();
        const order = [...items.slice(pos + 1), ...items.slice(0, pos + 1)];
        const hit = order.find((i) => model[open].items[i].label.toLowerCase().startsWith(k));
        if (hit !== undefined) { e.preventDefault(); setActive(hit); }
      }
    }
  };

  return (
    <div
      ref={barRef}
      className={`titlebar flex h-10 shrink-0 items-center bg-panel pl-2 ${kbd ? 'show-mnemonics' : ''}`}
      onDoubleClick={(e) => e.target === e.currentTarget && e.preventDefault()}
    >
      <AppIcon size={28} />

      <div role="menubar" aria-label="Menú principal" className="no-drag ml-2 flex items-center gap-0.5">
        {model.map((menu, m) => {
          const isOpen = open === m;
          return (
            <div key={menu.label} className="relative">
              <button
                ref={(el) => { topRefs.current[m] = el; }}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                tabIndex={m === 0 ? 0 : -1}
                className={`h-7 rounded-md px-2.5 text-[13px] outline-none transition-colors ${kbd && !isOpen ? 'focus:outline-2 focus:outline-accent' : ''} ${isOpen ? 'bg-hover text-ink' : 'text-ink/85 hover:bg-hover hover:text-ink'}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  if (isOpen) { close(); return; }
                  restoreFocus.current ??= document.activeElement;
                  setKbd(false);
                  openMenu(m);
                }}
                onPointerEnter={() => { if (open !== null && open !== m) openMenu(m); }}
                onKeyDown={(e) => { setKbd(true); onBarKey(e, m); }}
                onBlur={(e) => { if (!barRef.current?.contains(e.relatedTarget)) setKbd(false); }}
              >
                <span><span className="menu-mnemonic">{menu.label[0]}</span>{menu.label.slice(1)}</span>
              </button>

              {isOpen && (
                <div
                  role="menu"
                  aria-label={menu.label}
                  className="motion-pop absolute left-0 top-[calc(100%+4px)] z-50 min-w-60 rounded-xl border border-line bg-panel p-1 shadow-pop"
                >
                  {menu.items.map((it, i) => (it.sep ? (
                    <div key={`sep-${i}`} role="separator" className="mx-2 my-1 h-px bg-line" />
                  ) : (
                    <div key={it.label} className="relative">
                      <MenuItem
                        item={it}
                        enabled={itemEnabled(it)}
                        highlighted={active === i}
                        expanded={it.items ? sub === i : undefined}
                        onHover={() => {
                          setActive(itemEnabled(it) ? i : -1);
                          if (it.items && itemEnabled(it)) openSub(i); else closeSub();
                        }}
                        onChoose={() => choose(it, i)}
                      />
                      {it.items && sub === i && (
                        <div
                          role="menu"
                          aria-label={it.label}
                          className="motion-pop absolute left-full top-0 z-50 ml-1 min-w-64 max-w-[420px] rounded-xl border border-line bg-panel p-1 shadow-pop"
                        >
                          {it.items.map((s, j) => (s.sep ? (
                            <div key={`sep-${j}`} role="separator" className="mx-2 my-1 h-px bg-line" />
                          ) : (
                            <MenuItem
                              key={`${s.label}-${j}`}
                              item={s}
                              enabled={isEnabled(s)}
                              highlighted={subActive === j}
                              onHover={() => setSubActive(isEnabled(s) ? j : -1)}
                              onChoose={() => choose(s, j)}
                            />
                          )))}
                        </div>
                      )}
                    </div>
                  )))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="titlebar-title flex min-w-0 flex-1 items-center justify-center gap-2 px-4 text-xs text-muted">
        <span className="truncate">{title ?? 'SpiderPDF'}</span>
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Cambios sin guardar" />}
      </div>
    </div>
  );
}

function MenuItem({ item, enabled, highlighted, expanded, onHover, onChoose }) {
  const shortcut = item.accel ? formatAccel(item.accel) : item.hint;
  return (
    <div
      role="menuitem"
      aria-disabled={!enabled || undefined}
      aria-haspopup={item.items ? 'menu' : undefined}
      aria-expanded={expanded}
      title={item.title}
      className={`flex h-8 cursor-default items-center gap-6 rounded-lg px-2.5 text-sm ${enabled ? 'text-ink' : 'text-muted opacity-50'} ${highlighted ? 'bg-hover' : ''}`}
      onPointerEnter={onHover}
      onPointerUp={(e) => { if (e.button === 0) onChoose(); }}
    >
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{item.label}</span>
      {shortcut && <span className="tabnum text-xs text-muted">{shortcut}</span>}
      {item.items && <ChevronRight size={14} strokeWidth={1.75} className="-mr-1 text-muted" aria-hidden="true" />}
    </div>
  );
}
