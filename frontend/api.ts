import type { Data } from '../shared/types';

export class UnauthorizedError extends Error {
  constructor() {
    super('Not logged in');
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function send(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await send(method, url, body);
  if (r.status === 401 && url !== '/api/login') throw new UnauthorizedError();
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(r.status, err.error ?? `HTTP ${r.status}`);
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
}

export const api = {
  session: () => request<{ username: string }>('GET', '/api/session'),
  login: (username: string, password: string) =>
    request<{ username: string }>('POST', '/api/login', { username, password }),
  logout: () => request<void>('POST', '/api/logout', {}),
  registration: () => request<{ open: boolean; inviteRequired: boolean }>('GET', '/api/registration'),
  register: (username: string, password: string, inviteCode?: string) =>
    request<{ username: string }>('POST', '/api/register', { username, password, inviteCode }),
  deleteAccount: (password: string) => request<void>('DELETE', '/api/account', { password }),
  /** The data plus its version tag, needed to save. */
  load: async (): Promise<Versioned> => {
    const r = await send('GET', '/api/data');
    if (r.status === 401) throw new UnauthorizedError();
    if (!r.ok) throw new ApiError(r.status, `HTTP ${r.status}`);
    return { data: (await r.json()) as Data, etag: r.headers.get('ETag') ?? '' };
  },
  /**
   * Saves `data` if the server still has version `etag`. Otherwise resolves to the
   * server's newer version (`conflict`) so the caller can merge and retry.
   */
  save: async (data: Data, etag: string): Promise<{ etag: string } | { conflict: Versioned }> => {
    const r = await send('PUT', '/api/data', data, { 'If-Match': etag });
    if (r.status === 401) throw new UnauthorizedError();
    if (r.status === 412) return { conflict: { data: (await r.json()) as Data, etag: r.headers.get('ETag') ?? '' } };
    if (!r.ok) throw new ApiError(r.status, `HTTP ${r.status}`);
    return { etag: r.headers.get('ETag') ?? '' };
  },
};

export interface Versioned {
  data: Data;
  etag: string;
}
