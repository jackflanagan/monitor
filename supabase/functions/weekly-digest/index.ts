/**
 * weekly-digest — Supabase Edge Function
 *
 * Sends a weekly HTML email to every user with a 7-day summary of their plants:
 *   - Average moisture per plant
 *   - Number of dry alerts
 *   - Number of watering events
 *
 * Deploy:  supabase functions deploy weekly-digest
 *
 * Schedule (run in Supabase SQL editor):
 *   SELECT cron.schedule(
 *     'weekly-digest',
 *     '0 9 * * 1',   -- every Monday at 09:00 UTC
 *     $$
 *       SELECT net.http_post(
 *         url      := 'https://<project-ref>.supabase.co/functions/v1/weekly-digest',
 *         headers  := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
 *       )
 *     $$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SMTP_FROM           = Deno.env.get('SMTP_FROM') ?? 'Moist <noreply@plantmoist.com>'

interface Device {
  device_id: string
  plant_name: string
  user_id: string
}

interface UserRow {
  id: string
  email: string
}

interface ReadingSummary {
  avg_moisture: number
  dry_count: number
}

interface WateringSummary {
  watering_count: number
}

Deno.serve(async (_req: Request) => {
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Fetch all users via Auth admin API
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers()
    if (usersError) throw usersError
    const users: UserRow[] = usersData.users.map((u) => ({ id: u.id, email: u.email ?? '' }))

    let sent = 0

    for (const user of users) {
      if (!user.email) continue

      // Fetch user's devices
      const { data: devices } = await admin
        .from('devices')
        .select('device_id, plant_name, user_id')
        .eq('user_id', user.id)

      if (!devices || devices.length === 0) continue

      // Build stats per device
      const plantStats = await Promise.all(
        devices.map(async (device: Device) => {
          const [readingsRes, wateringsRes] = await Promise.all([
            admin
              .from('readings')
              .select('moisture, status')
              .eq('device_id', device.device_id)
              .gte('created_at', since),
            admin
              .from('watering_log')
              .select('id', { count: 'exact', head: true })
              .eq('device_id', device.device_id)
              .eq('user_id', user.id)
              .gte('watered_at', since),
          ])

          const readings = readingsRes.data ?? []
          const avgMoisture =
            readings.length > 0
              ? Math.round(readings.reduce((s: number, r: any) => s + r.moisture, 0) / readings.length)
              : null
          const dryCount = readings.filter((r: any) => r.status === 'DRY').length
          const wateringCount = wateringsRes.count ?? 0

          return {
            name: device.plant_name || device.device_id,
            avgMoisture,
            dryCount,
            wateringCount,
            readingCount: readings.length,
          }
        })
      )

      const html = buildEmailHtml(user.email, plantStats)

      // Send via Supabase SMTP (Resend integration)
      const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          from: SMTP_FROM,
          to: user.email,
          subject: '🌿 Your weekly Moist report',
          html,
        }),
      })

      if (emailRes.ok) sent++
    }

    return new Response(JSON.stringify({ ok: true, users: users.length, sent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('weekly-digest error:', message)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

function buildEmailHtml(
  email: string,
  plants: Array<{
    name: string
    avgMoisture: number | null
    dryCount: number
    wateringCount: number
    readingCount: number
  }>
): string {
  const rows = plants
    .map((p) => {
      const moisture = p.avgMoisture !== null ? `${p.avgMoisture}%` : 'No data'
      const moistureColor =
        p.avgMoisture === null
          ? '#666'
          : p.avgMoisture < 30
          ? '#ffb830'
          : p.avgMoisture >= 70
          ? '#4aadff'
          : '#5aff7e'

      return `
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #1c1c1c;font-size:14px;font-weight:700;color:#f0f0f0">
            🌿 ${escHtml(p.name)}
          </td>
          <td style="padding:14px 16px;border-bottom:1px solid #1c1c1c;font-size:14px;font-family:monospace;color:${moistureColor};text-align:center">
            ${moisture}
          </td>
          <td style="padding:14px 16px;border-bottom:1px solid #1c1c1c;font-size:14px;font-family:monospace;color:${p.dryCount > 0 ? '#ffb830' : '#5aff7e'};text-align:center">
            ${p.dryCount}
          </td>
          <td style="padding:14px 16px;border-bottom:1px solid #1c1c1c;font-size:14px;font-family:monospace;color:#4aadff;text-align:center">
            ${p.wateringCount}
          </td>
        </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

        <!-- Header -->
        <tr>
          <td style="padding-bottom:32px">
            <div style="font-size:28px;font-weight:900;letter-spacing:-0.03em;color:#f0f0f0">
              Moi<span style="color:#5aff7e">st</span>
            </div>
            <div style="font-size:13px;color:#666;font-family:monospace;margin-top:4px">
              soil moisture · anywhere
            </div>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="background:#141414;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:24px;margin-bottom:20px">
            <div style="font-size:20px;font-weight:800;color:#f0f0f0;margin-bottom:8px">
              Your weekly plant report 🌱
            </div>
            <div style="font-size:14px;color:#888;line-height:1.6">
              Here's how your plants did in the last 7 days, ${escHtml(email)}.
            </div>
          </td>
        </tr>

        <!-- Stats table -->
        <tr><td style="padding-top:16px">
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#141414;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
            <thead>
              <tr style="background:#1c1c1c">
                <th style="padding:12px 16px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#666;font-weight:500">Plant</th>
                <th style="padding:12px 16px;text-align:center;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#666;font-weight:500">Avg moisture</th>
                <th style="padding:12px 16px;text-align:center;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#666;font-weight:500">Dry alerts</th>
                <th style="padding:12px 16px;text-align:center;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#666;font-weight:500">Waterings</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding-top:24px;text-align:center">
          <a href="https://plantmoist.com"
            style="display:inline-block;background:#5aff7e;color:#000;text-decoration:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:900;letter-spacing:-0.01em">
            Open Moist →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:32px;text-align:center;font-size:12px;color:#444;font-family:monospace;line-height:1.7">
          Moist · plantmoist.com<br>
          <a href="https://plantmoist.com/privacy.html" style="color:#444">Privacy policy</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
