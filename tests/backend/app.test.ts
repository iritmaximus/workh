import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultData, type Data } from '../../shared/types';
import { createApp } from '../../backend/app';
import type { AppOptions } from '../../backend/app';

const PASSWORD = 'a long test password';

let tmpDir: string;
let server: Server;
let base: string;

async function start(overrides: Partial<AppOptions> = {}) {
  server = createApp({
    dataDir: path.join(tmpDir, 'data'),
    legacyDataFile: path.join(tmpDir, 'data.json'),
    distDir: path.join(tmpDir, 'dist'),
    sessionSecret: 's'.repeat(32),
    loginMaxFailures: 3,
    registrationsPerIpPerHour: 100,
    ...overrides,
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function restart(overrides: Partial<AppOptions> = {}) {
  await new Promise((resolve) => server.close(resolve));
  await start(overrides);
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workh-test-'));
  fs.mkdirSync(path.join(tmpDir, 'dist'));
  fs.writeFileSync(path.join(tmpDir, 'dist', 'index.html'), '<!doctype html><title>workh</title>');
  await start();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const json = (method: string, body: unknown, cookie?: string): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];

const register = (username: string, password = PASSWORD, extra: object = {}) =>
  fetch(`${base}/api/register`, json('POST', { username, password, ...extra }));

const login = (username: string, password = PASSWORD) =>
  fetch(`${base}/api/login`, json('POST', { username, password }));

/** Registers a user and returns their session cookie ("name=value"). */
async function newUser(username = 'aaro'): Promise<string> {
  const r = await register(username);
  expect(r.status).toBe(201);
  return cookieOf(r);
}

const getData = (cookie: string) => fetch(`${base}/api/data`, { headers: { Cookie: cookie } });

/** Saves on top of the current version, like the app does. */
async function putData(cookie: string, data: unknown) {
  const etag = (await getData(cookie)).headers.get('etag')!;
  return putAt(cookie, data, etag);
}
const putAt = (cookie: string, data: unknown, etag: string) =>
  fetch(`${base}/api/data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'If-Match': etag },
    body: JSON.stringify(data),
  });
const deleteAccount = (cookie: string, password = PASSWORD) =>
  fetch(`${base}/api/account`, json('DELETE', { password }, cookie));

const withEntry = (minutes: number): Data => ({
  ...defaultData(),
  entries: { '2026-10-06': { mode: 'total', minutes } },
});

describe('public endpoints', () => {
  it('serves health and the frontend without login', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>workh</title>');
  });

  it('sets security headers', async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('strict-transport-security')).toMatch(/max-age=/);
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('answers unknown API routes with JSON 404', async () => {
    const r = await fetch(`${base}/api/nope`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Not found' });
  });
});

describe('registration', () => {
  it('creates an account and logs it in with a hardened cookie', async () => {
    const r = await register('Aaro');
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ username: 'aaro' });
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^workh_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const s = await fetch(`${base}/api/session`, { headers: { Cookie: cookieOf(r) } });
    expect(await s.json()).toEqual({ username: 'aaro' });
  });

  it('never stores the plain password', async () => {
    await newUser();
    const raw = fs.readFileSync(path.join(tmpDir, 'data', 'users.json'), 'utf8');
    expect(raw).not.toContain(PASSWORD);
    expect(raw).toMatch(/scrypt\$/);
  });

  it('rejects taken usernames, case-insensitively', async () => {
    await newUser('aaro');
    const r = await register('AARO');
    expect(r.status).toBe(409);
  });

  it.each([
    ['ab', 'too short'],
    ['a'.repeat(33), 'too long'],
    ['has space', 'space'],
    ['../etc', 'path characters'],
    ['-leading', 'leading dash'],
  ])('rejects the username %j (%s)', async (username) => {
    expect((await register(username)).status).toBe(400);
  });

  it('rejects short passwords', async () => {
    const r = await register('aaro', 'short');
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/12/);
  });

  it('requires the invite code when one is configured', async () => {
    await restart({ registrationCode: 'secret-invite' });
    expect(await (await fetch(`${base}/api/registration`)).json()).toEqual({ open: true, inviteRequired: true });
    expect((await register('aaro')).status).toBe(403);
    expect((await register('aaro', PASSWORD, { inviteCode: 'wrong' })).status).toBe(403);
    expect((await register('aaro', PASSWORD, { inviteCode: 'secret-invite' })).status).toBe(201);
  });

  it('stops at the user limit', async () => {
    await restart({ maxUsers: 2 });
    await newUser('one');
    await newUser('two');
    expect((await register('three')).status).toBe(403);
    expect((await (await fetch(`${base}/api/registration`)).json()).open).toBe(false);
  });

  it('limits sign-ups per IP address', async () => {
    await restart({ registrationsPerIpPerHour: 2 });
    await newUser('one');
    await newUser('two');
    const r = await register('three');
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('gives hours from the old single-user data.json to the first account only', async () => {
    fs.writeFileSync(path.join(tmpDir, 'data.json'), JSON.stringify(withEntry(123)));
    const first = await newUser('first');
    expect((await (await getData(first)).json()).entries['2026-10-06'].minutes).toBe(123);
    expect(fs.existsSync(path.join(tmpDir, 'data.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'data.json.migrated'))).toBe(true);

    const second = await newUser('second');
    expect((await (await getData(second)).json()).entries).toEqual({});
  });
});

describe('login', () => {
  beforeEach(async () => {
    await newUser('aaro');
  });

  it('logs in case-insensitively', async () => {
    const r = await login('AARO');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ username: 'aaro' });
  });

  it('rejects a wrong password and an unknown user the same way', async () => {
    const wrongPw = await login('aaro', 'wrong password!');
    const noUser = await login('nobody');
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(await wrongPw.json()).toEqual(await noUser.json());
    expect(wrongPw.headers.get('set-cookie')).toBeNull();
  });

  it('rejects malformed login bodies', async () => {
    expect((await fetch(`${base}/api/login`, json('POST', { username: 'aaro' }))).status).toBe(400);
  });

  it('rate-limits repeated failures, even with the right password', async () => {
    for (let i = 0; i < 3; i++) expect((await login('aaro', 'wrong password!')).status).toBe(401);
    expect((await login('aaro')).status).toBe(429);
  });

  it('rate-limits per client IP from X-Forwarded-For set by a private-network proxy', async () => {
    const asClient = (ip: string, password: string) =>
      fetch(`${base}/api/login`, {
        ...json('POST', { username: 'aaro', password }),
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      });
    for (let i = 0; i < 3; i++) expect((await asClient('203.0.113.1', 'wrong password!')).status).toBe(401);
    expect((await asClient('203.0.113.1', PASSWORD)).status).toBe(429);
    // Another client behind the same proxy is not affected.
    expect((await asClient('203.0.113.2', PASSWORD)).status).toBe(200);
  });

  it('logs out by clearing the cookie', async () => {
    const cookie = cookieOf(await login('aaro'));
    const r = await fetch(`${base}/api/logout`, json('POST', {}, cookie));
    expect(r.status).toBe(204);
    expect(r.headers.get('set-cookie')).toMatch(/workh_session=;.*Expires=Thu, 01 Jan 1970/i);
  });
});

describe('sessions', () => {
  it('rejects requests without a session', async () => {
    expect((await fetch(`${base}/api/data`)).status).toBe(401);
    expect((await fetch(`${base}/api/session`)).status).toBe(401);
    expect((await fetch(`${base}/api/data`, json('PUT', defaultData()))).status).toBe(401);
    expect((await fetch(`${base}/api/account`, json('DELETE', { password: PASSWORD }))).status).toBe(401);
  });

  it('rejects forged or tampered cookies', async () => {
    const cookie = await newUser();
    const tampered = cookie.slice(0, -2) + (cookie.endsWith('A') ? 'BB' : 'AA');
    expect((await getData(tampered)).status).toBe(401);
    expect((await getData('workh_session=abc.def')).status).toBe(401);
  });

  it('rejects a cookie signed with another secret', async () => {
    const cookie = await newUser();
    await restart({ sessionSecret: 'other'.repeat(8) });
    expect((await getData(cookie)).status).toBe(401);
  });
});

describe('data API', () => {
  it('returns defaults, saves, and reads back', async () => {
    const cookie = await newUser();
    expect((await (await getData(cookie)).json()).settings.fullTimeWeekMinutes).toBe(2175);
    expect((await putData(cookie, withEntry(450))).status).toBe(200);
    expect((await (await getData(cookie)).json()).entries['2026-10-06']).toEqual({ mode: 'total', minutes: 450 });
  });

  it('keeps each user’s hours private', async () => {
    const alice = await newUser('alice');
    const bob = await newUser('bob');
    await putData(alice, withEntry(111));
    await putData(bob, withEntry(222));
    expect((await (await getData(alice)).json()).entries['2026-10-06'].minutes).toBe(111);
    expect((await (await getData(bob)).json()).entries['2026-10-06'].minutes).toBe(222);
  });

  it('rejects invalid shapes and malformed JSON', async () => {
    const cookie = await newUser();
    expect((await putData(cookie, { x: 1 })).status).toBe(400);
    const bad = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'If-Match': '"none"' },
      body: '{bad',
    });
    expect(bad.status).toBe(400);
    expect((await (await getData(cookie)).json()).entries).toEqual({});
  });

  it('rejects non-JSON writes (CSRF via HTML forms)', async () => {
    const cookie = await newUser();
    const form = await fetch(`${base}/api/data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: 'a=1',
    });
    expect(form.status).toBe(415);
    const del = await fetch(`${base}/api/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'text/plain', Cookie: cookie },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(del.status).toBe(415);
  });

  it('rejects oversized bodies', async () => {
    const cookie = await newUser();
    const huge = { ...defaultData(), padding: 'x'.repeat(2 * 1024 * 1024) };
    expect((await putData(cookie, huge)).status).toBe(413);
  });
});

describe('data versions (two tabs or devices)', () => {
  it('requires the version the client started from', async () => {
    const cookie = await newUser();
    const r = await fetch(`${base}/api/data`, json('PUT', defaultData(), cookie));
    expect(r.status).toBe(428);
  });

  it('refuses a save based on an old version and returns the current data', async () => {
    const cookie = await newUser();
    const startRev = (await getData(cookie)).headers.get('etag')!;
    const first = await putAt(cookie, withEntry(111), startRev); // tab A
    expect(first.status).toBe(200);
    const stale = await putAt(cookie, withEntry(222), startRev); // tab B, still on the old version
    expect(stale.status).toBe(412);
    expect((await stale.json()).entries['2026-10-06'].minutes).toBe(111);
    expect(stale.headers.get('etag')).toBe(first.headers.get('etag'));
    // Nothing was overwritten.
    expect((await (await getData(cookie)).json()).entries['2026-10-06'].minutes).toBe(111);
    // Retrying on top of the new version works.
    expect((await putAt(cookie, withEntry(222), stale.headers.get('etag')!)).status).toBe(200);
  });

  it('gives each saved version a new tag', async () => {
    const cookie = await newUser();
    const a = (await getData(cookie)).headers.get('etag');
    const b = (await putData(cookie, withEntry(1))).headers.get('etag');
    const c = (await putData(cookie, withEntry(2))).headers.get('etag');
    expect(new Set([a, b, c]).size).toBe(3);
    expect((await getData(cookie)).headers.get('etag')).toBe(c);
  });
});

describe('deleting an account', () => {
  it('requires the password', async () => {
    const cookie = await newUser();
    const r = await deleteAccount(cookie, 'wrong password!');
    expect(r.status).toBe(403);
    expect((await getData(cookie)).status).toBe(200);
  });

  it('rate-limits password guesses', async () => {
    const cookie = await newUser();
    for (let i = 0; i < 3; i++) expect((await deleteAccount(cookie, 'wrong password!')).status).toBe(403);
    expect((await deleteAccount(cookie)).status).toBe(429);
  });

  it('removes the account, its data and its sessions; the name becomes free', async () => {
    const cookie = await newUser('aaro');
    await putData(cookie, withEntry(450));
    const other = await newUser('other');
    await putData(other, withEntry(60));

    const r = await deleteAccount(cookie);
    expect(r.status).toBe(204);
    expect(r.headers.get('set-cookie')).toMatch(/workh_session=;/);

    expect((await getData(cookie)).status).toBe(401); // old cookie is dead
    expect((await login('aaro')).status).toBe(401);
    expect(fs.readdirSync(path.join(tmpDir, 'data', 'users'))).toHaveLength(1); // only "other" left
    expect((await getData(other)).status).toBe(200);

    const again = await newUser('aaro');
    expect((await (await getData(again)).json()).entries).toEqual({}); // fresh account, no old hours
  });
});
