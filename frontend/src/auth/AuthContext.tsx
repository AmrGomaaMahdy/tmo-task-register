import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, PASSWORD_REQUIRED, SESSION_ENDED } from '../api/client';
import type { Me } from '../api/types';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  /** Signs in; when the email code is on, resolves to the challenge instead and verifyCode() finishes. */
  login: (username: string, password: string) => Promise<MfaChallenge | null>;
  verifyCode: (code: string) => Promise<void>;
  resendCode: () => Promise<MfaChallenge>;
  logout: () => Promise<void>;
  /** True after the server ended the session (inactivity or the daily limit), until the next sign-in. */
  sessionEnded: boolean;
  /** Mirrors the server rule, to show or hide edit controls. The server always decides. */
  canEditGroup: (workGroupCode: string, status?: string) => boolean;
}

/** The second step of the sign-in (Configuration → Security → email code). */
export interface MfaChallenge {
  mfa_required?: boolean;
  email: string;
  minutes: number;
  resend_after: number;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Forget everything loaded for the previous user, but keep the 'me' query the provider observes. */
function dropCachedData(client: QueryClient) {
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [sessionEnded, setSessionEnded] = useState(false);
  // The server ends sessions after inactivity; the next API call says so and the app returns to sign-in,
  // dropping every cached record of the previous session.
  useEffect(() => {
    const ended = () => {
      if (!client.getQueryData(['me'])) return;
      dropCachedData(client);
      client.setQueryData(['me'], null);
      setSessionEnded(true);
    };
    // The server asks for a new password: read "me" again, and the app shows the password form.
    const pw = () => void client.invalidateQueries({ queryKey: ['me'] });
    window.addEventListener(SESSION_ENDED, ended);
    window.addEventListener(PASSWORD_REQUIRED, pw);
    return () => {
      window.removeEventListener(SESSION_ENDED, ended);
      window.removeEventListener(PASSWORD_REQUIRED, pw);
    };
  }, [client]);
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const session = await api<{ authenticated: boolean }>('/api/auth/csrf/');
      if (!session.authenticated) return null;
      try {
        return await api<Me>('/api/auth/me/');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  const signedIn = useCallback(
    (me: Me) => {
      dropCachedData(client);
      client.setQueryData(['me'], me);
      setSessionEnded(false);
    },
    [client],
  );
  const login = useCallback(
    async (username: string, password: string) => {
      await api('/api/auth/csrf/');
      const res = await api<Me | MfaChallenge>('/api/auth/login/', { method: 'POST', body: { username, password } });
      if ('mfa_required' in res && res.mfa_required) return res;
      signedIn(res as Me);
      return null;
    },
    [signedIn],
  );
  const verifyCode = useCallback(
    async (code: string) => {
      signedIn(await api<Me>('/api/auth/login/verify/', { method: 'POST', body: { code } }));
    },
    [signedIn],
  );
  const resendCode = useCallback(() => api<MfaChallenge>('/api/auth/login/resend/', { method: 'POST' }), []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout/', { method: 'POST' });
    dropCachedData(client);
    client.setQueryData(['me'], null);
  }, [client]);

  const value = useMemo<AuthValue>(() => {
    const me = meQuery.data ?? null;
    return {
      me,
      loading: meQuery.isLoading,
      login,
      verifyCode,
      resendCode,
      logout,
      sessionEnded,
      canEditGroup: (code, status) => {
        if (!me) return false;
        if (me.permissions.admin) return true;
        // The Focal Point (or the leader) edits only while preparing the task: Draft or Needs completion.
        if (status && status !== 'draft' && status !== 'needs_completion') return false;
        return me.work_groups.some((g) => g.code === code);
      },
    };
  }, [meQuery.data, meQuery.isLoading, login, verifyCode, resendCode, logout, sessionEnded]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
