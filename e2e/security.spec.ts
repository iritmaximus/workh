import { request as apiRequest } from '@playwright/test';
import { baseData, dayRow, expect, MONDAY, seed, test } from './fixtures';

test.describe('session cookie', () => {
  test('is HttpOnly, Secure and SameSite=Strict, and invisible to page scripts', async ({ page, context, user }) => {
    await page.goto('/');
    const cookie = (await context.cookies()).find((c) => c.name === 'workh_session');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
    // Expires in ~30 days (a persistent cookie, not a browser-session one).
    const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    expect(await page.evaluate(() => document.cookie)).not.toContain('workh_session');
    void user;
  });
});

test.describe('API without a session', () => {
  test('refuses every private endpoint', async ({ baseURL }) => {
    const anon = await apiRequest.newContext({ baseURL });
    expect((await anon.get('/api/data')).status()).toBe(401);
    expect((await anon.put('/api/data', { data: baseData() })).status()).toBe(401);
    expect((await anon.get('/api/session')).status()).toBe(401);
    expect((await anon.delete('/api/account', { data: { password: 'x' } })).status()).toBe(401);
    await anon.dispose();
  });
});

test.describe('content', () => {
  test('HTML typed into a note is shown as text, never run', async ({ page, user }) => {
    const payload = '<img src=x onerror="window.xssRan=1">';
    await seed(page.request, baseData({ entries: { [MONDAY]: { mode: 'off', note: payload } } }));
    await page.goto('/');
    await expect(dayRow(page, MONDAY).getByPlaceholder('Vacation, sick, holiday…')).toHaveValue(payload);
    expect(await page.evaluate(() => (window as unknown as { xssRan?: number }).xssRan)).toBeUndefined();
    void user;
  });

  test('the page runs without console errors or CSP violations', async ({ page, user }) => {
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto('/');
    await page.getByText('Settings', { exact: true }).click();
    await page.getByText('Account', { exact: true }).click();
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByRole('heading', { level: 2, name: /Week 42/ })).toBeVisible();
    expect(problems).toEqual([]);
    void user;
  });

  test('the login page also loads cleanly under the CSP', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
