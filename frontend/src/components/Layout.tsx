import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { LanguageSwitch } from '../i18n/LanguageProvider';
import { useRefs } from '../lib/useRefs';
import { currentTheme, saveTheme, THEMES, type Theme } from '../lib/theme';
import { FinalMile, Logo } from './Brand';
import NavIcon from './NavIcon';
import { Tip } from './ui';
import { useScope } from './WorkGroupScope';

export const NAV: { to: string; label: string; tip: string; manage?: boolean; admin?: boolean; plan?: boolean }[] = [
  { to: '/', label: 'Overview', tip: 'Where the registers stand: readiness, links with other groups, coverage of directions and what is coming up.' },
  { to: '/register', label: 'Task Register', tip: 'The tasks each work group owns, with filters and the automatic check.' },
  { to: '/activities', label: 'Activities', tip: 'Sheet 4: the activities of every task, with owners, dates, predecessors, timeline and check.' },
  { to: '/links', label: 'Links with other groups', tip: "Partners: what each task needs from its partner groups. Contributions: what Enable and Support tasks deliver to other groups. Both fill themselves from the register; when both groups record each other's task number, the link is agreed." },
  { to: '/check', label: 'Check', tip: 'Every problem the automatic check finds, before the register goes to the TMO.' },
  { to: '/master-plan', label: 'Master Plan', tip: 'The consolidated plan of all work groups, with the TMO inbox and Gantt view.', plan: true },
  { to: '/configuration', label: 'Configuration', tip: 'Work groups, directions, group members and every dropdown list.', manage: true },
  { to: '/backup', label: 'Backup & restore', tip: 'Download a full backup or an Excel copy of all data, restore from a backup, or go back to a restore point.', admin: true },
];

function readMenuState(): boolean {
  try {
    return localStorage.getItem('task-register.menu') === 'hidden';
  } catch {
    return false;
  }
}

export default function Layout() {
  const { me, logout } = useAuth();
  const { wg, setWg } = useScope();
  const refs = useRefs();
  const navigate = useNavigate();
  const location = useLocation();
  const [hidden, setHidden] = useState(readMenuState);
  // Teams choose only among their own work groups; a stored choice of another group is dropped.
  const viewAll = !!me?.permissions.view_all;
  const scopeGroups = viewAll ? refs.groups : refs.groups.filter((g) => me?.work_groups.some((m) => m.id === g.id));
  useEffect(() => {
    if (!viewAll && wg !== null && refs.ready && !scopeGroups.some((g) => g.id === wg)) setWg(null);
  }, [viewAll, wg, refs.ready, scopeGroups, setWg]);
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  const toggleMenu = () => {
    setHidden((h) => {
      try {
        localStorage.setItem('task-register.menu', h ? 'shown' : 'hidden');
      } catch {
        /* ignore */
      }
      return !h;
    });
  };
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const pickTheme = (t: Theme) => {
    saveTheme(t);
    setTheme(t);
  };

  return (
    <div className={`app ${hidden ? 'menu-off' : ''}`}>
      <aside className="rail">
        <div className="brand">
          <div className="brand-top">
            <Logo />
            <span className="name">
              <span className="full">Task Register</span>
              <span className="ver">v1.9</span>
            </span>
          </div>
          <FinalMile />
        </div>
        <div className="wgsel">
          <label htmlFor="wgSel">
            Work group <Tip text="Show one work group's register, or all work groups for the program view." />
          </label>
          <select id="wgSel" value={wg ?? ''} onChange={(e) => setWg(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{viewAll ? 'All work groups' : scopeGroups.length > 1 ? 'All my work groups' : 'My work group'}</option>
            {scopeGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} – {g.name}{g.task_count !== null ? ` (${g.task_count})` : ''}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="wgmini" onClick={toggleMenu} data-tip="Selected work group. Click to show the menu.">
          {refs.group(wg)?.code ?? 'ALL'}
        </button>
        <nav className="nav" aria-label="Main">
          {NAV.filter((n) => (!n.manage || me?.permissions.manage_master_data) && (!n.admin || me?.permissions.admin) && (!n.plan || me?.permissions.master_plan)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} data-tip={`${n.label}: ${n.tip}`} aria-label={n.label}>
              <span className="k ico"><NavIcon to={n.to} /></span>
              <span className="lbl">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="foot">
          <div className="who">
            <strong>{me?.full_name}</strong>
            <span>
              {me?.roles.join(', ')}
            </span>
          </div>
          <div className="themes">
            <span className="tl">Theme</span>
            <div className="sw" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.id} type="button" className={theme === t.id ? 'on' : ''} aria-pressed={theme === t.id} aria-label={t.label}
                  data-tip={t.tip} style={{ ['--t' as string]: t.swatch, ['--tk' as string]: t.tick }} onClick={() => pickTheme(t.id)} />
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="top">
          <div className="ttl">
            <button
              type="button"
              className="btn menu-t"
              onClick={toggleMenu}
              aria-label={hidden ? 'Show menu' : 'Hide menu'}
              aria-expanded={!hidden}
              data-tip={hidden ? 'Show the side menu' : 'Hide the side menu to give the page more room'}
            >
              ☰
            </button>
            <h1>{current?.label ?? 'Task'}</h1>
          </div>
          <div className="top-actions">
            <LanguageSwitch />
            {me?.permissions.create_tasks && (
              <button type="button" className="btn pri" onClick={() => navigate('/tasks/new')}>
                + New task
              </button>
            )}
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
