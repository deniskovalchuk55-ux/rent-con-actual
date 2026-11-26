// «Рух коштів»: суми за період, ряд по місяцях і групування по днях для історії банків і бірж.
import { convert, DEFAULT_RATES } from '../money.js'
import { monthKeyOf, UA_MONTHS_SHORT } from '../dates.js'

export const KIND_LABEL = {
  income: 'Надходження', expense: 'Покупка', transfer: 'Переказ', cash: 'Готівка',
  deposit: 'Поповнення біржі', withdrawal: 'Виведення з біржі',
}
const STABLE = new Set(['USDT', 'USDC', 'FDUSD', 'DAI', 'TUSD', 'USDE', 'PYUSD', 'USD1', 'BUSD', 'USDD', 'USDP', 'RLUSD'])
const FIAT = new Set(['USD', 'UAH', 'PLN', 'EUR', 'GBP', 'CHF', 'CZK'])

// Банки Монобанку — це власні заощадження: у підсумки не йдуть, щоб переказ «на банку» не рахувався двічі
export const isJar = r => String(r.account || '').startsWith('Банка «')
export const timeOf = r => new Date(r.date).getTime()

// Сума в USD: збережена оцінка, або за курсами застосунку, або за ціною монети
export function rowUSD(r, rates, coinPrice) {
  if (r.usd != null && Number.isFinite(r.usd)) return r.usd
  const c = r.currency
  if (FIAT.has(c) && (c === 'USD' || (rates && rates[c]) || DEFAULT_RATES[c])) return convert(r.amount, c, 'USD', rates)
  if (STABLE.has(c)) return r.amount
  const p = coinPrice ? coinPrice(c) : null
  return p ? r.amount * p : 0
}

// Підсумки за період у USD (додатні числа; напрям видно з назви)
export function flowSummary(rows, from, to, rates, coinPrice, { source = 'all' } = {}) {
  const s = { income: 0, expense: 0, transferIn: 0, transferOut: 0, cash: 0, deposit: 0, withdrawal: 0, count: 0 }
  for (const r of rows) {
    const t = timeOf(r)
    if (!(t >= from && t < to)) continue
    if (source === 'all' ? isJar(r) : r.account !== source) continue
    const v = rowUSD(r, rates, coinPrice)
    s.count++
    if (r.kind === 'income') s.income += Math.abs(v)
    else if (r.kind === 'expense') s.expense += Math.abs(v)
    else if (r.kind === 'cash') s.cash += Math.abs(v)
    else if (r.kind === 'deposit') s.deposit += Math.abs(v)
    else if (r.kind === 'withdrawal') s.withdrawal += Math.abs(v)
    else if (r.kind === 'transfer') { if (v >= 0) s.transferIn += v; else s.transferOut += -v }
  }
  s.in = s.income + s.transferIn
  s.out = s.expense + s.cash + s.transferOut
  return s
}

// Останні n місяців (включно з поточним) — для графіка «по місяцях»
export function monthlyFlows(rows, n, rates, coinPrice, opts = {}, now = new Date()) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    out.push({ key: monthKeyOf(from), label: UA_MONTHS_SHORT[from.getMonth()], from: from.getTime(), to: to.getTime(), ...flowSummary(rows, from.getTime(), to.getTime(), rates, coinPrice, opts) })
  }
  return out
}

// Рахунки, що трапляються в історії: спершу картки, далі біржі, банки в кінці
export function ledgerAccounts(rows) {
  const seen = new Map()
  for (const r of rows) if (r.account && !seen.has(r.account)) seen.set(r.account, r.kind === 'deposit' || r.kind === 'withdrawal' ? 1 : isJar(r) ? 2 : 0)
  return [...seen.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'uk')).map(([name]) => name)
}

// Операції місяця для вибраного рахунку, згруповані по днях (новіші вгорі)
export function groupByDay(rows, from, to, source = 'all') {
  const list = rows
    .filter(r => { const t = timeOf(r); return t >= from && t < to && (source === 'all' || r.account === source) })
    .sort((a, b) => timeOf(b) - timeOf(a))
  const days = []
  for (const r of list) {
    const d = new Date(timeOf(r))
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    let g = days[days.length - 1]
    if (!g || g.day !== key) { g = { day: key, items: [] }; days.push(g) }
    g.items.push(r)
  }
  return days
}

