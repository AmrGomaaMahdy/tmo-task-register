import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Full screen for one block of a page: the block is drawn over the whole window (at the end of <body>,
 * above the page header), and the browser itself goes full screen where it allows it. Esc or the button
 * goes back; the page behind does not scroll meanwhile.
 */
export function useFullScreen() {
  const [full, setFull] = useState(false);
  const exit = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);
  const enter = useCallback(() => {
    setFull(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exit(); };
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onChange);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onChange);
      document.body.classList.remove('no-scroll');
    };
  }, [full, exit]);
  return { full, enter, exit, toggle: full ? exit : enter };
}

export function FullScreenButton({ full, onClick }: { full: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn sm fs-btn" onClick={onClick} aria-label={full ? 'Exit full screen' : 'Full screen'}
      data-tip={full ? 'Exit full screen (Esc)' : 'Show this block full screen'}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {full
          ? <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          : <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" fill="none" stroke="currentColor" strokeWidth="1.6" />}
      </svg>
      <span>{full ? 'Exit full screen' : 'Full screen'}</span>
    </button>
  );
}

/** Shows `children` in place, or over the whole window with a title bar while `full`. */
export function FullScreenFrame({ full, title, actions, onExit, children }: {
  full: boolean;
  title: ReactNode;
  actions?: ReactNode;
  onExit: () => void;
  children: ReactNode;
}) {
  const exitBtn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (full) exitBtn.current?.querySelector('button')?.focus();
  }, [full]);
  if (!full) return <>{children}</>;
  return (
    <>
      <div className="fs-placeholder" />
      {createPortal(
        <div className="fs-overlay" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Full screen'}>
          <div className="fs-bar">
            <strong className="fs-title">{title}</strong>
            <span className="spacer" />
            {actions}
            <div ref={exitBtn}><FullScreenButton full onClick={onExit} /></div>
          </div>
          <div className="fs-body">{children}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
