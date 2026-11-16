/**
 * Thin fetch wrapper. The session cookie authenticates every call; unsafe
 * methods send Django's CSRF token from the csrftoken cookie.
 */
export class ApiError extends Error {
  status: number;
  fields: Record<string, string[]>;

  constructor(status: number, message: string, fields: Record<string, string[]> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function messageFrom(body: unknown, status: number): { message: string; fields: Record<string, string[]> } {
  if (body && typeof body === 'object') {
    const data = body as Record<string, unknown>;
    if (typeof data.detail === 'string') return { message: data.detail, fields: {} };
    const fields: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(data)) {
      fields[key] = Array.isArray(value) ? value.map(String) : [String(value)];
    }
    const first = Object.entries(fields)[0];
    if (first) return { message: first[0] === 'non_field_errors' ? first[1][0] : `${first[0]}: ${first[1][0]}`, fields };
  }
  if (status === 403) return { message: 'You do not have permission to do this.', fields: {} };
  if (status >= 500) return { message: 'The server had a problem. Try again in a moment.', fields: {} };
  return { message: `Request failed (${status}).`, fields: {} };
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRFToken'] = csrfToken();
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const { message, fields } = messageFrom(body, response.status);
    throw new ApiError(response.status, message, fields);
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
  if (!response.ok) {
    const { message, fields } = messageFrom(body, response.status === 413 ? 400 : response.status);
    throw new ApiError(response.status, response.status === 413 ? 'The file is too large.' : message, fields);
  }
  return body as T;
}
