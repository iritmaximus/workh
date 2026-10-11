import { useState, type FormEvent } from 'react';
import { api, UnauthorizedError } from '../api';

interface Props {
  username: string;
  onDeleted: () => void;
  onUnauthorized: () => void;
}

/** Account card with a two-step, password-confirmed "delete account". */
export function Account({ username, onDeleted, onUnauthorized }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      onDeleted();
    } catch (err) {
      if (err instanceof UnauthorizedError) return onUnauthorized();
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card account">
      <summary>
        <h2>Account</h2>
        <span className="muted">Logged in as {username}</span>
      </summary>

      {!confirming ? (
        <button type="button" className="danger-outline" onClick={() => setConfirming(true)}>
          Delete account…
        </button>
      ) : (
        <form className="danger-zone" onSubmit={remove}>
          <p>
            This permanently deletes the account <strong>{username}</strong> and all logged hours. It cannot be undone.
          </p>
          <label>
            Enter your password to confirm
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
          {error && (
            <p className="neg" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="submit" className="danger" disabled={busy || !password}>
              {busy ? 'Deleting…' : 'Delete my account'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setPassword('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </details>
  );
}
