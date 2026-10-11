import { vi } from 'vitest';
import { defaultData, type Data } from '../../shared/types';

interface FakeUser {
  password: string;
  data: Data;
  /** Data version, bumped on every save (the server's ETag). */
  rev?: number;
}

/** In-memory stand-in for the server API, installed as global fetch. */
export function installFakeApi(opts: {
  data: Data;
  /** Start with this user already logged in (cookie present). */
  loggedIn?: boolean;
  registration?: { open: boolean; inviteRequired: boolean };
}) {
  const state = {
    users: new Map<string, FakeUser>([['aaro', { password: 'secret password', data: structuredClone(opts.data) }]]),
    session: (opts.loggedIn ? 'aaro' : null) as string | null,
    saves: [] as { username: string; data: Data }[],
    /** When true, the next request that needs a session gets 401 (simulates expiry). */
    expireSession: false,
    get data() {
      return this.users.get('aaro')?.data as Data;
    },
  };
  const registration = opts.registration ?? { open: true, inviteRequired: false };

  const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    );
  const etag = (u: FakeUser) => ({ ETag: `"${u.rev ?? 0}"` });
  const notLoggedIn = () => reply(401, { error: 'Not logged in' });

  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    if (state.expireSession && url !== '/api/login') {
      state.session = null;
      state.expireSession = false;
    }
    const me = state.session ? state.users.get(state.session) : undefined;

    switch (`${method} ${url}`) {
      case 'GET /api/registration':
        return reply(200, registration);
      case 'POST /api/register': {
        const name = String(body.username).toLowerCase();
        if (state.users.has(name)) return reply(409, { error: 'That username is taken' });
        state.users.set(name, { password: body.password, data: defaultData() });
        state.session = name;
        return reply(201, { username: name });
      }
      case 'POST /api/login': {
        const name = String(body.username).toLowerCase();
        if (state.users.get(name)?.password !== body.password) {
          return reply(401, { error: 'Wrong username or password' });
        }
        state.session = name;
        return reply(200, { username: name });
      }
      case 'POST /api/logout':
        state.session = null;
        return reply(204);
      case 'GET /api/session':
        return me ? reply(200, { username: state.session }) : notLoggedIn();
      case 'DELETE /api/account':
        if (!me) return notLoggedIn();
        if (body.password !== me.password) return reply(403, { error: 'Wrong password' });
        state.users.delete(state.session!);
        state.session = null;
        return reply(204);
      case 'GET /api/data':
        return me ? reply(200, me.data, etag(me)) : notLoggedIn();
      case 'PUT /api/data': {
        if (!me) return notLoggedIn();
        const ifMatch = (init.headers as Record<string, string> | undefined)?.['If-Match'];
        if (ifMatch !== etag(me).ETag) return reply(412, me.data, etag(me));
        me.data = body;
        me.rev = (me.rev ?? 0) + 1;
        state.saves.push({ username: state.session!, data: body });
        return reply(200, { ok: true }, etag(me));
      }
      default:
        return reply(404, { error: 'Not found' });
    }
  });

  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
}
