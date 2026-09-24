import type { Handle } from "@sveltejs/kit";
import {
  clearSessionCookie,
  getSessionToken,
  getUserForSession,
} from "$lib/server/auth";

export const handle: Handle = async ({ event, resolve }) => {
  const token = getSessionToken(event.cookies);
  event.locals.user = null;

  // Static/prerendered pages do not need a database lookup. For requests that
  // do carry a session, a temporary database failure should not take down the
  // whole reader; the client can retry the session endpoint.
  if (token) {
    try {
      event.locals.user = await getUserForSession(token);
      if (!event.locals.user) clearSessionCookie(event.cookies);
    } catch (error) {
      console.error("Unable to resolve reader session", error);
    }
  }

  return resolve(event);
};
