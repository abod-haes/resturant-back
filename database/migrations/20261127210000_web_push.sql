-- Extend existing push registry and deliveries; preserve Expo rows.
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_web_push_owner_unique UNIQUE (id,user_id);
ALTER TABLE employee_push_devices DROP CONSTRAINT employee_push_devices_platform_check;
ALTER TABLE employee_push_devices DROP CONSTRAINT employee_push_devices_token_box_check;
ALTER TABLE employee_push_devices ADD COLUMN channel varchar(12) NOT NULL DEFAULT 'expo',
 ADD COLUMN session_id uuid, ADD COLUMN expires_at timestamptz;
ALTER TABLE employee_push_devices ADD CONSTRAINT push_device_channel_check CHECK (
 (channel='expo' AND platform IN ('android','ios') AND session_id IS NULL AND expires_at IS NULL)
 OR (channel='web_push' AND platform='web' AND (session_id IS NOT NULL OR NOT is_active)));
ALTER TABLE employee_push_devices ADD CONSTRAINT push_device_box_check CHECK (
 (channel='expo' AND length(token_box) BETWEEN 50 AND 900)
 OR (channel='web_push' AND length(token_box) BETWEEN 50 AND 8192));
ALTER TABLE employee_push_devices ADD CONSTRAINT push_device_session_owner_fk
 FOREIGN KEY(session_id,user_id) REFERENCES auth_sessions(id,user_id) ON DELETE RESTRICT;
CREATE INDEX push_device_web_session_idx ON employee_push_devices(session_id) WHERE session_id IS NOT NULL;
ALTER TABLE push_deliveries ADD COLUMN channel varchar(12) NOT NULL DEFAULT 'expo' CHECK(channel IN ('expo','web_push'));

-- Web Push has provider acceptance but no Expo-style delivery receipt.
ALTER TABLE push_deliveries DROP CONSTRAINT push_deliveries_receipt_status_check;
ALTER TABLE push_deliveries ADD CONSTRAINT push_deliveries_receipt_status_check CHECK (
 (channel='expo' AND receipt_status IN ('waiting','ok','error','expired')) OR
 (channel='web_push' AND receipt_status='not_required'));

-- Revoke browser delivery credentials atomically with session revocation.
CREATE FUNCTION deactivate_revoked_web_push_devices() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    UPDATE employee_push_devices SET is_active=false
      WHERE channel='web_push' AND session_id=NEW.id AND is_active=true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER auth_sessions_revoke_web_push
  AFTER UPDATE OF revoked_at ON auth_sessions
  FOR EACH ROW EXECUTE FUNCTION deactivate_revoked_web_push_devices();

-- Enforce channel consistency for every delivery, including legacy Expo rows.
ALTER TABLE employee_push_devices ADD CONSTRAINT push_device_id_channel_unique UNIQUE (id,channel);
ALTER TABLE push_deliveries ADD CONSTRAINT push_delivery_device_channel_fk
 FOREIGN KEY (device_id,channel) REFERENCES employee_push_devices(id,channel) ON DELETE RESTRICT;
ALTER TABLE push_deliveries ADD CONSTRAINT push_delivery_web_no_ticket_check
 CHECK (channel='expo' OR ticket_id IS NULL);

-- Detach retired sessions while preserving device and delivery history.
-- The restrictive FK remains a backstop; active web devices must have a session.
CREATE FUNCTION detach_deleted_web_push_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE employee_push_devices SET is_active=false, session_id=NULL
    WHERE channel='web_push' AND session_id=OLD.id AND user_id=OLD.user_id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER auth_sessions_delete_web_push
  BEFORE DELETE ON auth_sessions
  FOR EACH ROW EXECUTE FUNCTION detach_deleted_web_push_sessions();
