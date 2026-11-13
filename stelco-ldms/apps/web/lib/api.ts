'use client';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public requestId?: string) {
    super(message);
  }
  get reauthRequired() {
    return this.status === 401 && !!(this.details as { reauthRequired?: boolean } | undefined)?.reauthRequired;
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)(?:__Host-)?ldms_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : '';
}

type ReauthHandler = () => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;
export function onReauthRequired(h: ReauthHandler | null) {
  reauthHandler = h;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-csrf-token': csrf() } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new ApiError(res.status, (data as { message?: string })?.message ?? res.statusText, (data as { details?: unknown })?.details, (data as { requestId?: string })?.requestId);
    if (err.reauthRequired && retry && reauthHandler && (await reauthHandler())) return request<T>(method, path, body, false);
    if (res.status === 401 && !err.reauthRequired && typeof window !== 'undefined' && !location.pathname.startsWith('/login') && !path.startsWith('/auth/')) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
  form: <T>(p: string, fd: FormData) => request<T>('POST', p, fd),
};

/** Download a file (xlsx/ics/signed document link) through the BFF without leaving the page. */
export async function download(path: string, fallbackName = 'download') {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message ?? msg; } catch { /* ignore */ }
    if (res.status === 401 && reauthHandler && (await reauthHandler())) return download(path, fallbackName);
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function downloadVersion(versionId: string) {
  const { url } = await api.post<{ url: string }>(`/documents/versions/${versionId}/link`);
  await download(url.replace(/^\/api/, ''));
}
