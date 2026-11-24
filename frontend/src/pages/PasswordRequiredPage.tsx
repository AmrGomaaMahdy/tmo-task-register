import { PasswordForm } from '../components/PasswordDialog';
import { Logo } from '../components/Brand';
import { useAuth } from '../auth/AuthContext';
import { LanguageSwitch } from '../i18n/LanguageProvider';

/**
 * Shown instead of the application while the password must be changed: it expired (System settings ›
 * Password expiry), or an administrator set a temporary one (User access). The server answers nothing
 * else until it is done.
 */
export default function PasswordRequiredPage() {
  const { me, logout } = useAuth();
  const reason = me?.password?.reason;
  return (
    <div className="pwreq">
      <div className="pwreq-lang"><LanguageSwitch /></div>
      <div className="pwreq-card">
        <div className="pwreq-brand"><Logo /></div>
        <PasswordForm
          forced
          onDone={() => undefined}
          render={(title, body, footer) => (
            <>
              <h1>{title}</h1>
              <p className="pwreq-why">
                {reason === 'expired'
                  ? 'Your password has expired. Choose a new one to continue.'
                  : 'Your password was set by an administrator. Choose your own password to continue.'}
              </p>
              <div className="pwreq-body">{body}</div>
              <div className="pwreq-ft">
                <button type="button" className="dn" onClick={() => void logout()}>Sign out</button>
                <span className="spacer" />
                {footer}
              </div>
            </>
          )}
        />
      </div>
    </div>
  );
}
