import { useEffect, useRef, useState } from 'react';
import { BadgeAlert, BadgeCheck, BadgeInfo, BadgeQuestionMark, BadgeX, LoaderCircle, Lock, X } from 'lucide-react';
import { SIG_STATUS, worstStatus } from '../signed.js';
import { t, useT, getLocale } from '../i18n/index.js';

const ICON = { intact: BadgeCheck, modified: BadgeInfo, unknown: BadgeQuestionMark, broken: BadgeX, unavailable: BadgeQuestionMark, outdated: BadgeAlert };
const TONE = { neutral: 'text-muted', warn: 'text-ink', danger: 'text-danger' };

const fmtDate = (iso) => {
  if (!iso) return t('reader.sigStatus.noDate');
  try { return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; }
};

function StatusIcon({ status, size = 14 }) {
  if (status === 'pending') return <LoaderCircle size={size} strokeWidth={1.75} className="spin shrink-0 text-muted" aria-hidden="true" />;
  const Icon = ICON[status] ?? BadgeQuestionMark;
  const tone = SIG_STATUS[status]?.tone ?? 'neutral';
  return <Icon size={size} strokeWidth={1.75} className={`shrink-0 ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-ink' : 'text-accent'}`} aria-hidden="true" />;
}

/**
 * Aviso de la barra de estado para PDFs firmados digitalmente: el peor estado de sus firmas;
 * al hacer clic, panel con cada firma (firmante según el certificado, fecha y estado).
 *   groups: [{ name, sigs: [{ name, date, status, reason }] | 'pending' | 'unavailable' }]
 *   policy: editPolicy() (aviso de certificación)
 */
export default function SignatureStatus({ groups, policy }) {
  useT(); // repintar al cambiar el idioma
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);

  const all = groups.flatMap((g) => (Array.isArray(g.sigs) ? g.sigs : []));
  // Sin lista de firmas el grupo trae un estado: 'pending', 'unavailable' u 'outdated'.
  const special = groups.map((g) => g.sigs).filter((s) => typeof s === 'string');
  const status = special.includes('pending') ? 'pending'
    : special.includes('outdated') ? 'outdated'
      : all.length ? worstStatus(all)
        : special[0] ?? 'unknown';
  const text = SIG_STATUS[status].text;
  const tone = SIG_STATUS[status].tone;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); } };
    const onDown = (e) => { if (!ref.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    ref.current?.querySelector('[data-autofocus]')?.focus();
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [open]);

  return (
    <span className="relative ml-3 inline-flex min-w-0 items-center">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title={t('reader.sigStatus.view')}
        className={`inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-hover ${TONE[tone]}`}
      >
        <StatusIcon status={status} />
        <span className="truncate">{text}</span>
        {policy.level !== 'full' && <Lock size={12} strokeWidth={1.75} className="shrink-0 text-muted" aria-label={t('reader.sigStatus.certified')} />}
      </button>

      {open && (
        <div
          ref={ref}
          role="dialog"
          aria-label={t('reader.sigStatus.title')}
          className="motion-pop fixed bottom-10 left-3 z-50 w-[400px] max-w-[calc(100vw-24px)] rounded-xl border border-line bg-panel p-4 text-sm text-ink shadow-pop"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">{t('reader.sigStatus.title')}</h2>
            <button type="button" data-autofocus aria-label={t('reader.common.close')} onClick={() => { setOpen(false); btnRef.current?.focus(); }} className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink">
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>

          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {groups.map((g, gi) => (
              <section key={gi}>
                {groups.length > 1 && <h3 className="mb-1 truncate text-xs font-medium text-muted" title={g.name}>{g.name}</h3>}
                {!Array.isArray(g.sigs) ? (
                  <p className="flex items-center gap-2 text-muted"><StatusIcon status={g.sigs} />{SIG_STATUS[g.sigs].text}</p>
                ) : (
                  <ul className="space-y-1">
                    {g.sigs.map((s, i) => (
                      <li key={i} className="flex items-start gap-2.5 rounded-lg bg-hover/60 px-2.5 py-2">
                        <span className="mt-0.5"><StatusIcon status={s.status} size={16} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" title={s.name ?? ''}>{s.name ?? t('reader.sigStatus.unknownSigner')}</span>
                          <span className="block text-xs text-muted">{fmtDate(s.date)}</span>
                          <span className={`block text-xs ${s.status === 'broken' ? 'text-danger' : 'text-muted'}`}>{SIG_STATUS[s.status].text}</span>
                          {s.reason && s.status !== 'modified' && <span className="block text-xs text-muted">{s.reason}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {policy.level !== 'full' ? (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-accent-soft px-2.5 py-2 text-xs text-accent-ink">
              <Lock size={14} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
              {policy.notice} {t('reader.sigStatus.certifiedNote')}
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted">
              {t('reader.sigStatus.fullNote')}
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            {t('reader.sigStatus.trustNote')}
          </p>
        </div>
      )}
    </span>
  );
}
