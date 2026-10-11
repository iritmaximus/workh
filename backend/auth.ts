import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// ---------- Password hashing (scrypt) ----------
// Stored format: scrypt$N$r$p$<salt base64>$<hash base64>

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
// 128 * N * r = 32 MiB per hash; give scrypt a little headroom above that.
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password, salt, keylen, { N, r, p, maxmem: MAXMEM });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function isPasswordHash(stored: string): boolean {
  return /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(stored);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const [, n, r, p, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return timingSafeEqual(actual, expected);
}

// ---------- Session tokens ----------
// Stateless: base64url(JSON {u, exp}) + "." + base64url(HMAC-SHA256). Rotating
// SESSION_SECRET invalidates every session.

interface SessionPayload {
  u: string;
  exp: number;
}

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function createSessionToken(userId: string, secret: string, ttlMs: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, exp: now + ttlMs } satisfies SessionPayload)).toString(
    'base64url',
  );
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the user id for a valid, unexpired token, otherwise null. */
export function verifySessionToken(token: string, secret: string, now = Date.now()): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof data.u !== 'string' || typeof data.exp !== 'number' || data.exp <= now) return null;
    return data.u;
  } catch {
    return null;
  }
}

// ---------- Rate limiting ----------

/**
 * Counts events (failed logins, sign-ups) per key (client IP) in a sliding window. After
 * `maxHits` events the key is blocked until its oldest event leaves the window.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private maxHits: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Seconds until the key may try again; 0 if it is not blocked. */
  retryAfter(key: string): number {
    const list = this.recent(key);
    if (list.length < this.maxHits) return 0;
    return Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
  }

  hit(key: string): void {
    this.hits.set(key, [...this.recent(key), this.now()]);
    // Keep memory bounded if someone sprays many source IPs.
    if (this.hits.size > 10_000) {
      for (const k of this.hits.keys()) this.recent(k);
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
