import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { ApiError } from './api/client';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { DrillProvider } from './components/Drill';
import { WorkGroupScopeProvider } from './components/WorkGroupScope';
import { LanguageProvider } from './i18n/LanguageProvider';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import './styles.css';
import { applyTheme, storedTheme } from './lib/theme';

applyTheme(storedTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry network and server errors once; a "not found" or "not allowed" answer will not change on retry.
      retry: (failures, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 1,
      refetchOnWindowFocus: false,
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
              <DrillProvider>
                <App />
              </DrillProvider>
            </WorkGroupScopeProvider>
          </AuthProvider>
        </BrowserRouter>
      </LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
);
