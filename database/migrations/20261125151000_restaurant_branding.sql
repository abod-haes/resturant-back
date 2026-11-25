ALTER TABLE restaurants
 ADD COLUMN logo_url varchar(2048),
 ADD COLUMN primary_color varchar(7),
 ADD COLUMN secondary_color varchar(7),
 ADD CONSTRAINT restaurants_logo_https CHECK (logo_url IS NULL OR logo_url LIKE 'https://%'),
 ADD CONSTRAINT restaurants_primary_color CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$'),
 ADD CONSTRAINT restaurants_secondary_color CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9a-fA-F]{6}$');
