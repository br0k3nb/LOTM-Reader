import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  allowAuthAttempt,
  authenticateGoogleIdentity,
  createSession,
  GoogleAuthError,
  isSameOrigin,
  setSessionCookie,
  verifyGoogleCredential,
} from "$lib/server/auth";

const MAX_BODY_BYTES = 16_000;
const MAX_CREDENTIAL_LENGTH = 12_000;

export const POST: RequestHandler = async ({
  request,
  cookies,
  getClientAddress,
}) => {
  if (!isSameOrigin(request)) {
    return json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return json({ error: "Request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid Google sign-in request." }, { status: 400 });
  }

  const credential =
    body && typeof body === "object" && "credential" in body
      ? (body as { credential?: unknown }).credential
      : null;
  if (typeof credential !== "string" || credential.length < 20 || credential.length > MAX_CREDENTIAL_LENGTH) {
    return json({ error: "Invalid Google identity." }, { status: 400 });
  }

  let address = "unknown";
  try {
    address = getClientAddress();
  } catch {
    // Some local adapters do not provide a client address.
  }
  if (!allowAuthAttempt(`google:${address}`)) {
    return json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "retry-after": "900" } },
    );
  }

  try {
    const identity = await verifyGoogleCredential(credential);
    const user = await authenticateGoogleIdentity(identity);
    const session = await createSession(user.id);
    setSessionCookie(cookies, session.token, session.expiresAt);
    return json({ user }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      if (error.code === "not_configured") {
        return json({ error: "Google sign-in is not configured yet." }, { status: 503 });
      }
      if (error.code === "unavailable") {
        return json({ error: "Google sign-in is temporarily unavailable." }, { status: 503 });
      }
      if (error.code === "conflict") {
        return json({ error: "This Google account is linked to another account." }, { status: 409 });
      }
      return json({ error: "Google sign-in could not be verified." }, { status: 401 });
    }
    console.error("Google sign-in failed", error);
    return json({ error: "Unable to sign in with Google right now." }, { status: 503 });
  }
};
