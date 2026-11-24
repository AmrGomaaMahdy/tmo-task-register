import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { currentTheme, saveTheme, THEMES, type Theme } from '../lib/theme';
import PasswordDialog from './PasswordDialog';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/**
 * The signed-in person in the page header: their initials and name; the menu holds who they are and their
 * roles, the theme, Change password and Sign out.
 */
export default function UserMenu() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); wrap.current?.querySelector<HTMLButtonElement>('.um-btn')?.focus(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  if (!me) return null;
  const name = me.full_name || me.username;
  const pick = (t: Theme) => { saveTheme(t); setTheme(t); };
  return (
    <div className="um" ref={wrap}>
      <button type="button" className={`um-btn${open ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Account: ${name}`}>
        <span className="um-av" aria-hidden="true">{initials(name)}</span>
        <span className="um-name" data-notr>{name.split(' ')[0]}</span>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="um-panel" role="menu">
          <div className="um-who">
            <span className="um-av big" aria-hidden="true">{initials(name)}</span>
            <div>
              <strong data-notr>{name}</strong>
              <span className="t2" dir="ltr" data-notr>{me.email || me.username}</span>
            </div>
          </div>
          <div className="um-roles">
            {/* One element per role, so each is translated on its own. */}
            {me.roles.map((r) => <span key={r} className="rchip">{r}</span>)}
          </div>
          <div className="um-sec">
            <span className="um-h">Theme</span>
            <div className="um-themes" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.id} type="button" role="menuitemradio" aria-checked={theme === t.id} className={theme === t.id ? 'on' : ''}
                  onClick={() => pick(t.id)} style={{ ['--t' as string]: t.swatch, ['--tk' as string]: t.tick }}>
                  <i aria-hidden="true" /><span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="um-acts">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setPw(true); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16 7l2 2M14 9l2 2" /></svg>
              Change password
            </button>
            <button type="button" role="menuitem" className="um-out" onClick={async () => { setOpen(false); await logout(); navigate('/login'); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M14 4H6.5A1.5 1.5 0 005 5.5v13A1.5 1.5 0 006.5 20H14" /><path d="M10 12h10m-3-3l3 3-3 3" /></svg>
              Sign out
            </button>
          </div>
        </div>
      )}
      {pw && <PasswordDialog onClose={() => setPw(false)} />}
    </div>
  );
}
