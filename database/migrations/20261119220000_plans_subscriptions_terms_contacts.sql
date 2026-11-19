-- Additive schema for manual plan administration, subscription terms and renewal channels.
ALTER TABLE subscriptions
  ADD COLUMN grace_days integer NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 365),
  ADD COLUMN entitlement_snapshot jsonb CHECK (entitlement_snapshot IS NULL OR jsonb_typeof(entitlement_snapshot) = 'object');

-- At most one currently pending draft per restaurant; concurrent drafts serialized on restaurant.
CREATE UNIQUE INDEX subscriptions_one_pending_per_restaurant_idx
  ON subscriptions (restaurant_id) WHERE status = 'pending';

CREATE TABLE subscription_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  period varchar(8) NOT NULL CHECK (period IN ('monthly','yearly')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  grace_ends_at timestamptz NOT NULL,
  entitlement_snapshot jsonb NOT NULL CHECK (jsonb_typeof(entitlement_snapshot) = 'object'),
  activated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_terms_sequence_unique UNIQUE (subscription_id,sequence),
  CONSTRAINT subscription_terms_date_order_check CHECK (starts_at < ends_at AND ends_at <= grace_ends_at)
);
CREATE INDEX subscription_terms_subscription_sequence_idx ON subscription_terms (subscription_id,sequence DESC);
CREATE INDEX subscription_terms_plan_idx ON subscription_terms (plan_id);

CREATE TABLE renewal_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar(16) NOT NULL CHECK (type IN ('whatsapp','phone','email')),
  label varchar(120) NOT NULL CHECK (length(btrim(label)) > 0),
  value varchar(256) NOT NULL CHECK (length(btrim(value)) > 0),
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX renewal_contacts_enabled_order_idx ON renewal_contacts (is_enabled,sort_order,id);
