-- Retain historical employee records; archiving frees plan quota and immediately disables login.
ALTER TABLE users ADD COLUMN archived_at timestamptz;
CREATE INDEX employee_nonarchived_quota_idx ON users(restaurant_id,branch_id)
  WHERE role='EMPLOYEE' AND archived_at IS NULL;
