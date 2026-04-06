const express = require('express')
const cors    = require('cors')
const fetch   = require('node-fetch')
const crypto  = require('crypto')

const app  = express()
const PORT = process.env.PORT || 3001

// Delta Exchange India correct base URL
const DELTA_BASE = 'https://api.india.delta.exchange'

app.use(cors({ origin: '*' }))
app.use(express.json())

function generateSignature(secret, method, timestamp, path, qs, body) {
  const msg = method + timestamp + path + qs + body
  console.log('SIGN: ' + msg)
  return crypto.createHmac('sha256', secret).update(msg).digest('hex')
}

// ── Health ────────────────────────────────────────────────────────────
app.get('/_health', (req, res) => {
  res.json({ status: 'ok', endpoint: DELTA_BASE, serverTime: Math.floor(Date.now() / 1000) })
})

// ── Get outbound IP ───────────────────────────────────────────────────
app.get('/_myip', async (req, res) => {
  try {
    const r  = await fetch('https://api4.my-ip.io/ip')
    const ip = await r.text()
    res.json({ outboundIP: ip.trim() })
  } catch(e) { res.json({ error: e.message }) }
})

// ── Products (no auth) ────────────────────────────────────────────────
app.get('/_products', async (req, res) => {
  try {
    const r    = await fetch(DELTA_BASE + '/v2/products?contract_types=perpetual_futures&page_size=100')
    const text = await r.text()
    console.log('PRODUCTS STATUS: ' + r.status)
    console.log('PRODUCTS BODY: ' + text.slice(0, 500))
    if (!text || !text.trim()) return res.json({ error: 'Empty response', status: r.status })
    const data = JSON.parse(text)
    if (!data.result) return res.json({ error: 'No result field', raw: data })
    const products = data.result.map(function(p) {
      return { id: p.id, symbol: p.symbol, base: p.underlying_asset ? p.underlying_asset.symbol : '', tick: p.tick_size }
    })
    res.json({ count: products.length, products: products })
  } catch(e) {
    res.json({ error: e.message })
  }
})

// ── Public Delta passthrough (no auth) ───────────────────────────────
app.get('/_public/*', async (req, res) => {
  try {
    const deltaPath = req.path.replace('/_public', '')
    const qs        = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
    const url       = DELTA_BASE + deltaPath + qs
    console.log('PUBLIC: ' + url)
    const r    = await fetch(url, { timeout: 10000 })
    const text = await r.text()
    if (!text || !text.trim()) return res.status(r.status).json({ error: 'Empty response', status: r.status })
    let data
    try { data = JSON.parse(text) } catch(e) { data = { raw: text.slice(0, 200) } }
    res.status(r.status).json(data)
  } catch(e) {
    res.status(502).json({ error: e.message })
  }
})

// ── Debug test — shows exactly what Delta returns for any endpoint ────
// Usage: /_debug?key=X&secret=Y&path=/v2/wallet/balances
app.get('/_debug', async (req, res) => {
  const key    = req.query.key
  const secret = req.query.secret
  const path   = req.query.path || '/v2/wallet/balances'

  if (!key || !secret) {
    return res.json({ usage: '/_debug?key=YOUR_KEY&secret=YOUR_SECRET&path=/v2/wallet/balances' })
  }

  const timestamp = String(Math.floor(Date.now() / 1000))
  const qs        = ''
  const body      = ''
  const sig       = generateSignature(secret, 'GET', timestamp, path, qs, body)

  const headers = {
    'Content-Type': 'application/json',
    'api-key':      key,
    'timestamp':    timestamp,
    'signature':    sig,
  }

  const url = DELTA_BASE + path
  console.log('DEBUG GET: ' + url)

  try {
    const r    = await fetch(url, { headers, timeout: 10000 })
    const text = await r.text()
    console.log('DEBUG STATUS: ' + r.status)
    console.log('DEBUG BODY: ' + text.slice(0, 500))
    let data
    try { data = JSON.parse(text) } catch(e) { data = { raw: text } }
    res.json({
      httpStatus: r.status,
      deltaBody:  data,
      debug: {
        url:       url,
        timestamp: timestamp,
        prehash:   'GET' + timestamp + path,
      }
    })
  } catch(e) {
    res.json({ error: e.message })
  }
})

// ── Authenticated proxy ───────────────────────────────────────────────
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
    console.log('STATUS: ' + response.status + ' BODY: ' + text.slice(0, 300))

    if (!text || !text.trim()) {
      return res.status(response.status).json({
        error: 'Empty response from Delta (HTTP ' + response.status + ')',
        hint:  response.status === 500 ? 'Wrong API endpoint or malformed request' :
               response.status === 401 ? 'Check IP whitelist and API keys' : ''
      })
    }

    let data
    try { data = JSON.parse(text) }
    catch(e) { data = { error: 'Non-JSON: ' + text.slice(0, 200) } }

    res.status(response.status).json(data)
  } catch (err) {
    console.error('Fetch error: ' + err.message)
    res.status(502).json({ error: 'Fetch failed: ' + err.message })
  }
}

app.all('*', proxyDelta)

app.listen(PORT, () => {
  console.log('GODTRADE Delta Proxy on port ' + PORT)
  console.log('Endpoint: ' + DELTA_BASE)
  console.log('Test: /_debug?key=X&secret=Y')
})
