-- Migration 008: Notification settings per device
-- notification_settings stores dry threshold, frequency, quiet hours, and sound
-- last_notified tracks when a push was last sent to avoid spamming

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS notification_settings JSONB,
  ADD COLUMN IF NOT EXISTS last_notified         TIMESTAMPTZ;

COMMENT ON COLUMN devices.notification_settings IS
  '{"dry_threshold":30,"frequency":"hourly","sound":true,"quiet_hours":{"enabled":false,"start":"22:00","end":"08:00"}}';

COMMENT ON COLUMN devices.last_notified IS
  'Timestamp of the last push notification sent for this device — used for frequency throttling';
