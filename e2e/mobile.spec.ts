import type { Page } from '@playwright/test';
import { dayInput, expect, MONDAY, saved, test } from './fixtures';

async function expectNoSideways(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('on a phone @mobile', () => {
  test('the login screen fits the width', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expectNoSideways(page);
  });

  test('the tracker fits the width and hours can be entered', async ({ page, user }) => {
    await page.goto('/');
    await expectNoSideways(page);
    await dayInput(page, MONDAY).tap();
    await dayInput(page, MONDAY).fill('7:15');
    await saved(page);
    await page.getByText('Settings', { exact: true }).tap();
    await expectNoSideways(page);
    void user;
  });
});
