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
