import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/Confirm';
import { toast } from '../components/Toasts';
import { ErrorText } from '../components/ui';
import { fmtStamp } from '../lib/format';

interface Settings {
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: 'starttls' | 'ssl' | 'none';
  smtp_user: string;
  smtp_password_set: boolean;
  from_email: string;
  email_configured: boolean;
  env_email: { host?: string; from?: string };
  effective_from: string;
  mfa_email_enabled: boolean;
  mfa_code_minutes: number;
  password_expiry_enabled: boolean;
  password_expiry_days: number;
  password_length_enabled: boolean;
  password_min_length: number;
  idle_timeout_enabled: boolean;
  idle_timeout_minutes: number;
  session_limit_enabled: boolean;
  session_limit_hours: number;
  updated_at: string | null;
  updated_by_name: string;
  users_without_email: string[];
}
type Patch = Partial<Settings> & { smtp_password?: string; smtp_password_clear?: boolean };

const with_ = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b));
const MINUTES_CODE = [5, 10, 15, 30];
const EXPIRY_DAYS = [60, 90, 180];
const LENGTHS = [8, 10, 12, 14, 16];
const IDLE = [15, 30, 60, 120, 240, 480];
const SESSION = [8, 10, 24, 72, 168];
const hoursLabel = (h: number) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : `${h} hours`);
const minutesLabel = (m: number) => (m % 60 === 0 && m >= 60 ? `${m / 60} ${m === 60 ? 'hour' : 'hours'}` : `${m} minutes`);

const ICONS: Record<string, ReactNode> = {
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.8 6.5l8.2 6 8.2-6" /></>,
  code: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /><path d="M12 14v2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16 7l2 2M14 9l2 2" /></>,
  ruler: <><rect x="2.5" y="8" width="19" height="8" rx="1.5" /><path d="M6 8v3M9.5 8v4M13 8v3M16.5 8v4" /></>,
  door: <><path d="M14 4H6.5A1.5 1.5 0 005 5.5v13A1.5 1.5 0 006.5 20H14" /><path d="M10 12h10m-3-3l3 3-3 3" /></>,
};

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="tgl" data-tip={label}>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span aria-hidden="true" />
      <b>{on ? 'On' : 'Off'}</b>
    </label>
  );
}

function Card({ icon, title, text, on, onToggle, toggleLabel, disabled, children, state }: {
  icon: string; title: string; text: string; on?: boolean; onToggle?: (v: boolean) => void; toggleLabel?: string; disabled?: boolean; children?: ReactNode; state?: ReactNode;
}) {
  return (
    <section className={`set-card${on === false ? ' off' : ''}${on ? ' on' : ''}`}>
      <header>
        <span className="set-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg></span>
        <div className="set-hd">
          <h3>{title}{state}</h3>
          <p>{text}</p>
        </div>
        {onToggle && <Switch on={!!on} onChange={onToggle} label={toggleLabel ?? title} disabled={disabled} />}
      </header>
      {children && <div className="set-body">{children}</div>}
    </section>
  );
}

function Choice({ label, value, options, render, onChange, disabled }: {
  label: string; value: number; options: number[]; render: (n: number) => string; onChange: (n: number) => void; disabled?: boolean;
}) {
  return (
    <label className="set-choice">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {with_(options, value).map((n) => <option key={n} value={n}>{render(n)}</option>)}
      </select>
    </label>
  );
}

/**
 * System settings (administrators): outgoing email, the email code at sign-in, password expiry and length,
 * and the automatic sign-out. Every policy has its own switch; a change is saved at once and recorded in
 * the audit trail (the SMTP server is saved with its own button).
 */