// Пошук в історії: назва, коментар, рахунок або сума (8350, «8 350»)
export function searchLedger(rows, query, source = 'all') {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!q) return []
  const digits = q.replace(/[\s\u202f,.₴$€zł+−-]/g, '')
  const isNum = /^\d+$/.test(digits)
  return rows.filter(r => (source === 'all' || r.account === source) && (
    String(r.title || '').toLowerCase().includes(q) || String(r.note || '').toLowerCase().includes(q) ||
    String(r.account || '').toLowerCase().includes(q) || (isNum && String(Math.round(Math.abs(r.amount))).startsWith(digits))
  ))
}

/* ----- Регулярні платежі: підписки, звʼязок, комуналка, щомісячні перекази ----- */
// «Bolt.eu/o/2511» і «Bolt.eu/o/2512» — один отримувач: прибираємо цифри й службові знаки
export const merchantKey = t => String(t || '').toLowerCase().replace(/[\d#*№]+/g, ' ').replace(/[/._\-]+\s*$/g, '').replace(/\s+/g, ' ').trim()
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0 }

// Зміна ціни підписки: останні 1–2 списання однакові між собою, а до того щонайменше два місяці була
// інша стабільна сума (±1%), і різниця — від 5%. Коливання курсу (±1–3%) зміною не вважаємо.
// amounts — від найновішого до найстарішого. → { from, to, fresh } (fresh — скільки списань уже за новою ціною)
export function priceChange(amounts) {
  if (amounts.length < 3) return null
  const to = amounts[0]
  const same = (a, b) => Math.abs(a - b) <= Math.max(0.01, b * 0.01)
  let fresh = 1
  while (fresh < amounts.length && same(amounts[fresh], to)) fresh++
  if (fresh > 2) return null // нова ціна вже звична — не новина
  const before = amounts.slice(fresh, fresh + 3)
  if (before.length < 2) return null
  const from = median(before)
  if (!before.every(a => same(a, from))) return null
  if (Math.abs(to - from) < Math.max(0.5, from * 0.05)) return null
  return { from, to, fresh }
}

// Те, що списується приблизно раз на місяць і приблизно на ту саму суму (за останні пів року)
export function recurringPayments(rows, rates, now = new Date()) {
  const since = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime()
  const groups = new Map()
  for (const r of rows) {
    if (!(r.amount < 0) || isJar(r) || !(r.kind === 'expense' || r.kind === 'transfer')) continue
    const t = timeOf(r)
    if (t < since) continue
    const key = merchantKey(r.title) + '|' + r.currency
    if (!key.startsWith('|')) (groups.get(key) || groups.set(key, []).get(key)).push(r)
  }
  const out = []
  for (const list of groups.values()) {
    const months = new Set(list.map(r => { const d = new Date(timeOf(r)); return d.getFullYear() * 12 + d.getMonth() }))
    if (months.size < 3) continue // щонайменше три різні місяці
    if (list.length / months.size > 1.5) continue // «Сільпо» по кілька разів на місяць — не підписка
    const sorted = [...list].sort((a, b) => timeOf(b) - timeOf(a))
    const amounts = sorted.map(r => Math.abs(r.amount))
    const med = median(amounts)
    const change = priceChange(amounts)
    const near = (arr, ref) => arr.filter(a => Math.abs(a - ref) <= Math.max(1, ref * 0.2)).length
    const similar = change ? near(amounts.slice(0, change.fresh), change.to) + near(amounts.slice(change.fresh), change.from) : near(amounts, med)
    if (similar / amounts.length < 0.7) continue // суми скачуть — це не регулярний платіж
    const last = sorted[0]
    const amount = change ? change.to : med // після подорожчання рахуємо вже за новою ціною
    const lastD = new Date(timeOf(last))
    const next = new Date(lastD.getFullYear(), lastD.getMonth() + 1, lastD.getDate(), lastD.getHours(), lastD.getMinutes())
    const usd = Math.abs(rowUSD({ ...last, amount: -amount, usd: last.usd != null && last.amount ? (last.usd / last.amount) * -amount : null }, rates))
    out.push({ key: merchantKey(last.title), title: last.title, amount, currency: last.currency, usd, kind: last.kind, account: last.account,
      lastDate: lastD.getTime(), nextDate: next.getTime(), months: months.size, day: lastD.getDate(),
      change: change && { from: change.from, to: change.to, pct: change.to / change.from - 1, since: timeOf(sorted[change.fresh - 1]) } })
  }
  return out.sort((a, b) => b.usd - a.usd)
}
