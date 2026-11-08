// Фейковий бекенд для демо й тестів: Notion (зі схемою колонок, як у реальних базах), CoinGecko, курси, Telegram.
// Підміняє window.fetch лише для /api/notion, /api/coingecko і джерел курсів.

const SCHEMAS = {
  DB_CLIENTS: { 'Назва': 'title', 'Ставка': 'number', 'Валюта': 'select', 'Старт': 'date', 'Телефон': 'rich_text', 'Telegram': 'rich_text', 'Setup сума': 'number', 'Setup валюта': 'select', 'Тип оплати': 'select', 'Бонусні дні': 'number', 'Реферал': 'relation', 'Бонус-сума': 'number', 'Бонус виданий': 'checkbox', 'Telegram ID': 'number' },
  DB_PAYMENTS: { 'ID': 'title', 'Клієнт': 'relation', 'Дата': 'date', 'Місяців': 'number', 'Сума': 'number', 'Валюта': 'select', 'Telegram ID': 'number' },
  DB_WORK_ENTRIES: { 'ID': 'title', 'Дата': 'date', 'Тип': 'select', 'Години': 'number', 'Ставка': 'number', 'Ставка валюта': 'select', 'Категорія': 'relation', 'Назва': 'rich_text', 'Сума': 'number', 'Валюта': 'select', 'Опис': 'rich_text', 'Telegram ID': 'number' },
  DB_WORK_CATEGORIES: { 'Назва': 'title', 'Ставка': 'number', 'Валюта': 'select', 'За замовчуванням': 'checkbox', 'Telegram ID': 'number' },
  DB_PAYOUTS: { 'ID': 'title', 'Місяць': 'rich_text', 'Дата': 'date', 'Сума': 'number', 'Валюта': 'select', 'Тип': 'select', 'Категорія': 'relation', 'Telegram ID': 'number' },
  DB_GOALS: { 'Назва': 'title', 'Поточна ціль': 'number', 'Валюта': 'select', 'Старт': 'date', 'Дедлайн': 'date', 'Іконка': 'rich_text', 'Історія рівнів': 'rich_text', 'Статус': 'select', 'Telegram ID': 'number' },
  DB_GOAL_TX: { 'ID': 'title', 'Ціль': 'relation', 'Дата': 'date', 'Сума': 'number', 'Валюта': 'select', 'Тип': 'select', 'Опис': 'rich_text', 'Telegram ID': 'number' },
  DB_ASSETS: { 'Символ': 'title', 'Назва': 'rich_text', 'CoinGecko ID': 'rich_text', 'Тип': 'select', 'Іконка': 'rich_text', 'Telegram ID': 'number' },
  DB_ASSET_TX: { 'ID': 'title', 'Актив': 'relation', 'Дата': 'date', 'Тип': 'select', 'Кількість': 'number', 'Ціна': 'number', 'Валюта': 'select', 'Комісія': 'number', 'Опис': 'rich_text', 'Telegram ID': 'number' },
  DB_EXPENSES: { 'Назва': 'title', 'Сума': 'number', 'Валюта': 'select', 'Дата': 'date', 'Категорія': 'relation', 'Опис': 'rich_text', 'Telegram ID': 'number' },
  DB_CAT_EXPENSES: { 'Назва': 'title', 'Загальна': 'checkbox', 'Telegram ID': 'number' },
}

