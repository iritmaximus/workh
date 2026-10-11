import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultData } from '../../shared/types';
import { UserStore } from '../../backend/store';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workh-store-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('UserStore', () => {
  it('creates users with case-insensitive, unique names', () => {
    const store = new UserStore(dir);
    const u = store.create('Aaro', 'hash')!;
    expect(u.username).toBe('aaro');
    expect(store.findByName('AARO')?.id).toBe(u.id);
    expect(store.create('aaro', 'hash2')).toBeNull();
    expect(store.count()).toBe(1);
  });

  it('persists users across restarts', () => {
    const u = new UserStore(dir).create('aaro', 'hash')!;
    const reopened = new UserStore(dir);
    expect(reopened.findById(u.id)).toEqual(u);
  });

  it('keeps each user’s hours separate', () => {
    const store = new UserStore(dir);
    const a = store.create('a-user', 'h')!;
    const b = store.create('b-user', 'h')!;
    const data = { ...defaultData(), entries: { '2026-10-06': { mode: 'total' as const, minutes: 60 } } };
    store.writeData(a.id, data);
    expect(store.readData(a.id).data).toEqual(data);
    expect(store.readData(b.id).data.entries).toEqual({});
  });

  it('can seed a new account with existing data', () => {
    const store = new UserStore(dir);
    const data = { ...defaultData(), entries: { '2026-10-06': { mode: 'total' as const, minutes: 60 } } };
    const u = store.create('aaro', 'h', data)!;
    expect(store.readData(u.id).data).toEqual(data);
  });

  it('only writes on top of the expected version', () => {
    const store = new UserStore(dir);
    const u = store.create('aaro', 'h')!;
    const { rev } = store.readData(u.id);
    const first = store.writeData(u.id, defaultData(), rev);
    expect(first.ok).toBe(true);
    const stale = store.writeData(u.id, defaultData(), rev);
    expect(stale).toEqual({ ok: false, current: store.readData(u.id) });
  });

  it('deletes the user and every data file', () => {
    const store = new UserStore(dir);
    const u = store.create('aaro', 'h')!;
    store.writeData(u.id, defaultData());
    store.writeData(u.id, defaultData()); // creates .bak
    store.delete(u.id);

    expect(store.findById(u.id)).toBeUndefined();
    expect(new UserStore(dir).count()).toBe(0);
    expect(fs.readdirSync(path.join(dir, 'users'))).toEqual([]);
  });
});
