// Оренда: періоди оплат, статуси, виконане/в процесі, рефералка. Формули — як у v3.
import { addMonthsDays, AVG_MONTH_DAYS, daysBetween, MS_DAY, parseDate, startOf, today } from '../dates.js'
import { convert } from '../money.js'

export const totalMonths = c => (c.payments || []).reduce((s, p) => s + (p.months || 0), 0)

// фактичний старт із бонусними днями (разовий зсув)
export function effectiveStart(c) {
  const d = parseDate(c.start)
  if (c.bonusDays && c.bonusDays > 0) d.setDate(d.getDate() + c.bonusDays)
  return d
}

// кінець платного періоду (без реферального бонусу)
export function paidUntilDate(c) {
  return addMonthsDays(effectiveStart(c), totalMonths(c))
}

// коли очікується наступна оплата
export function nextPayDate(c) {
  if (c.payMode === 'postpaid') {
    const ps = c.payments || []
    if (ps.length > 0) return addMonthsDays(parseDate(ps[ps.length - 1].date), 1)
    return addMonthsDays(effectiveStart(c), 1)
  }
  return addMonthsDays(effectiveStart(c), totalMonths(c) + (c.bonusMonths || 0))
}

// 'due' ≤ 0 днів, 'warn' ≤ 3, 'soon' ≤ 7, 'ok'
export function statusOf(c, now = today()) {
  const days = daysBetween(now, nextPayDate(c))
  if (days <= 0) return { level: 'due', days }
  if (days <= 3) return { level: 'warn', days }
  if (days <= 7) return { level: 'soon', days }
  return { level: 'ok', days }
}

export function nextPayText(days) {
  if (days > 1) return 'через ' + days + ' дн'
  if (days === 1) return 'завтра'
  if (days === 0) return 'сьогодні'
  return 'прострочено ' + Math.abs(days) + ' дн'
}

// Кожна оплата покриває період, що починається там, де закінчилась попередня (від c.start).
export function paymentSpans(c) {
  const spans = []
  let cursor = parseDate(c.start)
  for (const p of c.payments || []) {
    const start = new Date(cursor)
    const end = addMonthsDays(cursor, p.months)
    spans.push({ start, end, amountNative: p.amountNative, cur: p.cur || c.cur, payment: p })
    cursor = end
  }
  return spans
}

function spanDoneRatio(span, now) {
  const total = span.end - span.start
  if (total <= 0) return 1
  if (now >= span.end) return 1
  if (now <= span.start) return 0
  return (now - span.start) / total
}

export function clientDoneUSD(c, nowMs, rates) {
  let done = 0
  for (const s of paymentSpans(c)) done += convert(s.amountNative, s.cur, 'USD', rates) * spanDoneRatio(s, nowMs)
  return done
}

export function clientDoneBetweenUSD(c, from, to, rates) {
  let done = 0
  for (const s of paymentSpans(c)) {
    const start = Math.max(s.start, from)
    const end = Math.min(s.end, to)
    if (end <= start) continue
    const total = s.end - s.start
    if (total <= 0) continue
    done += convert(s.amountNative, s.cur, 'USD', rates) * ((end - start) / total)
  }
  return done
}

export function clientInProgressUSD(c, nowMs, rates) {
  let prog = 0
  for (const s of paymentSpans(c)) {
    if (nowMs >= s.end) continue
    const total = s.end - s.start
    if (total <= 0) continue
    const remaining = nowMs <= s.start ? 1 : (s.end - nowMs) / total
    prog += convert(s.amountNative, s.cur, 'USD', rates) * remaining
  }
  return prog
}

export const clientPaidUSD = (c, rates) => (c.payments || []).reduce((s, p) => s + convert(p.amountNative, p.cur || c.cur, 'USD', rates), 0)
export const portfolioMonthlyUSD = (clients, rates) => clients.reduce((s, c) => s + convert(c.rate, c.cur, 'USD', rates), 0)

