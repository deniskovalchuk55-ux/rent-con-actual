// Валюти й форматування. Конвертація як у v3: усе через USD за курсами rates = { UAH, PLN } (скільки одиниць за $1).
export const CURRENCIES = ['USD', 'UAH', 'PLN']
export const SYM = { USD: '$', UAH: '₴', PLN: 'zł' }
export const CUR_NAME = { USD: 'Долар', UAH: 'Гривня', PLN: 'Злотий' }
export const DEFAULT_RATES = { UAH: 41, PLN: 4.0 }

export function convert(amount, fromCur, toCur, rates) {
  const v = Number(amount) || 0
  const from = fromCur || 'USD'
  const to = toCur || 'USD'
  if (from === to) return v
  const r = rates || DEFAULT_RATES
  const usd = from === 'USD' ? v : v / (r[from] || DEFAULT_RATES[from] || 1)
  return to === 'USD' ? usd : usd * (r[to] || DEFAULT_RATES[to] || 1)
}

const NNBSP = ' ' // вузький нерозривний пробіл між тисячами

function groupInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP)
}

// Округлення як у v3: від 100 — цілі, від 10 — одна цифра після коми, менше — дві.
export function roundSmart(v) {
  const abs = Math.abs(v)
  if (abs >= 100) return Math.round(v)
  if (abs >= 10) return Math.round(v * 10) / 10
  return Math.round(v * 100) / 100
}

export function numStr(v, { decimals } = {}) {
  const r = decimals != null ? Number(Math.abs(v).toFixed(decimals)) : Math.abs(roundSmart(v))
  const [i, f] = String(r).split('.')
  return groupInt(i) + (f ? ',' + f : '')
}

// formatMoney(1234.5, 'UAH') → «1 235 ₴»; sign: 'auto' | 'always' | 'never'
export function formatMoney(v, cur = 'USD', { sign = 'auto', decimals } = {}) {
  const n = Number(v) || 0
  const s = numStr(n, { decimals })
  const neg = n < 0 && Math.abs(roundSmart(n)) > 0
  const pre = neg && sign !== 'never' ? '−' : (sign === 'always' && n > 0 ? '+' : '')
  if (cur === 'USD') return pre + '$' + s
  return pre + s + NNBSP + SYM[cur]
}

// Компактно для графіків і календаря: 1,2k / 15k / 1,3M
export function formatCompact(v, cur) {
  const n = Math.abs(Number(v) || 0)
  let s
  if (n >= 1e6) s = (Math.round(n / 1e5) / 10).toString().replace('.', ',') + 'M'
  else if (n >= 1e4) s = Math.round(n / 1e3) + 'k'
  else if (n >= 1e3) s = (Math.round(n / 100) / 10).toString().replace('.', ',') + 'k'
  else if (n >= 100) s = String(Math.round(n))
  else if (n >= 10) s = String(Math.round(n * 10) / 10).replace('.', ',')
  else s = String(Math.round(n * 100) / 100).replace('.', ',')
  const pre = v < 0 ? '−' : ''
  if (!cur) return pre + s
  return cur === 'USD' ? pre + '$' + s : pre + s + SYM[cur]
}

export function parseAmount(str) {
  if (str == null) return NaN
  const s = String(str).replace(/\s| | /g, '').replace(',', '.')
  if (s === '') return NaN
  return Number(s)
}

/* ===== Курси: кілька джерел по черзі (як у v3) ===== */
export const FX_SOURCES = [
  {
    name: 'НБУ',
    url: 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json',
    parse: data => {
      if (!Array.isArray(data)) return null
      const usd = data.find(x => x.cc === 'USD')
      const pln = data.find(x => x.cc === 'PLN')
      if (!usd) return null
      return { UAH: usd.rate, PLN: pln ? usd.rate / pln.rate : null }
    },
  },
  {
    name: 'ExchangeRate-API',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: data => (data && data.rates ? { UAH: data.rates.UAH || null, PLN: data.rates.PLN || null } : null),
  },
  {
    name: 'ПриватБанк',
    url: 'https://api.privatbank.ua/p24api/pubinfo?json&exchange&coursid=11',
    parse: data => {
      if (!Array.isArray(data)) return null
      const usd = data.find(x => x.ccy === 'USD')
      const pln = data.find(x => x.ccy === 'PLN')
      const uah = usd ? parseFloat(usd.sale) : null
      if (!uah) return null
      return { UAH: uah, PLN: pln ? uah / parseFloat(pln.sale) : null }
    },
  },
]

export async function fetchRates() {
  for (const src of FX_SOURCES) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 6000)
      const r = await fetch(src.url, { signal: ctrl.signal })
      clearTimeout(t)
      if (!r.ok) continue
      const rates = src.parse(await r.json())
      if (!rates || !rates.UAH) continue
      return {
        UAH: Math.round(rates.UAH * 100) / 100,
        PLN: rates.PLN ? Math.round(rates.PLN * 1000) / 1000 : null,
        source: src.name,
      }
    } catch { /* наступне джерело */ }
  }
  return null
}
