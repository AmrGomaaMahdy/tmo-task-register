import { useState } from 'react';

import { api, ApiError } from '../api/client';
import { Field, Modal } from './ui';

/** Change one's own password: the current one, then the new one twice. The session stays signed in. */
export default function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const mismatch = !!again && next !== again;
  const valid = !!current && next.length >= 12 && next === again;
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
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'The password was not changed. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Change password" onClose={onClose}
      footer={done ? <button type="button" className="btn pri" onClick={onClose}>Close</button> : <>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn pri" disabled={!valid || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Change password'}</button>
      </>}>
      {done ? <p className="intro">Your password is changed. Use the new one the next time you sign in.</p> : (
        <form className="fgrid" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void save(); }}>
          <Field label="Current password" req="REQUIRED" htmlFor="pw-current" wide>
            <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            {fieldErr('current_password')}
          </Field>
          <Field label="New password" req="REQUIRED" htmlFor="pw-new" hint="At least 12 characters. Not a common password, not only digits, and not like your name." wide>
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
    </Modal>
  );
}
