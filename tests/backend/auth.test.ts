import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  hashPassword,
  isPasswordHash,
  RateLimiter,
  verifyPassword,
  verifySessionToken,
} from '../../backend/auth';

const SECRET = 'x'.repeat(32);

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(isPasswordHash(hash)).toBe(true);
    expect(hash).not.toContain('correct');
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    await expect(verifyPassword('pw', 'plaintext')).resolves.toBe(false);
    await expect(verifyPassword('pw', '')).resolves.toBe(false);
  });
});

describe('session tokens', () => {
  const now = 1_700_000_000_000;

  it('round-trips a user id', () => {
    const token = createSessionToken('aaro', SECRET, 60_000, now);
    expect(verifySessionToken(token, SECRET, now + 1000)).toBe('aaro');
  });

  it('expires', () => {
    const token = createSessionToken('aaro', SECRET, 60_000, now);
    expect(verifySessionToken(token, SECRET, now + 60_000)).toBeNull();
  });

  it('rejects a different secret', () => {
    const token = createSessionToken('aaro', SECRET, 60_000, now);
    expect(verifySessionToken(token, 'y'.repeat(32), now)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = createSessionToken('aaro', SECRET, 60_000, now);
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'aaro', exp: now + 10 * 365 * 86_400_000 })).toString('base64url');
    expect(verifySessionToken(`${forged}.${sig}`, SECRET, now)).toBeNull();
  });

  it('rejects garbage', () => {
    for (const t of ['', 'abc', 'a.b.c', '.', 'e30.']) expect(verifySessionToken(t, SECRET, now)).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('blocks after too many hits and unblocks when the window passes', () => {
    let t = 0;
    const limiter = new RateLimiter(3, 60_000, () => t);
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfter('ip')).toBe(0);
      limiter.hit('ip');
      t += 1000;
    }
    expect(limiter.retryAfter('ip')).toBe(57); // first hit at t=0 leaves the window at 60 s
    expect(limiter.retryAfter('other-ip')).toBe(0);
    t = 60_001;
    expect(limiter.retryAfter('ip')).toBe(0);
  });

  it('resets', () => {
    const limiter = new RateLimiter(2, 60_000, () => 0);
    limiter.hit('ip');
    limiter.hit('ip');
    expect(limiter.retryAfter('ip')).toBeGreaterThan(0);
    limiter.reset('ip');
    expect(limiter.retryAfter('ip')).toBe(0);
  });
});
