import { expect, PASSWORD, test, track, uniqueName } from './fixtures';

// This server runs with REGISTRATION_CODE=let-me-in-please.
test.use({ baseURL: 'http://localhost:3101' });

test.describe('invite-only sign-up', () => {
  async function fillSignUp(page: import('@playwright/test').Page, code: string) {
    const username = uniqueName();
    track({ username, password: PASSWORD }, 'http://localhost:3101');
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByLabel('Invite code').fill(code);
    await page.getByRole('button', { name: 'Create account' }).click();
  }

  test('a wrong code is refused', async ({ page }) => {
    await fillSignUp(page, 'guess-the-code');
    await expect(page.getByRole('alert')).toHaveText('Invalid invite code');
  });

  test('the right code creates the account', async ({ page }) => {
    await fillSignUp(page, 'let-me-in-please');
    await expect(page.getByRole('heading', { name: /Week 41/ })).toBeVisible();
  });

  test('the API refuses sign-up without the code too', async ({ page }) => {
    const r = await page.request.post('/api/register', { data: { username: uniqueName(), password: PASSWORD } });
    expect(r.status()).toBe(403);
  });
});
