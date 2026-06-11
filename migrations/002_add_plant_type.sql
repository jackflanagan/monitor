-- Add plant_type column to devices table
ALTER TABLE devices ADD COLUMN IF NOT EXISTS plant_type VARCHAR(32);
