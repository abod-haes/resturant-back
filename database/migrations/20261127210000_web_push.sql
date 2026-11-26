-- Web Push is separate from Expo; expand both channels atomically.
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_web_push_owner_unique UNIQUE (id,user_id);
CREATE TABLE employee_web_push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL,
 endpoint_hash char(64) NOT NULL UNIQUE CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),
 subscription_box text NOT NULL CHECK (length(subscription_box) BETWEEN 50 AND 8192),
 expires_at timestamptz,
 is_active boolean NOT NULL DEFAULT true,
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (session_id,user_id) REFERENCES auth_sessions(id,user_id) ON DELETE RESTRICT
);
CREATE INDEX web_push_user_active_idx ON employee_web_push_subscriptions(user_id) WHERE is_active;
CREATE INDEX web_push_session_idx ON employee_web_push_subscriptions(session_id) WHERE is_active;
CREATE TABLE web_push_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 outbox_id uuid NOT NULL REFERENCES call_outbox(id) ON DELETE RESTRICT,
 subscription_id uuid NOT NULL REFERENCES employee_web_push_subscriptions(id) ON DELETE RESTRICT,
 state varchar(12) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 last_error_code varchar(64),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(outbox_id,subscription_id)
);
CREATE INDEX web_push_due_idx ON web_push_deliveries(next_attempt_at,id) WHERE state='pending';
CREATE TRIGGER web_push_touch_updated_at BEFORE UPDATE ON web_push_deliveries FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
