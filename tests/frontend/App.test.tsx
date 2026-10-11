// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Data } from '../../shared/types';
import { App } from '../../frontend/App';
import { installFakeApi } from './fakeApi';

// Thursday of ISO week 41; the tracked week runs Mon 2026-10-05 – Sun 2026-10-11.
const NOW = new Date('2026-10-08T12:00:00');

const data = (): Data => ({
  settings: {
    fullTimeWeekMinutes: 2175,
    workdays: [1, 2, 3, 4, 5],
    trackingStart: '2026-10-05',
    openingBalanceMinutes: 0,
  },
  workloadPeriods: [{ from: '2026-01-01', percent: 100 }],
  entries: {
    '2026-10-05': { mode: 'total', minutes: 435 },
    '2026-10-06': { mode: 'total', minutes: 435 },
  },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function logIn(user = userEvent.setup(), password = 'secret password', username = 'aaro') {
  await user.type(await screen.findByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

const balanceCard = () => document.querySelector('section.balance') as HTMLElement;
const weekFooter = () => document.querySelector('.week-total') as HTMLElement;

describe('login', () => {
  it('shows the login form when there is no session', async () => {
    const { fetchMock } = installFakeApi({ data: data() });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/data', expect.anything());
  });

  it('shows an error for a wrong password and stays on the form', async () => {
    installFakeApi({ data: data() });
    render(<App />);
    await logIn(undefined, 'wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('loads the tracker after logging in', async () => {
    installFakeApi({ data: data() });
    render(<App />);
    await logIn();
    expect(await screen.findByRole('heading', { name: /Week 41/ })).toBeInTheDocument();
    expect(screen.getByText('aaro')).toBeInTheDocument();
  });

  it('skips the form with an existing session, and logs out', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: /Week 41/ });
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(state.session).toBeNull();
  });
});

describe('tracking hours', () => {
  it('shows the week totals and the running balance up to today', async () => {
    installFakeApi({ data: data(), loggedIn: true });
    render(<App />);
    await screen.findByRole('heading', { name: /Week 41/ });
    // Two 7:15 days logged; full-week target 36:15.
    expect(within(weekFooter()).getByText('14 h 30 min')).toBeInTheDocument();
    expect(within(weekFooter()).getByText('36 h 15 min')).toBeInTheDocument();
    // Balance counts Mon–Thu (today): Wed and Thu missing -> −14 h 30 min.
    expect(within(balanceCard()).getByText('−14 h 30 min')).toBeInTheDocument();
    expect(within(balanceCard()).getByText('hours short')).toBeInTheDocument();
  });

  it('updates totals as you type and saves to the server', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: /Week 41/ });

    await user.type(screen.getByLabelText('Hours worked on 2026-10-07'), '8:15');
    await user.type(screen.getByLabelText('Hours worked on 2026-10-08'), '7h15');

    expect(within(balanceCard()).getByText('+1 h 00 min')).toBeInTheDocument();
    expect(within(balanceCard()).getByText('extra hours banked')).toBeInTheDocument();
    await waitFor(() => expect(state.data.entries['2026-10-08']).toEqual({ mode: 'total', minutes: 435 }));
    expect(state.data.entries['2026-10-07']).toEqual({ mode: 'total', minutes: 495 });
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
  });

  it('marks invalid input without saving it', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText('Hours worked on 2026-10-07');
    await user.type(input, 'abc');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await new Promise((r) => setTimeout(r, 700));
    expect(state.saves).toHaveLength(0);
  });

  it('counts start–end ranges minus the break', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: /Week 41/ });

    const wed = screen.getByRole('group', { name: 'Input mode for 2026-10-07' });
    await user.click(within(wed).getByRole('button', { name: 'Start–End' }));
    const row = wed.closest('.day') as HTMLElement;
    await user.type(within(row).getByLabelText('Start'), '08:00');
    await user.type(within(row).getByLabelText('End'), '16:00');

    expect(within(row).getByText('7:30')).toBeInTheDocument(); // 8 h − 30 min default break
    await waitFor(() =>
      expect(state.data.entries['2026-10-07']).toEqual({ mode: 'range', start: '08:00', end: '16:00', breakMin: 30 }),
    );
  });

  it('gives an off day no target', async () => {
    installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    const wed = await screen.findByRole('group', { name: 'Input mode for 2026-10-07' });
    await user.click(within(wed).getByRole('button', { name: 'Off' }));
    expect(within(weekFooter()).getByText('29 h 00 min')).toBeInTheDocument();
  });
});

