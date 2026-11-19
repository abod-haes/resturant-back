-- Efficient stable keyset pagination for platform admin restaurant list.
CREATE INDEX restaurants_admin_created_id_idx ON restaurants (created_at DESC, id DESC);
