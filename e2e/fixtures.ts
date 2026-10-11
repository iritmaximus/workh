import { test as base, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type { Data } from '../shared/types';

/** Thursday of ISO week 41 (Mon 5 Oct – Sun 11 Oct 2026), midday local time. */
export const NOW = new Date('2026-10-08T12:00:00');
export const MONDAY = '2026-10-05';
export const PASSWORD = 'correct horse battery';

export interface Creds {
  username: string;
  password: string;
}

let counter = 0;
/** Unique, valid username (3–32 chars, lowercase). Parallel workers never collide. */
export function uniqueName(prefix = 'u'): string {
  return `${prefix}${process.pid.toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Accounts created by the running test; deleted afterwards so the servers never reach
// their account limit (MAX_USERS), however often the suite runs.
const created: { creds: Creds; baseURL: string }[] = [];

/** Remember an account created through the UI so it gets cleaned up too. */
export function track(creds: Creds, baseURL = 'http://localhost:3100') {
  created.push({ creds, baseURL });
}

export async function registerViaApi(request: APIRequestContext, creds: Creds) {
  const r = await request.post('/api/register', { data: creds });
  expect(r.status(), await r.text()).toBe(201);
  track(creds, new URL(r.url()).origin);
}

// Plain fetch, not a Playwright request context: this runs during teardown, outside the
// test's trace recording.
async function deleteCreated() {
  for (const { creds, baseURL } of created.splice(0)) {
    const headers = { 'Content-Type': 'application/json' };
    const login = await fetch(`${baseURL}/api/login`, { method: 'POST', headers, body: JSON.stringify(creds) });
    if (!login.ok) continue; // already deleted by the test, or never finished signing up
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    await fetch(`${baseURL}/api/account`, {
      method: 'DELETE',
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ password: creds.password }),
    });
  }
}

/** Replace the logged-in user's data — test setup without clicking through every field. */
export async function seed(request: APIRequestContext, data: Data) {
  const etag = (await request.get('/api/data')).headers()['etag'];
  const r = await request.put('/api/data', { data, headers: { 'If-Match': etag } });
  expect(r.status(), await r.text()).toBe(200);
}

export function baseData(overrides: Partial<Data> = {}): Data {
  return {
    settings: { fullTimeWeekMinutes: 2175, workdays: [1, 2, 3, 4, 5], trackingStart: MONDAY, openingBalanceMinutes: 0 },
    workloadPeriods: [{ from: '2026-01-01', percent: 100 }],
    entries: {},
    ...overrides,
  };
}

/** New browser context = a different device/person, with its own frozen clock. */
export async function newClient(browser: Browser, baseURL = 'http://localhost:3100') {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  return { context, page };
}

// ---------- Page helpers ----------

export const dayInput = (page: Page, date: string) => page.getByLabel(`Hours worked on ${date}`);
export const dayRow = (page: Page, date: string) =>
  page.locator('.day').filter({ has: page.getByRole('group', { name: `Input mode for ${date}` }) });
export const weekFooter = (page: Page) => page.locator('.week-total');
export const balanceCard = (page: Page) => page.locator('section.balance');
export const saved = (page: Page) => expect(page.getByText('Saved ✓')).toBeVisible();

export async function fetchData(request: APIRequestContext): Promise<Data> {
  const r = await request.get('/api/data');
  expect(r.status()).toBe(200);
  return (await r.json()) as Data;
}

// ---------- Fixtures ----------

export const test = base.extend<{ user: Creds; cleanup: void }>({
  cleanup: [
    async ({}, use) => {
      await use();
      await deleteCreated();
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(NOW);
    await use(page);
  },
  /** A freshly registered user whose session cookie is already in the page's context. */
  user: async ({ page }, use) => {
    const creds = { username: uniqueName(), password: PASSWORD };
    await registerViaApi(page.request, creds);
    await use(creds);
  },
});

export { expect };
