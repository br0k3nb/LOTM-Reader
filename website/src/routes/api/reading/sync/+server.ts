import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { isSameOrigin } from "$lib/server/auth";
import {
  getReadingState,
  saveReadingState,
} from "$lib/server/reading";
import type { PageReadEvent, ReadingProgress } from "$lib/reading-types";

const MAX_BODY_BYTES = 32_000;
const MAX_EVENTS = 500;
const MAX_SLUG = 1_000_000;
const MAX_PAGE_INDEX = 10_000_000;
const MAX_SCROLL = 100_000_000;

function validPart(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function integer(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    return null;
  }
  return value;
}

function parseProgress(value: unknown): ReadingProgress | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const slug = integer(input.slug, MAX_SLUG);
  const scroll = integer(input.scroll, MAX_SCROLL);
  const pageIndex = integer(input.pageIndex, MAX_PAGE_INDEX);
  const updatedAt = integer(input.updatedAt, Date.now() + 24 * 60 * 60 * 1000);
  if (
    !validPart(input.book) ||
    !validPart(input.tl) ||
    slug === null ||
    scroll === null ||
    pageIndex === null ||
    updatedAt === null ||
    typeof input.scrollRatio !== "number" ||
    !Number.isFinite(input.scrollRatio)
  ) {
    return null;
  }

  return {
    book: input.book,
    tl: input.tl,
    slug,
    scroll,
    scrollRatio: Math.max(0, Math.min(1, input.scrollRatio)),
    pageIndex,
    updatedAt,
  };
}

function parseEvents(value: unknown): PageReadEvent[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_EVENTS) return null;

  const events: PageReadEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const input = item as Record<string, unknown>;
    const slug = integer(input.slug, MAX_SLUG);
    const pageIndex = integer(input.pageIndex, MAX_PAGE_INDEX);
    if (
      !validPart(input.book) ||
      !validPart(input.tl) ||
      slug === null ||
      pageIndex === null ||
      !validDate(input.date)
    ) {
      return null;
    }
    events.push({
      book: input.book,
      tl: input.tl,
      slug,
      pageIndex,
      date: input.date,
    });
  }
  return events;
}

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) return json({ error: "Authentication required." }, { status: 401 });

  try {
    const book = url.searchParams.get("book") || undefined;
    const state = await getReadingState(locals.user.id, validPart(book) ? book : undefined);
    return json(state, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Unable to load reading state", error);
    return json({ error: "Unable to load reading data right now." }, { status: 503 });
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return json({ error: "Authentication required." }, { status: 401 });
  if (!isSameOrigin(request)) {
    return json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "Sync payload is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid sync payload." }, { status: 400 });
  }

  const input = (body || {}) as Record<string, unknown>;
  const progress = input.progress === undefined ? null : parseProgress(input.progress);
  const events = parseEvents(input.events);
  if ((input.progress !== undefined && !progress) || !events) {
    return json({ error: "Invalid reading progress." }, { status: 400 });
  }

  try {
    await saveReadingState(locals.user.id, progress, events);
    const state = await getReadingState(locals.user.id);
    return json(
      { ...state, syncedAt: Date.now() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to save reading state", error);
    return json({ error: "Unable to sync reading data right now." }, { status: 503 });
  }
};
