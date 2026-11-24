import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development, Vite serves the React app and forwards API calls to Django,
// so the browser sees one origin (as it does behind Nginx in Docker).
const backend = process.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/admin': backend,
      '/static': backend,
      '/oidc': backend,
    },
  },
  build: { sourcemap: false },
});