let n = 0
export const uuid = () => {
  n++
  let hex = n.toString(16)
  while (hex.length < 32) hex += Math.floor(Math.random() * 16).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const rt = arr => (arr || []).map(t => ({ type: 'text', text: { content: (t.text && t.text.content) || t.plain_text || '' }, plain_text: (t.text && t.text.content) || t.plain_text || '' }))

function normalize(db, props, strict) {
  const schema = SCHEMAS[db]
  const out = {}
  for (const [name, val] of Object.entries(props || {})) {
    const type = schema[name]
    if (!type) {
      if (strict) throw Object.assign(new Error(`${name} is not a property that exists.`), { status: 400, code: 'validation_error' })
      continue
    }
    const keys = Object.keys(val)
    if (keys.length !== 1 || keys[0] !== type) throw Object.assign(new Error(`${name} is expected to be ${type}.`), { status: 400, code: 'validation_error' })
    if (type === 'title' || type === 'rich_text') out[name] = { type, [type]: rt(val[type]) }
    else if (type === 'select') out[name] = { type, select: val.select ? { name: val.select.name } : null }
    else if (type === 'number') {
      if (val.number != null && typeof val.number !== 'number') throw Object.assign(new Error(`${name} should be a number`), { status: 400 })
      out[name] = { type, number: val.number }
    } else if (type === 'date') out[name] = { type, date: val.date ? { start: val.date.start, end: null } : null }
    else if (type === 'checkbox') out[name] = { type, checkbox: !!val.checkbox }
    else if (type === 'relation') {
      // як справжній Notion: у звʼязку мають бути id сторінок (UUID), а не тимчасові tmp-…
      if ((val.relation || []).some(r => !/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(String(r.id))))
        throw Object.assign(new Error(`${name}: relation id should be a valid uuid`), { status: 400, code: 'validation_error' })
      out[name] = { type, relation: (val.relation || []).map(r => ({ id: r.id })) }
    }
  }
  return out
}

function emptyProps(db) {
  const out = {}
  for (const [name, type] of Object.entries(SCHEMAS[db])) {
    if (type === 'title' || type === 'rich_text') out[name] = { type, [type]: [] }
    else if (type === 'select') out[name] = { type, select: null }
    else if (type === 'number') out[name] = { type, number: null }
    else if (type === 'date') out[name] = { type, date: null }
    else if (type === 'checkbox') out[name] = { type, checkbox: false }
    else if (type === 'relation') out[name] = { type, relation: [] }
  }
  return out
}

export function createFake({ latency = 120, failRate = 0 } = {}) {
  const tables = Object.fromEntries(Object.keys(SCHEMAS).map(k => [k, []]))
  const byId = new Map()
  const log = []
  const api = {
    tables, log, byId,
    insert(db, props, opts = {}) {
      const page = { object: 'page', id: opts.id || uuid(), created_time: opts.created || new Date().toISOString(), archived: false, parent: { database_id: db }, properties: { ...emptyProps(db), ...normalize(db, props, true) } }
      tables[db].push(page)
      byId.set(page.id, page)
      return page
    },
    failNext: 0,
    failRate,
    latency,
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  // як у мережі: запит іде половину затримки, виконується, відповідь іде другу половину;
  // читання (query) бачить стан на момент, коли запит дійшов, — так відтворюються гонки із синхронізацією
  api.latencyFor = {}
  api.handle = async body => {
    const lf = api.latencyFor
    const base = lf[body.action + ':' + body.database] ?? lf[body.action] ?? api.latency // напр. { 'query:DB_CLIENTS': 3000 }
    const L = base * (0.5 + Math.random())
    if (api.failNext > 0) { await sleep(L); api.failNext--; return [429, { message: 'Rate limited (fake)' }] }
    if (api.failRate && Math.random() < api.failRate) { await sleep(L); return [503, { message: 'Service unavailable (fake)' }] }
    await sleep(body.action === 'query' ? 10 : L / 2)
    const res = exec(body)
    await sleep(body.action === 'query' ? L : L / 2)
    return res
  }
  const exec = body => {
    const { action, database, pageId, properties, cursor } = body
    try {
      if (action === 'query') {
        if (!tables[database]) return [400, { error: 'Bad or missing database: ' + database }]
        const rows = tables[database].filter(p => !p.archived)
        const start = cursor ? parseInt(cursor, 10) : 0
        const slice = rows.slice(start, start + 100)
        const more = start + 100 < rows.length
        return [200, { object: 'list', results: JSON.parse(JSON.stringify(slice)), has_more: more, next_cursor: more ? String(start + 100) : null }]
      }
      if (action === 'create') {
        if (!tables[database]) return [400, { error: 'Bad or missing database: ' + database }]
        const page = api.insert(database, properties)
        log.push({ action, database, properties: JSON.parse(JSON.stringify(properties)), id: page.id, t: Date.now() })
        return [200, JSON.parse(JSON.stringify(page))]
      }
      if (action === 'update') {
        const page = byId.get(pageId)
        if (!page) return [404, { message: 'Could not find page with ID: ' + pageId }]
        if (page.archived) return [400, { object: 'error', code: 'validation_error', message: "Can't edit block that is archived. You must unarchive the block before editing." }]
        const db = page.parent.database_id
        Object.assign(page.properties, normalize(db, properties, true))
        log.push({ action, database: db, pageId, properties: JSON.parse(JSON.stringify(properties)), t: Date.now() })
        return [200, JSON.parse(JSON.stringify(page))]
      }
      if (action === 'archive') {
        const page = byId.get(pageId)
        if (!page) return [404, { message: 'Could not find page with ID: ' + pageId }]
        page.archived = true
        log.push({ action, database: page.parent.database_id, pageId, t: Date.now() })
        return [200, { ...JSON.parse(JSON.stringify(page)), archived: true }]
      }
      return [400, { error: 'Unknown action: ' + action }]
    } catch (e) {
      return [e.status || 500, { object: 'error', code: e.code || 'error', message: e.message }]
    }
  }
  return api
}

/* ===== CoinGecko (детермінована «історія» цін) ===== */
export const COINS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', price: 97250, ch: 1.8, vol: 0.022, thumb: 'https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png' },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', price: 3480, ch: -0.9, vol: 0.03, thumb: 'https://assets.coingecko.com/coins/images/279/thumb/ethereum.png' },
  { id: 'solana', symbol: 'sol', name: 'Solana', price: 186.4, ch: 3.4, vol: 0.04, thumb: 'https://assets.coingecko.com/coins/images/4128/thumb/solana.png' },
  { id: 'the-open-network', symbol: 'ton', name: 'Toncoin', price: 5.62, ch: -2.1, vol: 0.035, thumb: 'https://assets.coingecko.com/coins/images/17980/thumb/ton_symbol.png' },
  { id: 'tether', symbol: 'usdt', name: 'Tether', price: 1, ch: 0.01, vol: 0.0005, thumb: 'https://assets.coingecko.com/coins/images/325/thumb/Tether.png' },
  { id: 'binancecoin', symbol: 'bnb', name: 'BNB', price: 652, ch: 0.6, vol: 0.025, thumb: 'https://assets.coingecko.com/coins/images/825/thumb/bnb-icon2_2x.png' },
]

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }

