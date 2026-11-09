// Огляд за період (день / тиждень / місяць / рік з якорем-датою) — як «Огляд» у v3, плюс тренд за місяці.
import { parseDate, toISO, UA_MONTHS, UA_MONTHS_SHORT, monthKeyOf } from '../dates.js'
import { convert } from '../money.js'
import { rentCashBetweenUSD, setupBetweenUSD } from './rent.js'
import { workEarnedBetweenUSD } from './work.js'

export function periodBounds(kind, anchorISO) {
  const a = parseDate(anchorISO)
  if (kind === 'day') { const to = new Date(a); to.setDate(to.getDate() + 1); return { from: a.getTime(), to: to.getTime() } }
  if (kind === 'week') {
    const from = new Date(a); from.setDate(from.getDate() - ((a.getDay() + 6) % 7))
    const to = new Date(from); to.setDate(to.getDate() + 7)
    return { from: from.getTime(), to: to.getTime() }
  }
  if (kind === 'month') return { from: new Date(a.getFullYear(), a.getMonth(), 1).getTime(), to: new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime() }
  return { from: new Date(a.getFullYear(), 0, 1).getTime(), to: new Date(a.getFullYear() + 1, 0, 1).getTime() }
}

export function periodLabel(kind, anchorISO) {
  const a = parseDate(anchorISO)
  if (kind === 'day') return a.getDate() + ' ' + UA_MONTHS_SHORT[a.getMonth()] + ' ' + a.getFullYear()
  if (kind === 'week') {
    const from = new Date(a); from.setDate(from.getDate() - ((a.getDay() + 6) % 7))
    const to = new Date(from); to.setDate(to.getDate() + 6)
    if (from.getMonth() === to.getMonth()) return from.getDate() + '–' + to.getDate() + ' ' + UA_MONTHS_SHORT[from.getMonth()] + ' ' + from.getFullYear()
    return from.getDate() + ' ' + UA_MONTHS_SHORT[from.getMonth()] + ' – ' + to.getDate() + ' ' + UA_MONTHS_SHORT[to.getMonth()]
  }
  if (kind === 'month') return UA_MONTHS[a.getMonth()] + ' ' + a.getFullYear()
  return String(a.getFullYear())
}

export function shiftAnchor(kind, anchorISO, delta) {
  const a = parseDate(anchorISO)
  if (kind === 'day') a.setDate(a.getDate() + delta)
  else if (kind === 'week') a.setDate(a.getDate() + delta * 7)
  else if (kind === 'month') a.setMonth(a.getMonth() + delta, 1)
  else a.setFullYear(a.getFullYear() + delta)
  return toISO(a)
}

export function isCurrentPeriod(kind, anchorISO) {
  const { from, to } = periodBounds(kind, anchorISO)
  const n = Date.now()
  return n >= from && n < to
}

export function expensesBetweenUSD(expenses, from, to, rates) {
  let s = 0
  for (const e of expenses) {
    const t = parseDate(e.date).getTime()
    if (t >= from && t < to) s += convert(e.amount, e.currency || 'USD', 'USD', rates)
  }
  return s
}

export function expensesByCategory(expenses, cats, from, to, rates) {
  const by = {}
  for (const e of expenses) {
    const t = parseDate(e.date).getTime()
    if (t < from || t >= to) continue
    const key = e.categoryId || 'none'
    ;(by[key] ||= { id: key, name: '', usd: 0, count: 0 })
    by[key].usd += convert(e.amount, e.currency || 'USD', 'USD', rates)
    by[key].count++
  }
  for (const id in by) by[id].name = id === 'none' ? 'Без категорії' : ((cats.find(c => c.id === id) || {}).name || 'Категорія')
  return Object.values(by).sort((a, b) => b.usd - a.usd)
}

// Підсумок періоду. Оренда — гроші за датою оплати (як «Огляд» у v3), розробка окремо.
export function periodSummary(data, from, to, mode, rates) {
  const rent = rentCashBetweenUSD(data.clients, from, to, rates)
  const work = workEarnedBetweenUSD(data.workEntries, data.payouts, from, to, mode, rates)
  const setup = setupBetweenUSD(data.clients, from, to, rates)
  const spent = expensesBetweenUSD(data.expenses, from, to, rates)
  const earned = rent + work + setup
  return { rent, work, setup, earned, spent, net: earned - spent }
}

// Ряд за останні n місяців (включно з поточним), для графіків тренду
export function monthlySeries(data, n, mode, rates, now = new Date()) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const s = periodSummary(data, from.getTime(), to.getTime(), mode, rates)
    out.push({ key: monthKeyOf(from), label: UA_MONTHS_SHORT[from.getMonth()], ...s })
  }
  return out
}
