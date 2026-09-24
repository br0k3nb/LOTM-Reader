# LOTM-Reader accounts and reading sync

The fork now has a same-origin, email/password account system backed by the
existing Postgres connection. It is intentionally server-side: the browser
receives an opaque `HttpOnly` session cookie and never receives the database
URL or password hashes.

## Local setup

1. Start the Postgres instance used by the reader.
2. Make sure `POSTGRES_URL` is available to the SvelteKit server. The existing
   `website/.env` file is used by `npm run dev`.
3. Apply `website/scripts/auth-schema.sql` once, or let the first authenticated
   request create the tables automatically. The SQL file is preferable for a
   deployment pipeline. For example:
   `psql "$POSTGRES_URL_NON_POOLING" -f website/scripts/auth-schema.sql`.
4. Run `npm run dev` and open the account icon in the reader or book page.

The account schema uses these tables:

- `reader_users` — normalized email and scrypt password hashes.
- `reader_google_accounts` — verified Google subjects linked to reader users.
- `reader_sessions` — hashed, expiring opaque session tokens.
- `reader_progress` — the newest position for each book and translation.
- `reader_page_reads` — idempotent daily page events.

## Sync behavior

Reading remains local-first. Every scroll updates the existing `lastRead`
value and queues a logical page event in local storage. When an account is
active, the queue is uploaded after a short debounce and retried on focus,
online events, and the next sign-in. Events are namespaced per account so an
outbox from one account cannot be uploaded to another.

A logical page is an 800 CSS-pixel vertical segment of a chapter. Re-reading
the same chapter page on the same local calendar day is counted once; reading
it on another day is counted again. The server stores the client-provided
local date so the number remains consistent with the reader's calendar day.
The same definition should be retained if page segmentation is later moved into
the content build.

Progress conflicts use the newest `updatedAt` value. The server validates the
value and ignores an older device's progress, while page events use a unique
key and therefore cannot be double-counted during retries.

## Production notes

- Use HTTPS. Session cookies are `Secure` in production and `SameSite=Lax`.
- Keep `POSTGRES_URL` server-side and use a pooled runtime URL plus a direct
  migration URL where appropriate.
- The endpoints validate request origin, request size, field ranges, and
  ownership through the session; clients never send a user ID.
- Add a distributed rate limiter and an email verification/password-reset
  provider before opening registration to the public.
- The chapter renderer currently uses `{@html ...}`. Sanitize chapter HTML and
  add a strict CSP before enabling accounts on a high-risk deployment.
- The schema currently retains daily page events. Add a retention/export job if
  the project needs long-term analytics.

## Google sign-in

Google sign-in uses Google Identity Services. Only the public OAuth client ID
is sent to the browser; the returned ID token is verified server-side against
Google before a reader session is created. A Google identity is linked to an
existing reader account when the verified email matches, otherwise a new local
account is created with an unusable random password.

The Vercel project needs these variables for Production and Preview:

- `GOOGLE_CLIENT_ID` — server-side audience validation.
- `VITE_GOOGLE_CLIENT_ID` — the same public client ID for the browser button.

In the Google Cloud OAuth client, add `https://lotmreader.vercel.app` as an
authorized JavaScript origin. The client secret is not needed for the
Identity Services flow and must not be placed in the browser.

The current adapter is `@sveltejs/adapter-vercel`; the auth and sync endpoints
are serverless Node routes. Deploying only `website/build/` to a static host
will serve the UI but cannot provide `/api/auth/*` or `/api/reading/sync`.
Use the Vercel deployment (or move these endpoints to a separate compatible
API) before enabling sign-in. For a manual Vercel deploy, set
`POSTGRES_URL`/`POSTGRES_URL_NON_POOLING` in the project environment, apply
`website/scripts/auth-schema.sql`, and run the normal SvelteKit build.
