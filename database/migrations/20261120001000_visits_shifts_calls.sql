-- v1.8.0: durable QR visits, shifts and notification-only service call events.
-- All foreign keys are restrictive to retain history and prevent cross-tenant/cross-branch access.
ALTER TABLE qr_credentials ADD CONSTRAINT qr_credentials_id_table_unique UNIQUE (id,table_id);

CREATE TABLE visit_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  table_id uuid NOT NULL,
  qr_credential_id uuid NOT NULL,
  qr_version integer NOT NULL CHECK (qr_version >= 1),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  first_call_confirmed boolean NOT NULL DEFAULT false,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_sessions_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches (id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT visit_sessions_table_branch_fk FOREIGN KEY (table_id,branch_id)
    REFERENCES restaurant_tables (id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT visit_sessions_credential_table_fk FOREIGN KEY (qr_credential_id,table_id)
    REFERENCES qr_credentials (id,table_id) ON DELETE RESTRICT,
  CONSTRAINT visit_sessions_ttl_check CHECK (expires_at > created_at),
  CONSTRAINT visit_sessions_id_table_unique UNIQUE (id,table_id)
);
CREATE INDEX visit_sessions_table_expiry_idx ON visit_sessions(table_id,expires_at DESC);
CREATE INDEX visit_sessions_expiry_idx ON visit_sessions(expires_at);

CREATE TABLE restaurant_call_settings (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE RESTRICT,
  routing_mode varchar(12) NOT NULL DEFAULT 'department'
    CHECK (routing_mode IN ('all','department')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE branch_call_settings (
  branch_id uuid PRIMARY KEY REFERENCES branches(id) ON DELETE RESTRICT,
  routing_mode varchar(12) CHECK (routing_mode IS NULL OR routing_mode IN ('all','department')),
  shift_max_minutes integer NOT NULL DEFAULT 720 CHECK (shift_max_minutes BETWEEN 60 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employee_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  planned_ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_shifts_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches (id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT employee_shifts_interval_check CHECK (
    planned_ends_at > started_at AND (ended_at IS NULL OR ended_at >= started_at)
  )
);
CREATE UNIQUE INDEX employee_shifts_one_open_per_employee ON employee_shifts(employee_user_id)
  WHERE ended_at IS NULL;
CREATE INDEX employee_shifts_branch_active_idx ON employee_shifts(branch_id,planned_ends_at)
  WHERE ended_at IS NULL;

CREATE TABLE service_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  table_id uuid NOT NULL,
  session_id uuid NOT NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('waiter','hookah')),
  idempotency_key uuid NOT NULL,
  delivery_state varchar(12) NOT NULL CHECK (delivery_state IN ('queued','no_staff')),
  owner_alerted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_calls_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches (id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT service_calls_table_branch_fk FOREIGN KEY (table_id,branch_id)
    REFERENCES restaurant_tables (id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT service_calls_session_table_fk FOREIGN KEY (session_id,table_id)
    REFERENCES visit_sessions (id,table_id) ON DELETE RESTRICT,
  CONSTRAINT service_calls_idempotency_unique UNIQUE (session_id,idempotency_key)
);
CREATE INDEX service_calls_cooldown_idx ON service_calls(table_id,kind,created_at DESC);
CREATE INDEX service_calls_owner_history_idx ON service_calls(restaurant_id,branch_id,created_at DESC,id DESC);

CREATE TABLE call_recipients (
  call_id uuid NOT NULL REFERENCES service_calls(id) ON DELETE RESTRICT,
  employee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id,employee_user_id)
);
CREATE INDEX call_recipients_employee_idx ON call_recipients(employee_user_id,created_at DESC);

CREATE TABLE call_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL,
  employee_user_id uuid NOT NULL,
  state varchar(10) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT call_delivery_outbox_recipient_fk FOREIGN KEY (call_id,employee_user_id)
    REFERENCES call_recipients(call_id,employee_user_id) ON DELETE RESTRICT,
  CONSTRAINT call_delivery_outbox_recipient_unique UNIQUE (call_id,employee_user_id)
);
CREATE INDEX call_delivery_outbox_pending_idx ON call_delivery_outbox(created_at,id)
  WHERE state = 'pending';

CREATE TABLE owner_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  call_id uuid NOT NULL UNIQUE REFERENCES service_calls(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX owner_alerts_unread_idx ON owner_alerts(restaurant_id,created_at DESC)
  WHERE read_at IS NULL;

CREATE TRIGGER restaurant_call_settings_touch BEFORE UPDATE ON restaurant_call_settings
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER branch_call_settings_touch BEFORE UPDATE ON branch_call_settings
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
