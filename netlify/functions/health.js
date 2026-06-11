/**
 * netlify/functions/health.js
 *
 * Lightweight health endpoint for the Moist Netlify deployment.
 * Returns a 200 JSON response with uptime stats.
 *
 * Available at: /.netlify/functions/health
 * Also reachable via the redirect below (add to netlify.toml):
 *
 *   [[redirects]]
 *   from = "/health"
 *   to   = "/.netlify/functions/health"
 *   status = 200
 */

const startedAt = new Date().toISOString()
const startedMs = Date.now()

exports.handler = async function handler(event, _context) {
  const uptimeMs = Date.now() - startedMs
  const uptimeSecs = Math.floor(uptimeMs / 1000)

  const body = {
    status: 'ok',
    service: 'moist-web',
    version: process.env.DEPLOY_ID || 'local',
    environment: process.env.CONTEXT || 'development',
    region: process.env.AWS_REGION || 'unknown',
    started_at: startedAt,
    uptime_seconds: uptimeSecs,
    checked_at: new Date().toISOString(),
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body, null, 2),
  }
}
