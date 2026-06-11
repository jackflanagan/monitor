/**
 * healthcheck — Supabase Edge Function
 *
 * Checks:
 *   1. Database is reachable (simple query)
 *   2. A reading has been received in the last 30 minutes
 *   3. pending_devices table is not bloating (< 100 rows older than 1 hour)
 *
 * Sends an email alert to ALERT_EMAIL if any check fails.
 *
 * Deploy:  supabase functions deploy healthcheck
 *
 * Schedule (run in Supabase SQL editor):
 *   SELECT cron.schedule(
 *     'healthcheck',
 *     '*\/15 * * * *',   -- every 15 minutes
 *     $$
 *       SELECT net.http_post(
 *         url      := 'https://<project-ref>.supabase.co/functions/v1/healthcheck',
 *         headers  := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
 *       )
 *     $$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ALERT_EMAIL          = Deno.env.get('ALERT_EMAIL') ?? 'admin@plantmoist.com'
const SMTP_FROM            = Deno.env.get('SMTP_FROM') ?? 'Moist Monitor <noreply@plantmoist.com>'

interface CheckResult {
  name: string
  ok: boolean
  message: string
}

Deno.serve(async (_req: Request) => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const checks: CheckResult[] = []
  const startedAt = new Date().toISOString()

  // ── Check 1: Database reachable ───────────────────────────────────────────
  try {
    const { error } = await admin.from('devices').select('id', { count: 'exact', head: true })
    checks.push({
      name: 'database_reachable',
      ok: !error,
      message: error ? `Query failed: ${error.message}` : 'OK',
    })
  } catch (e: unknown) {
    checks.push({
      name: 'database_reachable',
      ok: false,
      message: `Exception: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  // ── Check 2: Recent readings ───────────────────────────────────────────────
  try {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { count, error } = await admin
      .from('readings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since)

    const hasRecent = !error && (count ?? 0) > 0
    checks.push({
      name: 'recent_readings',
      ok: hasRecent,
      message: error
        ? `Query failed: ${error.message}`
        : hasRecent
        ? `${count} reading(s) in the last 30 minutes`
        : 'No readings in the last 30 minutes — devices may be offline',
    })
  } catch (e: unknown) {
    checks.push({
      name: 'recent_readings',
      ok: false,
      message: `Exception: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  // ── Check 3: pending_devices not bloating ─────────────────────────────────
  try {
    const oldThreshold = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error } = await admin
      .from('pending_devices')
      .select('id', { count: 'exact', head: true })
      .lt('created_at', oldThreshold)

    const staleCount = count ?? 0
    const ok = !error && staleCount < 100
    checks.push({
      name: 'pending_devices_healthy',
      ok,
      message: error
        ? `Query failed: ${error.message}`
        : ok
        ? `${staleCount} stale pending device(s) — within limits`
        : `${staleCount} stale pending devices older than 1 hour — possible bloat`,
    })
  } catch (e: unknown) {
    checks.push({
      name: 'pending_devices_healthy',
      ok: false,
      message: `Exception: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  // ── Alert if any check failed ─────────────────────────────────────────────
  const allOk = checks.every((c) => c.ok)
  const failed = checks.filter((c) => !c.ok)

  if (!allOk) {
    const failLines = failed.map((c) => `• ${c.name}: ${c.message}`).join('\n')
    const html = buildAlertEmail(failed, startedAt)

    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          from: SMTP_FROM,
          to: ALERT_EMAIL,
          subject: `🚨 Moist healthcheck failed (${failed.length} check${failed.length > 1 ? 's' : ''})`,
          html,
        }),
      })
      console.warn('Healthcheck alert sent:', failLines)
    } catch (emailErr) {
      console.error('Could not send alert email:', emailErr)
    }
  }

  return new Response(
    JSON.stringify({ ok: allOk, checked_at: startedAt, checks }),
    {
      status: allOk ? 200 : 503,
      headers: { 'Content-Type': 'application/json' },
    }
  )
})

function buildAlertEmail(failed: CheckResult[], checkedAt: string): string {
  const rows = failed
    .map(
      (c) => `<tr>
      <td style="padding:12px 16px;border-bottom:1px solid #1c1c1c;font-size:14px;color:#ff7a7a;font-weight:700">${c.name}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #1c1c1c;font-size:13px;color:#888;font-family:monospace">${c.message}</td>
    </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
        <tr><td style="padding-bottom:24px">
          <div style="font-size:24px;font-weight:900;color:#f0f0f0">Moi<span style="color:#5aff7e">st</span> — Health Alert</div>
        </td></tr>
        <tr><td style="background:#1c1010;border:1px solid #3a1a1a;border-radius:14px;padding:20px;margin-bottom:20px">
          <div style="font-size:16px;font-weight:700;color:#ff7a7a;margin-bottom:8px">
            🚨 ${failed.length} healthcheck${failed.length > 1 ? 's' : ''} failed
          </div>
          <div style="font-size:13px;color:#888;font-family:monospace">Checked at: ${checkedAt}</div>
        </td></tr>
        <tr><td style="padding-top:16px">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden">
            <thead><tr style="background:#1c1c1c">
              <th style="padding:10px 16px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#666">Check</th>
              <th style="padding:10px 16px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#666">Details</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </td></tr>
        <tr><td style="padding-top:24px;font-size:12px;color:#444;font-family:monospace">
          Moist · plantmoist.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
