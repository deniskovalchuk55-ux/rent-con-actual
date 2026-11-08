// Робота: записи (погодинно / фікс), місячні виплати (аванс / фактична), статуси. Формули — як у v3.
import { monthKeyOf, parseDate } from '../dates.js'
import { convert } from '../money.js'

export function workEntryUSD(e, rates) {
  if (e.kind === 'hourly') return convert(e.rate ?? 0, e.rateCur || 'USD', 'USD', rates) * (e.hours || 0)
  return convert(e.amountNative || 0, e.cur || 'USD', 'USD', rates)
}

const isMonth = key => e => monthKeyOf(e.date) === key
const sameCat = catId => x => (x.categoryId || null) === (catId || null)

export function accruedUSDForMonth(entries, key, rates, catId) {
  let s = 0
  for (const e of entries) {
    if (e.kind !== 'hourly' || monthKeyOf(e.date) !== key) continue
    if (catId !== undefined && !sameCat(catId)(e)) continue
    s += workEntryUSD(e, rates)
  }
  return s
}

export function hoursForMonth(entries, key) {
  return entries.filter(e => e.kind === 'hourly' && isMonth(key)(e)).reduce((s, e) => s + (e.hours || 0), 0)
}

export function categoriesInMonth(entries, key) {
  const set = new Set()
  for (const e of entries) if (e.kind === 'hourly' && monthKeyOf(e.date) === key) set.add(e.categoryId || 'no-cat')
  return Array.from(set)
}

export function paidUSDForMonth(payouts, key, rates, catId) {
  let s = 0
  for (const p of payouts) {
    if (p.month !== key) continue
    if (catId !== undefined && !sameCat(catId)(p)) continue
    s += convert(p.amount, p.cur || 'USD', 'USD', rates)
  }
  return s
}

export const hasGeneralFinal = (payouts, key) => payouts.some(p => p.month === key && !p.categoryId && p.type === 'final')
export const hasAnyFinal = (payouts, key) => payouts.some(p => p.month === key && p.type === 'final')

export function categoryStatus(entries, payouts, key, catId, rates) {
  if (hasGeneralFinal(payouts, key)) return 'paid'
  const catPayouts = payouts.filter(p => p.month === key && sameCat(catId)(p))
  const generalAdvance = payouts.filter(p => p.month === key && !p.categoryId && p.type === 'advance')
  if (catPayouts.some(p => p.type === 'final')) return 'paid'
  const accrued = accruedUSDForMonth(entries, key, rates, catId)
  const paid = catPayouts.reduce((s, p) => s + convert(p.amount, p.cur || 'USD', 'USD', rates), 0)
  if (paid === 0 && generalAdvance.length === 0) return 'pending'
  if (paid >= accrued) return 'paid'
  return 'partial'
}

// 'paid' | 'partial' | 'pending'
export function monthPayoutStatus(entries, payouts, key, rates) {
  const ps = payouts.filter(p => p.month === key)
  if (ps.length === 0) return 'pending'
  if (hasGeneralFinal(payouts, key)) return 'paid'
  const statuses = categoriesInMonth(entries, key).map(c => categoryStatus(entries, payouts, key, c === 'no-cat' ? null : c, rates))
  if (statuses.every(s => s === 'paid')) return 'paid'
  if (statuses.every(s => s === 'pending')) return 'pending'
  return 'partial'
}

export const STATUS_LABEL = { paid: 'виплачено', partial: 'частково', pending: 'очікує' }

// заробіток у межах [from, to): 'accrued' — за датою роботи, 'paid' — за датою виплати (+ фікс одразу)
export function workEarnedBetweenUSD(entries, payouts, from, to, mode, rates) {
  let sum = 0
  if (mode === 'paid') {
    for (const p of payouts) {
      const t = parseDate(p.date).getTime()
      if (t >= from && t < to) sum += convert(p.amount, p.cur || 'USD', 'USD', rates)
    }
    for (const e of entries) {
      if (e.kind !== 'fixed') continue
      const t = parseDate(e.date).getTime()
      if (t >= from && t < to) sum += workEntryUSD(e, rates)
    }
    return sum
  }
  for (const e of entries) {
    const t = parseDate(e.date).getTime()
    if (t >= from && t < to) sum += workEntryUSD(e, rates)
  }
  return sum
}

export function workHoursBetween(entries, from, to) {
  let h = 0
  for (const e of entries) {
    if (e.kind !== 'hourly') continue
    const t = parseDate(e.date).getTime()
    if (t >= from && t < to) h += e.hours || 0
  }
  return h
}

export function workByCategoryBetween(entries, payouts, categories, from, to, mode, rates) {
  const by = {}
  const add = (id, usd, hours) => { (by[id] ||= { usd: 0, hours: 0 }); by[id].usd += usd; by[id].hours += hours || 0 }
  if (mode === 'paid') {
    for (const p of payouts) {
      const t = parseDate(p.date).getTime()
      if (t >= from && t < to) add(p.categoryId || 'no-cat', convert(p.amount, p.cur || 'USD', 'USD', rates), 0)
    }
    for (const e of entries) {
      if (e.kind !== 'fixed') continue
      const t = parseDate(e.date).getTime()
      if (t >= from && t < to) add('fixed', workEntryUSD(e, rates), 0)
    }
  } else {
    for (const e of entries) {
      const t = parseDate(e.date).getTime()
      if (t < from || t >= to) continue
      if (e.kind === 'hourly') add(e.categoryId || 'no-cat', workEntryUSD(e, rates), e.hours || 0)
      else add('fixed', workEntryUSD(e, rates), 0)
    }
  }
  return Object.entries(by).map(([id, d]) => {
    let name
    if (id === 'fixed') name = 'Підробітки'
    else if (id === 'no-cat') name = 'Без категорії'
    else name = (categories.find(c => c.id === id) || {}).name || 'Категорія'
    return { id, name, usd: d.usd, hours: d.hours }
  }).sort((a, b) => b.usd - a.usd)
}

// усі місяці, в яких є погодинна робота або виплати, від нових до старих
export function workMonths(entries, payouts) {
  const set = new Set()
  for (const e of entries) if (e.kind === 'hourly') set.add(monthKeyOf(e.date))
  for (const p of payouts) if (p.month) set.add(p.month)
  return Array.from(set).sort((a, b) => b.localeCompare(a))
}

export function defaultCategory(categories) {
  return categories.find(c => c.isDefault) || categories[0] || null
}
