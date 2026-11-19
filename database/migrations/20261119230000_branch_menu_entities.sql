-- Restaurant branch menus, independently scoped to each branch. Schema is additive.
-- Referential constraints enforce cross-branch and cross-tenant integrity, including image references.
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
  description varchar(1000),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000000),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches (id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT categories_id_branch_unique UNIQUE (id,branch_id)
);
CREATE UNIQUE INDEX categories_live_name_ci_unique
  ON categories(branch_id,lower(name)) WHERE archived_at IS NULL;
CREATE INDEX categories_branch_listing_idx ON categories(branch_id,created_at DESC,id DESC);
CREATE INDEX categories_branch_display_idx ON categories(branch_id,sort_order,id) WHERE archived_at IS NULL AND is_active;

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  category_id uuid NOT NULL,
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  description varchar(3000),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  old_price_minor integer CHECK (old_price_minor IS NULL OR old_price_minor > price_minor),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  tags text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(tags) <= 12),
  is_visible boolean NOT NULL DEFAULT true,
  is_sold_out boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000000),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches (id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT products_category_branch_fk FOREIGN KEY (category_id,branch_id)
    REFERENCES categories (id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT products_id_branch_unique UNIQUE (id,branch_id)
);
CREATE INDEX products_branch_listing_idx ON products(branch_id,created_at DESC,id DESC);
CREATE INDEX products_category_display_idx ON products(category_id,sort_order,id)
  WHERE archived_at IS NULL AND is_visible;
CREATE INDEX products_branch_category_idx ON products(branch_id,category_id);

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  url varchar(2048) NOT NULL CHECK (url ~ '^https://[^[:space:]]+$'),
  alt varchar(200),
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 7),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_images_product_branch_fk FOREIGN KEY (product_id,branch_id)
    REFERENCES products (id,branch_id) ON DELETE RESTRICT,
  CONSTRAINT product_images_order_unique UNIQUE (product_id,sort_order)
);
CREATE INDEX product_images_product_idx ON product_images(product_id,sort_order);

CREATE TRIGGER categories_touch_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
CREATE TRIGGER products_touch_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();
