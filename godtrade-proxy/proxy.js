/**
 * GODTRADE — Delta Exchange Cloud Proxy
 * Deploy this on Railway for a fixed IP.
 * Your API keys are sent in request headers from your browser.
 * They are never stored on this server.
 */

const express = require('express')
const cors    = require('cors')
const fetch   = require('node-fetch')
const crypto  = require('crypto')

const app  = express()
const PORT = process.env.PORT || 3001

const DELTA_BASE = 'https://api.india.delta.exchange'

app.use(cors({ origin: '*' }))
app.use(express.json())

// ── HMAC Signature ────────────────────────────────────────────────────
function generateSignature(secret, method, timestamp, path, qs, body) {
  const msg = method + timestamp + path + qs + body
  return crypto.createHmac('sha256', secret).update(msg).digest('hex')
}

// ── Safe response parser ──────────────────────────────────────────────
function extractError(data) {
  if (!data) return 'No response'
  const e = data.error
  if (e) {
    if (typeof e === 'string') return e
    if (typeof e === 'object') return e.message || e.code || e.error_code || JSON.stringify(e)
  }
  return data.message || data.code || JSON.stringify(data)
}

// ── Main proxy handler ────────────────────────────────────────────────
async function proxyDelta(req, res) {
  const apiKey    = req.headers['x-delta-key']
  const apiSecret = req.headers['x-delta-secret']

  if (!apiKey || !apiSecret) {
    return res.status(401).json({ error: 'Missing x-delta-key or x-delta-secret headers' })
  }

  const method    = req.method.toUpperCase()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const path      = req.path
  const qs        = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
  const isBody    = ['POST', 'PUT', 'PATCH'].includes(method)
  const bodyStr   = isBody && req.body && Object.keys(req.body).length > 0
    ? JSON.stringify(req.body) : ''

  const signature = generateSignature(apiSecret, method, timestamp, path, qs, bodyStr)
  const headers   = {
    'Content-Type': 'application/json',
    'api-key':      apiKey,
    'timestamp':    timestamp,
    'signature':    signature,
  }

  const url = DELTA_BASE + path + qs
  console.log(method + ' ' + url)

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: bodyStr || undefined,
      timeout: 10000,
    })

    const text = await response.text()
    console.log('Status: ' + response.status + ' Body: ' + text.slice(0, 200))

    if (!text || !text.trim()) {
      return res.status(response.status).json({
        error: 'Empty response from Delta (HTTP ' + response.status + ')'
      })
    }

    let data
    try { data = JSON.parse(text) }
    catch(e) { data = { error: 'Non-JSON: ' + text.slice(0, 100) } }

    res.status(response.status).json(data)

  } catch (err) {
    console.error('Fetch error: ' + err.message)
    res.status(502).json({ error: 'Fetch failed: ' + err.message })
  }
}

// ── Health check ──────────────────────────────────────────────────────
app.get('/_health', (req, res) => {
  res.json({
    status:     'ok',
    endpoint:   DELTA_BASE,
    serverTime: Math.floor(Date.now() / 1000),
    message:    'GODTRADE Delta Proxy running on Railway'
  })
})

// ── IP reporter — use this to find Railway outbound IP ───────────────
app.get('/_myip', async (req, res) => {
  try {
    const r    = await fetch('https://api4.my-ip.io/ip')
    const ip   = await r.text()
    res.json({ outboundIP: ip.trim(), message: 'Add this IP to Delta Exchange API key whitelist' })
  } catch(e) {
    res.json({ error: e.message })
  }
})

// ── All other routes → Delta ──────────────────────────────────────────
app.all('*', proxyDelta)

app.listen(PORT, () => {
  console.log('GODTRADE Delta Proxy running on port ' + PORT)
  console.log('Delta endpoint: ' + DELTA_BASE)
})
