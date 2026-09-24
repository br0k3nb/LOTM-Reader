import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
// Server-only file, never imported by pages. Vercel injects process.env at
// runtime; the small loader below also makes local .env files work in Vite
// dev without adding another runtime dependency.

// Shared SQL client (server-only). Works with local Postgres, Neon direct,
// and Neon pooled connections (prepare:false is required behind pgbouncer).
// Prefers the non-pooled URL when the Vercel integration provides both.
let _sql: ReturnType<typeof postgres> | null = null;

function localEnv(name: string): string | undefined {
  for (const file of [".env.local", ".env"]) {
    try {
      const path = resolve(process.cwd(), file);
      if (!existsSync(path)) continue;
      const line = readFileSync(path, "utf8")
        .split(/\r?\n/)
        .find((entry) => entry.trim().startsWith(`${name}=`));
      if (!line) continue;
      const value = line.slice(line.indexOf("=") + 1).trim();
      return value.replace(/^(['"])(.*)\1$/, "$2");
    } catch {
      // Ignore malformed/unreadable local env files and use runtime env.
    }
  }
  return undefined;
}

export function db() {
  if (!_sql) {
    const url =
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.POSTGRES_URL ||
      localEnv("POSTGRES_URL_NON_POOLING") ||
      localEnv("POSTGRES_URL") ||
      (import.meta.env as Record<string, string | undefined>).POSTGRES_URL_NON_POOLING ||
      (import.meta.env as Record<string, string | undefined>).POSTGRES_URL;
    if (!url) {
      throw new Error(
        "Missing POSTGRES_URL. Set it in .env (local) or add a Postgres integration (Vercel)."
      );
    }
    _sql = postgres(url, {
      prepare: false,
      max: 3,
      idle_timeout: 10,
      connect_timeout: 10,
    });
  }
  return _sql;
}
