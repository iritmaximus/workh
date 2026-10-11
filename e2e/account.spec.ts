import type { Page } from '@playwright/test';
import {
  baseData,
  dayInput,
  expect,
  fetchData,
  MONDAY,
  newClient,
  registerViaApi,
  saved,
  seed,
  test,
} from './fixtures';

async function openDelete(page: Page) {
  await page.goto('/');
  await page.getByText('Account', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete account…' }).click();
}

test.describe('deleting an account', () => {
  test('cancel leaves everything in place', async ({ page, user }) => {
    await openDelete(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Delete account…' })).toBeVisible();
    expect((await page.request.get('/api/session')).status()).toBe(200);
    void user;
  });

  test('the delete button stays disabled until a password is typed', async ({ page, user }) => {
    await openDelete(page);
    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
    void user;
  });

  test('a wrong password deletes nothing', async ({ page, user }) => {
    await openDelete(page);
    await page.getByLabel('Enter your password to confirm').fill('wrong password');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong password');
    expect((await page.request.get('/api/session')).status()).toBe(200);
    void user;
  });

  test('deletes the login and the hours; the name can be reused from scratch', async ({ page, user }) => {
    await seed(page.request, baseData({ entries: { [MONDAY]: { mode: 'total', minutes: 435 } } }));
    await openDelete(page);
    await page.getByLabel('Enter your password to confirm').fill(user.password);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByText('Your account and all its data were deleted.')).toBeVisible();

    // The old password no longer logs in.
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong username or password');

    // Re-registering the name gives an empty account, not the old hours.
    await registerViaApi(page.request, user);
    expect((await fetchData(page.request)).entries).toEqual({});
  });

  test('another device logged into the deleted account is logged out', async ({ page, browser, user }) => {
    const other = await newClient(browser);
    await other.page.request.post('/api/login', { data: user });
    await other.page.goto('/');
    await expect(other.page.locator('.app-header')).toContainText(user.username);

    await openDelete(page);
    await page.getByLabel('Enter your password to confirm').fill(user.password);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByText('Your account and all its data were deleted.')).toBeVisible();

    // The other device notices on its next save…
    await dayInput(other.page, MONDAY).fill('7:15');
    await expect(other.page.getByText(/session expired/i)).toBeVisible();
    // …and nothing was written for the deleted account.
    await registerViaApi(page.request, user);
    expect((await fetchData(page.request)).entries).toEqual({});
    await other.context.close();
  });

  test('a change typed just before deleting is not saved afterwards', async ({ page, user }) => {
    await openDelete(page);
    await dayInput(page, MONDAY).fill('7:15');
    await page.getByLabel('Enter your password to confirm').fill(user.password);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByText('Your account and all its data were deleted.')).toBeVisible();
    await page.waitForTimeout(800);
    await registerViaApi(page.request, user);
    expect((await fetchData(page.request)).entries).toEqual({});
  });
});

test('saving shows progress and then "Saved ✓"', async ({ page, user }) => {
  await page.goto('/');
  await dayInput(page, MONDAY).fill('7:15');
  await saved(page);
  void user;
});
