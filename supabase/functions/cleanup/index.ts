/**
 * cleanup — Supabase Edge Function
 *
 * Runs data retention on the readings table for all devices:
 *   1. For readings older than 7 days: keep one reading per hour (downsampling)
 *   2. Delete readings older than the device's retention_days (default 90)
 *
 * Deploy:  supabase functions deploy cleanup
 *
 * Schedule (run in Supabase SQL editor):
 *   SELECT cron.schedule(
 *     'cleanup-readings',
 *     '0 2 * * *',   -- every day at 02:00 UTC
 *     $$
 *       SELECT net.http_post(
 *         url      := 'https://<project-ref>.supabase.co/functions/v1/cleanup',
 *         headers  := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
 *       )
 *     $$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (_req: Request) => {
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    // Fetch all devices with their retention setting
    const { data: devices, error } = await admin
      .from('devices')
      .select('device_id, retention_days')

    if (error) throw error
    if (!devices || devices.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, total_deleted: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let totalDeleted = 0

    for (const device of devices) {
      const retentionDays = device.retention_days ?? 90

      // Call the PG helper function defined in migration 005
      const { data: result, error: cleanupError } = await admin.rpc('cleanup_old_readings', {
        p_device_id: device.device_id,
        p_retention_days: retentionDays,
      })

      if (cleanupError) {
        console.error(`cleanup error for ${device.device_id}:`, cleanupError.message)
      } else {
        totalDeleted += result ?? 0
      }
    }

    console.log(`Cleanup complete. Devices: ${devices.length}, rows deleted: ${totalDeleted}`)

    return new Response(
      JSON.stringify({ ok: true, processed: devices.length, total_deleted: totalDeleted }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('cleanup error:', message)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
