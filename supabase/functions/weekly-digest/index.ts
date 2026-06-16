/**
 * weekly-digest — Supabase Edge Function
 *
 * Sends a personalised weekly push notification + HTML email to each user
 * every Sunday at 9am UTC.
 *
 * For each device calculates over 7 days:
 *   - Average moisture %, time in OK/DRY/WET ranges
 *   - Number of dry alerts (transitions into DRY)
 *   - Number of waterings from watering_log
 *
 * Deploy:  supabase functions deploy weekly-digest
 *
 * Schedule (pg_cron — 9am every Sunday UTC):
 *   SELECT cron.schedule(
 *     'weekly-digest',
 *     '0 9 * * 0',
 *     $$
 *       SELECT net.http_post(
 *         url      := 'https://<project-ref>.supabase.co/functions/v1/weekly-digest',
 *         headers  := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
 *       )
 *     $$
 *   );
 *
 * Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMTP_FROM,
 *                   VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SMTP_FROM            = Deno.env.get('SMTP_FROM') ?? 'Moist <noreply@plantmoist.com>'
const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
const VAPID_SUBJECT        = Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:admin@plantmoist.com'

async function sendWebPush(subscription: Record<string, unknown>, payload: string): Promise<boolean> {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) return false
  try {
    const { webPush } = await import('https://esm.sh/web-push@3.6.7')
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    await webPush.sendNotification(subscription as Parameters<typeof webPush.sendNotification>[0], payload)
    return true
  } catch (e) {
    console.error('Push send failed:', e)
    return false
  }
}

function buildPushMessage(plants: PlantStat[]): { title: string; body: string } {
  if (!plants.length) return { title: 'Weekly plant update 🌿', body: 'No readings this week — check your sensor.' }
  const worst = [...plants].sort((a, b) => (a.okPct ?? 100) - (b.okPct ?? 100))[0]
  const best  = [...plants].sort((a, b) => (b.okPct ?? 0)  - (a.okPct ?? 0))[0]
  if (plants.length === 1) {
    const s = plants[0]
    if ((s.okPct ?? 0) >= 90)  return { title: `${s.name} had a great week 🌿`, body: `Moisture OK ${s.okPct}% of the time — well done!` }
    if ((s.dryPct ?? 0) >= 40) return { title: `${s.name} needs attention 🥀`,  body: `It was dry ${s.dryPct}% of the time this week.` }
    return { title: `${s.name}'s weekly report 📊`, body: `Avg moisture ${s.avgMoisture}%. ${s.wateringCount} watering${s.wateringCount !== 1 ? 's' : ''} logged.` }
  }
  const allGood = plants.every((s) => (s.okPct ?? 0) >= 75)
  if (allGood) return { title: 'All your plants had a great week 🌿', body: plants.map((s) => `${s.name}: OK ${s.okPct}%`).join(' · ') }
  return { title: `${worst.name} needs attention this week 🥀`, body: `Dry ${worst.dryPct}% of the time. ${best.name} is thriving (OK ${best.okPct}%).` }
}

interface PlantStat {
  name:          string
  avgMoisture:   number | null
  okPct:         number | null
  dryPct:        number | null
  wetPct:        number | null
  dryCount:      number
  wateringCount: number
  readingCount:  number
}

Deno.serve(async (_req: Request) => {
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers()
    if (usersError) throw usersError

    let pushSent = 0, emailSent = 0

    for (const u of usersData.users) {
      if (!u.email) continue

      const { data: devices } = await admin
        .from('devices').select('device_id, plant_name').eq('user_id', u.id)
      if (!devices?.length) continue

      const plantStats: PlantStat[] = await Promise.all(
        devices.map(async (device: { device_id: string; plant_name: string }) => {
          const [readingsRes, wateringsRes] = await Promise.all([
            admin.from('readings').select('moisture, status').eq('device_id', device.device_id).gte('created_at', since),
            admin.from('watering_log').select('id', { count: 'exact', head: true }).eq('device_id', device.device_id).eq('user_id', u.id).gte('watered_at', since),
          ])
          const readings = readingsRes.data ?? []
          const total    = readings.length
          const okPct    = total ? Math.round(readings.filter((r: any) => r.status === 'OK').length  / total * 100) : null
          const dryPct   = total ? Math.round(readings.filter((r: any) => r.status === 'DRY').length / total * 100) : null
          const wetPct   = total ? Math.round(readings.filter((r: any) => r.status === 'WET').length / total * 100) : null
          const dryCount = readings.reduce((n: number, r: any, i: number) =>
            i > 0 && r.status === 'DRY' && readings[i - 1].status !== 'DRY' ? n + 1 : n, 0)
          return {
            name:          device.plant_name || device.device_id,
            avgMoisture:   total ? Math.round(readings.reduce((s: number, r: any) => s + r.moisture, 0) / total) : null,
            okPct, dryPct, wetPct, dryCount,
            wateringCount: wateringsRes.count ?? 0,
            readingCount:  total,
          }
        })
      )

      // ── Push notification ──────────────────────────────────────────────────
      const { data: subs } = await admin.from('push_subscriptions').select('subscription').eq('user_id', u.id)
      if (subs?.length) {
        const { title, body } = buildPushMessage(plantStats)
        const payload = JSON.stringify({ title, body, icon: '/icon-192.png', badge: '/badge-72.png' })
        for (const row of subs) {
          const ok = await sendWebPush(row.subscription, payload)
          if (ok) pushSent++
        }
      }

      // ── HTML email ─────────────────────────────────────────────────────────
      const html = buildEmailHtml(u.email, plantStats)
      const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        body: JSON.stringify({ from: SMTP_FROM, to: u.email, subject: '🌿 Your weekly Moist report', html }),
      })
      if (emailRes.ok) emailSent++
    }

    return new Response(JSON.stringify({ ok: true, users: usersData.users.length, pushSent, emailSent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('weekly-digest error:', message)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})

function buildEmailHtml(email: string, plants: PlantStat[]): string {
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