export function history(id, days) {
  const c = COINS.find(x => x.id === id)
  if (!c) return []
  const pts = days <= 1 ? 288 : days <= 90 ? days * 24 / (days > 30 ? 4 : 1) : days
  const step = (days * 86400000) / pts
  const r = rng(id.length * 7919 + days)
  const now = Date.now()
  const vals = [c.price]
  for (let i = 1; i <= pts; i++) vals.push(vals[i - 1] / (1 + (r() - 0.5) * c.vol * Math.sqrt(step / 86400000) * 2.2 + 0.0004 * Math.sqrt(step / 86400000)))
  vals.reverse()
  return vals.map((v, i) => [now - (vals.length - 1 - i) * step, Math.round(v * 100) / 100])
}

function cgHandle(body) {
  const { path, query } = body
  if (path === '/search') {
    const q = String(query.query || '').toLowerCase()
    return { coins: COINS.filter(c => c.name.toLowerCase().includes(q) || c.symbol.includes(q)).map(c => ({ id: c.id, symbol: c.symbol.toUpperCase(), name: c.name, thumb: c.thumb })) }
  }
  if (path === '/simple/price') {
    const out = {}
    for (const id of String(query.ids).split(',')) { const c = COINS.find(x => x.id === id); if (c) out[id] = { usd: c.price, usd_24h_change: c.ch } }
    return out
  }
  const m = path.match(/^\/coins\/([a-z0-9-]+)\/market_chart$/)
  if (m) return { prices: history(m[1], parseInt(query.days, 10) || 30) }
  return {}
}

export function installFakeBackend(fake, { user = { id: 111, first_name: 'Андрій', username: 'andrii' } } = {}) {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (url, opts = {}) => {
    const u = String(url)
    const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    if (u.includes('/api/notion')) {
      const [status, data] = await fake.handle(JSON.parse(opts.body || '{}'))
      return json(status, data)
    }
    if (u.includes('/api/coingecko')) {
      await new Promise(r => setTimeout(r, 160))
      return json(200, cgHandle(JSON.parse(opts.body || '{}')))
    }
    if (u.includes('bank.gov.ua')) return json(200, [{ cc: 'USD', rate: 41.82 }, { cc: 'PLN', rate: 10.43 }])
    if (u.includes('er-api.com') || u.includes('privatbank')) return json(500, {})
    return realFetch(url, opts)
  }
  window.Telegram = {
    WebApp: {
      initData: '', initDataUnsafe: { user }, platform: 'demo', colorScheme: window.__demoScheme || 'dark', version: '8.0',
      ready() {}, expand() {}, disableVerticalSwipes() {}, isVersionAtLeast: () => true,
      setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
      onEvent() {}, offEvent() {},
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
      BackButton: { show() { window.__backVisible = true }, hide() { window.__backVisible = false }, onClick(fn) { window.__back = fn }, offClick() {} },
      CloudStorage: { getItem: (k, cb) => cb(null, null), setItem: (k, v, cb) => cb && cb(null, true) },
      openLink: url => { window.__openedLink = url }, openTelegramLink: url => { window.__openedLink = url },
      enableClosingConfirmation() {}, disableClosingConfirmation() {},
    },
  }
  window.__fake = fake
}
