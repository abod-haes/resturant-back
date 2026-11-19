-- V1.7: tenant/branch-scoped floors, areas, restaurant tables, one active QR credential per table.
-- QR credentials use SHA-256 lookup hash plus AES-256-GCM encrypted token for authorized PDF reprinting.
CREATE TABLE floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000000),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT floors_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches (id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT floors_id_branch_unique UNIQUE (id,branch_id)
);
CREATE UNIQUE INDEX floors_live_name_ci_unique ON floors(branch_id,lower(name)) WHERE archived_at IS NULL;
CREATE INDEX floors_branch_display_idx ON floors(branch_id,sort_order,id) WHERE archived_at IS NULL;

CREATE TABLE areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  floor_id uuid NOT NULL,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000000),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT areas_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches (id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT areas_floor_branch_fk FOREIGN KEY (floor_id,branch_id)
    REFERENCES floors (id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT areas_id_branch_unique UNIQUE (id,branch_id)
);
CREATE UNIQUE INDEX areas_live_name_ci_unique ON areas(floor_id,lower(name)) WHERE archived_at IS NULL;
CREATE INDEX areas_floor_display_idx ON areas(floor_id,sort_order,id) WHERE archived_at IS NULL;

CREATE TABLE restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  area_id uuid NOT NULL,
  label varchar(100) NOT NULL CHECK (length(btrim(label)) > 0),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000000),
  is_active boolean NOT NULL DEFAULT true,
  qr_enabled boolean NOT NULL DEFAULT true,
  calls_enabled boolean NOT NULL DEFAULT true,
  qr_version integer NOT NULL DEFAULT 1 CHECK (qr_version >= 1),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_tables_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches (id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT restaurant_tables_area_branch_fk FOREIGN KEY (area_id,branch_id)
    REFERENCES areas (id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT restaurant_tables_id_branch_unique UNIQUE (id,branch_id)
);
CREATE UNIQUE INDEX restaurant_tables_label_ci_unique ON restaurant_tables(branch_id,lower(label))
  WHERE archived_at IS NULL;
CREATE INDEX restaurant_tables_branch_listing_idx ON restaurant_tables(branch_id,sort_order,id)
  WHERE archived_at IS NULL;
CREATE INDEX restaurant_tables_area_idx ON restaurant_tables(area_id,sort_order,id);

CREATE TABLE qr_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_box text NOT NULL CHECK (length(token_box) BETWEEN 70 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT qr_credentials_table_branch_fk FOREIGN KEY (table_id,branch_id)
    REFERENCES restaurant_tables (id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT qr_credentials_version_unique UNIQUE (table_id,version)
);
CREATE UNIQUE INDEX qr_credentials_one_live_per_table ON qr_credentials(table_id) WHERE revoked_at IS NULL;
CREATE INDEX qr_credentials_table_created_idx ON qr_credentials(table_id,created_at DESC);

CREATE TRIGGER floors_touch_updated_at BEFORE UPDATE ON floors FOR EACH ROW
  EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER areas_touch_updated_at BEFORE UPDATE ON areas FOR EACH ROW
  EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER restaurant_tables_touch_updated_at BEFORE UPDATE ON restaurant_tables FOR EACH ROW
  EXECUTE FUNCTION platform_touch_updated_at();
