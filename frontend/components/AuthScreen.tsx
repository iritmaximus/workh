import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

interface Props {
  notice?: string;
  onLogin: (username: string) => void;
}

const MIN_PASSWORD = 12;

/** Log in, or create a new account. */
export function AuthScreen({ notice, onLogin }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [registration, setRegistration] = useState<{ open: boolean; inviteRequired: boolean } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .registration()
      .then(setRegistration)
      .catch(() => setRegistration({ open: false, inviteRequired: false }));
  }, []);

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError(null);
    setPassword('');
    setRepeat('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'register') {
      if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters`);
      if (password !== repeat) return setError('Passwords do not match');
    }
    setBusy(true);
    try {
      const { username: user } =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password, registration?.inviteRequired ? inviteCode : undefined);
      onLogin(user);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
      setRepeat('');
    } finally {
      setBusy(false);
    }
  }

  const registering = mode === 'register';

  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <h1>Working hours</h1>
        {notice && <p className="muted">{notice}</p>}
        <h2>{registering ? 'Create account' : 'Log in'}</h2>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            {...(registering
              ? {
                  minLength: 3,
                  maxLength: 32,
                  pattern: '[A-Za-z0-9][A-Za-z0-9._\\-]{2,31}',
                  'aria-describedby': 'username-hint',
                }
              : {})}
          />
        </label>
        {registering && (
          <span id="username-hint" className="muted small hint">
            3–32 letters, numbers, dots, dashes or underscores
          </span>
        )}
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-describedby={registering ? 'password-hint' : undefined}
          />
        </label>
        {registering && (
          <span id="password-hint" className="muted small hint">
            At least {MIN_PASSWORD} characters
          </span>
        )}
        {registering && (
          <label>
            Repeat password
            <input
              name="repeat"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </label>
        )}
        {registering && registration?.inviteRequired && (
          <label>
            Invite code
            <input name="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
          </label>
        )}
        {error && (
          <p className="neg" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {registering ? (busy ? 'Creating account…' : 'Create account') : busy ? 'Logging in…' : 'Log in'}
        </button>
        {registering ? (
          <p className="muted small">
            Already have an account?{' '}
            <button type="button" className="link" onClick={() => switchMode('login')}>
              Log in
            </button>
          </p>
        ) : (
          registration?.open && (
            <p className="muted small">
              New here?{' '}
              <button type="button" className="link" onClick={() => switchMode('register')}>
                Create an account
              </button>
            </p>
          )
        )}
      </form>
    </main>
  );
}
