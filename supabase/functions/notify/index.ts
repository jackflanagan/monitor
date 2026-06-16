/**
 * notify — Supabase Edge Function
 *
 * Checks all devices for dry conditions and sends push notifications,
 * respecting per-device notification_settings (quiet hours, frequency,
 * custom dry threshold).
 *
 * Deploy:  supabase functions deploy notify
 *
 * Schedule (pg_cron — run every 10 minutes):
 *   SELECT cron.schedule(
 *     'notify-dry-plants',
 *     '*\/10 * * * *',
 *     $$
 *       SELECT net.http_post(
 *         url     := 'https://<project-ref>.supabase.co/functions/v1/notify',
 *         headers := '{"Authorization":"Bearer <service-role-key>"}'::jsonb
 *       )
 *     $$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_SUBJECT        = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@plantmoist.com'

interface NotifSettings {
  dry_threshold?: number
  frequency?: 'always' | 'hourly' | 'daily'
  sound?: boolean
  quiet_hours?: { enabled?: boolean; start?: string; end?: string }
}

function isQuietHour(settings: NotifSettings): boolean {
  const qh = settings.quiet_hours
  if (!qh?.enabled) return false
  const now = new Date()
  const [startH, startM] = (qh.start ?? '22:00').split(':').map(Number)
  const [endH, endM]     = (qh.end   ?? '08:00').split(':').map(Number)
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes()
  const startMins = startH * 60 + startM
  const endMins   = endH   * 60 + endM
  // Handle overnight ranges (e.g. 22:00 – 08:00)
  if (startMins > endMins) return nowMins >= startMins || nowMins < endMins
  return nowMins >= startMins && nowMins < endMins
}

function frequencyOk(lastNotified: string | null, frequency: string): boolean {
  if (!lastNotified) return true
  const msSince = Date.now() - new Date(lastNotified).getTime()
  if (frequency === 'always') return true
  if (frequency === 'hourly') return msSince >= 60 * 60 * 1000
  if (frequency === 'daily')  return msSince >= 24 * 60 * 60 * 1000
  return true
}

// Minimal web-push using the VAPID private key via SubtleCrypto
// For full VAPID support, use the web-push npm package with esm.sh
async function sendWebPush(subscription: Record<string, unknown>, payload: string): Promise<boolean> {
  try {
    // Use a lightweight web-push compatible library via esm.sh
    const { webPush } = await import('https://esm.sh/web-push@3.6.7')
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    await webPush.sendNotification(subscription as Parameters<typeof webPush.sendNotification>[0], payload)
    return true
  } catch (e) {
    console.error('Push send failed:', e)
    return false
  }
}

Deno.serve(async (_req: Request) => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  // Fetch all devices with their latest reading and owner's push subscriptions
  const { data: devices, error: devErr } = await admin
    .from('devices')
    .select('device_id, plant_name, user_id, notification_settings, last_notified')

  if (devErr || !devices) {
    return new Response(JSON.stringify({ error: devErr?.message }), { status: 500 })
  }

  let sent = 0, skipped = 0

  for (const device of devices) {
    const ns: NotifSettings = device.notification_settings ?? {}
    const dryThreshold = ns.dry_threshold ?? 30
    const frequency    = ns.frequency    ?? 'hourly'

    // Skip quiet hours
    if (isQuietHour(ns)) { skipped++; continue }

    // Skip frequency limit
    if (!frequencyOk(device.last_notified, frequency)) { skipped++; continue }

    // Get latest reading for this device
    const { data: readings } = await admin
      .from('readings')
      .select('moisture, status, created_at')
      .eq('device_id', device.device_id)
      .order('created_at', { ascending: false })
      .limit(1)

    const latest = readings?.[0]
    if (!latest) { skipped++; continue }

    // Only notify if reading is recent (< 20 min old) and moisture is dry
    const ageMs = Date.now() - new Date(latest.created_at).getTime()
    if (ageMs > 20 * 60 * 1000) { skipped++; continue }
    if (latest.moisture > dryThreshold) { skipped++; continue }

    // Get user's push subscriptions
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', device.user_id)

    if (!subs?.length) { skipped++; continue }

    const plantName = device.plant_name ?? 'Your plant'
    const payload = JSON.stringify({
      title: `${plantName} is thirsty 🥀`,
      body: `Moisture at ${latest.moisture}% — time to water 💧`,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      silent: ns.sound === false,
    })

    for (const row of subs) {
      const ok = await sendWebPush(row.subscription, payload)
      if (ok) sent++
    }

    // Update last_notified
    await admin
      .from('devices')
      .update({ last_notified: new Date().toISOString() })
      .eq('device_id', device.device_id)
  }

  return new Response(
    JSON.stringify({ sent, skipped, devices: devices.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
