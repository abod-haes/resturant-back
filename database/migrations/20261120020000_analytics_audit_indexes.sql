-- v1.10: bounded analytics and stable global audit keyset read indexes.
-- Forward-only migration; no existing table/column modified.
CREATE INDEX audit_logs_global_keyset_idx ON audit_logs (created_at DESC, id DESC);
CREATE INDEX audit_logs_restaurant_keyset_idx
  ON audit_logs (restaurant_id, created_at DESC, id DESC);
CREATE INDEX service_calls_restaurant_branch_time_idx
  ON service_calls (restaurant_id, branch_id, created_at DESC)
  INCLUDE (type, delivery_state, table_id);
