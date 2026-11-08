// Виклики проксі /api/notion з повторами при тимчасових збоях (ліміт запитів, мережа, 5xx).
let initData = ''
export function setInitData(s) { initData = s || '' }

export class ApiError extends Error {
  constructor(message, { status = 0, transient = false, data = null } = {}) {
    super(message)
    this.status = status
    this.transient = transient
    this.data = data
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function post(url, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (initData) headers['X-Telegram-Init-Data'] = initData
  let res
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (e) {
    throw new ApiError('Немає зʼєднання з сервером', { transient: true })
  }
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`
    throw new ApiError(msg, { status: res.status, transient: res.status === 429 || res.status >= 500, data })
  }
  return data
}

export async function notionCall(payload, { retries = 3 } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await post('/api/notion', payload)
    } catch (e) {
      if (!(e instanceof ApiError) || !e.transient || attempt >= retries) throw e
      await sleep(450 * 2 ** attempt + Math.random() * 250)
      attempt++
    }
  }
}

export async function queryAll(database, { sorts, filter } = {}) {
  let all = []
  let cursor = null
  do {
    const data = await notionCall({ action: 'query', database, cursor, sorts, filter })
    all = all.concat((data && data.results) || [])
    cursor = data && data.has_more ? data.next_cursor : null
  } while (cursor)
  return all
}

export const createPage = (database, properties) => notionCall({ action: 'create', database, properties })
export const updatePage = (pageId, properties) => notionCall({ action: 'update', pageId, properties })
export const archivePage = pageId => notionCall({ action: 'archive', pageId })

/* ===== CoinGecko через проксі ===== */
export async function cgCall(path, query) {
  return post('/api/coingecko', { path, query })
}

export async function cgSearch(q) {
  if (!q || q.length < 2) return []
  const data = await cgCall('/search', { query: q })
  return ((data && data.coins) || []).slice(0, 12).map(c => ({ id: c.id, symbol: c.symbol, name: c.name, thumb: c.thumb || c.large || '' }))
}

export async function cgPrices(ids) {
  if (!ids || !ids.length) return {}
  const data = await cgCall('/simple/price', { ids: ids.join(','), vs_currencies: 'usd', include_24hr_change: 'true' })
  const out = {}
  for (const id in data || {}) out[id] = { price: data[id].usd || 0, change24h: data[id].usd_24h_change || 0, ts: Date.now() }
  return out
}

export async function cgHistory(id, days) {
  const data = await cgCall(`/coins/${id}/market_chart`, { vs_currency: 'usd', days: String(days) })
  return (data && data.prices) || []
}
