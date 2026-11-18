import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { ApiError } from './api/client';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ConfirmProvider } from './components/Confirm';
import { DrillProvider } from './components/Drill';
import { toast } from './components/Toasts';
import { WorkGroupScopeProvider } from './components/WorkGroupScope';
import { LanguageProvider } from './i18n/LanguageProvider';
// Self-hosted type (the Content-Security-Policy allows fonts from this site only): Archivo with its width
// axis for titles and figures, IBM Plex Sans for text, IBM Plex Mono for codes, IBM Plex Sans Arabic.
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import './styles.css';
import { watchErrors } from './lib/reportError';
import { applyTheme, storedTheme } from './lib/theme';

applyTheme(storedTheme());
watchErrors();

const queryClient = new QueryClient({
  // Every successful change confirms itself with a short toast; its text comes from the mutation's meta.
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, mutation) => {
      const text = mutation.meta?.toast;
      if (typeof text === 'string') toast(text);
    },
  }),
  defaultOptions: {
    queries: {
      // Retry network and server errors once; a "not found" or "not allowed" answer will not change on retry.
      retry: (failures, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 1,
      refetchOnWindowFocus: false,
      // Data stays fresh for half a minute, so going back to a page shows it at once instead of a spinner.
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <BrowserRouter>
          <AuthProvider>
            <WorkGroupScopeProvider>
              <ConfirmProvider>
              <DrillProvider>
                <App />
              </DrillProvider>
              </ConfirmProvider>
            </WorkGroupScopeProvider>
          </AuthProvider>
        </BrowserRouter>
      </LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
);
