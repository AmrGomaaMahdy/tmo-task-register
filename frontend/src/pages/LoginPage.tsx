import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { api, ApiError, SERVER_WAKING } from '../api/client';
import { LanguageSwitch } from '../i18n/LanguageProvider';
import { useAuth, type MfaChallenge } from '../auth/AuthContext';
import { Logo } from '../components/Brand';
import { ErrorText } from '../components/ui';

export default function LoginPage() {
  const { me, login, verifyCode, resendCode, sessionEnded } = useAuth();
  // The second step, when the email code is on (Configuration → Security).
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // On Render's free plan the server sleeps when idle; the first sign-in waits while it starts.
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setWaking(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(SERVER_WAKING, on);
    return () => window.removeEventListener(SERVER_WAKING, on);
  }, []);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsCheck = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ oidc_enabled: boolean; mfa_email?: boolean }>('/api/auth/csrf/') });

  if (me) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const step = await login(username.trim(), password);
      if (step) {
        setPassword('');
        setChallenge(step);
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
      setPassword(''); // never keep a rejected password in the form
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
      <Orbit />
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
        {challenge ? (
          <CodeStep challenge={challenge} verify={verifyCode} resend={resendCode}
            onDone={() => navigate('/', { replace: true })} onBack={() => { setChallenge(null); setError(null); }} />
        ) : (
        <form className="login-card" onSubmit={submit}>
          <span className="card-glow" aria-hidden="true"><i /></span>
          <div>
            <h2>Sign in</h2>
            <p>Sign in to maintain your work group's register and view the Master Plan.</p>
          </div>
          {sessionEnded && !error && <div className="notice-box" role="status">Your session ended after a period without activity. Sign in again to continue.</div>}
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
            <div className="pw-wrap">
              <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} onKeyUp={capsCheck} onKeyDown={capsCheck} onBlur={() => setCaps(false)} required />
              <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)} aria-pressed={show}
                aria-label={show ? 'Hide password' : 'Show password'} data-tip={show ? 'Hide password' : 'Show password'}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.7" />
                  <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
                  {show && <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.7" />}
                </svg>
              </button>
            </div>
            {caps && <span className="caps-hint" role="status">Caps Lock is on.</span>}
          </div>
          <button type="submit" className="btn pri block login-go" disabled={busy}>
            {busy ? <span className="spin" aria-hidden="true" /> : null}
            {busy ? (waking ? 'Starting the server…' : 'Signing in…') : 'Sign in'}
          </button>
          {busy && waking && <p className="hint" role="status">The server was idle and is starting up. This can take up to a minute; there is no need to click again.</p>}
          {config.data?.mfa_email && <p className="hint mfa-hint">After your password, we email you a sign-in code.</p>}
          <a className="login-guide" href="/guide" target="_blank" rel="noopener">User guide</a>
          {import.meta.env.DEV && (
            <p className="hint">Trial users: admin, tmo.officer, ict.team, hr.team, fin.team, committee.viewer (password in your .env).</p>
          )}
        </form>
        )}
      </div>
    </div>
  );
}

/**
 * The second step of the sign-in: the 6-digit code sent by email. It submits by itself once six digits are
 * in (typed, pasted, or filled from the phone's mail by the browser), can send a new code after a short
 * wait, and goes back to the password for another account.
 */
function CodeStep({ challenge, verify, resend, onDone, onBack }: {
  challenge: MfaChallenge;
  verify: (code: string) => Promise<void>;
  resend: () => Promise<MfaChallenge>;
  onDone: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [info, setInfo] = useState(challenge);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(challenge.resend_after);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);
  const go = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verify(value);
      onDone();
    } catch (err) {
      setError(err);
      setCode('');
      // Too many wrong codes or an expired code: the server ended the attempt; start again.
      const c = err instanceof ApiError ? err.code : undefined;
      if (c === 'too_many' || c === 'expired') window.setTimeout(onBack, 2500);
    } finally {
      setBusy(false);
    }
  };
  const again = async () => {
    setError(null);
    setSent(false);
    try {
      const next = await resend();
      setInfo(next);
      setWait(next.resend_after);
      setSent(true);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="login-card code-step" onSubmit={(e) => { e.preventDefault(); void go(code); }}>
      <span className="card-glow" aria-hidden="true"><i /></span>
      <span className="code-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M3.8 6.5l8.2 6 8.2-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      </span>
      <div>
        <h2>Check your email</h2>
        <p>We sent a 6-digit code to <b dir="ltr" data-notr>{info.email}</b></p>
        <p className="t2">{`It is valid for ${info.minutes} minutes.`}</p>
      </div>
      <ErrorText error={error} />
      {sent && !error && <div className="notice-box" role="status">A new code is on its way. Use the latest email.</div>}
      <div className="fld">
        <label htmlFor="code">Sign-in code</label>
        <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
          value={code} autoFocus dir="ltr" placeholder="······"
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) void go(v); }} />
      </div>
      <button type="submit" className="btn pri block login-go" disabled={busy || code.length !== 6}>
        {busy ? <span className="spin" aria-hidden="true" /> : null}
        {busy ? 'Checking…' : 'Verify and sign in'}
      </button>
      <div className="code-links">
        <button type="button" className="dn" onClick={onBack}>Use another account</button>
        {wait > 0 ? <span className="t2">{`Send a new code in ${wait} s`}</span>
          : <button type="button" className="dn" onClick={() => void again()}>Send a new code</button>}
      </div>
    </form>
  );
}

/**
 * The work groups circling the TMO: dots on two slow orbits around the sign-in card. The rings are drawn
 * once; each dot is a tiny element the compositor turns around the centre, so nothing is redrawn while it
 * moves. It stands still for people who prefer reduced motion, and is hidden on small screens.
 */
function Orbit() {
  const dots = [
    ...Array.from({ length: 13 }, (_, i) => ({ a: (i * 360) / 13, r: 47.5, big: i % 4 === 0, kind: 'gold', speed: 140 })),
    ...Array.from({ length: 7 }, (_, i) => ({ a: 20 + (i * 360) / 7, r: 34.2, big: false, kind: 'blue', speed: -95 })),
  ];
  return (
    <div className="login-orbit" aria-hidden="true">
      <svg viewBox="0 0 600 600">
        <circle cx="300" cy="300" r="285" className="ring r1" />
        <circle cx="300" cy="300" r="205" className="ring r2" />
        <circle cx="300" cy="300" r="125" className="ring r3" />
      </svg>
      {dots.map((d, i) => (
        <span key={i} className={`lo-dot ${d.kind}${d.big ? ' big' : ''}`}
          style={{ ['--a' as string]: `${d.a}deg`, ['--r' as string]: `${d.r}cqw`, animationDuration: `${Math.abs(d.speed)}s`, animationDirection: d.speed < 0 ? 'reverse' : 'normal' }} />
      ))}
    </div>
  );
}