export default function SettingsPage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => api<Settings>('/api/auth/settings/'), enabled: !!me?.permissions.admin });
  const save = useMutation({
    mutationFn: (body: Patch) => api<Settings>('/api/auth/settings/', { method: 'PATCH', body }),
    onSuccess: (data) => {
      client.setQueryData(['system-settings'], data);
      void client.invalidateQueries({ queryKey: ['auth-config'] });
      void client.invalidateQueries({ queryKey: ['me'] });
      toast('Settings saved.');
    },
  });
  if (!me?.permissions.admin) return <Navigate to="/" replace />;
  const s = q.data;
  if (!s) return <div className="skel" style={{ height: 420 }} />;
  const set = (p: Patch) => save.mutate(p);

  const toggleMfa = async (on: boolean) => {
    const ok = await confirm({
      title: on ? 'Turn on the email code at sign-in?' : 'Turn off the email code at sign-in?',
      message: on ? (
        <>
          <p>From the next sign-in, everyone enters a 6-digit code sent to their email after their password. People already signed in stay signed in.</p>
          {s.users_without_email.length > 0 && <p className="warn-text">{`${s.users_without_email.length} active accounts have no email address and could not sign in until one is added: ${s.users_without_email.slice(0, 8).join(', ')}${s.users_without_email.length > 8 ? '…' : ''}`}</p>}
        </>
      ) : <p>Everyone signs in with the user name and password only.</p>,
      confirmLabel: on ? 'Turn on' : 'Turn off',
      tone: on ? 'primary' : 'danger',
    });
    if (ok) set({ mfa_email_enabled: on });
  };
  const toggleExpiry = async (on: boolean) => {
    if (on && !(await confirm({
      title: 'Turn on password expiry?',
      message: <p>{`Passwords will have to be changed every ${s.password_expiry_days} days. The count starts today for passwords set before, so nobody is asked at once. People who sign in with Microsoft are not affected.`}</p>,
      confirmLabel: 'Turn on', tone: 'primary',
    }))) return;
    set({ password_expiry_enabled: on });
  };

  return (
    <div className="settings">
      <ErrorText error={save.error} />
      <h2 className="set-group">Email</h2>
      <EmailCard s={s} save={(p) => save.mutateAsync(p)} busy={save.isPending} />
      <Card icon="code" title="Email code at sign-in" toggleLabel="Email code at sign-in"
        text="Multi-factor sign-in: after the user name and password, a 6-digit code is emailed to the person and must be entered. A code works once."
        on={s.mfa_email_enabled} onToggle={(v) => void toggleMfa(v)} disabled={save.isPending || (!s.email_configured && !s.mfa_email_enabled)}>
        <div className="set-row">
          <Choice label="Code valid for" value={s.mfa_code_minutes} options={MINUTES_CODE} render={(n) => `${n} minutes`} onChange={(n) => set({ mfa_code_minutes: n })} disabled={save.isPending} />
        </div>
        {!s.email_configured && <p className="set-note warn">Set up outgoing email first: the code is sent by email.</p>}
        {s.users_without_email.length > 0 && (
          <p className="set-note">{`${s.users_without_email.length} active accounts have no email address. `}<Link to="/users?filter=no-email">Add them in User access</Link></p>
        )}
      </Card>

      <h2 className="set-group">Passwords</h2>
      <Card icon="key" title="Password expiry" toggleLabel="Password expiry"
        text="People must choose a new password after a number of days. Until they do, the application only shows the password form."
        on={s.password_expiry_enabled} onToggle={(v) => void toggleExpiry(v)} disabled={save.isPending}>
        <div className="set-row">
          <Choice label="Change the password every" value={s.password_expiry_days} options={EXPIRY_DAYS} render={(n) => `${n} days`} onChange={(n) => set({ password_expiry_days: n })} disabled={save.isPending} />
        </div>
      </Card>
      <Card icon="ruler" title="Minimum password length" toggleLabel="Minimum password length"
        text="New passwords must have at least this many characters. Common passwords, passwords of digits only and passwords like the person's name are refused in any case."
        on={s.password_length_enabled} onToggle={(v) => set({ password_length_enabled: v })} disabled={save.isPending}>
        <div className="set-row">
          <Choice label="At least" value={s.password_min_length} options={LENGTHS} render={(n) => `${n} characters`} onChange={(n) => set({ password_min_length: n })} disabled={save.isPending} />
        </div>
        {!s.password_length_enabled && <p className="set-note warn">Off: no length is required. Not recommended.</p>}
      </Card>

      <h2 className="set-group">Automatic sign-out</h2>
      <Card icon="clock" title="Sign out after inactivity" toggleLabel="Sign out after inactivity"
        text="A session ends when nothing has been done in the application for this long."
        on={s.idle_timeout_enabled} onToggle={(v) => set({ idle_timeout_enabled: v })} disabled={save.isPending}>
        <div className="set-row">
          <Choice label="After" value={s.idle_timeout_minutes} options={IDLE} render={minutesLabel} onChange={(n) => set({ idle_timeout_minutes: n })} disabled={save.isPending} />
        </div>
      </Card>
      <Card icon="door" title="Maximum session length" toggleLabel="Maximum session length"
        text="A session ends this long after signing in, however active it is. Closing the browser always ends it."
        on={s.session_limit_enabled} onToggle={(v) => set({ session_limit_enabled: v })} disabled={save.isPending}>
        <div className="set-row">
          <Choice label="Sign out after" value={s.session_limit_hours} options={SESSION} render={hoursLabel} onChange={(n) => set({ session_limit_hours: n })} disabled={save.isPending} />
        </div>
        {!s.session_limit_enabled && !s.idle_timeout_enabled && <p className="set-note warn">Both off: a session lasts until the browser is closed (at most 8 days).</p>}
      </Card>
      {s.updated_by_name && <p className="hint">{`Last changed by ${s.updated_by_name}, ${fmtStamp(s.updated_at)}. Every change is in the audit trail.`}</p>}
      <p className="hint">If email stops working while the email code is on, an administrator on the server can turn it off with <code>python manage.py signin_code off</code>.</p>
    </div>
  );
}

