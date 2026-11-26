// Фейковий /api/finance для демо й тестів: Монобанк, Bybit, BingX, MEXC з правдоподібними даними.
// Категорії підбирає той самий модуль, що й на сервері.
import { suggestCategory, kindOf, flowOf } from '../api/_lib/categorize.js'

const PRICES = { BTC: 97250, ETH: 3480, SOL: 186.4, TON: 5.62, USDT: 1, USDC: 1, BNB: 652, KAS: 0.118, PEPE: 0.0000112 }
const PLN_UAH = 10.43
const UAH_USD = 41.8

/* ===== Демо-історія за 12 місяців: зарплата, оренда, покупки, перекази, готівка, біржі ===== */
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const SHOPS = [['Сільпо', 5411, 300, 1400], ['АТБ', 5411, 150, 700], ['Bolt.eu', 4121, 120, 380], ['Пузата Хата', 5812, 180, 420], ['Аптека Подорожник', 5912, 90, 650],
  ['Netflix.com', 4899, 389, 389], ['ZARA', 5651, 900, 2600], ['Kyivstar', 4814, 250, 250], ['WOG', 5541, 900, 1800], ['Rozetka', 5732, 400, 4200]]
export const DEMO_ACCOUNTS = { uah: { label: 'Чорна картка •4821', cur: 'UAH', ref: 'card-uah' }, usd: { label: 'Біла картка •0377', cur: 'USD', ref: 'card-usd' }, eur: { label: 'Біла картка •9012', cur: 'EUR', ref: 'card-eur' } }
const EUR_USD = 1.08
const TYPE_NAME = { income: 'Надходження', expense: 'Покупка', transfer: 'Переказ', cash: 'Готівка', deposit: 'Поповнення біржі', withdrawal: 'Виведення з біржі' }
const EX_LABEL = { bybit: 'Bybit', bingx: 'BingX', mexc: 'MEXC' }

export function demoLedger(now = new Date()) {
  const out = []
  for (let i = 0; i < 12; i++) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const r = mulberry(first.getFullYear() * 100 + first.getMonth())
    const key = first.getFullYear() + String(first.getMonth() + 1).padStart(2, '0')
    let k = 0
    const at = (day, h) => new Date(first.getFullYear(), first.getMonth(), Math.min(day, dim), h, Math.floor(r() * 60))
    const mono = (acc, d, title, mcc, amount, note = '') => {
      const a = DEMO_ACCOUNTS[acc]
      if (d.getTime() > Date.now()) return
      const kind = flowOf({ amount, mcc, title })
      const usd = a.cur === 'USD' ? amount : a.cur === 'EUR' ? Math.round(amount * EUR_USD * 100) / 100 : Math.round(amount / UAH_USD * 100) / 100
      out.push({ bankId: `mono:demo-${acc}-${key}-${k++}`, title, amount, currency: a.cur, usd, date: d.toISOString(), kind, account: a.label, note, ref: a.ref })
    }
    const ex = (prov, d, dir, coin, amount, network) => {
      if (d.getTime() > Date.now()) return
      out.push({ bankId: `${prov}:${dir === 'in' ? 'dep' : 'wd'}:demo-${key}-${k++}`, title: (dir === 'in' ? 'Поповнення ' : 'Виведення ') + coin, amount: dir === 'in' ? amount : -amount, currency: coin, usd: (dir === 'in' ? 1 : -1) * amount * (PRICES[coin] || 1), date: d.toISOString(), kind: dir === 'in' ? 'deposit' : 'withdrawal', account: EX_LABEL[prov], note: 'мережа ' + network, provider: prov })
    }
    mono('uah', at(5, 10), 'Від: ТОВ «Діджитал Лаб»', 4829, 48500 + Math.round(r() * 6000), 'зарплата')
    mono('uah', at(10, 18), 'Від: Олена К.', 4829, 8350, 'оренда')
    if (r() > 0.4) mono('uah', at(21, 15), 'Від: Ігор М.', 4829, 1200 + Math.round(r() * 1800))
    const n = 16 + Math.floor(r() * 12)
    for (let j = 0; j < n; j++) { const [t, mcc, lo, hi] = SHOPS[Math.floor(r() * SHOPS.length)]; mono('uah', at(1 + Math.floor(r() * dim), 9 + Math.floor(r() * 12)), t, mcc, -Math.round(lo + r() * (hi - lo))) }
    mono('uah', at(6, 11), 'На банку «Відпустка»', 4829, -2000)
    if (r() > 0.5) mono('uah', at(14, 13), 'Банкомат ПриватБанк', 6011, -1000 - Math.round(r() * 2) * 500)
    if (r() > 0.6) mono('uah', at(18, 20), 'Переказ на картку', 4829, -1500 - Math.round(r() * 3) * 500, 'Сергій П.')
    mono('usd', at(3, 16), 'Upwork Escrow', 4829, 750 + Math.round(r() * 300))
    mono('usd', at(12, 9), 'Apple.com/bill', 5818, -9.99)
    if (r() > 0.5) mono('eur', at(15, 14), 'Booking.com', 4722, -Math.round(60 + r() * 140))
    ex('bybit', at(8, 12), 'in', 'USDT', 300, 'TRC20')
    if (r() > 0.5) ex('bybit', at(19, 17), 'out', 'USDT', 120, 'TRC20')
    if (r() > 0.5) ex('bingx', at(19, 18), 'in', 'USDT', 119, 'TRC20')
    if (r() > 0.6) ex('mexc', at(25, 21), 'in', 'KAS', 400, 'KAS')
  }
  return out
}

