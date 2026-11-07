import { db } from "$lib/db";
import { ensureAuthSchema } from "$lib/server/auth";
import {
  applyDelta,
  freshDoc,
  validateDoc,
  type HabitDelta,
  type HabitDoc,
} from "$lib/habits/sync";

/** How many applied delta ids to remember for idempotent retries. */
const APPLIED_LIMIT = 200;

let schemaPromise: Promise<void> | undefined;

/**
 * One row per account holding the merged habit record (streaks, XP, rewards,
 * achievements) shared by the website and the Android app. Created on first use
 * like the other reader tables; see scripts/auth-schema.sql.
 */
export function ensureHabitSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureAuthSchema();
      await db()`
        CREATE TABLE IF NOT EXISTS reader_habits (
          user_id UUID PRIMARY KEY REFERENCES reader_users(id) ON DELETE CASCADE,
          data JSONB NOT NULL,
          applied TEXT[] NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

export async function getHabits(userId: string): Promise<{ habits: HabitDoc; updatedAt: number | null }> {
  await ensureHabitSchema();
  const rows = await db()<{ data: unknown; updated_at: Date }[]>`
    SELECT data, updated_at FROM reader_habits WHERE user_id = ${userId}
  `;
  if (rows.length === 0) return { habits: freshDoc(), updatedAt: null };
  return { habits: validateDoc(rows[0].data), updatedAt: new Date(rows[0].updated_at).getTime() };
}

/**
 * Applies one client delta exactly once. Concurrent requests for the same
 * account are serialized by the row lock; a retried id returns the stored
 * record unchanged.
 */
export async function applyHabitDelta(
  userId: string,
  id: string,
  delta: HabitDelta,
): Promise<{ habits: HabitDoc; duplicate: boolean }> {
  await ensureHabitSchema();
  const sql = db();
  return sql.begin(async (tx) => {
    await tx`
      INSERT INTO reader_habits (user_id, data)
      VALUES (${userId}, ${tx.json(freshDoc() as never)})
      ON CONFLICT (user_id) DO NOTHING
    `;
    const [row] = await tx<{ data: unknown; applied: string[] }[]>`
      SELECT data, applied FROM reader_habits WHERE user_id = ${userId} FOR UPDATE
    `;
    const current = validateDoc(row.data);
    const applied = row.applied ?? [];
    if (applied.includes(id)) return { habits: current, duplicate: true };

    const next = applyDelta(current, delta);
    const ids = [...applied, id].slice(-APPLIED_LIMIT);
    await tx`
      UPDATE reader_habits
      SET data = ${tx.json(next as never)}, applied = ${ids}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;
    return { habits: next, duplicate: false };
  });
}
