import express from 'express';
import fs from 'node:fs';
import { isData, type Data } from '../shared/types';
import { createSessionToken, hashPassword, RateLimiter, verifyPassword, verifySessionToken } from './auth';
import * as config from './config';
import { UserStore, type User } from './store';

const COOKIE = 'workh_session';
const HOUR_MS = 3_600_000;

export const USERNAME_RULE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD = 12;
const MAX_PASSWORD = 1024;

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

type AuthedRequest = express.Request & { user: User };

/** Defaults come from config.ts; tests override individual values. */
export interface AppOptions {
  dataDir: string;
  distDir: string;
  legacyDataFile: string;
  sessionSecret: string;
  sessionTtlMs: number;
  registrationCode: string;
  maxUsers: number;
  registrationsPerIpPerHour: number;
  loginMaxFailures: number;
  loginWindowMs: number;
}

export function createApp(overrides: Partial<AppOptions> = {}) {
  const o: AppOptions = {
    dataDir: config.DATA_DIR,
    distDir: config.DIST_DIR,
    legacyDataFile: config.LEGACY_DATA_FILE,
    sessionSecret: config.SESSION_SECRET,
    sessionTtlMs: config.SESSION_TTL_MS,
    registrationCode: config.REGISTRATION_CODE,
    maxUsers: config.MAX_USERS,
    registrationsPerIpPerHour: config.REGISTRATIONS_PER_IP_PER_HOUR,
    loginMaxFailures: config.LOGIN_MAX_FAILURES,
    loginWindowMs: config.LOGIN_WINDOW_MS,
    ...overrides,
  };
  const store = new UserStore(o.dataDir);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  const loginLimiter = new RateLimiter(o.loginMaxFailures, o.loginWindowMs);
  const signupLimiter = new RateLimiter(o.registrationsPerIpPerHour, HOUR_MS);
  // Logins for unknown usernames still run scrypt against this, so they take as long as real ones.
  const dummyHash = hashPassword('dummy password for timing');

  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000',
    });
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // State-changing API calls must send JSON. Together with the SameSite=Strict cookie
  // this stops cross-site form posts (CSRF): browsers can't send JSON cross-origin
  // without a CORS preflight, which this server never approves.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      res.status(415).json({ error: 'Content-Type must be application/json' });
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const cookieOptions: express.CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: true, // browsers also accept Secure cookies on http://localhost
    path: '/',
  };

  const startSession = (res: express.Response, user: User) => {
    const token = createSessionToken(user.id, o.sessionSecret, o.sessionTtlMs);
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: o.sessionTtlMs });
  };

  /** The logged-in user, or undefined. A deleted account's cookie no longer matches anyone. */
  const currentUser = (req: express.Request): User | undefined => {
    const token = readCookie(req.headers.cookie, COOKIE);
    const id = token ? verifySessionToken(token, o.sessionSecret) : null;
    return id ? store.findById(id) : undefined;
  };

  const credentials = (body: unknown) => {
    const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > MAX_PASSWORD) return null;
    return { username: username.trim().toLowerCase(), password };
  };

  const tooMany = (res: express.Response, limiter: RateLimiter, key: string, what: string) => {
    const wait = limiter.retryAfter(key);
    if (wait === 0) return false;
    res
      .set('Retry-After', String(wait))
      .status(429)
      .json({ error: `Too many ${what}. Try again later.` });
    return true;
  };

  // ---------- Registration ----------

  app.get('/api/registration', (_req, res) => {
    res.json({ open: store.count() < o.maxUsers, inviteRequired: o.registrationCode !== '' });
  });

  app.post('/api/register', async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (tooMany(res, signupLimiter, ip, 'new accounts from your address')) return;

    const creds = credentials(req.body);
    if (!creds) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }
    if (!USERNAME_RULE.test(creds.username)) {
      res.status(400).json({
        error: 'Username must be 3–32 characters: letters, numbers, dots, dashes or underscores',
      });
      return;
    }
    if (creds.password.length < MIN_PASSWORD) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
      return;
    }
    const { inviteCode } = (req.body ?? {}) as { inviteCode?: unknown };
    if (o.registrationCode !== '' && inviteCode !== o.registrationCode) {
      signupLimiter.hit(ip); // guessing invite codes counts against the sign-up limit
      res.status(403).json({ error: 'Invalid invite code' });
      return;
    }
    if (store.count() >= o.maxUsers) {
      res.status(403).json({ error: 'No more accounts can be created' });
      return;
    }
    if (store.findByName(creds.username)) {
      res.status(409).json({ error: 'That username is taken' });
      return;
    }

    const passwordHash = await hashPassword(creds.password);
    if (store.count() >= o.maxUsers) {
      res.status(403).json({ error: 'No more accounts can be created' }); // filled up while hashing
      return;
    }
    // The very first account inherits hours logged before accounts existed.
    const legacy = store.count() === 0 ? readLegacyData(o.legacyDataFile) : undefined;
    const user = store.create(creds.username, passwordHash, legacy);
    if (!user) {
      res.status(409).json({ error: 'That username is taken' }); // lost a race with a parallel sign-up
      return;
    }
    if (legacy) {
      fs.renameSync(o.legacyDataFile, `${o.legacyDataFile}.migrated`);
      console.log(`WorkH: moved ${o.legacyDataFile} into the new account "${user.username}"`);
    }
    signupLimiter.hit(ip);
    startSession(res, user);
    res.status(201).json({ username: user.username });
  });

  // ---------- Sessions ----------

  app.post('/api/login', async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (tooMany(res, loginLimiter, ip, 'failed logins')) return;

    const creds = credentials(req.body);
    if (!creds) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }
    const user = store.findByName(creds.username);
    const ok = await verifyPassword(creds.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !ok) {
      loginLimiter.hit(ip);
      res.status(401).json({ error: 'Wrong username or password' });
      return;
    }
    loginLimiter.reset(ip);
    startSession(res, user);
    res.json({ username: user.username });
  });

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  });

  // Everything below requires a logged-in user.
  const requireAuth: express.RequestHandler = (req, res, next) => {
    const user = currentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    (req as AuthedRequest).user = user;
    next();
  };

  app.get('/api/session', requireAuth, (req, res) => {
    res.json({ username: (req as AuthedRequest).user.username });
  });

  app.delete('/api/account', requireAuth, async (req, res) => {
    const { user } = req as AuthedRequest;
    const ip = req.ip ?? 'unknown';
    if (tooMany(res, loginLimiter, ip, 'failed attempts')) return;
    const { password } = (req.body ?? {}) as { password?: unknown };
    if (typeof password !== 'string' || !(await verifyPassword(password, user.passwordHash))) {
      loginLimiter.hit(ip);
      res.status(403).json({ error: 'Wrong password' });
      return;
    }
    store.delete(user.id);
    console.log(`WorkH: deleted account "${user.username}"`);
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  });

  // ---------- Data ----------

  // The data version travels as an ETag. Saves must send it back in If-Match; a stale
  // version gets 412 with the current data so the client can merge and retry.
  app.get('/api/data', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { data, rev } = store.readData((req as AuthedRequest).user.id);
      res.set('ETag', `"${rev}"`).json(data);
    } catch (err) {
      console.error('Could not read data file:', err);
      res.status(500).json({ error: 'Could not read data file' });
    }
  });

  app.put('/api/data', requireAuth, (req, res) => {
    const ifMatch = req.get('If-Match')?.replace(/^"|"$/g, '');
    if (!ifMatch) {
      res.status(428).json({ error: 'If-Match header with the data version is required' });
      return;
    }
    if (!isData(req.body)) {
      res.status(400).json({ error: 'Invalid data shape' });
      return;
    }
    const result = store.writeData((req as AuthedRequest).user.id, req.body, ifMatch);
    if (!result.ok) {
      res.status(412).set('ETag', `"${result.current.rev}"`).json(result.current.data);
      return;
    }
    res.set('ETag', `"${result.rev}"`).json({ ok: true });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Malformed / oversized JSON bodies end up here; answer with JSON instead of an HTML error page.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    if (typeof err === 'object' && err !== null && 'status' in err && err.status === 413) {
      res.status(413).json({ error: 'Request too large' });
      return;
    }
    next(err);
  });

  if (fs.existsSync(o.distDir)) app.use(express.static(o.distDir));

  return app;
}

function readLegacyData(file: string): Data | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isData(data) ? data : undefined;
  } catch {
    return undefined;
  }
}