function ledgerProps(e, owner = 111) {
  return {
    'Назва': { title: [{ text: { content: e.title } }] }, 'Сума': { number: e.amount }, 'Валюта': { select: { name: e.currency } },
    'USD': { number: e.usd == null ? null : e.usd }, 'Дата': { date: { start: e.date } }, 'Тип': { select: { name: TYPE_NAME[e.kind] } },
    'Рахунок': { select: { name: e.account } }, 'Опис': { rich_text: e.note ? [{ text: { content: e.note } }] : [] },
    'Банк ID': { rich_text: [{ text: { content: e.bankId } }] }, 'Telegram ID': { number: owner },
  }
}

export function createFakeFinance(fake, { configured = { mono: true, bybit: true, bingx: true, mexc: true, enablebanking: false }, ledger = 'seeded' } = {}) {
  const st = { webhook: 'off', imp: false, ntf: false, log: ledger === 'seeded', failNext: null, previewCalls: 0, ledgerReady: ledger !== 'off', notifyTests: 0, statementCalls: 0 }
  if (ledger === 'seeded') { st.webhook = 'on'; for (const e of demoLedger()) fake.insert('DB_LEDGER', ledgerProps(e)) }
  const ledgerIds = () => new Set(fake.tables.DB_LEDGER.filter(p => !p.archived).map(p => (p.properties['Банк ID'].rich_text[0] || {}).plain_text))
  function writeLedger(items) {
    const have = ledgerIds()
    let created = 0, duplicates = 0, invalid = 0
    for (const e of items || []) {
      if (!e || !/^(mono|bybit|bingx|mexc):/.test(e.bankId) || !Number.isFinite(Number(e.amount))) { invalid++; continue }
      if (have.has(e.bankId)) { duplicates++; continue }
      fake.insert('DB_LEDGER', ledgerProps(e)); have.add(e.bankId); created++
    }
    return { ok: true, created, duplicates, invalid, remaining: [] }
  }
  const accounts = [
    { id: 'mono:card-uah', ref: 'card-uah', kind: 'card', name: 'Чорна картка', mask: '•4821', currency: 'UAH', balance: 18450.32, creditLimit: 30000 },
    { id: 'mono:card-usd', ref: 'card-usd', kind: 'card', name: 'Біла картка', mask: '•0377', currency: 'USD', balance: 1240.5, creditLimit: 0 },
    { id: 'mono:card-eur', ref: 'card-eur', kind: 'card', name: 'Біла картка', mask: '•9012', currency: 'EUR', balance: 312, creditLimit: 0 },
    { id: 'mono:jar:j1', kind: 'jar', name: 'Відпустка в Карпатах', currency: 'UAH', balance: 12300, goal: 40000 },
    { id: 'mono:jar:j2', kind: 'jar', name: 'Подушка безпеки', currency: 'UAH', balance: 25000, goal: null },
  ]
  const h = (asset, qty, account, extra = {}) => ({ asset, qty, usd: PRICES[asset] != null ? qty * PRICES[asset] : null, account, ...extra })

  function balances() {
    const out = []
    if (configured.mono) out.push({ provider: 'mono', label: 'Монобанк', ok: true, accounts, webhook: st.webhook, hookImport: st.webhook === 'on' && st.imp, hookNotify: st.webhook === 'on' && st.ntf, hookLog: st.webhook === 'on' && st.log, fetchedAt: Date.now() })
    if (configured.bybit) out.push({ provider: 'bybit', label: 'Bybit', ok: true, holdings: [h('BTC', 0.0215, 'Торговий'), h('ETH', 0.42, 'Торговий'), h('USDT', 310, 'Торговий'), h('SOL', 3.1, 'Фінансовий'), h('USDC', 120, 'Earn')] })
    if (configured.bingx) out.push({ provider: 'bingx', label: 'BingX', ok: true, holdings: [h('TON', 120, 'Спот'), h('USDT', 85, 'Спот'), { asset: 'USDT', qty: 140, usd: 140, account: 'Безстрокові USDT-M', approx: true }] })
    if (configured.mexc) out.push({ provider: 'mexc', label: 'MEXC', ok: true, holdings: [h('KAS', 800, 'Спот'), h('PEPE', 2500000, 'Спот')] })
    return { providers: out, fetchedAt: Date.now() }
  }

  const categories = () => fake.tables.DB_CAT_EXPENSES.filter(p => !p.archived).map(p => ({ id: p.id, name: (p.properties['Назва'].title[0] || {}).plain_text || '' }))
  const iso = d => d.toISOString().slice(0, 10)

  function preview({ account }) {
    st.previewCalls++
    const acc = accounts.find(a => a.ref === account)
    if (!acc) return [400, { error: 'Не вказано рахунок' }]
    const now = Date.now()
    const day = n => iso(new Date(now - n * 864e5))
    // [днів тому, назва, mcc, сума в UAH (−) або валюті покупки, валюта покупки]
    const plan = acc.currency === 'UAH' ? [
      [0, 'Сільпо', 5411, -612.4], [1, 'BIEDRONKA 4471 WARSZAWA', 5411, -86.2, 'PLN'], [2, 'Bolt.eu/o/2511', 4121, -31.5, 'PLN'],
      [3, 'Netflix.com', 4899, -389], [4, 'Пузата Хата', 5812, -284], [5, 'Переказ на картку', 4829, -2000],
      [6, 'Аптека Подорожник', 5912, -437.8], [8, 'ZARA', 5651, -1899], [9, 'Сільпо', 5411, -945.1],
      [10, 'Банкомат ПриватБанк', 6011, -1500], [11, 'Від: Олена К.', 4829, 3500], [12, 'Kyivstar', 4814, -250],
      [14, 'Cinema City Arkadia', 7832, -38, 'PLN'], [15, 'Żabka Z4417', 5411, -24.9, 'PLN'], [17, 'Bolt.eu/o/2511', 4121, -27.0, 'PLN'],
      [19, 'Пузата Хата', 5812, -312], [21, 'ROSSMANN 112', 5977, -68.5, 'PLN'], [23, 'Сільпо', 5411, -1104.7],
      [25, 'Orlen Stacja', 5541, -210, 'PLN'], [28, 'Spotify', 5815, -199], [30, 'Lidl Sp. z o.o.', 5411, -132.4, 'PLN'],
    ] : [[2, 'Apple.com/bill', 5818, -9.99], [11, 'Booking.com', 4722, -186], [20, 'Udemy', 8299, -14.99]]
    const cats = categories()
    const items = plan.map(([ago, title, mcc, amt, op], i) => {
      const opCurrency = op || acc.currency
      const amountOp = Math.abs(amt)
      const amountAccount = op === 'PLN' && acc.currency === 'UAH' ? Math.round(amountOp * PLN_UAH * 100) / 100 : amountOp
      const kind = kindOf({ amount: amt, mcc, title })
      const currency = ['UAH', 'USD', 'PLN'].includes(acc.currency) ? acc.currency : 'UAH'
      const bankId = 'mono:demo-' + account + '-' + i
      const exists = fake.tables.DB_EXPENSES.some(p => !p.archived && p.properties['Банк ID'] && (p.properties['Банк ID'].rich_text[0] || {}).plain_text === bankId)
      const note = (opCurrency !== acc.currency ? `${String(amountOp).replace('.', ',')} ${opCurrency} · ` : '') + 'Монобанк'
      const expense = kind === 'expense' ? {
        bankId, date: day(ago), title, note, currency,
        amount: currency === acc.currency ? amountAccount : Math.round(amountAccount * 45.5 * 100) / 100,
        categoryId: suggestCategory({ title, mcc }, cats),
      } : null
      return { bankId, date: day(ago), title, kind, mcc, hold: ago === 0, accountCurrency: acc.currency, amountAccount, opCurrency, amountOp, expense, exists }
    })
    return [200, { account, currency: acc.currency, items, categories: cats }]
  }

  function importItems({ items }) {
    const created = [], duplicates = []
    for (const e of (items || []).slice(0, 25)) {
      const dup = fake.tables.DB_EXPENSES.some(p => !p.archived && p.properties['Банк ID'] && (p.properties['Банк ID'].rich_text[0] || {}).plain_text === e.bankId)
      if (dup) { duplicates.push(e.bankId); continue }
      const page = fake.insert('DB_EXPENSES', {
        'Назва': { title: [{ text: { content: e.title } }] }, 'Сума': { number: e.amount }, 'Валюта': { select: { name: e.currency } },
        'Дата': { date: { start: e.date } }, 'Категорія': { relation: e.categoryId ? [{ id: e.categoryId }] : [] },
        'Опис': { rich_text: [{ text: { content: e.note || '' } }] }, 'Telegram ID': { number: 111 },
        'Банк ID': { rich_text: [{ text: { content: e.bankId } }] },
      })
      created.push({ bankId: e.bankId, id: page.id })
    }
    return [200, { ok: true, created, duplicates, invalid: 0 }]
  }

  async function handle(body) {
    await new Promise(r => setTimeout(r, (fake.latency || 300) * (0.6 + Math.random() * 0.8)))
    if (st.failNext) { const f = st.failNext; st.failNext = null; return f }
    switch (body.action) {
      case 'status': return [200, { auth: 'on', owner: true, setup: { bot: true, owner: true, expensesDb: true, categoriesDb: true }, providers: configured, region: 'fra1',
        ledger: { ready: st.ledgerReady }, notify: { bot: true, pollUrl: 'https://rent.example.app/api/finance?hook=poll&k=demo0000000000000000000000000000' } }]
      case 'balances': return [200, balances()]
      case 'mono-webhook': {
        st.imp = body.import !== undefined ? !!body.import : body.enable !== false
        st.ntf = !!body.notify; st.log = !!body.log
        st.webhook = st.imp || st.ntf || st.log ? 'on' : 'off'
        return [200, { ok: true, webhook: st.webhook, hookImport: st.webhook === 'on' && st.imp, hookNotify: st.webhook === 'on' && st.ntf, hookLog: st.webhook === 'on' && st.log }]
      }
      case 'ledger-setup': { const created = !st.ledgerReady; st.ledgerReady = true; return [200, { ok: true, id: 'ledger-demo', created }] }
      case 'ledger-write': return st.ledgerReady ? [200, writeLedger(body.items)] : [409, { error: 'Базу «Рух коштів» ще не створено', code: 'ledger-missing' }]
      case 'mono-statement': {
        st.statementCalls++
        const acc = Object.values(DEMO_ACCOUNTS).find(a => a.ref === body.account)
        if (!acc) return [404, { error: 'Немає такого рахунку в Монобанку' }]
        const entries = demoLedger().filter(e => e.ref === acc.ref && Date.parse(e.date) >= body.from && Date.parse(e.date) < body.to)
        return [200, { entries, more: null, account: acc.label }]
      }
      case 'exchange-history': {
        const entries = demoLedger().filter(e => e.provider === body.provider && Date.parse(e.date) >= body.from && Date.parse(e.date) < body.to)
        return [200, { entries }]
      }
      case 'ledger-sync': {
        if (!st.ledgerReady) return [409, { error: 'Базу «Рух коштів» ще не створено', code: 'ledger-missing' }]
        const since = Date.now() - 30 * 864e5
        const r = writeLedger(demoLedger().filter(e => e.provider && Date.parse(e.date) >= since))
        return [200, { ...r, errors: [] }]
      }
      case 'notify-test': st.notifyTests++; return [200, { ok: true }]
      case 'transfers-check': return [200, { providers: Object.keys(EX_LABEL).filter(n => configured[n]).map(n => ({ provider: n, ok: true, deposits: 1, withdrawals: 0 })), pollUrl: 'https://rent.example.app/api/finance?hook=poll&k=demo' }]
      case 'mono-preview': return preview(body)
      case 'expenses-import': return importItems(body)
      default: return [400, { error: 'Unknown action: ' + body.action }]
    }
  }
  return { handle, state: st }
}
