import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  allowAuthAttempt,
  authenticateUser,
  clearAuthAttempts,
  createSession,
  isSameOrigin,
  normalizeEmail,
  setSessionCookie,
  validatePassword,
} from "$lib/server/auth";

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
    return json({ error: "Enter your email and password." }, { status: 400 });
  }

  let address = "unknown";
  try {
    address = getClientAddress();
  } catch {
    // Some local adapters do not provide a client address.
  }
  const rateKey = `login:${address}:${email}`;
  if (!allowAuthAttempt(rateKey)) {
    return json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "retry-after": "900" } },
    );
  }

  try {
    const user = await authenticateUser(email, password);
    // Keep the response deliberately generic so the endpoint cannot be used to
    // discover which email addresses have accounts.
    if (!user) return json({ error: "Email or password is incorrect." }, { status: 401 });

    clearAuthAttempts(rateKey);
    const session = await createSession(user.id);
    setSessionCookie(cookies, session.token, session.expiresAt);
    return json(
      { user },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Reader login failed", error);
    return json({ error: "Unable to sign in right now." }, { status: 503 });
  }
};
