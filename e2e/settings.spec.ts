import type { Page } from '@playwright/test';
import { balanceCard, baseData, dayRow, expect, fetchData, MONDAY, saved, seed, test, weekFooter } from './fixtures';

async function openSettings(page: Page) {
  await page.getByText('Settings', { exact: true }).click();
}

test.describe('workload periods', () => {
  test('a 50% period from Wednesday halves the target from that day on', async ({ page, user }) => {
    // Seeded: a new account's defaults follow the server's real clock, not the frozen one.
    await seed(page.request, baseData());
    await page.goto('/');
    await openSettings(page);
    await page.getByRole('button', { name: '+ Add period' }).click(); // starts today at 50%
    const periods = page.locator('.periods li');
    await expect(periods).toHaveCount(2);
    await periods.nth(1).locator('input[type=date]').fill('2026-10-07');

    // Mon, Tue 7:15; Wed–Fri 3:37.5
    await expect(dayRow(page, MONDAY).locator('.day-figures')).toContainText('/ 7:15');
    await expect(dayRow(page, '2026-10-07').locator('.day-figures')).toContainText('/ 3:38');
    await expect(weekFooter(page)).toContainText('Target25 h 23 min'); // 14:30 + 10:52.5, rounded
    await saved(page);
    expect((await fetchData(page.request)).workloadPeriods).toEqual([
      { from: '2026-01-01', percent: 100 },
      { from: '2026-10-07', percent: 50 },
    ]);
    void user;
  });

  test('25% gives 9:04 a week and the period list shows it', async ({ page, user }) => {
    await seed(page.request, baseData({ workloadPeriods: [{ from: '2026-01-01', percent: 25 }] }));
    await page.goto('/');
    await expect(weekFooter(page)).toContainText('Target9 h 04 min');
    await openSettings(page);
    await expect(page.locator('.periods li')).toContainText('= 9:04 h/week');
    void user;
  });

  test('percentages outside 0–100 are clamped', async ({ page, user }) => {
    await page.goto('/');
    await openSettings(page);
    const pct = page.locator('.periods li input[type=number]');
    await pct.fill('250');
    await expect(pct).toHaveValue('100');
    await pct.fill('-5');
    await expect(pct).toHaveValue('0');
    void user;
  });

  test('with every period removed the target falls back to 100%', async ({ page, user }) => {
    await page.goto('/');
    await openSettings(page);
    await page.locator('.periods li').getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('.periods li')).toHaveCount(0);
    await expect(weekFooter(page)).toContainText('Target36 h 15 min');
    void user;
  });
});

test.describe('other settings', () => {
  test('a different full-time week changes every daily target', async ({ page, user }) => {
    await page.goto('/');
    await openSettings(page);
    const input = page.locator('.settings-grid label').filter({ hasText: 'Full-time week' }).locator('input');
    await input.fill('37:30');
    await expect(weekFooter(page)).toContainText('Target37 h 30 min');
    await expect(dayRow(page, MONDAY).locator('.day-figures')).toContainText('/ 7:30');
    void user;
  });

  test('a four-day week spreads the same hours over four days', async ({ page, user }) => {
    await page.goto('/');
    await openSettings(page);
    await page.getByRole('checkbox', { name: 'Fri' }).uncheck();
    await expect(weekFooter(page)).toContainText('Target36 h 15 min');
    await expect(dayRow(page, MONDAY).locator('.day-figures')).toContainText('/ 9:04');
    await expect(dayRow(page, '2026-10-09').locator('.day-figures')).toContainText('/ 0:00');
    void user;
  });

  test('the last working day cannot be unchecked', async ({ page, user }) => {
    await seed(page.request, baseData({ settings: { ...baseData().settings, workdays: [1] } }));
    await page.goto('/');
    await openSettings(page);
    await page.getByRole('checkbox', { name: 'Mon' }).click();
    await expect(page.getByRole('checkbox', { name: 'Mon' })).toBeChecked();
    void user;
  });

  test('a negative opening balance carries into the balance', async ({ page, user }) => {
    await seed(page.request, baseData()); // tracking from MONDAY, not the server's current week
    await page.goto('/');
    await openSettings(page);
    await page.getByPlaceholder('e.g. -2:30').fill('-2:30');
    // Mon–Thu nothing logged (−29 h) plus −2:30
    await expect(balanceCard(page)).toContainText('−31 h 30 min');
    void user;
  });

  test('moving the tracking start changes what the balance counts', async ({ page, user }) => {
    await page.goto('/');
    await openSettings(page);
    await page
      .locator('.settings-grid label')
      .filter({ hasText: 'Tracking start' })
      .locator('input')
      .fill('2026-10-08');
    await expect(balanceCard(page)).toContainText('−7 h 15 min'); // only today
    await saved(page);
    expect((await fetchData(page.request)).settings.trackingStart).toBe('2026-10-08');
    void user;
  });
});
