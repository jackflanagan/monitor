-- Watering log table with RLS
CREATE TABLE IF NOT EXISTS watering_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  watered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes       TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS watering_log_device_id_idx ON watering_log(device_id);
CREATE INDEX IF NOT EXISTS watering_log_watered_at_idx ON watering_log(watered_at DESC);

-- Enable Row Level Security
ALTER TABLE watering_log ENABLE ROW LEVEL SECURITY;

-- Users can only see their own watering logs
CREATE POLICY "Users see own watering logs"
  ON watering_log FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert their own watering logs
CREATE POLICY "Users insert own watering logs"
  ON watering_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own watering logs
CREATE POLICY "Users delete own watering logs"
  ON watering_log FOR DELETE
  USING (auth.uid() = user_id);
