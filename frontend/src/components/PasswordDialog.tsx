import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Field, Modal } from './ui';

/** Change one's own password: the current one, then the new one twice. The session stays signed in. */
export default function PasswordDialog({ onClose }: { onClose: () => void }) {
  return <PasswordForm onDone={onClose} render={(title, body, footer) => <Modal title={title} onClose={onClose} footer={footer}>{body}</Modal>} onCancel={onClose} />;
}

/**
 * The password form, in a dialog (from the menu) or on its own page when the password must be changed
 * first (it expired, or an administrator set it): then there is no Cancel, and the app opens once done.
 */
export function PasswordForm({ onDone, onCancel, render, forced }: {
  onDone: () => void;
  onCancel?: () => void;
  render: (title: string, body: ReactNode, footer: ReactNode) => JSX.Element;
  forced?: boolean;
}) {
  const { me } = useAuth();
  const client = useQueryClient();
  const min = me?.password?.min_length ?? 0;
  const onClose = onCancel ?? onDone;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const mismatch = !!again && next !== again;
  const valid = !!current && next.length >= Math.max(min, 1) && next === again && next !== current;
  const fieldErr = (k: string) => {
    const msg = error?.fields[k]?.[0];
    return msg ? <span className="field-error" role="alert">{msg}</span> : null;
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/password/', { method: 'POST', body: { current_password: current, new_password: next } });
      setDone(true);
      if (forced) {
        await client.invalidateQueries({ queryKey: ['me'] });
        onDone();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'The password was not changed. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const hint = `${min ? `At least ${min} characters. ` : ''}Not a common password, not only digits, not like your name, and not the current one.`;
  return render(
    forced ? 'Choose a new password' : 'Change password',
    <>
      {done ? <p className="intro">Your password is changed. Use the new one the next time you sign in.</p> : (
        <form className="fgrid" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void save(); }}>
          <Field label={forced ? 'Current (or temporary) password' : 'Current password'} req="REQUIRED" htmlFor="pw-current" wide>
            <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            {fieldErr('current_password')}
          </Field>
          <Field label="New password" req="REQUIRED" htmlFor="pw-new" hint={hint} wide>
            <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            {fieldErr('new_password')}
          </Field>
          <Field label="New password again" req="REQUIRED" htmlFor="pw-again" wide>
            <input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch} />
            {mismatch && <span className="field-error" role="alert">The two new passwords are not the same.</span>}
          </Field>
          {error && !Object.keys(error.fields).length && <span className="field-error" role="alert">{error.message}</span>}
          <button type="submit" hidden />
        </form>
      )}
    </>,
    done ? <button type="button" className="btn pri" onClick={onClose}>Close</button> : <>
      {!forced && <button type="button" className="btn" onClick={onClose}>Cancel</button>}
      <button type="button" className="btn pri" disabled={!valid || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Change password'}</button>
    </>,
  );
}
