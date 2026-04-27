-- NevUp Track 1 — Full Schema with Row-Level Security
-- Migration: 001_schema.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- USERS (root of all RLS chains)
-- =========================================================================
CREATE TABLE IF NOT EXISTS users (
  user_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- SESSIONS (groups of related trades)
-- =========================================================================
CREATE TABLE IF NOT EXISTS sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  notes      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- =========================================================================
-- TRADES (immutable event log — core table)
-- =========================================================================
CREATE TABLE IF NOT EXISTS trades (
  trade_id         UUID PRIMARY KEY,   -- client-supplied idempotency key
  user_id          UUID NOT NULL REFERENCES users(user_id),
  session_id       UUID NOT NULL REFERENCES sessions(session_id),
  asset            TEXT NOT NULL,
  asset_class      TEXT NOT NULL CHECK (asset_class IN ('equity','crypto','forex')),
  direction        TEXT NOT NULL CHECK (direction IN ('long','short')),
  entry_price      NUMERIC(18,8) NOT NULL,
  exit_price       NUMERIC(18,8),
  quantity         NUMERIC(18,8) NOT NULL,
  entry_at         TIMESTAMPTZ NOT NULL,
  exit_at          TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  plan_adherence   INTEGER CHECK (plan_adherence BETWEEN 1 AND 5),
  emotional_state  TEXT CHECK (emotional_state IN ('calm','anxious','greedy','fearful','neutral')),
  entry_rationale  TEXT CHECK (char_length(entry_rationale) <= 500),
  profit_loss      NUMERIC(18,8) GENERATED ALWAYS AS (
    CASE WHEN exit_price IS NOT NULL AND entry_price IS NOT NULL
      THEN (exit_price - entry_price) * quantity
      ELSE NULL
    END
  ) STORED,
  revenge_flag     BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_user     ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_session  ON trades(session_id);
CREATE INDEX IF NOT EXISTS idx_trades_entry_at ON trades(user_id, entry_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_exit_at  ON trades(user_id, exit_at DESC);

-- =========================================================================
-- USER_METRICS (rolling aggregates)
-- =========================================================================
CREATE TABLE IF NOT EXISTS user_metrics (
  user_id               UUID PRIMARY KEY REFERENCES users(user_id),
  plan_adherence_score  FLOAT,
  wins_by_emotion       JSONB DEFAULT '{}',
  losses_by_emotion     JSONB DEFAULT '{}',
  tilts_triggered       INTEGER DEFAULT 0,
  last_trade_id         UUID,
  last_updated          TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- SESSION_METRICS (per-session tilt index)
-- =========================================================================
CREATE TABLE IF NOT EXISTS session_metrics (
  session_id   UUID PRIMARY KEY REFERENCES sessions(session_id),
  tilt_index   FLOAT NOT NULL DEFAULT 0,
  total_trades INTEGER NOT NULL DEFAULT 0,
  loss_follows INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- EVENTS (audit log — overtrading alerts etc.)
-- =========================================================================
CREATE TABLE IF NOT EXISTS events (
  event_id   BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(user_id),
  event_type TEXT NOT NULL,
  trade_id   UUID,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at DESC);

-- =========================================================================
-- DEBRIEFS (post-session reflections)
-- =========================================================================
CREATE TABLE IF NOT EXISTS debriefs (
  debrief_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID NOT NULL REFERENCES sessions(session_id),
  overall_mood         TEXT NOT NULL CHECK (overall_mood IN ('calm','anxious','greedy','fearful','neutral')),
  key_mistake          TEXT,
  key_lesson           TEXT,
  plan_adherence_rating INTEGER NOT NULL CHECK (plan_adherence_rating BETWEEN 1 AND 5),
  will_review_tomorrow  BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- ROW-LEVEL SECURITY
-- =========================================================================

-- Enable RLS on all user-scoped tables
ALTER TABLE trades          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_metrics    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE events          ENABLE ROW LEVEL SECURITY;

-- Policies: user_isolation on each table
-- These use current_setting('app.current_user_id') which the auth middleware sets per-transaction

CREATE POLICY user_isolation_trades ON trades
  FOR ALL USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY user_isolation_sessions ON sessions
  FOR ALL USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY user_isolation_user_metrics ON user_metrics
  FOR ALL USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- session_metrics needs a join-based policy — session owner check
CREATE POLICY user_isolation_session_metrics ON session_metrics
  FOR ALL USING (
    session_id IN (
      SELECT session_id FROM sessions
      WHERE user_id = current_setting('app.current_user_id', true)::UUID
    )
  );

CREATE POLICY user_isolation_events ON events
  FOR ALL USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- =========================================================================
-- GRANT USAGE (for the application role)
-- =========================================================================
-- The nevup user (from DATABASE_URL) gets full access but RLS filters apply
GRANT ALL ON ALL TABLES IN SCHEMA public TO nevup;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO nevup;
