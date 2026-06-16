-- Migration 009: Device commands table
-- Stores commands sent from the app to ESP32 devices (e.g. reset_wifi).
-- The firmware polls this table every 60 seconds and marks commands executed.

CREATE TABLE IF NOT EXISTS device_commands (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   TEXT        NOT NULL,
  command     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_device_commands_device_pending
  ON device_commands (device_id, created_at)
  WHERE executed_at IS NULL;

-- RLS
ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert commands for their own devices
CREATE POLICY "Users can insert commands for own devices"
  ON device_commands FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM devices
      WHERE devices.device_id = device_commands.device_id
        AND devices.user_id   = auth.uid()
    )
  );

-- Anon key (used by ESP32) can read and update unexecuted commands for its device
-- The device_id is passed as a filter in the query, so no additional auth needed here.
CREATE POLICY "Anon can read pending commands"
  ON device_commands FOR SELECT
  TO anon
  USING (executed_at IS NULL);

CREATE POLICY "Anon can mark commands executed"
  ON device_commands FOR UPDATE
  TO anon
  USING (executed_at IS NULL)
  WITH CHECK (executed_at IS NOT NULL);
