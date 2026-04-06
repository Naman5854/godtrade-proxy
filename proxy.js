/**
 * GODTRADE — Delta Exchange Cloud Proxy
 * Deploy on Render.com for a fixed IP.
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

function generateSignature(secret, method, timestamp, path, qs, body) {
  const msg = method + timestamp + path + qs + body
  return crypto.createHmac('sha256', secret).update(msg).digest('hex')
}

function extractError(data) {
  if (!data) return 'No response'
  const e = data.error
  if (e) {
    if (typeof e === 'string') return e
    if (typeof e === 'object') return e.message || e.code || e.error_code || JSON.stringify(e)
  }
  return data.message || data.code || JSON.stringify(data)
}

// ── Public routes (no auth needed) ───────────────────────────────────

app.get('/_health', (req, res) => {
  res.json({ status: 'ok', endpoint: DELTA_BASE, serverTime: Math.floor(Date.now() / 1000) })
})

app.get('/_myip', async (req, res) => {
  try {
    const r  = await fetch('https://api4.my-ip.io/ip')
    const ip = await r.text()
    res.json({ outboundIP: ip.trim(), addThisToDelda: 'Add this IP to Delta Exchange API key whitelist' })
  } catch(e) { res.json({ error: e.message }) }
})

// Lists all perpetual products with real IDs — no auth needed
app.get('/_products', async (req, res) => {
  try {
    const url  = DELTA_BASE + '/v2/products?contract_types=perpetual_futures&page_size=100'
    const r    = await fetch(url)
    const text = await r.text()
    if (!text || !text.trim()) return res.json({ error: 'Empty response from Delta' })
    const data = JSON.parse(text)
    if (!data.result) return res.json({ error: 'No result', raw: data })
    const products = data.result.map(function(p) {
      return {
        id:     p.id,
        symbol: p.symbol,
        base:   p.underlying_asset ? p.underlying_asset.symbol : '',
        tick:   p.tick_size,
      }
    })
    res.json({ count: products.length, products: products })
  } catch(e) {
    res.json({ error: e.message })
  }
})

// Forward any public Delta endpoint without auth
// Usage: /_public/v2/tickers  →  Delta /v2/tickers
app.get('/_public/*', async (req, res) => {
  try {
    const deltaPath = req.path.replace('/_public', '')
    const qs        = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
    const url       = DELTA_BASE + deltaPath + qs
    console.log('PUBLIC GET ' + url)
    const r    = await fetch(url)
    const text = await r.text()
    if (!text || !text.trim()) return res.status(r.status).json({ error: 'Empty response' })
    let data
    try { data = JSON.parse(text) } catch(e) { data = { raw: text } }
    res.status(r.status).json(data)
  } catch(e) {
    res.status(502).json({ error: e.message })
  }
})

// ── Authenticated proxy handler ───────────────────────────────────────
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
    const response = await fetch(url, { method, headers, body: bodyStr || undefined, timeout: 10000 })
    const text     = await response.text()
    console.log('Status: ' + response.status + ' Body: ' + text.slice(0, 300))

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

// All other routes require auth and go to Delta
app.all('*', proxyDelta)

app.listen(PORT, () => {
  console.log('GODTRADE Delta Proxy on port ' + PORT)
  console.log('Endpoint: ' + DELTA_BASE)
  console.log('Health:   /_health')
  console.log('My IP:    /_myip')
  console.log('Products: /_products')
})
