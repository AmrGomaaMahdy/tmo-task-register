import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** What a confirmation asks. `tone: 'danger'` (the default) colours the confirm button red. */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

/**
 * One confirmation dialog for the whole app: `if (!(await confirm({...}))) return;`.
 * It opens above any other dialog, focuses Cancel (the safe choice), and Escape cancels only this one.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<Ask>((o) => new Promise((resolve) => setAsk({ ...o, resolve })), []);
  const done = useCallback((v: boolean) => {
    setAsk((a) => {
      a?.resolve(v);
      return null;
    });
  }, []);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && <ConfirmDialog ask={ask} onDone={done} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ ask, onDone }: { ask: ConfirmOptions; onDone: (v: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    cancel.current?.focus();
    // Capture phase on window: runs before the dialog underneath hears Escape, and stops it there.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onDone(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    const back = before.current;
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (back instanceof HTMLElement) back.focus();
    };
  }, [onDone]);
  const danger = (ask.tone ?? 'danger') === 'danger';
  return createPortal(
    <div className="modal confirm-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(false); }}>
      <div className={`mbox confirm-box ${danger ? 'is-danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-msg">
        <div className="confirm-hd">
          <span className="confirm-ico" aria-hidden="true">{danger ? '!' : '?'}</span>
          <h2 id="cf-title">{ask.title}</h2>
        </div>
        {ask.message && <div id="cf-msg" className="confirm-msg">{ask.message}</div>}
        <div className="confirm-ft">
          <button ref={cancel} type="button" className="btn" onClick={() => onDone(false)}>{ask.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className={`btn ${danger ? 'danger' : 'pri'}`} onClick={() => onDone(true)}>{ask.confirmLabel ?? 'Confirm'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  // Outside the provider (tests, isolated renders) fall back to the browser's own dialog.
  return ask ?? (async (o) => window.confirm(o.title));
}
