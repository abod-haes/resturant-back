-- Additive migration: existing tenants retain their legacy URLs.
ALTER TABLE restaurants ADD COLUMN subdomain varchar(63),
 ADD COLUMN domain_status varchar(7) NOT NULL DEFAULT 'pending',
 ADD CONSTRAINT restaurants_subdomain_format CHECK (subdomain IS NULL OR subdomain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
 ADD CONSTRAINT restaurants_subdomain_unique UNIQUE (subdomain),
 ADD CONSTRAINT restaurants_domain_status_check CHECK (domain_status IN ('pending','ready') AND (domain_status <> 'ready' OR subdomain IS NOT NULL));
