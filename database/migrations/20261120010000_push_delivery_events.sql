-- v1.9 push delivery + durable multi-replica realtime.
-- Forward-only; existing v1.8 outbox remains intact.
CREATE TABLE employee_push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  platform varchar(12) NOT NULL CHECK (platform IN ('android','ios')),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_box text NOT NULL CHECK (length(token_box) BETWEEN 50 AND 900),
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_active_idx ON employee_push_devices(user_id,last_seen_at DESC)
  WHERE is_active=true;

ALTER TABLE call_outbox
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES call_outbox(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES employee_push_devices(id) ON DELETE RESTRICT,
  state varchar(12) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  ticket_id varchar(128),
  receipt_status varchar(12) NOT NULL DEFAULT 'waiting'
    CHECK (receipt_status IN ('waiting','ok','error','expired')),
  receipt_checked_at timestamptz,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_delivery_unique_target UNIQUE (outbox_id,device_id)
);
CREATE INDEX push_delivery_due_idx ON push_deliveries(next_attempt_at,id)
  WHERE state='pending';
CREATE INDEX push_receipts_due_idx ON push_deliveries(next_attempt_at,id)
  WHERE state='accepted' AND receipt_status='waiting' AND ticket_id IS NOT NULL;
CREATE TRIGGER push_deliveries_touch_updated_at BEFORE UPDATE ON push_deliveries
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
CREATE INDEX call_outbox_due_idx ON call_outbox(next_attempt_at,id) WHERE state='pending';

CREATE TABLE restaurant_event_counters (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE RESTRICT,
  next_sequence bigint NOT NULL DEFAULT 0 CHECK (next_sequence >= 0)
);
CREATE TABLE realtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  branch_id uuid NOT NULL,
  recipient_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  event_type varchar(32) NOT NULL CHECK (event_type IN ('call.created','owner.alert.created','shift.updated')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT realtime_events_branch_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches(id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT realtime_events_unique_seq UNIQUE (restaurant_id,sequence)
);
CREATE INDEX realtime_events_owner_idx ON realtime_events(restaurant_id,sequence)
  WHERE recipient_user_id IS NULL;
CREATE INDEX realtime_events_employee_idx ON realtime_events(recipient_user_id,restaurant_id,sequence)
  WHERE recipient_user_id IS NOT NULL;