/** The SMTP server: its own form and Save button, a test message, and where email goes when it is off. */
function EmailCard({ s, save, busy }: { s: Settings; save: (p: Patch) => Promise<Settings>; busy: boolean }) {
  const blank = { smtp_host: s.smtp_host, smtp_port: s.smtp_port, smtp_security: s.smtp_security, smtp_user: s.smtp_user, from_email: s.from_email };
  const [form, setForm] = useState(blank);
  const [password, setPassword] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => setForm({ smtp_host: s.smtp_host, smtp_port: s.smtp_port, smtp_security: s.smtp_security, smtp_user: s.smtp_user, from_email: s.from_email }),
    [s.smtp_host, s.smtp_port, s.smtp_security, s.smtp_user, s.from_email]);
  const dirty = password !== '' || (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== blank[k]);
  const test = useMutation({
    mutationFn: () => api<{ sent_to: string }>('/api/auth/settings/test-email/', { method: 'POST', body: to ? { to } : {} }),
    onSuccess: (d) => toast(`Test message sent to ${d.sent_to}.`),
  });
  const submit = async () => {
    await save({ ...form, ...(password ? { smtp_password: password } : {}) });
    setPassword('');
  };
  const using = s.email_enabled && s.smtp_host ? 'own' : s.env_email.host ? 'env' : 'none';
  return (
    <Card icon="mail" title="Outgoing email" toggleLabel="Use this SMTP server"
      text="The mail server that sends the sign-in codes and the notices (for example to a delegate). Microsoft 365: smtp.office365.com, port 587, STARTTLS, with a mailbox allowed to send."
      on={s.email_enabled} onToggle={(v) => void save({ email_enabled: v, ...(v ? form : {}) })} disabled={busy || (!s.email_enabled && !form.smtp_host.trim())}
      state={<span className={`pill ${s.email_configured ? 'ok' : ''}`}>{using === 'own' ? 'Using this server' : using === 'env' ? 'Using the server environment' : 'Not set up'}</span>}>
      <form className="set-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="w2"><span>SMTP server</span><input value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} placeholder="smtp.office365.com" dir="ltr" /></label>
        <label><span>Port</span><input type="number" min={1} max={65535} value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })} dir="ltr" /></label>
        <label><span>Security</span>
          <select value={form.smtp_security} onChange={(e) => setForm({ ...form, smtp_security: e.target.value as Settings['smtp_security'] })}>
            <option value="starttls">STARTTLS (port 587)</option><option value="ssl">SSL/TLS (port 465)</option><option value="none">None</option>
          </select>
        </label>
        <label><span>User name</span><input value={form.smtp_user} onChange={(e) => setForm({ ...form, smtp_user: e.target.value })} autoComplete="off" dir="ltr" placeholder="tmo-register@al-ayuni.com" /></label>
        <label><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" dir="ltr"
          placeholder={s.smtp_password_set ? '•••••••• (stored, leave empty to keep)' : ''} /></label>
        <label className="w2"><span>Sender (From)</span><input value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} dir="ltr" placeholder="TMO Task Register <no-reply@al-ayuni.com>" /></label>
        <div className="set-actions w2">
          <button type="submit" className="btn pri" disabled={!dirty || busy}>Save email settings</button>
          {s.smtp_password_set && <button type="button" className="dn" onClick={() => void save({ smtp_password_clear: true })}>Remove the stored password</button>}
        </div>
      </form>
      <p className="set-note">
        {using === 'own' ? `Emails are sent through ${s.smtp_host}, from ${s.effective_from}.`
          : using === 'env' ? `Off: emails go through the server's own settings (${s.env_email.host}), from ${s.effective_from}.`
          : 'Off and no server email is set up: emails are only written to the server log.'}
        {' '}The password is stored encrypted and is never shown again.
      </p>
      <div className="set-test">
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Send the test to (empty: your own address)" dir="ltr" aria-label="Test address" />
        <button type="button" className="btn" disabled={!s.email_configured || test.isPending || dirty} onClick={() => test.mutate()}>{test.isPending ? 'Sending…' : 'Send a test email'}</button>
      </div>
      {dirty && <p className="set-note">Save the changes before sending a test.</p>}
      <ErrorText error={test.error} />
    </Card>
  );
}
