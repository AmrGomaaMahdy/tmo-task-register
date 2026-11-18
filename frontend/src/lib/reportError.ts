import { api } from '../api/client';

/**
 * Report an error in this browser to the administrators' System issues page. Each distinct message is
 * sent once per page load, and reporting can never cause another error.
 */
const sent = new Set<string>();
const IGNORE = [/ResizeObserver loop/, /Loading chunk \d+ failed/, /AbortError/];

export function reportError(message: string, stack = '', where = '') {
  const text = (message || 'Unknown error').slice(0, 500);
  if (IGNORE.some((r) => r.test(text)) || sent.has(text) || sent.size > 20) return;
  sent.add(text);
  api('/api/client-errors/', {
    method: 'POST',
    body: { message: text, stack: stack.slice(0, 6000), url: (location.pathname + location.search).slice(0, 250), where: where.slice(0, 120) },
  }).catch(() => undefined);
}

/** Uncaught errors and rejected promises anywhere in the app. */
export function watchErrors() {
  window.addEventListener('error', (e) => reportError(e.message, e.error instanceof Error ? e.error.stack ?? '' : `${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // Refused API calls already show on the page and are recorded on the server.
    if (r && typeof r === 'object' && 'status' in r) return;
    reportError(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack ?? '' : '');
  });
}
