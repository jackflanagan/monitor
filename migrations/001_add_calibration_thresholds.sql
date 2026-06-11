-- Add calibration threshold columns to devices table
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dry_threshold INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS wet_threshold INTEGER;
