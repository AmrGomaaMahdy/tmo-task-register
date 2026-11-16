import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { LanguageSwitch } from '../i18n/LanguageProvider';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Brand';
import { ErrorText } from '../components/ui';

export default function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ oidc_enabled: boolean }>('/api/auth/csrf/') });

  if (me) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      {/* Moving light behind the page: soft blobs, a faint grid and the road to 2027 */}
      <div className="login-bg" aria-hidden="true">
        <span className="blob b1" /><span className="blob b2" /><span className="blob b3" />
        <span className="grid-lines" />
      </div>
      <div className="login-lang"><LanguageSwitch /></div>
      <div className="login-wrap">
        <section className="login-hero">
          <div className="hero-brand">
            <Logo />
            <span className="eyebrow">Al-Ayuni Investment &amp; Contracting</span>
          </div>
          <h1 className="hero-title">TMO <span>Task Register</span></h1>
          <p className="hero-sub">One register for every work group: tasks, the links between groups, and the Master Plan on the road to 2027.</p>
          <ul className="hero-points">
            <li><b>01</b><span>Describe each task and who it involves</span></li>
            <li><b>02</b><span>Agree partners and contributions with other groups</span></li>
            <li><b>03</b><span>Plan, check and follow the Master Plan</span></li>
          </ul>
          <div className="hero-road" aria-hidden="true">
            <span className="road-t">Final Mile to 2027</span>
            <span className="road"><i /><b>2027</b></span>
          </div>
        </section>
        <form className="login-card" onSubmit={submit}>
          <div>
            <h2>Sign in</h2>
            <p>Sign in to maintain your work group's register and view the Master Plan.</p>
          </div>
          <ErrorText error={error} />
          {config.data?.oidc_enabled && (
            <>
              <a className="btn pri block" href="/oidc/authenticate/">Sign in with Microsoft</a>
              <div className="or">or use a local account</div>
            </>
          )}
          <div className="fld">
            <label htmlFor="username">User name</label>
            <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="fld">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn pri block login-go" disabled={busy}>
            {busy ? <span className="spin" aria-hidden="true" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {import.meta.env.DEV && (
            <p className="hint">Trial users: admin, tmo.officer, ict.team, hr.team, fin.team, committee.viewer (password in your .env).</p>
          )}
        </form>
      </div>
    </div>
  );
}
