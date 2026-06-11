-- ─── Indexes ──────────────────────────────────────────────────────────────────
-- Speed up per-device queries and time-range scans as the table grows.

CREATE INDEX IF NOT EXISTS readings_device_id_created_at_idx
  ON readings(device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS readings_created_at_idx
  ON readings(created_at DESC);

-- ─── Rate limiting ────────────────────────────────────────────────────────────
-- Reject inserts from a device_id that has posted > 10 readings in the last
-- 60 seconds. This protects against runaway firmware loops or replay attacks.

CREATE OR REPLACE FUNCTION check_reading_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM readings
  WHERE device_id = NEW.device_id
    AND created_at > NOW() - INTERVAL '1 minute';

  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded: device % has posted % readings in the last 60 seconds',
      NEW.device_id, recent_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate the trigger so this migration is idempotent.
DROP TRIGGER IF EXISTS enforce_reading_rate_limit ON readings;

CREATE TRIGGER enforce_reading_rate_limit
  BEFORE INSERT ON readings
  FOR EACH ROW
  EXECUTE FUNCTION check_reading_rate_limit();
