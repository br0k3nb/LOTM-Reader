import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { isSameOrigin } from "$lib/server/auth";
import { applyHabitDelta, getHabits } from "$lib/server/habits";
import { parseDelta, SYNC_VERSION } from "$lib/habits/sync";

// A first sync uploads up to 400 days of history; later deltas are tiny.
const MAX_BODY_BYTES = 512_000;

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: "Authentication required." }, { status: 401 });
  try {
    const { habits, updatedAt } = await getHabits(locals.user.id);
    return json(
      { version: SYNC_VERSION, habits, updatedAt, syncedAt: Date.now() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to load habits", error);
    return json({ error: "Unable to load progress right now." }, { status: 503 });
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return json({ error: "Authentication required." }, { status: 401 });
  if (!isSameOrigin(request)) {
    return json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "Progress payload is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return json({ error: "Progress payload is too large." }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid progress payload." }, { status: 400 });
  }

  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = input.id;
  if (input.version !== SYNC_VERSION || typeof id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    return json({ error: "Invalid progress payload." }, { status: 400 });
  }
  const delta = parseDelta(input.delta);
  if (!delta) return json({ error: "Invalid progress payload." }, { status: 400 });

  try {
    const { habits, duplicate } = await applyHabitDelta(locals.user.id, id, delta);
    return json(
      { version: SYNC_VERSION, habits, duplicate, syncedAt: Date.now() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to save habits", error);
    return json({ error: "Unable to sync progress right now." }, { status: 503 });
  }
};
