// Дати. Логіка періодів перенесена з v3 без змін (30.44 дня в місяці, тиждень з понеділка).
export const MS_DAY = 86400000
export const AVG_MONTH_DAYS = 30.44

export const UA_MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
export const UA_MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']
export const UA_MONTHS_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру']
export const UA_WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']

export function today() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// 'YYYY-MM-DD' (або ISO з часом) → локальна північ того дня
export function parseDate(s) {
  if (s instanceof Date) { const d = new Date(s); d.setHours(0, 0, 0, 0); return d }
  if (!s) return today()
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00')
  if (isNaN(d)) return today()
  d.setHours(0, 0, 0, 0)
  return d
}

export function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function daysBetween(a, b) { return Math.round((b - a) / MS_DAY) }

export function addMonthsDays(date, monthsFloat) {
  const whole = Math.floor(monthsFloat)
  const frac = monthsFloat - whole
  const d = new Date(date)
  d.setMonth(d.getMonth() + whole)
  d.setDate(d.getDate() + Math.round(frac * AVG_MONTH_DAYS))
  d.setHours(0, 0, 0, 0)
  return d
}

export function splitMonthsDays(m) {
  const whole = Math.floor(m)
  const days = Math.round((m - whole) * AVG_MONTH_DAYS)
  return { months: whole, days }
}

export function fmtMonthsDays(m) {
  const { months, days } = splitMonthsDays(m)
  if (months === 0 && days === 0) return '0 дн'
  const parts = []
  if (months > 0) parts.push(months + ' міс')
  if (days > 0) parts.push(days + ' дн')
  return parts.join(' ')
}

export function startOf(unit, now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (unit === 'day') return d
  if (unit === 'week') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d }
  if (unit === 'month') { d.setDate(1); return d }
  if (unit === 'year') { d.setMonth(0, 1); return d }
  return d
}

export function monthKeyOf(date) {
  const d = date instanceof Date ? date : parseDate(date)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

export function monthKeyLabel(key, { short = false } = {}) {
  const [y, m] = key.split('-').map(Number)
  return (short ? UA_MONTHS_SHORT : UA_MONTHS)[m - 1] + ' ' + y
}

export function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return monthKeyOf(d)
}

export function isoWeekInfo(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const year = d.getFullYear()
  const jan1 = new Date(year, 0, 1)
  const week = Math.ceil((((d - jan1) / 86400000) + 1) / 7)
  const dt = new Date(date)
  dt.setHours(0, 0, 0, 0)
  const start = new Date(dt); start.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
  const end = new Date(start); end.setDate(start.getDate() + 6)
  return { year, week, start, end }
}

// «3 листопада», рік додається, якщо він не поточний
export function fmtDate(d, { year } = {}) {
  const x = d instanceof Date ? d : parseDate(d)
  const showYear = year ?? x.getFullYear() !== new Date().getFullYear()
  return x.getDate() + ' ' + UA_MONTHS_GEN[x.getMonth()] + (showYear ? ' ' + x.getFullYear() : '')
}

export function fmtDateShort(d) {
  const x = d instanceof Date ? d : parseDate(d)
  return x.getDate() + ' ' + UA_MONTHS_SHORT[x.getMonth()] + (x.getFullYear() !== new Date().getFullYear() ? ' ' + String(x.getFullYear()).slice(2) : '')
}

// «сьогодні», «вчора», «завтра» або дата
export function fmtRelDay(d) {
  const x = d instanceof Date ? d : parseDate(d)
  const diff = daysBetween(today(), x)
  if (diff === 0) return 'сьогодні'
  if (diff === -1) return 'вчора'
  if (diff === 1) return 'завтра'
  return fmtDate(x)
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

export function daysWord(n) { return plural(n, 'день', 'дні', 'днів') }
