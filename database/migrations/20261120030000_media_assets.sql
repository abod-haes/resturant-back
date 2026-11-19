-- v1.11: tenant-owned media library with private documents and managed product images.
-- Only new, forward-only structures; existing remote URL-based products remain readable.
CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('image','document')),
  object_key varchar(512) NOT NULL UNIQUE,
  public_url varchar(2048),
  original_name varchar(200) NOT NULL,
  content_type varchar(64) NOT NULL CHECK (content_type IN ('image/webp','application/pdf')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  width integer CHECK (width BETWEEN 1 AND 8192),
  height integer CHECK (height BETWEEN 1 AND 8192),
  status varchar(16) NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading','ready','deleting','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_branch_tenant_fk FOREIGN KEY (branch_id,restaurant_id)
    REFERENCES branches(id,restaurant_id) ON DELETE RESTRICT,
  CONSTRAINT media_id_tenant_unique UNIQUE(id,restaurant_id),
  CONSTRAINT media_shape_check CHECK (
    (kind='image' AND content_type='image/webp' AND width IS NOT NULL AND height IS NOT NULL AND public_url IS NOT NULL)
    OR (kind='document' AND content_type='application/pdf' AND width IS NULL AND height IS NULL AND public_url IS NULL)
    OR status='uploading'
  )
);
CREATE INDEX media_assets_restaurant_list_idx ON media_assets(restaurant_id,created_at DESC,id DESC)
  WHERE status='ready';
CREATE INDEX media_assets_cleanup_idx ON media_assets(status,updated_at,id);
CREATE TRIGGER media_assets_touch_updated_at BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION platform_touch_updated_at();

-- Existing product_images were scoped by product + branch; backfill the restaurant ID
-- before adding composite tenant FKs. Same-tenant media can be reused across branches.
ALTER TABLE product_images ADD COLUMN restaurant_id uuid;
UPDATE product_images pi SET restaurant_id = p.restaurant_id
FROM products p WHERE p.id = pi.product_id;
ALTER TABLE product_images ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE product_images ADD COLUMN media_asset_id uuid;
ALTER TABLE products ADD CONSTRAINT product_id_branch_restaurant_unique UNIQUE(id,branch_id,restaurant_id);
ALTER TABLE product_images ADD CONSTRAINT product_images_product_tenant_fk
  FOREIGN KEY (product_id,branch_id,restaurant_id)
  REFERENCES products(id,branch_id,restaurant_id) ON DELETE RESTRICT;
ALTER TABLE product_images ADD CONSTRAINT product_images_media_tenant_fk
  FOREIGN KEY (media_asset_id,restaurant_id)
  REFERENCES media_assets(id,restaurant_id) ON DELETE RESTRICT;
CREATE INDEX product_images_media_reference_idx
  ON product_images(media_asset_id) WHERE media_asset_id IS NOT NULL;