describe('expired session', () => {
  it('asks to log in again and then saves the pending change', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: /Week 41/ });

    state.expireSession = true;
    await user.type(screen.getByLabelText('Hours worked on 2026-10-07'), '6');

    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(state.data.entries['2026-10-07']).toBeUndefined();

    await logIn(user);
    await waitFor(() => expect(state.data.entries['2026-10-07']).toEqual({ mode: 'total', minutes: 360 }));
  });
});

describe('creating an account', () => {
  async function openSignUp(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
  }

  it('signs up and lands in an empty tracker', async () => {
    const { state } = installFakeApi({ data: data() });
    const user = userEvent.setup();
    render(<App />);
    await openSignUp(user);
    await user.type(screen.getByLabelText('Username'), 'newbie');
    await user.type(screen.getByLabelText('Password'), 'long enough password');
    await user.type(screen.getByLabelText('Repeat password'), 'long enough password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: /Week 41/ })).toBeInTheDocument();
    expect(screen.getByText('newbie')).toBeInTheDocument();
    expect(within(weekFooter()).getByText('0 h 00 min')).toBeInTheDocument();
    expect(state.users.has('newbie')).toBe(true);
  });

  it('checks the password length and confirmation before sending', async () => {
    const { fetchMock } = installFakeApi({ data: data() });
    const user = userEvent.setup();
    render(<App />);
    await openSignUp(user);
    await user.type(screen.getByLabelText('Username'), 'newbie');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Repeat password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 12 characters');

    await user.type(screen.getByLabelText('Password'), 'long enough password');
    await user.type(screen.getByLabelText('Repeat password'), 'a different password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/register', expect.anything());
  });

  it('shows the server error for a taken username', async () => {
    installFakeApi({ data: data() });
    const user = userEvent.setup();
    render(<App />);
    await openSignUp(user);
    await user.type(screen.getByLabelText('Username'), 'aaro');
    await user.type(screen.getByLabelText('Password'), 'long enough password');
    await user.type(screen.getByLabelText('Repeat password'), 'long enough password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That username is taken');
  });

  it('asks for an invite code when the server requires one', async () => {
    installFakeApi({ data: data(), registration: { open: true, inviteRequired: true } });
    const user = userEvent.setup();
    render(<App />);
    await openSignUp(user);
    expect(screen.getByLabelText('Invite code')).toBeRequired();
  });

  it('hides sign-up when registration is closed', async () => {
    installFakeApi({ data: data(), registration: { open: false, inviteRequired: false } });
    render(<App />);
    await screen.findByRole('button', { name: 'Log in' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create an account' })).toBeNull());
  });
});

describe('deleting an account', () => {
  async function openDelete(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { name: /Week 41/ });
    await user.click(screen.getByText('Account'));
    await user.click(screen.getByRole('button', { name: 'Delete account…' }));
  }

  it('can be cancelled', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    await openDelete(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete account…' })).toBeInTheDocument();
    expect(state.users.has('aaro')).toBe(true);
  });

  it('needs the right password, then deletes and returns to the login screen', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    await openDelete(user);

    const deleteButton = screen.getByRole('button', { name: 'Delete my account' });
    expect(deleteButton).toBeDisabled();
    await user.type(screen.getByLabelText('Enter your password to confirm'), 'wrong');
    await user.click(deleteButton);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password');
    expect(state.users.has('aaro')).toBe(true);

    await user.type(screen.getByLabelText('Enter your password to confirm'), 'secret password');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('Your account and all its data were deleted.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(state.users.has('aaro')).toBe(false);
  });

  it('drops a not-yet-saved change instead of writing it after deletion', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    const user = userEvent.setup();
    render(<App />);
    await openDelete(user);
    // Type a change, then delete before the 500 ms save debounce fires.
    await user.type(screen.getByLabelText('Hours worked on 2026-10-07'), '6');
    await user.type(screen.getByLabelText('Enter your password to confirm'), 'secret password');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await screen.findByText('Your account and all its data were deleted.');
    await new Promise((r) => setTimeout(r, 700));
    expect(state.saves).toHaveLength(0);
  });
});

describe('expired session with another user', () => {
  it('never saves one user’s pending change into another account', async () => {
    const { state } = installFakeApi({ data: data(), loggedIn: true });
    state.users.set('other', { password: 'other password!', data: data() });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: /Week 41/ });

    state.expireSession = true;
    await user.type(screen.getByLabelText('Hours worked on 2026-10-07'), '6');
    await screen.findByText(/session expired/i);

    await logIn(user, 'other password!', 'other');
    await screen.findByText('other');
    await new Promise((r) => setTimeout(r, 700));
    expect(state.saves.filter((s) => s.username === 'other')).toHaveLength(0);
    expect(state.users.get('other')!.data.entries['2026-10-07']).toBeUndefined();
  });
});
