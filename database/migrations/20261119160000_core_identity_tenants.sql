-- Restaurant platform core relational foundation, PostgreSQL 17.
-- Forward-only, transactional. Authorization requires server-side tenant policy in future features.

CREATE TABLE restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  slug varchar(128) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  slug varchar(128) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  currency varchar(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branches_id_restaurant_id_unique UNIQUE (id, restaurant_id)
);
CREATE INDEX branches_restaurant_active_idx ON branches (restaurant_id, is_active);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(64) NOT NULL CHECK (username ~ '^[A-Za-z0-9._-]{3,64}$'),
  display_name varchar(200) NOT NULL CHECK (length(btrim(display_name)) > 0),
  password_hash text NOT NULL CHECK (length(password_hash) >= 40),
  role varchar(32) NOT NULL CHECK (role IN ('PRIMARY_ADMIN', 'PLATFORM_ADMIN', 'RESTAURANT_OWNER', 'EMPLOYEE')),
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid,
  department varchar(16),
  must_change_password boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_branch_same_restaurant_fk
    FOREIGN KEY (branch_id, restaurant_id) REFERENCES branches(id, restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT users_role_scope_check CHECK (
    (role IN ('PRIMARY_ADMIN', 'PLATFORM_ADMIN') AND restaurant_id IS NULL AND branch_id IS NULL AND department IS NULL)
    OR (role = 'RESTAURANT_OWNER' AND restaurant_id IS NOT NULL AND branch_id IS NULL AND department IS NULL)
    OR (role = 'EMPLOYEE' AND restaurant_id IS NOT NULL AND branch_id IS NOT NULL AND department IS NOT NULL AND department IN ('waiter', 'hookah'))
  )
);
CREATE UNIQUE INDEX users_username_ci_unique ON users (lower(username));
CREATE UNIQUE INDEX users_single_restaurant_owner_idx ON users (restaurant_id) WHERE role = 'RESTAURANT_OWNER';
CREATE INDEX users_restaurant_role_idx ON users (restaurant_id, role);
CREATE INDEX users_branch_department_active_idx ON users (branch_id, department, is_active) WHERE role = 'EMPLOYEE';

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL UNIQUE CHECK (length(btrim(name)) > 0),
  max_branches integer NOT NULL CHECK (max_branches >= 1),
  max_tables integer NOT NULL CHECK (max_tables >= 1),
  max_employees integer NOT NULL CHECK (max_employees >= 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  period varchar(8) NOT NULL CHECK (period IN ('monthly', 'yearly')),
  status varchar(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  grace_ends_at timestamptz,
  activated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_active_interval_check CHECK (
    status <> 'active' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
  ),
  CONSTRAINT subscriptions_interval_order_check CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  ),
  CONSTRAINT subscriptions_grace_order_check CHECK (
    grace_ends_at IS NULL OR (ends_at IS NOT NULL AND grace_ends_at >= ends_at)
  )
);
CREATE UNIQUE INDEX subscriptions_one_active_per_restaurant_idx
  ON subscriptions (restaurant_id) WHERE status = 'active';
CREATE INDEX subscriptions_restaurant_status_idx ON subscriptions (restaurant_id, status, ends_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE RESTRICT,
  action varchar(100) NOT NULL CHECK (length(btrim(action)) > 0),
  entity_type varchar(100) NOT NULL CHECK (length(btrim(entity_type)) > 0),
  entity_id uuid,
  request_id varchar(128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_restaurant_created_idx ON audit_logs (restaurant_id, created_at DESC);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs (actor_user_id, created_at DESC);

-- Persist updated_at consistently for all mutable root entities.
CREATE FUNCTION platform_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER restaurants_touch_updated_at BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER branches_touch_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER plans_touch_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER subscriptions_touch_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
