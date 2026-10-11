import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defaultData, type Data } from '../shared/types';
import { log } from './log';

export interface User {
  id: string;
  /** Stored lowercase; usernames are case-insensitive. */
  username: string;
  passwordHash: string;
  createdAt: string;
}

interface UsersFile {
  users: User[];
}

/** Version tag of a user's stored data; changes whenever the file's content does. */
const revOf = (content: string | null) =>
  content === null ? 'none' : createHash('sha256').update(content).digest('base64url').slice(0, 22);

export type WriteResult = { ok: true; rev: string } | { ok: false; current: { data: Data; rev: string } };

/** Writes via a temp file + rename so a crash never leaves a half-written file. */
function writeAtomic(file: string, content: string) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/**
 * Users live in <dataDir>/users.json; each user's hours in <dataDir>/users/<id>.json.
 * All access goes through this one process, and writes are synchronous, so the
 * in-memory copy of users.json is always the truth.
 */
export class UserStore {
  private users: User[];
  private readonly usersFile: string;
  private readonly userDir: string;

  constructor(dataDir: string) {
    this.usersFile = path.join(dataDir, 'users.json');
    this.userDir = path.join(dataDir, 'users');
    fs.mkdirSync(this.userDir, { recursive: true });
    this.users = fs.existsSync(this.usersFile)
      ? (JSON.parse(fs.readFileSync(this.usersFile, 'utf8')) as UsersFile).users
      : [];
  }

  private persist() {
    writeAtomic(this.usersFile, JSON.stringify({ users: this.users } satisfies UsersFile, null, 2) + '\n');
  }

  private dataFile(id: string) {
    return path.join(this.userDir, `${id}.json`);
  }

  count(): number {
    return this.users.length;
  }

  findById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  findByName(username: string): User | undefined {
    const name = username.toLowerCase();
    return this.users.find((u) => u.username === name);
  }

  /** Returns null if the username is already taken. */
  create(username: string, passwordHash: string, initialData?: Data): User | null {
    if (this.findByName(username)) return null;
    const user: User = {
      id: randomUUID(),
      username: username.toLowerCase(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    if (initialData) this.writeData(user.id, initialData);
    this.users.push(user);
    this.persist();
    return user;
  }

  /** Removes the user and every file holding their hours. */
  delete(id: string): void {
    this.users = this.users.filter((u) => u.id !== id);
    this.persist();
    for (const suffix of ['', '.bak', '.tmp']) fs.rmSync(`${this.dataFile(id)}${suffix}`, { force: true });
  }

  private readRaw(id: string): string | null {
    const file = this.dataFile(id);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  readData(id: string): { data: Data; rev: string } {
    const raw = this.readRaw(id);
    return { data: raw === null ? defaultData() : (JSON.parse(raw) as Data), rev: revOf(raw) };
  }

  /**
   * Saves only if the stored data is still at `ifRev` — the version the client started
   * from — so an outdated tab or device can't overwrite newer changes. Omit `ifRev` to
   * write unconditionally (new accounts).
   */
  writeData(id: string, data: Data, ifRev?: string): WriteResult {
    if (ifRev !== undefined && revOf(this.readRaw(id)) !== ifRev) {
      return { ok: false, current: this.readData(id) };
    }
    const file = this.dataFile(id);
    const content = JSON.stringify(data, null, 2) + '\n';
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    writeAtomic(file, content);
    log.debug('wrote data file', { file });
    return { ok: true, rev: revOf(content) };
  }
}
