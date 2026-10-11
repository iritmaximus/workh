import {
  balanceCard,
  baseData,
  dayInput,
  dayRow,
  expect,
  fetchData,
  MONDAY,
  saved,
  seed,
  test,
  weekFooter,
} from './fixtures';

const TUE = '2026-10-06';
const WED = '2026-10-07';
const THU = '2026-10-08'; // "today"
const FRI = '2026-10-09';
const WEEKDAYS = [MONDAY, TUE, WED, THU, FRI];

test.describe('entering total hours', () => {
  test('a full 7:15 week is exactly on target, and survives a reload', async ({ page, user }) => {
    await page.goto('/');
    for (const d of WEEKDAYS) await dayInput(page, d).fill('7:15');
    await expect(weekFooter(page)).toContainText('Worked36 h 15 min');
    await expect(weekFooter(page)).toContainText('Target36 h 15 min');
    await expect(weekFooter(page)).toContainText('0 h 00 min — on target');
    await saved(page);

    await page.reload();
    for (const d of WEEKDAYS) await expect(dayInput(page, d)).toHaveValue('7:15');
    void user;
  });

  for (const [typed, minutes] of [
    ['7.5', 450],
    ['7,5', 450],
    ['7:30', 450],
    ['7h30', 450],
    ['7h 30min', 450],
    ['450m', 450],
    ['8', 480],
  ] as const) {
    test(`understands "${typed}"`, async ({ page, user }) => {
      await page.goto('/');
      const input = dayInput(page, MONDAY);
      await input.fill(typed);
      await input.blur();
      await expect(input).toHaveValue(`${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`);
      await saved(page);
      expect((await fetchData(page.request)).entries[MONDAY]).toEqual({ mode: 'total', minutes });
      void user;
    });
  }

  // Question: a single day can't be negative or longer than a day. Before this test the app
  // accepted "-2" (subtracting hours) and "30" for one day.
  for (const typed of ['-2', '25', '30:00', 'abc', '7:75']) {
    test(`rejects "${typed}" for a day and saves nothing`, async ({ page, user }) => {
      await page.goto('/');
      const input = dayInput(page, MONDAY);
      await input.fill(typed);
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(weekFooter(page)).toContainText('Worked0 h 00 min');
      await page.waitForTimeout(800); // longer than the save debounce
      expect((await fetchData(page.request)).entries[MONDAY]).toBeUndefined();
      void user;
    });
  }

  test('clearing a day removes it', async ({ page, user }) => {
    await seed(page.request, baseData({ entries: { [MONDAY]: { mode: 'total', minutes: 435 } } }));
    await page.goto('/');
    await dayInput(page, MONDAY).fill('');
    await saved(page);
    expect((await fetchData(page.request)).entries[MONDAY]).toBeUndefined();
    void user;
  });

  // Question: the save waits 500 ms after typing. Is a change lost if the tab is closed sooner?
  test('a change is saved even when the page is reloaded immediately', async ({ page, user }) => {
    await page.goto('/');
    await dayInput(page, MONDAY).fill('6:45');
    await page.reload();
    await expect(dayInput(page, MONDAY)).toHaveValue('6:45');
    void user;
  });
});

test.describe('start–end ranges', () => {
  async function setRange(
    page: import('@playwright/test').Page,
    date: string,
    start: string,
    end: string,
    br?: string,
  ) {
    const row = dayRow(page, date);
    await row.getByRole('button', { name: 'Start–End' }).click();
    await row.getByLabel('Start').fill(start);
    await row.getByLabel('End').fill(end);
    if (br !== undefined) await row.getByRole('spinbutton').fill(br);
    return row;
  }

  test('subtracts the default 30 min break', async ({ page, user }) => {
    await page.goto('/');
    const row = await setRange(page, MONDAY, '08:00', '16:00');
    await expect(row.locator('.day-figures')).toContainText('7:30');
    await saved(page);
    expect((await fetchData(page.request)).entries[MONDAY]).toEqual({
      mode: 'range',
      start: '08:00',
      end: '16:00',
      breakMin: 30,
    });
    void user;
  });

  test('handles a shift past midnight', async ({ page, user }) => {
    await page.goto('/');
    const row = await setRange(page, MONDAY, '22:00', '06:00', '0');
    await expect(row.locator('.day-figures')).toContainText('8:00');
    void user;
  });

  test('a break longer than the shift gives zero, not negative hours', async ({ page, user }) => {
    await page.goto('/');
    const row = await setRange(page, MONDAY, '09:00', '10:00', '90');
    await expect(row.locator('.day-figures')).toContainText('0:00');
    void user;
  });

  test('only a start time counts as nothing yet', async ({ page, user }) => {
    await page.goto('/');
    const row = dayRow(page, MONDAY);
    await row.getByRole('button', { name: 'Start–End' }).click();
    await row.getByLabel('Start').fill('08:00');
    await expect(row.locator('.day-figures')).toContainText('0:00');
    void user;
  });
});

