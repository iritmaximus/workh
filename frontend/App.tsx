import { useEffect, useRef, useState } from 'react';
import type { Data, Entry } from '../shared/types';
import { api, UnauthorizedError, type Versioned } from './api';
import { history, mondayOf, todayISO } from './calc';
import { mergeData } from './merge';
import { Account } from './components/Account';
import { AuthScreen } from './components/AuthScreen';
import { BalanceCard } from './components/BalanceCard';
import { HistoryTable } from './components/HistoryTable';
import { Settings } from './components/Settings';
import { WeekView } from './components/WeekView';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 500;

type Auth =
  | { state: 'checking' }
  | { state: 'out'; notice?: string }
  | { state: 'in'; username: string; recovered: Unsaved | null };

/** Edits that could not be saved, plus the server version they were made on. */
interface Unsaved {
  base: Data;
  mine: Data;
}

/** Login gate: shows the login form until the server confirms a session. */
export function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'checking' });
  // Changes that could not be saved because the session expired; saved after the *same*
  // user logs in again (never into someone else's account).
  const unsaved = useRef<{ username: string; edits: Unsaved } | null>(null);

  useEffect(() => {
    api
      .session()
      .then(({ username }) => setAuth({ state: 'in', username, recovered: null }))
      .catch(() => setAuth({ state: 'out' }));
  }, []);

  if (auth.state === 'checking') return <main className="muted">Loading…</main>;
  if (auth.state === 'out') {
    const logIn = (username: string) => {
      const recovered = unsaved.current?.username === username ? unsaved.current.edits : null;
      unsaved.current = null;
      setAuth({ state: 'in', username, recovered });
    };
    return <AuthScreen notice={auth.notice} onLogin={logIn} />;
  }

  return (
    <Tracker
      key={auth.username}
      username={auth.username}
      recovered={auth.recovered}
      onUnauthorized={(pending) => {
        unsaved.current = pending ? { username: auth.username, edits: pending } : null;
        setAuth({
          state: 'out',
          notice: pending
            ? 'Your session expired. Log in again — your latest change will be saved then.'
            : 'Your session expired. Please log in again.',
        });
      }}
      onLogout={async () => {
        await api.logout().catch(() => undefined);
        setAuth({ state: 'out' });
      }}
      onDeleted={() => setAuth({ state: 'out', notice: 'Your account and all its data were deleted.' })}
    />
  );
}

interface TrackerProps {
  username: string;
  recovered: Unsaved | null;
  onUnauthorized: (unsaved: Unsaved | null) => void;
  onLogout: () => void;
  onDeleted: () => void;
}

function Tracker({ username, recovered, onUnauthorized, onLogout, onDeleted }: TrackerProps) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const today = todayISO();
  const [monday, setMonday] = useState(mondayOf(today));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Data | null>(null);
  /** The latest version known to be on the server — what our edits are based on. */
  const server = useRef<Versioned | null>(null);
  const saving = useRef(false);

  async function save(next: Data, attempt = 0): Promise<void> {
    if (!server.current) return;
    pending.current = null;
    saving.current = true;
    setSaveState('saving');
    try {
      const result = await api.save(next, server.current.etag);
      if ('etag' in result) {
        server.current = { data: next, etag: result.etag };
        setSaveState(pending.current ? 'pending' : 'saved');
        return;
      }
      // Another tab or device saved first: put our edits on top of its version and retry.
      const mine = pending.current ?? next;
      const merged = mergeData(server.current.data, mine, result.conflict.data);
      server.current = result.conflict;
      clearTimeout(timer.current);
      pending.current = null;
      setData(merged);
      if (attempt < 3) await save(merged, attempt + 1);
      else setSaveState('error');
    } catch (err) {
      if (err instanceof UnauthorizedError)
        onUnauthorized({ base: server.current.data, mine: pending.current ?? next });
      else setSaveState('error');
    } finally {
      saving.current = false;
    }
  }

  async function load() {
    try {
      const latest = await api.load();
      server.current = latest;
      return latest;
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized(null);
      else setLoadError((err as Error).message);
      return null;
    }
  }

  // Both effects run once per login: Tracker is re-created (keyed) for every user, and
  // load/save only touch refs and state setters, so stale closures are not an issue.
  /* oxlint-disable react-hooks/exhaustive-deps, react/set-state-in-effect */
  useEffect(() => {
    void load().then((latest) => {
      if (!latest) return;
      if (recovered) {
        const merged = mergeData(recovered.base, recovered.mine, latest.data);
        setData(merged);
        void save(merged);
      } else {
        setData(latest.data);
      }
    });
  }, []);

  // Coming back to the tab (e.g. after editing on the phone): show the latest data.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || pending.current || saving.current) return;
      const known = server.current?.etag;
      void load().then((latest) => {
        if (latest && latest.etag !== known && !pending.current) setData(latest.data);
      });
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps, react/set-state-in-effect */

  // If the tab is closed while a save is still debounced, send it right away.
  useEffect(() => {
    const flush = () => {
      if (pending.current && server.current) {
        clearTimeout(timer.current);
        // If another device saved meanwhile this is refused (412) rather than overwriting it.
        void fetch('/api/data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'If-Match': server.current.etag },
          body: JSON.stringify(pending.current),
          keepalive: true,
        });
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      clearTimeout(timer.current);
    };
  }, []);

  function update(next: Data) {
    setData(next);
    pending.current = next;
    setSaveState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), SAVE_DELAY_MS);
  }

  function setEntry(date: string, entry: Entry | undefined) {
    if (!data) return;
    const entries = { ...data.entries };
    if (entry) entries[date] = entry;
    else delete entries[date];
    update({ ...data, entries });
  }

  if (loadError) {
    return (
      <main>
        <p className="neg">Could not load data from the server: {loadError}</p>
      </main>
    );
  }
  if (!data) return <main className="muted">Loading…</main>;

  const { rows, balance } = history(data, today);

  return (
    <main>
      <header className="app-header">
        <h1>Working hours</h1>
        <span className={`save-state ${saveState}`} aria-live="polite">
          {saveState === 'pending' || saveState === 'saving'
            ? 'Saving…'
            : saveState === 'saved'
              ? 'Saved ✓'
              : saveState === 'error'
                ? 'Save failed!'
                : ''}
        </span>
        <span className="user">
          <span className="muted">{username}</span>
          <button
            type="button"
            className="link"
            onClick={async () => {
              // Save a still-debounced change before the session goes away.
              if (pending.current) {
                clearTimeout(timer.current);
                await save(pending.current);
              }
              onLogout();
            }}
          >
            Log out
          </button>
        </span>
      </header>

      <div className="top">
        <WeekView data={data} monday={monday} today={today} onNavigate={setMonday} onEntryChange={setEntry} />
        <BalanceCard balance={balance} trackingStart={data.settings.trackingStart} today={today} />
      </div>

      <HistoryTable rows={rows} selected={monday} onSelect={setMonday} />
      <Settings data={data} today={today} onChange={update} />
      <Account
        username={username}
        onUnauthorized={() => onUnauthorized(null)}
        onDeleted={() => {
          // Nothing left to save: drop any debounced write so it can't hit the deleted account.
          clearTimeout(timer.current);
          pending.current = null;
          onDeleted();
        }}
      />
    </main>
  );
}
