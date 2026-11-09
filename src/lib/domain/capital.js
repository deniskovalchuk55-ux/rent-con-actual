// Цілі й активи. Формули — як у v3.
import { parseDate, today, daysBetween } from '../dates.js'
import { convert } from '../money.js'

/* ===== Цілі ===== */
export function goalWithTx(g, txs, rates) {
  const transactions = txs.filter(t => t.goalId === g.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  let saved = 0
  for (const t of transactions) {
    const native = convert(convert(t.amount, t.cur, 'USD', rates), 'USD', g.cur, rates)
    if (t.type === 'add') saved += native
    else if (t.type === 'take' || t.type === 'spent') saved -= native
  }
  saved = Math.max(0, saved)
  const pct = g.target > 0 ? Math.min(1, saved / g.target) : 0
  return { ...g, transactions, saved, pct }
}

// Темп: середній внесок за 30 днів від старту → оцінка дати досягнення
export function goalForecast(g) {
  if (g.status !== 'active' || g.saved >= g.target) return null
  const started = parseDate(g.start)
  const days = Math.max(1, daysBetween(started, today()))
  const hasAdds = g.transactions.some(t => t.type === 'add')
  if (!hasAdds || g.saved <= 0) return null
  const perDay = g.saved / days
  if (perDay <= 0) return null
  const left = (g.target - g.saved) / perDay
  const eta = new Date(today().getTime() + left * 86400000)
  return { perMonth: perDay * 30.44, eta }
}

export function deadlineInfo(g) {
  if (!g.deadline) return null
  const d = daysBetween(today(), parseDate(g.deadline))
  return { days: d, text: d > 0 ? `${d} дн до дедлайну` : d === 0 ? 'дедлайн сьогодні' : `дедлайн минув ${-d} дн тому` }
}

/* ===== Активи ===== */
export function assetWithTx(a, txs, prices, rates) {
  const transactions = txs.filter(t => t.assetId === a.id).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
  let qty = 0, investedUSD = 0, totalBuyCostUSD = 0, totalBuyQty = 0
  // хронологічно для коректної середньої
  for (const t of [...transactions].reverse()) {
    const priceUSD = convert(t.price, t.cur || 'USD', 'USD', rates)
    const feeUSD = convert(t.fee || 0, t.cur || 'USD', 'USD', rates)
    if (t.txType === 'buy') {
      qty += t.qty
      investedUSD += t.qty * priceUSD + feeUSD
      totalBuyCostUSD += t.qty * priceUSD
      totalBuyQty += t.qty
    } else if (t.txType === 'sell') {
      qty -= t.qty
      investedUSD -= (totalBuyQty > 0 ? totalBuyCostUSD / totalBuyQty : 0) * t.qty
    }
  }
  const p = prices[a.cgId] || {}
  const price = p.price || 0
  const q = Math.max(0, qty)
  const inv = Math.max(0, investedUSD)
  const valueUSD = q * price
  const pnlUSD = valueUSD - inv
  return {
    ...a, transactions, qty: q, investedUSD: inv,
    avgBuyUSD: totalBuyQty > 0 ? totalBuyCostUSD / totalBuyQty : 0,
    priceUSD: price, change24h: p.change24h || 0,
    valueUSD, pnlUSD, pnlPct: inv > 0 ? (pnlUSD / inv) * 100 : 0,
  }
}

// Баланс портфеля в часі: кількість на кожну дату × ціна з історії CoinGecko
export function portfolioHistory(assets, histories, rates) {
  const lead = assets.find(a => (histories[a.cgId] || []).length > 1)
  if (!lead) return []
  const timeline = histories[lead.cgId]
  const pts = []
  for (const [ts] of timeline) {
    let value = 0, invested = 0
    for (const a of assets) {
      let qty = 0, cost = 0
      for (const t of [...a.transactions].reverse()) {
        if (new Date(t.date).getTime() > ts) continue
        const priceUSD = convert(t.price, t.cur || 'USD', 'USD', rates)
        if (t.txType === 'buy') { qty += t.qty; cost += t.qty * priceUSD }
        else { const before = qty; qty -= t.qty; cost -= (before > 0 ? cost / before : 0) * t.qty }
      }
      if (qty <= 0) continue
      let priceAt = a.priceUSD || 0
      for (const [ht, pr] of histories[a.cgId] || []) { if (ht <= ts) priceAt = pr; else break }
      value += qty * priceAt
      invested += cost
    }
    pts.push({ t: ts, v: value, pnl: value - invested })
  }
  return pts
}

export function fmtQty(q) {
  if (!q) return '0'
  const s = q >= 1000 ? q.toFixed(2) : q >= 1 ? q.toFixed(4) : q.toFixed(6)
  return s.replace(/\.?0+$/, '').replace('.', ',')
}

export function fmtPriceUSD(p) {
  if (!p) return '$0'
  if (p >= 1000) return '$' + Math.round(p).toLocaleString('uk-UA').replace(/\s/g, ' ')
  if (p >= 1) return '$' + p.toFixed(2).replace('.', ',')
  return '$' + p.toPrecision(3).replace('.', ',')
}
