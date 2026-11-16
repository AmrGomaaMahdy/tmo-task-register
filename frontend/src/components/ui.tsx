import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { CheckSummary, Status } from '../api/types';
import { Num, type DrillSpec } from './Drill';
import { REQUIREMENT_HINT, REQUIREMENT_LABEL, STATUS_HINT, STATUS_LABEL, type Requirement } from '../lib/fields';

/** A small (i) icon; the shared TooltipLayer shows its text on hover, focus or tap. */
export function Tip({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span className="tip" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      i
    </span>
  );
}

export function TooltipLayer() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
      const b = box.current;
      if (!b) return;
      current = el;
      b.textContent = el.dataset.tip ?? '';
      b.classList.add('on');
      const r = el.getBoundingClientRect();
      let x = r.left + r.width / 2 - b.offsetWidth / 2;
      let y = r.bottom + 8;
      x = Math.max(8, Math.min(window.innerWidth - b.offsetWidth - 8, x));
      if (y + b.offsetHeight > window.innerHeight - 8) y = r.top - b.offsetHeight - 8;
      b.style.left = `${x}px`;
      b.style.top = `${y}px`;
    };
    const hide = () => {
      current = null;
      box.current?.classList.remove('on');
    };
    const over = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (el && el !== current) show(el);
      else if (!el && current) hide();
    };
    const focus = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (el) show(el);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  return <div ref={box} id="tipbox" role="tooltip" />;
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`pill st-${status}`} data-tip={STATUS_HINT[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CheckBadge({ summary }: { summary: CheckSummary | null | undefined }) {
  if (!summary) return null;
  if (summary.ok && !summary.errors) return <span className="chk ok">✓ OK</span>;
  if (summary.errors) return <span className="chk bad">{summary.errors} not OK</span>;
  return <span className="chk warn">{summary.warnings} to complete</span>;
}

export function ReqBadge({ req }: { req: Requirement }) {
  return (
    <span className={`rq rq-${req}`} data-tip={REQUIREMENT_HINT[req]}>
      {REQUIREMENT_LABEL[req]}
    </span>
  );
}

export function Panel({ title, tip, actions, children, className = '' }: {
  title?: ReactNode;
  tip?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-hd">
          {title && (
            <h2>
              {title} <Tip text={tip} />
            </h2>
          )}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className="panel-bd">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tip, small, drill }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tip?: string;
  small?: string;
  /** The tasks or activities behind the number: clicking it opens them. */
  drill?: DrillSpec | null;
}) {
  return (
    <div className="kpi">
      <span className="kpi-l">
        {label} <Tip text={tip} />
      </span>
      <span className="kpi-v">
        <Num value={value} drill={drill && { ...drill, title: drill.title || label, sub: drill.sub ?? tip } as DrillSpec} />
        {small && <small>{small}</small>}
      </span>
      {sub && <span className="kpi-s">{sub}</span>}
    </div>
  );
}

export function Pager({ count, page, size, onPage, onSize }: {
  count: number;
  page: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (s: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / size));
  if (count <= 10 && size === 10) return null;
  const lo = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => lo + i).filter((n) => n <= pages);
  const first = (page - 1) * size + 1;
  return (
    <div className="pager">
      <label>
        Rows per page
        <select value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Rows per page">
          {[10, 20, 50].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <span className="mono">
        {first}–{Math.min(count, page * size)} of {count}
      </span>
      <span className="pbtns">
        <button type="button" disabled={page === 1} onClick={() => onPage(1)} aria-label="First page">«</button>
        <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
        {nums.map((n) => (
          <button type="button" key={n} className={n === page ? 'on' : ''} onClick={() => onPage(n)} aria-current={n === page}>
            {n}
          </button>
        ))}
        <button type="button" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
        <button type="button" disabled={page === pages} onClick={() => onPage(pages)} aria-label="Last page">»</button>
      </span>
    </div>
  );
}

export function usePaging(initial = 10) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initial);
  return {
    page,
    size,
    setPage,
    setSize: (s: number) => {
      setSize(s);
      setPage(1);
    },
    reset: () => setPage(1),
  };
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`mbox ${wide ? 'wide' : ''}`}>
        <div className="mh">
          <h2>{title}</h2>
          <button type="button" className="btn ghost sm" onClick={onClose}>Close ✕</button>
        </div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

/** A delete button that asks for a second click instead of a browser dialog. */
export function ConfirmButton({ onConfirm, label = 'Remove', disabled, title }: {
  onConfirm: () => void;
  label?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <span data-tip={disabled ? title : undefined}>
      <button
        type="button"
        className={`btn sm ${armed ? 'danger' : 'ghost'}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (armed) onConfirm();
          else setArmed(true);
        }}
      >
        {armed ? 'Confirm' : label}
      </button>
    </span>
  );
}

export const Loading = () => <div className="empty">Loading…</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error-box" role="alert">{error instanceof Error ? error.message : 'Something went wrong.'}</div>;
}

export function Field({ label, req, hint, children, wide, htmlFor }: {
  label: string;
  req?: Requirement;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
  htmlFor?: string;
}) {
  return (
    <div className={`fld ${wide ? 'w2' : ''}`}>
      <label htmlFor={htmlFor}>
        {label} {req && <ReqBadge req={req} />} <Tip text={hint} />
      </label>
      {children}
    </div>
  );
}
