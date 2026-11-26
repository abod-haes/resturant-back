ALTER TABLE categories ADD COLUMN image_media_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT;
ALTER TABLE categories ADD COLUMN image_url text;
ALTER TABLE categories ADD CONSTRAINT categories_image_pair_check CHECK ((image_media_id IS NULL) = (image_url IS NULL));
CREATE INDEX categories_image_media_idx ON categories(image_media_id) WHERE image_media_id IS NOT NULL;
