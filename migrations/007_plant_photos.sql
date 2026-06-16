-- Migration 007: Plant photos
-- Adds photo_url column to devices table.
-- The actual image is stored in a Supabase Storage bucket called 'plant-photos'.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ─── Storage bucket setup (run once in Supabase dashboard or via API) ─────────
-- Create bucket: plant-photos (public)
-- Then apply these RLS policies so users can only access their own folder.

-- Insert: users can upload to their own folder (user_id/*)
-- CREATE POLICY "Users can upload own photos"
-- ON storage.objects FOR INSERT
-- TO authenticated
-- WITH CHECK (bucket_id = 'plant-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Select: users can read their own photos (bucket is public so public URLs work too)
-- CREATE POLICY "Users can read own photos"
-- ON storage.objects FOR SELECT
-- TO authenticated
-- USING (bucket_id = 'plant-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Update / Delete: users can replace or remove their own photos
-- CREATE POLICY "Users can update own photos"
-- ON storage.objects FOR UPDATE
-- TO authenticated
-- USING (bucket_id = 'plant-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- CREATE POLICY "Users can delete own photos"
-- ON storage.objects FOR DELETE
-- TO authenticated
-- USING (bucket_id = 'plant-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
