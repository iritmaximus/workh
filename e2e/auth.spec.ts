import {
  baseData,
  dayInput,
  expect,
  fetchData,
  MONDAY,
  newClient,
  PASSWORD,
  registerViaApi,
  track,
  saved,
  seed,
  test,
  uniqueName,
} from './fixtures';

test.describe('sign up', () => {
  test('creates an account through the form and lands in an empty tracker', async ({ page }) => {
    const username = uniqueName();
    track({ username, password: PASSWORD });
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: /Week 41/ })).toBeVisible();
    await expect(page.locator('.app-header')).toContainText(username);
    await expect(page.locator('.week-total')).toContainText('0 h 00 min');
  });

  test('stores mixed-case usernames lowercase, and both spellings log in', async ({ page }) => {
    const username = uniqueName('Mixed');
    await registerViaApi(page.request, { username, password: PASSWORD });
    await page.request.post('/api/logout', { data: {} });

    await page.goto('/');
    await page.getByLabel('Username').fill(username.toUpperCase());
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('.app-header')).toContainText(username.toLowerCase());
  });

  test('refuses a taken username without logging into the existing account', async ({ page, user }) => {
    await page.request.post('/api/logout', { data: {} });
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password', { exact: true }).fill('some other password');
    await page.getByLabel('Repeat password').fill('some other password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toHaveText('That username is taken');
    expect((await page.request.get('/api/session')).status()).toBe(401);
  });

  test('blocks a username with spaces in the browser before it reaches the server', async ({ page }) => {
    const registerCalls: string[] = [];
    page.on('request', (r) => r.url().endsWith('/api/register') && registerCalls.push(r.url()));
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Username').fill('has space');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    expect(await page.getByLabel('Username').evaluate((el: HTMLInputElement) => el.validity.patternMismatch)).toBe(
      true,
    );
    expect(registerCalls).toEqual([]);
  });

  test('a password typo in the repeat field is caught', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Username').fill(uniqueName());
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Repeat password').fill(PASSWORD + 'x');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toHaveText('Passwords do not match');
  });
});

test.describe('log in / log out', () => {
  test('a session survives a reload; logging out survives a reload too', async ({ page, user }) => {
    await page.goto('/');
    await expect(page.locator('.app-header')).toContainText(user.username);
    await page.reload();
    await expect(page.locator('.app-header')).toContainText(user.username);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect((await page.request.get('/api/data')).status()).toBe(401);
  });

  test('a wrong password shows an error and clears only the password field', async ({ page, user }) => {
    await page.request.post('/api/logout', { data: {} });
    await page.goto('/');
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill('not my password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong username or password');
    await expect(page.getByLabel('Username')).toHaveValue(user.username);
    await expect(page.getByLabel('Password')).toHaveValue('');
  });

  test('logging out right after typing still saves the change', async ({ page, user }) => {
    await page.goto('/');
    await dayInput(page, MONDAY).fill('7:15');
    // Within the 500 ms save debounce:
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

    await page.request.post('/api/login', { data: user });
    expect((await fetchData(page.request)).entries[MONDAY]).toEqual({ mode: 'total', minutes: 435 });
  });
});

test.describe('expired session', () => {
  test('asks to log in again and then saves the change made meanwhile', async ({ page, context, user }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Week 41/ })).toBeVisible();
    await context.clearCookies(); // the session is gone, the page doesn't know yet

    await dayInput(page, MONDAY).fill('6:00');
    await expect(page.getByText(/session expired/i)).toBeVisible();
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('heading', { name: /Week 41/ })).toBeVisible();
    await saved(page);
    expect((await fetchData(page.request)).entries[MONDAY]).toEqual({ mode: 'total', minutes: 360 });
  });
});

test.describe('several users and devices', () => {
  test('users never see each other’s hours', async ({ browser }) => {
    const alice = await newClient(browser);
    const bob = await newClient(browser);
    await registerViaApi(alice.page.request, { username: uniqueName('alice'), password: PASSWORD });
    await registerViaApi(bob.page.request, { username: uniqueName('bob'), password: PASSWORD });
    await seed(alice.page.request, baseData({ entries: { [MONDAY]: { mode: 'total', minutes: 600 } } }));

    await bob.page.goto('/');
    await expect(dayInput(bob.page, MONDAY)).toHaveValue('');
    await expect(bob.page.locator('.week-total')).toContainText('0 h 00 min');

    await alice.page.goto('/');
    await expect(dayInput(alice.page, MONDAY)).toHaveValue('10:00');
    await alice.context.close();
    await bob.context.close();
  });

  // Question: what happens with two devices open at once (phone + laptop)? Each save sends
  // the whole document, so a device with an old copy must not wipe the other's changes.
  test('two tabs editing different days keep both changes', async ({ page, context, user }) => {
    const tabA = page;
    const tabB = await context.newPage();
    await tabB.clock.setFixedTime(new Date('2026-10-08T12:00:00'));
    await tabA.goto('/');
    await tabB.goto('/');
    await expect(dayInput(tabB, MONDAY)).toBeVisible();

    await dayInput(tabA, MONDAY).fill('8:00');
    await saved(tabA);
    await dayInput(tabB, '2026-10-06').fill('7:00'); // tab B still has the old copy
    await saved(tabB);

    const data = await fetchData(page.request);
    expect(data.entries[MONDAY]).toEqual({ mode: 'total', minutes: 480 });
    expect(data.entries['2026-10-06']).toEqual({ mode: 'total', minutes: 420 });
    // Tab B now also shows tab A's Monday.
    await expect(dayInput(tabB, MONDAY)).toHaveValue('8:00');
    void user;
  });
});