test.describe('off days', () => {
  test('an off day drops out of the target and keeps its note', async ({ page, user }) => {
    await page.goto('/');
    const row = dayRow(page, WED);
    await row.getByRole('button', { name: 'Off' }).click();
    await row.getByPlaceholder('Vacation, sick, holiday…').fill('Vacation');
    await expect(weekFooter(page)).toContainText('Target29 h 00 min');
    await saved(page);
    await page.reload();
    await expect(dayRow(page, WED).getByPlaceholder('Vacation, sick, holiday…')).toHaveValue('Vacation');
    void user;
  });
});

test.describe('week view and balance', () => {
  test('the week number and dates are right, including around New Year', async ({ page, user }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2, name: /Week/ })).toHaveText('Week 41 5 Oct – 11 Oct 2026');
    const next = page.getByRole('button', { name: 'Next week' });
    for (let i = 0; i < 12; i++) await next.click();
    // 2026 has 53 ISO weeks; this one contains 1 Jan 2027.
    await expect(page.getByRole('heading', { level: 2, name: /Week/ })).toHaveText('Week 53 28 Dec – 3 Jan 2027');
    await next.click();
    await expect(page.getByRole('heading', { level: 2, name: /Week/ })).toHaveText('Week 1 4 Jan – 10 Jan 2027');
    await page.getByRole('button', { name: 'This week' }).click();
    await expect(page.getByRole('heading', { level: 2, name: /Week 41/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'This week' })).toHaveCount(0);
    void user;
  });

  test('today is highlighted', async ({ page, user }) => {
    await page.goto('/');
    await expect(page.locator('.day.today')).toHaveCount(1);
    await expect(page.locator('.day.today')).toContainText('Thu');
    void user;
  });

  test('the balance counts up to today only; future days in the week do not count yet', async ({ page, user }) => {
    await seed(
      page.request,
      baseData({
        entries: {
          [MONDAY]: { mode: 'total', minutes: 435 },
          [TUE]: { mode: 'total', minutes: 435 },
          [WED]: { mode: 'total', minutes: 435 },
          [THU]: { mode: 'total', minutes: 495 }, // +1 h today
          [FRI]: { mode: 'total', minutes: 600 }, // tomorrow, already logged
        },
      }),
    );
    await page.goto('/');
    await expect(balanceCard(page)).toContainText('+1 h 00 min');
    // The week view, by contrast, shows the whole week.
    await expect(weekFooter(page)).toContainText('+3 h 45 min over');
    void user;
  });

  test('hours before the tracking start date are ignored by the balance', async ({ page, user }) => {
    await seed(
      page.request,
      baseData({
        settings: { ...baseData().settings, trackingStart: WED },
        entries: { [MONDAY]: { mode: 'total', minutes: 600 }, [WED]: { mode: 'total', minutes: 435 } },
      }),
    );
    await page.goto('/');
    // Wed logged 7:15, Thu (today) nothing -> −7:15. Monday's 10 h must not count.
    await expect(balanceCard(page)).toContainText('−7 h 15 min');
    void user;
  });

  test('the history adds up week by week and links to each week', async ({ page, user }) => {
    await seed(
      page.request,
      baseData({
        settings: { ...baseData().settings, trackingStart: '2026-09-28' },
        entries: Object.fromEntries(
          ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) => [
            d,
            { mode: 'total' as const, minutes: 495 },
          ]),
        ),
      }),
    );
    await page.goto('/');
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2);
    // Newest first. Week 40: +5 h. Week 41 Mon–Thu: nothing logged -> −29 h.
    await expect(rows.nth(1)).toContainText('+5 h 00 min');
    await expect(rows.nth(0)).toContainText('−29 h 00 min');
    await expect(rows.nth(0)).toContainText('−24 h 00 min');
    await expect(balanceCard(page)).toContainText('−24 h 00 min');

    await rows.nth(1).click();
    await expect(page.getByRole('heading', { level: 2, name: /Week 40/ })).toBeVisible();
    await expect(dayInput(page, '2026-09-28')).toHaveValue('8:15');
    void user;
  });
});

test.describe('time zones', () => {
  // Question: "today" comes from the browser clock. Just after midnight on a Monday, is it
  // already the new week — in a time zone far from the server's?
  test.use({ timezoneId: 'Pacific/Auckland' });

  test('just after midnight on Monday is already the new week', async ({ page, user }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T00:30:00+13:00'));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2, name: /Week/ })).toHaveText('Week 42 12 Oct – 18 Oct 2026');
    await expect(page.locator('.day.today')).toContainText('Mon');
    void user;
  });
});
