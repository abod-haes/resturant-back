ALTER TABLE restaurants ADD COLUMN font_family varchar(32),
 ADD CONSTRAINT restaurants_font_family CHECK (font_family IS NULL OR font_family IN ('cairo','system'));
