import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- From the environment ----------

export const PORT = Number(process.env.PORT ?? 3001);
/** Holds users.json and users/<id>.json. */
export const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
/** Signs session cookies. Without one, a random secret is used and everyone is logged out on restart. */
export const SESSION_SECRET = process.env.SESSION_SECRET ?? randomBytes(32).toString('base64url');
/** If set, creating an account requires this invite code. */
export const REGISTRATION_CODE = process.env.REGISTRATION_CODE ?? '';

// ---------- Fixed ----------

export const DIST_DIR = path.join(ROOT, 'dist');
/** Pre-accounts single-user data; adopted by the first account created, if present. */
export const LEGACY_DATA_FILE = path.join(ROOT, 'data.json');
export const SESSION_TTL_MS = 30 * 86_400_000;
export const MAX_USERS = 100;
export const REGISTRATIONS_PER_IP_PER_HOUR = 5;
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;
/** Trust X-Forwarded-For only from private-network peers, i.e. the ingress proxy. */
export const TRUST_PROXY = 'loopback, linklocal, uniquelocal';
