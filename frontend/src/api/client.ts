/**
 * Thin fetch wrapper. The session cookie (HttpOnly, never readable here) authenticates every call;
 * unsafe methods send Django's CSRF token from the csrftoken cookie. Nothing secret is kept in
 * localStorage or sessionStorage (OWASP A07: tokens out of reach of scripts).
 */
export class ApiError extends Error {
  status: number;
  fields: Record<string, string[]>;
  /** Machine-readable reason from the API, e.g. "not_authenticated" or "locked". */
  code?: string;

  constructor(status: number, message: string, fields: Record<string, string[]> = {}, code?: string) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

/** Fired when the server ends the session (idle or absolute timeout): the app returns to sign-in. */
export const SESSION_ENDED = 'task-register:session-ended';
/** Fired when the server holds the user back until they change their password (expired, or reset). */
export const PASSWORD_REQUIRED = 'task-register:password-required';

function csrfToken(): string {
  // On HTTPS the cookie carries the "__Host-" prefix (see SESSION/CSRF_COOKIE_NAME in settings.py).
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/** The server's own messages name their field; its generic ones ("This field is required.") get the field's name. */
const GENERIC = /^(This field|Ensure |Invalid|Date has|A valid|Incorrect type|Not a valid|"|Select a valid)/;
const label = (key: string) => {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function messageFrom(body: unknown, status: number): { message: string; fields: Record<string, string[]>; code?: string } {
  if (body && typeof body === 'object') {
    const data = body as Record<string, unknown>;
    if (typeof data.detail === 'string') return { message: data.detail, fields: {}, code: typeof data.code === 'string' ? data.code : undefined };
    const fields: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'code') continue;
      fields[key] = Array.isArray(value) ? value.map(String) : [String(value)];
    }
    const first = Object.entries(fields)[0];
    if (first) return { message: first[0] === 'non_field_errors' || !GENERIC.test(first[1][0]) ? first[1][0] : `${label(first[0])}: ${first[1][0]}`, fields };
  }
  if (status === 403) return { message: 'You do not have permission to do this.', fields: {} };
  if (status >= 500) return { message: 'The server had a problem. Try again in a moment.', fields: {} };
  return { message: `Request failed (${status}).`, fields: {} };
}

/** Fired while the server is being woken up (Render's free plan sleeps when idle); `detail` is true while waiting. */
export const SERVER_WAKING = 'task-register:server-waking';

/** How long to keep trying a request the server cannot answer yet: a sleeping free server takes up to a minute. */
const WAKE_LIMIT_MS = 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * True when the reply is not from the API itself: a hosting page ("service waking up", "bad gateway") or a
 * network failure. Such replies are HTML, not JSON, and the request never reached the application.
 */
const notFromApi = (response: Response | null) =>
  !response || [502, 503, 504].includes(response.status)
  // a "loading" page served with 200 while the API starts
  || (response.ok && response.status !== 204 && !(response.headers.get('content-type') ?? '').includes('json'));

const UNREACHABLE = 'The server is not answering yet. If it was idle it may be starting up, which can take a minute. Try again shortly.';

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  // Reads and the sign-in steps are safe to repeat; other changes are never sent twice.
  const retry = method === 'GET' || path.startsWith('/api/auth/');
  const started = Date.now();
  let response: Response | null = null;
  let woke = false;
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRFToken'] = csrfToken();
    try {
      response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      response = null; // offline, or the connection was dropped
    }
    if (response?.status === 204) break;
    if (!notFromApi(response) || !retry || Date.now() - started > WAKE_LIMIT_MS) break;
    woke = true;
    window.dispatchEvent(new CustomEvent(SERVER_WAKING, { detail: true }));
    await sleep(Math.min(2000 * 2 ** attempt, 10_000));
  }
  if (woke) window.dispatchEvent(new CustomEvent(SERVER_WAKING, { detail: false }));
  if (!response) throw new ApiError(0, UNREACHABLE, {}, 'unreachable');
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // An HTML page instead of the API's JSON: never show its HTML or a JSON parse error.
    if (notFromApi(response)) throw new ApiError(response.status || 0, UNREACHABLE, {}, 'unreachable');
    throw new ApiError(response.status, `The server answered with a web page instead of data (HTTP ${response.status}). Usually a proxy or address setting: see "Troubleshooting" in docs/render.md.`, {}, 'not_json');
  }
  if (!response.ok) {
    const { message, fields, code } = messageFrom(body, response.status);
    if (code === 'not_authenticated' && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(SESSION_ENDED));
    if (code === 'password_change_required') window.dispatchEvent(new Event(PASSWORD_REQUIRED));
    throw new ApiError(response.status, message, fields, code);
  }
  return body as T;
}

export function qs(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** POST a multipart form (file uploads). Same CSRF and error handling as api(). */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-CSRFToken': csrfToken() },
    credentials: 'same-origin',
    body: form,
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok && body === undefined && text && response.status !== 413) throw new ApiError(response.status, UNREACHABLE, {}, 'unreachable');
  if (!response.ok) {
    const { message, fields } = messageFrom(body, response.status === 413 ? 400 : response.status);
    throw new ApiError(response.status, response.status === 413 ? 'The file is too large.' : message, fields);
  }
  return body as T;
}
