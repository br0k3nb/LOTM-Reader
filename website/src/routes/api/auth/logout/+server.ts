import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  clearSessionCookie,
  deleteSession,
  getSessionToken,
  isSameOrigin,
} from "$lib/server/auth";

export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    return json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  try {
    await deleteSession(getSessionToken(cookies));
  } catch (error) {
    // Always clear the browser cookie, even if the server-side delete failed.
    console.error("Reader logout failed", error);
  }
  clearSessionCookie(cookies);
  return json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
};
