import { db } from "$lib/db";
import { ensureAuthSchema } from "$lib/server/auth";
import type {
  PageReadEvent,
  ReadingProgress,
  ReadingStateResponse,
} from "$lib/reading-types";

type ProgressRow = {
  book: string;
  tl: string;
  slug: number;
  scroll_y: number;
  scroll_ratio: number;
  page_index: number;
  updated_at: number | string;
};

function toProgress(row: ProgressRow): ReadingProgress {
  return {
    book: row.book,
    tl: row.tl,
    slug: Number(row.slug),
    scroll: Number(row.scroll_y),
    scrollRatio: Number(row.scroll_ratio),
    pageIndex: Number(row.page_index),
    updatedAt: Number(row.updated_at),
  };
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function getReadingState(
  userId: string,
  book?: string,
): Promise<ReadingStateResponse> {
  await ensureAuthSchema();
  const sql = db();
  const progressRows = book
    ? await sql<ProgressRow[]>`
        SELECT book, tl, slug, scroll_y, scroll_ratio, page_index, updated_at
        FROM reader_progress
        WHERE user_id = ${userId} AND book = ${book}
        ORDER BY updated_at DESC
      `
    : await sql<ProgressRow[]>`
        SELECT book, tl, slug, scroll_y, scroll_ratio, page_index, updated_at
        FROM reader_progress
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT 50
      `;

  const dailyRows = await sql<{ reading_date: string | Date; pages: number }[]>`
    SELECT to_char(reading_date, 'YYYY-MM-DD') AS reading_date, COUNT(*)::int AS pages
    FROM reader_page_reads
    WHERE user_id = ${userId}
      AND reading_date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY reading_date
    ORDER BY reading_date DESC
  `;

  const daily: Record<string, number> = {};
  for (const row of dailyRows) {
    const date =
      row.reading_date instanceof Date
        ? row.reading_date.toISOString().slice(0, 10)
        : String(row.reading_date);
    daily[date] = Number(row.pages);
  }

  return {
    progress: progressRows.map(toProgress),
    daily,
  };
}

export async function saveReadingState(
  userId: string,
  progress: ReadingProgress | null,
  events: PageReadEvent[],
): Promise<void> {
  if (!progress && events.length === 0) return;
  await ensureAuthSchema();
  const sql = db();

  // Keep progress and its page events atomic. A retry can safely repeat the
  // whole request, and a malformed event cannot leave a half-synced position.
  await sql.begin(async (tx) => {
    if (progress) {
      await tx`
        INSERT INTO reader_progress (
          user_id, book, tl, slug, scroll_y, scroll_ratio, page_index, updated_at
        )
        VALUES (
          ${userId},
          ${progress.book},
          ${progress.tl},
          ${progress.slug},
          ${progress.scroll},
          ${progress.scrollRatio},
          ${progress.pageIndex},
          ${progress.updatedAt}
        )
        ON CONFLICT (user_id, book, tl) DO UPDATE SET
          slug = EXCLUDED.slug,
          scroll_y = EXCLUDED.scroll_y,
          scroll_ratio = EXCLUDED.scroll_ratio,
          page_index = EXCLUDED.page_index,
          updated_at = EXCLUDED.updated_at,
          synced_at = NOW()
        WHERE reader_progress.updated_at <= EXCLUDED.updated_at
      `;
    }

    if (events.length > 0) {
      // `date` is the wire-format field on PageReadEvent; the database column
      // is named reading_date to distinguish it from an event timestamp.
      // Normalize the camelCase pageIndex field to the SQL recordset name.
      // Use postgres.js' typed JSON parameter; a plain string would be bound
      // as a JSON scalar and rejected by jsonb_to_recordset.
      const jsonEvents = sql.json(
        events.map((event) => ({
          book: event.book,
          tl: event.tl,
          slug: event.slug,
          page_index: event.pageIndex,
          date: event.date,
        })),
      );
      await tx`
        INSERT INTO reader_page_reads (
          user_id, book, tl, slug, page_index, reading_date
        )
        SELECT
          ${userId},
          event.book,
          event.tl,
          event.slug,
          event.page_index,
          event.date::date
        FROM jsonb_to_recordset(${jsonEvents}::jsonb) AS event(
          book TEXT,
          tl TEXT,
          slug INTEGER,
          page_index INTEGER,
          date TEXT
        )
        ON CONFLICT DO NOTHING
      `;
    }
  });
}

export { localDateString };
