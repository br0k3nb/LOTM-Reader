import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { Cookies } from "@sveltejs/kit";
import type { AuthUser } from "$lib/auth-types";
import { db } from "$lib/db";

/**
 * Server-side authentication for the reader.
 *
 * The browser only receives an opaque session token in an HttpOnly cookie. The
 * database stores only a SHA-256 digest of that token, so a database leak does
 * not expose usable sessions.
 */
export const SESSION_COOKIE = "lotm_reader_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type { AuthUser };

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
};

const PASSWORD_MAX_LENGTH = 256;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

let schemaPromise: Promise<void> | undefined;

type AuthAttempt = { count: number; resetAt: number };
const authAttempts = new Map<string, AuthAttempt>();
const AUTH_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_ATTEMPT_LIMIT = 12;

/** Best-effort per-instance abuse protection; use a shared limiter at scale. */
export function allowAuthAttempt(key: string): boolean {
  const now = Date.now();
  for (const [entryKey, entry] of authAttempts) {
    if (entry.resetAt <= now) authAttempts.delete(entryKey);
  }
  const current = authAttempts.get(key);
  if (!current) {
    authAttempts.set(key, { count: 1, resetAt: now + AUTH_ATTEMPT_WINDOW_MS });
    return true;
  }
  if (current.count >= AUTH_ATTEMPT_LIMIT) return false;
  current.count += 1;
  return true;
}

export function clearAuthAttempts(key: string): void {
  authAttempts.delete(key);
}

/**
 * Create the small authentication/sync schema on first use. This keeps the
 * fork deployable on a fresh Postgres database without requiring a migration
 * runner. The same statements are also provided in scripts/auth-schema.sql for
 * teams that prefer to apply schema changes during deployment.
 */
export function ensureAuthSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = db();

      await sql`
        CREATE TABLE IF NOT EXISTS reader_users (
          id UUID PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS reader_sessions (
          token_hash CHAR(64) PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS reader_sessions_user_id_idx
        ON reader_sessions(user_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS reader_sessions_expires_at_idx
        ON reader_sessions(expires_at)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS reader_progress (
          user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
          book TEXT NOT NULL,
          tl TEXT NOT NULL,
          slug INTEGER NOT NULL CHECK (slug >= 0),
          scroll_y INTEGER NOT NULL DEFAULT 0 CHECK (scroll_y >= 0),
          scroll_ratio DOUBLE PRECISION NOT NULL DEFAULT 0
            CHECK (scroll_ratio >= 0 AND scroll_ratio <= 1),
          page_index INTEGER NOT NULL DEFAULT 0 CHECK (page_index >= 0),
          updated_at BIGINT NOT NULL,
          synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, book, tl)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS reader_progress_updated_at_idx
        ON reader_progress(user_id, updated_at DESC)
      `;

      // One row represents one logical page reached on one local calendar day.
      // The primary key makes concurrent updates from multiple devices safe:
      // re-reading the same logical page on the same day is not double-counted.
      await sql`
        CREATE TABLE IF NOT EXISTS reader_page_reads (
          user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
          book TEXT NOT NULL,
          tl TEXT NOT NULL,
          slug INTEGER NOT NULL CHECK (slug >= 0),
          page_index INTEGER NOT NULL CHECK (page_index >= 0),
          reading_date DATE NOT NULL,
          read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, book, tl, slug, page_index, reading_date)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS reader_page_reads_user_date_idx
        ON reader_page_reads(user_id, reading_date DESC)
      `;
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }

  return schemaPromise;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  // Deliberately conservative validation. The authoritative check is whether
  // the address can receive a verification message in a future auth provider;
  // this app currently has no mail provider, so avoid rejecting valid addresses.
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function validatePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 8 || value.length > PASSWORD_MAX_LENGTH) return null;
  return value;
}

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key as Buffer);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (
    !Number.isSafeInteger(cost) ||
    !Number.isSafeInteger(blockSize) ||
    !Number.isSafeInteger(parallelization) ||
    cost < 16_384 ||
    cost > 1_000_000 ||
    blockSize < 1 ||
    blockSize > 32 ||
    parallelization < 1 ||
    parallelization > 16
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        expected.length,
        { N: cost, r: blockSize, p: parallelization },
        (error, key) => {
          if (error) reject(error);
          else resolve(key as Buffer);
        },
      );
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getSessionToken(cookies: Cookies): string | undefined {
  return cookies.get(SESSION_COOKIE);
}

export function setSessionCookie(
  cookies: Cookies,
  token: string,
  expiresAt: Date,
): void {
  cookies.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

export async function createUser(
  email: string,
  password: string,
): Promise<AuthUser> {
  await ensureAuthSchema();
  const sql = db();
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const rows = await sql`
    INSERT INTO reader_users (id, email, password_hash)
    VALUES (${id}, ${email}, ${passwordHash})
    RETURNING id, email
  `;
  return rows[0] as AuthUser;
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<AuthUser | null> {
  await ensureAuthSchema();
  const sql = db();
  const rows = await sql<UserRow[]>`
    SELECT id, email, password_hash
    FROM reader_users
    WHERE email = ${email}
    LIMIT 1
  `;
  const user = rows[0];
  if (!user) {
    // Do a real password derivation for unknown accounts as well, reducing
    // account-enumeration timing differences.
    await derivePasswordKey(password, Buffer.alloc(16));
    return null;
  }
  if (!(await verifyPassword(password, user.password_hash))) return null;
  return { id: user.id, email: user.email };
}

export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  await ensureAuthSchema();
  const sql = db();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await sql`
    DELETE FROM reader_sessions WHERE expires_at <= NOW()
  `;
  await sql`
    INSERT INTO reader_sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, ${expiresAt})
  `;
  return { token, expiresAt };
}

export async function getUserForSession(
  token: string | undefined,
): Promise<AuthUser | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  await ensureAuthSchema();
  const sql = db();
  const rows = await sql<AuthUser[]>`
    SELECT u.id, u.email
    FROM reader_sessions s
    JOIN reader_users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashSessionToken(token)}
      AND s.expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await ensureAuthSchema();
  const sql = db();
  await sql`
    DELETE FROM reader_sessions
    WHERE token_hash = ${hashSessionToken(token)}
  `;
}

/** Reject cross-origin cookie-authenticated mutations. */
export function isSameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;

  const referer = request.headers.get("referer");
  if (!referer) return true;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

export { normalizeEmail, validatePassword };
