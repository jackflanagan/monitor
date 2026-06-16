/**
 * reset-device — Supabase Edge Function
 *
 * Inserts a reset_wifi command into device_commands for the specified device.
 * The ESP32 polls this table every 60 seconds and executes pending commands.
 *
 * Called by the Moist app when the user confirms WiFi reset in device settings.
 *
 * Deploy: supabase functions deploy reset-device
 *
 * Request body: { "device_id": "ESP32-ABCD" }
 * Auth: requires valid user JWT (checks device ownership)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Verify the caller is an authenticated user
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(SUPABASE_URL, authHeader.replace('Bearer ', ''), {
    auth: { persistSession: false },
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let body: { device_id?: string }
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { device_id } = body
  if (!device_id) return new Response(JSON.stringify({ error: 'device_id required' }), { status: 400 })

  // Confirm this device belongs to the authenticated user
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  const { data: device } = await admin
    .from('devices')
    .select('device_id')
    .eq('device_id', device_id)
    .eq('user_id', user.id)
    .single()

  if (!device) return new Response(JSON.stringify({ error: 'Device not found' }), { status: 404 })

  const { error } = await admin
    .from('device_commands')
    .insert({ device_id, command: 'reset_wifi' })

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
