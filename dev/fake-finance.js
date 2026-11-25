// Фейковий /api/finance для демо й тестів: Монобанк, Bybit, BingX, MEXC з правдоподібними даними.
// Категорії підбирає той самий модуль, що й на сервері.
import { suggestCategory, kindOf } from '../api/_lib/categorize.js'

const PRICES = { BTC: 97250, ETH: 3480, SOL: 186.4, TON: 5.62, USDT: 1, USDC: 1, BNB: 652, KAS: 0.118, PEPE: 0.0000112 }
const PLN_UAH = 10.43

export function createFakeFinance(fake, { configured = { mono: true, bybit: true, bingx: true, mexc: true, enablebanking: false } } = {}) {
  const st = { webhook: 'off', failNext: null, previewCalls: 0 }
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
    if (configured.mono) out.push({ provider: 'mono', label: 'Монобанк', ok: true, accounts, webhook: st.webhook, fetchedAt: Date.now() })
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
      case 'status': return [200, { auth: 'on', owner: true, setup: { bot: true, owner: true, expensesDb: true, categoriesDb: true }, providers: configured, region: 'fra1' }]
      case 'balances': return [200, balances()]
      case 'mono-webhook': st.webhook = body.enable === false ? 'off' : 'on'; return [200, { ok: true, webhook: st.webhook }]
      case 'mono-preview': return preview(body)
      case 'expenses-import': return importItems(body)
      default: return [400, { error: 'Unknown action: ' + body.action }]
    }
  }
  return { handle, state: st }
}
