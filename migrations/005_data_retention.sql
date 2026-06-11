-- Add retention_days column to devices (default 90 days)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 90;

-- Helper: delete readings older than retention_days for a given device
-- Called by the cleanup Edge Function.
CREATE OR REPLACE FUNCTION cleanup_old_readings(p_device_id TEXT, p_retention_days INTEGER)
RETURNS INTEGER AS $$
DECLARE
  cutoff TIMESTAMPTZ := NOW() - (p_retention_days || ' days')::INTERVAL;
  older_cutoff TIMESTAMPTZ := NOW() - INTERVAL '7 days';
  deleted_count INTEGER := 0;
  tmp INTEGER;
BEGIN
  -- Step 1: Downsample readings older than 7 days — keep one reading per hour.
  -- Delete readings in the 7-day-to-retention window that are NOT the first
  -- reading in their (device_id, hour) bucket.
  DELETE FROM readings
  WHERE device_id = p_device_id
    AND created_at < older_cutoff
    AND created_at >= cutoff
    AND id NOT IN (
      SELECT DISTINCT ON (date_trunc('hour', created_at)) id
      FROM readings
      WHERE device_id = p_device_id
        AND created_at < older_cutoff
        AND created_at >= cutoff
      ORDER BY date_trunc('hour', created_at), created_at
    );
  GET DIAGNOSTICS tmp = ROW_COUNT;
  deleted_count := deleted_count + tmp;

  -- Step 2: Delete everything older than the retention cutoff.
  DELETE FROM readings
  WHERE device_id = p_device_id
    AND created_at < cutoff;
  GET DIAGNOSTICS tmp = ROW_COUNT;
  deleted_count := deleted_count + tmp;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
