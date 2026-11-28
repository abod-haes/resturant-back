ALTER TABLE restaurants ADD COLUMN menu_font_family varchar(32),
 ADD CONSTRAINT restaurants_menu_font_family CHECK (menu_font_family IS NULL OR menu_font_family IN ('cairo','tajawal','noto-naskh','amiri','ibm-plex','system'));
