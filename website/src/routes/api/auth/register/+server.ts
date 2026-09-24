import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  allowAuthAttempt,
  clearAuthAttempts,
  createSession,
  createUser,
  isSameOrigin,
  normalizeEmail,
  setSessionCookie,
  validatePassword,
} from "$lib/server/auth";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  if (!isSameOrigin(request)) {
    return json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") || 0) > 16_000) {
    return json({ error: "Request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, { status: 400 });
  }

  const input =
    body && typeof body === "object"
      ? (body as { email?: unknown; password?: unknown })
      : {};
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  if (!email || !password) {
    return json(
      { error: "Enter a valid email and a password of at least 8 characters." },
      { status: 400 },
    );
  }

  let address = "unknown";
  try {
    address = getClientAddress();
  } catch {
    // Some local adapters do not provide a client address.
  }
  const rateKey = `register:${address}`;
  if (!allowAuthAttempt(rateKey)) {
    return json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "retry-after": "900" } },
    );
  }

  try {
    const user = await createUser(email, password);
    clearAuthAttempts(rateKey);
    const session = await createSession(user.id);
    setSessionCookie(cookies, session.token, session.expiresAt);
    return json(
      { user },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return json({ error: "An account with that email already exists." }, { status: 409 });
    }
    console.error("Reader registration failed", error);
    return json({ error: "Unable to create the account right now." }, { status: 503 });
  }
};
