-- Migration 006: Add calibration JSONB column to devices
-- Stores the wizard-captured dry/wet ADC values as {dry_value, wet_value}
-- The existing dry_threshold and wet_threshold columns remain for backwards
-- compatibility with plant-type presets; calibration takes precedence in the app.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS calibration JSONB;

COMMENT ON COLUMN devices.calibration IS
  'Wizard-calibrated sensor range: {"dry_value": <ADC in air>, "wet_value": <ADC in water>}';
