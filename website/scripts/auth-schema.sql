-- LOTM-Reader account and cross-device reading state.
-- The application also runs these idempotent statements on first use, but
-- applying this file during deployment makes the required schema explicit.

CREATE TABLE IF NOT EXISTS reader_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reader_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reader_sessions_user_id_idx
  ON reader_sessions(user_id);
CREATE INDEX IF NOT EXISTS reader_sessions_expires_at_idx
  ON reader_sessions(expires_at);

CREATE TABLE IF NOT EXISTS reader_progress (
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  tl TEXT NOT NULL,
  slug INTEGER NOT NULL CHECK (slug >= 0),
  scroll_y INTEGER NOT NULL DEFAULT 0 CHECK (scroll_y >= 0),
  scroll_ratio DOUBLE PRECISION NOT NULL DEFAULT 0
    CHECK (scroll_ratio >= 0 AND scroll_ratio <= 1),
  page_index INTEGER NOT NULL DEFAULT 0 CHECK (page_index >= 0),
  updated_at BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, book, tl)
);
CREATE INDEX IF NOT EXISTS reader_progress_updated_at_idx
  ON reader_progress(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reader_page_reads (
  user_id UUID NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  tl TEXT NOT NULL,
  slug INTEGER NOT NULL CHECK (slug >= 0),
  page_index INTEGER NOT NULL CHECK (page_index >= 0),
  reading_date DATE NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, book, tl, slug, page_index, reading_date)
);
CREATE INDEX IF NOT EXISTS reader_page_reads_user_date_idx
  ON reader_page_reads(user_id, reading_date DESC);
