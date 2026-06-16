-- Migration 010: firmware_version and rssi columns on readings
-- firmware_version: string sent by ESP32 on every POST (e.g. "1.0.0")
-- rssi: WiFi signal strength in dBm (e.g. -65)

ALTER TABLE readings
  ADD COLUMN IF NOT EXISTS firmware_version TEXT,
  ADD COLUMN IF NOT EXISTS rssi             INTEGER;

-- app_config: stores latest_firmware_version so the app can show update badges
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial firmware version
INSERT INTO app_config (key, value)
  VALUES ('latest_firmware_version', '1.0.0')
  ON CONFLICT (key) DO NOTHING;

-- RLS: everyone can read app_config, only service role can write
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read app_config"
  ON app_config FOR SELECT
  TO anon, authenticated
  USING (true);
