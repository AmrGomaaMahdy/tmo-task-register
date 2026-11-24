import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** What a confirmation asks. `tone: 'danger'` (the default) colours the confirm button red. */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /** Ask for a reason too (a text box); with `required`, the confirm button waits for it. */
  reason?: { label: string; required?: boolean; placeholder?: string };
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;
type AskReason = (o: ConfirmOptions & { reason: NonNullable<ConfirmOptions['reason']> }) => Promise<string | null>;
const ConfirmContext = createContext<{ confirm: Ask; withReason: AskReason } | null>(null);

/**
 * One confirmation dialog for the whole app: `if (!(await confirm({...}))) return;`.
 * It opens above any other dialog, focuses Cancel (the safe choice), and Escape cancels only this one.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (v: string | null) => void }) | null>(null);
  const withReason = useCallback<AskReason>((o) => new Promise((resolve) => setAsk({ ...o, resolve })), []);
  const confirm = useCallback<Ask>(
    (o) => new Promise((resolve) => setAsk({ ...o, resolve: (v) => resolve(v !== null) })),
    [],
  );
  const done = useCallback((v: string | null) => {
    setAsk((a) => {
      a?.resolve(v);
      return null;
    });
  }, []);
  const value = useMemo(() => ({ confirm, withReason }), [confirm, withReason]);
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {ask && <ConfirmDialog ask={ask} onDone={done} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ ask, onDone }: { ask: ConfirmOptions; onDone: (v: string | null) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  const missing = !!ask.reason?.required && text.trim().length < 3;
  const before = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    cancel.current?.focus();
    // Capture phase on window: runs before the dialog underneath hears Escape, and stops it there.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onDone(null);
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
    <div className="modal confirm-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
      <div className={`mbox confirm-box ${danger ? 'is-danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-msg">
        <div className="confirm-hd">
          <span className="confirm-ico" aria-hidden="true">{danger ? '!' : '?'}</span>
          <h2 id="cf-title">{ask.title}</h2>
        </div>
        {ask.message && <div id="cf-msg" className="confirm-msg">{ask.message}</div>}
        {ask.reason && (
          <label className="confirm-reason">
            <span>{ask.reason.label}{ask.reason.required ? '' : ' (optional)'}</span>
            <textarea rows={3} maxLength={500} value={text} placeholder={ask.reason.placeholder} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        <div className="confirm-ft">
          <button ref={cancel} type="button" className="btn" onClick={() => onDone(null)}>{ask.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className={`btn ${danger ? 'danger' : 'pri'}`} disabled={missing} onClick={() => onDone(text.trim())}>{ask.confirmLabel ?? 'Confirm'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  // Outside the provider (tests, isolated renders) fall back to the browser's own dialog.
  return ask?.confirm ?? (async (o) => window.confirm(o.title));
}

/** Like useConfirm, with a text box for the reason: resolves to the reason ('' when optional and empty), or null. */
export function useConfirmWithReason(): AskReason {
  const ask = useContext(ConfirmContext);
  return ask?.withReason ?? (async (o) => (window.confirm(o.title) ? '' : null));
}