/* ===== Рефералка =====
   Бонус запрошувачу нараховується, коли приведений клієнт має оплату ≥ 1 місяць і з його старту минув ≥ 1 місяць
   (або в Notion уже стоїть «Бонус виданий»). Рахується детерміновано при кожному завантаженні. */
export function isReferralReady(c, now = today()) {
  if (totalMonths(c) < 1) return false
  return (now.getTime() - parseDate(c.start).getTime()) / MS_DAY >= AVG_MONTH_DAYS
}

export function applyReferrals(clients, now = today()) {
  const byId = new Map(clients.map(c => [c.id, { ...c, bonusMonths: 0, bonusLog: [], referralGranted: false }]))
  for (const c of byId.values()) {
    if (!c.referredBy || !c.bonusAmount) continue
    const referrer = byId.get(c.referredBy)
    if (!referrer) continue
    if (c.bonusGranted || isReferralReady(c, now)) {
      c.referralGranted = true
      referrer.bonusMonths += c.bonusAmount
      referrer.bonusLog.push({ fromId: c.id, fromName: c.name, months: c.bonusAmount })
    }
  }
  return clients.map(c => byId.get(c.id))
}

export function referralBonusUSD(c, clients, rates) {
  const referrer = clients.find(x => x.id === c.referredBy)
  if (!referrer) return 0
  return convert(referrer.rate, referrer.cur, 'USD', rates) * (c.bonusAmount || 0)
}

export function referralTotals(clients, rates) {
  let granted = 0
  let pending = 0
  for (const c of clients) {
    if (!c.referredBy || !c.bonusAmount) continue
    const v = referralBonusUSD(c, clients, rates)
    if (c.referralGranted) granted += v
    else pending += v
  }
  return { granted, pending }
}

/* ===== Дохід за період ===== */
export function rentDoneUSD(clients, from, to, rates) {
  let s = 0
  for (const c of clients) s += clientDoneBetweenUSD(c, from, to, rates)
  return s
}

// виконане (нараховане за часом) за період 'day' | 'week' | 'month' | 'year' | 'all'
export function rentEarnedUSD(clients, period, rates, now = new Date()) {
  if (period === 'all') return clients.reduce((s, c) => s + clientDoneUSD(c, now.getTime(), rates), 0)
  return rentDoneUSD(clients, startOf(period, now).getTime(), now.getTime() + MS_DAY, rates)
}

// разова плата (розробка) зараховується на дату старту клієнта
export function setupBetweenUSD(clients, from, to, rates) {
  let sum = 0
  for (const c of clients) {
    if (!c.setupAmount || c.setupAmount <= 0) continue
    const t = parseDate(c.start).getTime()
    if (t >= from && t < to) sum += convert(c.setupAmount, c.setupCur || 'USD', 'USD', rates)
  }
  return sum
}

// гроші, що надійшли (за датою оплати)
export function rentCashBetweenUSD(clients, from, to, rates) {
  let s = 0
  for (const c of clients) {
    for (const p of c.payments || []) {
      const t = parseDate(p.date).getTime()
      if (t >= from && t < to) s += convert(p.amountNative, p.cur || c.cur, 'USD', rates)
    }
  }
  return s
}

// Частка поточного оплаченого періоду, що вже минула (для кільця на картці)
export function periodProgress(c, now = today()) {
  const next = nextPayDate(c)
  if (c.payMode === 'postpaid') {
    const ps = c.payments || []
    const from = ps.length ? parseDate(ps[ps.length - 1].date) : effectiveStart(c)
    const total = next - from
    if (total <= 0) return 1
    return Math.min(1, Math.max(0, (now - from) / total))
  }
  // передплата: від початку останнього оплаченого відрізка до кінця
  const spans = paymentSpans(c)
  const end = next
  const startCandidate = spans.length ? spans[spans.length - 1].start : effectiveStart(c)
  const total = end - startCandidate
  if (total <= 0) return 1
  return Math.min(1, Math.max(0, (now - startCandidate) / total))
}
