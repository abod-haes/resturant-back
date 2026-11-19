-- Additive auth schema. No plaintext credentials or tokens persisted.
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  refresh_hash char(64) NOT NULL UNIQUE CHECK (refresh_hash ~ '^[0-9a-f]{64}$'),
  previous_refresh_hash char(64) UNIQUE CHECK (previous_refresh_hash IS NULL OR previous_refresh_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);

CREATE TABLE auth_login_attempts (
  identity_hash char(64) PRIMARY KEY CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);
CREATE INDEX auth_login_attempts_cleanup_idx ON auth_login_attempts (window_started_at);

CREATE TABLE auth_refresh_history (
  refresh_hash char(64) PRIMARY KEY CHECK (refresh_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_refresh_history_session_idx ON auth_refresh_history (session_id);
