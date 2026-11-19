-- V1.8: authenticated employee shift windows and anonymous table visit calls.
-- Durable outbox records are NOT delivery confirmations; no network notifications are sent in this slice.
CREATE TABLE restaurant_call_settings (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  waiter_enabled boolean NOT NULL DEFAULT true,
  hookah_enabled boolean NOT NULL DEFAULT false,
  routing_mode varchar(24) NOT NULL DEFAULT 'all_on_shift'
    CHECK (routing_mode IN ('all_on_shift','department_on_shift')),
  shift_auto_end_minutes integer NOT NULL DEFAULT 720
    CHECK (shift_auto_end_minutes BETWEEN 60 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE branch_call_settings (
  branch_id uuid PRIMARY KEY REFERENCES branches(id) ON DELETE RESTRICT,
  enabled boolean,
  waiter_enabled boolean,
  hookah_enabled boolean,
  routing_mode varchar(24) CHECK (routing_mode IS NULL OR routing_mode IN ('all_on_shift','department_on_shift')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER restaurant_call_settings_touch BEFORE UPDATE ON restaurant_call_settings
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER branch_call_settings_touch BEFORE UPDATE ON branch_call_settings
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();

CREATE TABLE employee_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  department varchar(16) NOT NULL CHECK (department IN ('waiter','hookah')),
  started_at timestamptz NOT NULL DEFAULT now(),
  auto_end_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT employee_shift_branch_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches(id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT employee_shift_time_check CHECK (auto_end_at > started_at),
  CONSTRAINT employee_shift_end_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX employee_shift_one_open_idx ON employee_shifts(user_id) WHERE ended_at IS NULL;
CREATE INDEX employee_shift_staff_routing_idx ON employee_shifts(branch_id,department,auto_end_at DESC)
  WHERE ended_at IS NULL;

CREATE TABLE visit_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  table_id uuid NOT NULL,
  credential_id uuid NOT NULL REFERENCES qr_credentials(id) ON DELETE RESTRICT,
  credential_version integer NOT NULL CHECK (credential_version >= 1),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  first_call_confirmed boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  CONSTRAINT visits_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches(id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT visits_table_branch_fk FOREIGN KEY (table_id,branch_id)
    REFERENCES restaurant_tables(id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT visits_expiration_check CHECK (expires_at > created_at)
);
CREATE INDEX visits_table_expiry_idx ON visit_sessions(table_id,expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX visits_cleanup_expiry_idx ON visit_sessions(expires_at);

CREATE TABLE service_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  table_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES visit_sessions(id) ON DELETE RESTRICT,
  type varchar(16) NOT NULL CHECK (type IN ('waiter','hookah')),
  idempotency_key uuid NOT NULL,
  delivery_state varchar(16) NOT NULL CHECK (delivery_state IN ('queued','no_staff')),
  recipients_count integer NOT NULL CHECK (recipients_count >= 0),
  owner_alerted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calls_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches(id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT calls_table_branch_fk FOREIGN KEY (table_id,branch_id)
    REFERENCES restaurant_tables(id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT calls_session_idempotency_unique UNIQUE (session_id,idempotency_key)
);
CREATE INDEX calls_table_type_cooldown_idx ON service_calls(table_id,type,created_at DESC);
CREATE INDEX calls_branch_history_idx ON service_calls(branch_id,created_at DESC,id DESC);
CREATE INDEX calls_restaurant_history_idx ON service_calls(restaurant_id,created_at DESC,id DESC);

CREATE TABLE call_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES service_calls(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state varchar(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  CONSTRAINT call_outbox_unique_recipient UNIQUE(call_id,recipient_user_id)
);
CREATE INDEX call_outbox_pending_idx ON call_outbox(created_at,id) WHERE state='pending';

CREATE TABLE owner_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  call_id uuid NOT NULL UNIQUE REFERENCES service_calls(id) ON DELETE RESTRICT,
  type varchar(16) NOT NULL CHECK (type='no_staff'),
  created_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  CONSTRAINT alerts_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches(id,restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX owner_alerts_restaurant_idx ON owner_alerts(restaurant_id,created_at DESC,id DESC);
