import { useId, useRef, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { PasswordInput, useModal } from './PasswordDialog.jsx';
import { checkNewPassword, permsFor } from '../security.js';

/**
 * «Proteger con contraseña»: contraseña para abrir y, si se restringe algo, otra de permisos (quien la tenga puede
 * hacerlo todo). Cifrado AES-256. onProtect({ user, owner, perms, separateOwner }): las contraseñas van directas
 * al worker (pdf.setProtection); este diálogo no las guarda en ningún otro sitio.
 */
export default function ProtectDialog({ initial, onCancel, onProtect }) {
  const ref = useRef(null);
  const ids = { user: useId(), user2: useId(), owner: useId(), owner2: useId(), err: useId() };
  const [user, setUser] = useState('');
  const [user2, setUser2] = useState('');
  const [owner, setOwner] = useState('');
  const [owner2, setOwner2] = useState('');
  const [allow, setAllow] = useState(() => ({ print: true, copy: true, edit: true, ...initial }));
  const [tried, setTried] = useState(false);
  useModal(ref, onCancel);

  const restricted = !allow.print || !allow.copy || !allow.edit;
  const userErr = checkNewPassword(user, user2);
  let ownerErr = restricted ? checkNewPassword(owner, owner2) : null;
  if (!ownerErr && restricted && owner === user) ownerErr = 'La contraseña de permisos tiene que ser distinta de la de abrir.';
  const error = userErr ?? ownerErr;

  function submit(e) {
    e.preventDefault();
    setTried(true);
    if (error) return;
    onProtect({ user, owner: restricted ? owner : '', perms: permsFor(allow), separateOwner: restricted });
  }

  const check = (key, label, hint) => (
    <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${allow[key] ? 'border-line hover:bg-hover' : 'border-accent bg-accent-soft'}`}>
      <input type="checkbox" checked={allow[key]} onChange={() => setAllow((a) => ({ ...a, [key]: !a[key] }))} className="mt-1 accent-[var(--accent)]" />
      <span>
        <span className={`block font-medium ${allow[key] ? '' : 'text-accent-ink'}`}>{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proteger-titulo"
        onSubmit={submit}
        noValidate
        className="motion-pop relative flex max-h-full w-[480px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden="true"><LockKeyhole size={16} strokeWidth={1.75} /></span>
          <h2 id="proteger-titulo" className="text-base font-semibold tracking-tight">Proteger con contraseña</h2>
        </div>
        <div className="space-y-5 overflow-y-auto px-5 py-5 text-sm">
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-muted">Contraseña para abrir</legend>
            <label htmlFor={ids.user} className="sr-only">Contraseña para abrir</label>
            <PasswordInput id={ids.user} value={user} onChange={setUser} autoFocus label="la contraseña para abrir" invalid={tried && !!userErr} autoComplete="new-password" />
            <label htmlFor={ids.user2} className="block text-xs text-muted">Repítela</label>
            <PasswordInput id={ids.user2} value={user2} onChange={setUser2} label="la contraseña repetida" invalid={tried && !!userErr} autoComplete="new-password" />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-muted">Quien la use puede</legend>
            {check('print', 'Imprimir', 'Sin esta casilla, el PDF no se puede imprimir.')}
            {check('copy', 'Copiar texto e imágenes', 'Sin ella, no se puede seleccionar y copiar.')}
            {check('edit', 'Editar', 'Páginas, texto, notas, firmas y formularios.')}
          </fieldset>
          {restricted && (
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-xs font-medium text-muted">Contraseña de permisos</legend>
              <p className="text-xs text-muted">Quien la tenga podrá hacerlo todo y cambiar o quitar la protección.</p>
              <label htmlFor={ids.owner} className="sr-only">Contraseña de permisos</label>
              <PasswordInput id={ids.owner} value={owner} onChange={setOwner} label="la contraseña de permisos" invalid={tried && !!ownerErr} autoComplete="new-password" />
              <label htmlFor={ids.owner2} className="block text-xs text-muted">Repítela</label>
              <PasswordInput id={ids.owner2} value={owner2} onChange={setOwner2} label="la contraseña de permisos repetida" invalid={tried && !!ownerErr} autoComplete="new-password" />
            </fieldset>
          )}
          <p id={ids.err} role={tried && error ? 'alert' : undefined} className={`text-xs ${tried && error ? 'text-danger' : 'text-muted'}`}>
            {tried && error ? error : 'Cifrado AES-256. Si olvidas la contraseña, nadie podrá abrir el PDF: ni tú ni SpiderPDF.'}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">Cancelar</button>
          <button type="submit" className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-[background-color,scale] hover:bg-accent/90 active:scale-[0.98]">
            Proteger
          </button>
        </div>
      </form>
    </div>
  );
}
