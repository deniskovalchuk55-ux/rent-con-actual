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
