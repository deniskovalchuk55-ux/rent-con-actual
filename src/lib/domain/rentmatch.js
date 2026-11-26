// «Схоже на оплату оренди»: надходження на картку, яке за сумою (ставка × місяці) і часом відповідає
// орендарю, а в застосунку такої оплати ще немає. Застосунок лише пропонує — зараховує людина.
import { nextPayDate } from './rent.js'
import { rowUSD, isJar, timeOf } from './ledger.js'
import { convert } from '../money.js'
import { parseDate, MS_DAY } from '../dates.js'

const norm = s => String(s || '').toLowerCase().replace(/[ʼ'’`]/g, "'").replace(/[^a-zа-яіїєґ0-9' ]/gi, ' ').replace(/\s+/g, ' ').trim()
// «Від: Олена К.» → «олена к»
export const senderOf = r => norm(String(r.title || '').replace(/^від\s*:?\s*/i, ''))

// Скільки слів імені збігається (ім'я, прізвище, ініціал не рахуємо)
export function nameScore(sender, clientName) {
  const a = norm(sender).split(' ').filter(w => w.length >= 3)
  const b = norm(clientName).split(' ').filter(w => w.length >= 3)
  let hits = 0
  for (const w of a) if (b.some(x => x === w || (x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))) hits++
  return hits
}

export function rentMatches(clients, rows, rates, { skip = [], now = new Date() } = {}) {
  const nowMs = now.getTime()
  const since = nowMs - 45 * MS_DAY
  const skipSet = new Set(skip)
  const found = []
  for (const r of rows) {
    if (r.kind !== 'income' || !(r.amount > 0) || isJar(r) || skipSet.has(r.bankId) || skipSet.has(r.id)) continue
    const t = timeOf(r)
    if (t < since || t > nowMs + MS_DAY) continue
    const usd = rowUSD(r, rates)
    if (!(usd > 0)) continue
    const cands = []
    for (const c of clients) {
      const rateUSD = convert(c.rate, c.cur || 'USD', 'USD', rates)
      if (!(rateUSD > 0)) continue
      const k = Math.round(usd / rateUSD)
      if (k < 1 || k > 12) continue
      const sameCur = r.currency === c.cur
      const name = nameScore(senderOf(r), c.name)
      // у валюті орендаря — точно; з перерахунком курсу — з допуском, але тоді має збігтися й імʼя
      if (!sameCur && !name) continue
      const tol = sameCur ? 0.01 : 0.05
      if (Math.abs(usd - k * rateUSD) > rateUSD * k * tol) continue
      // лише сума — тільки звичні періоди (1, 2, 3, 6, 12 міс), інакше надто легко вгадати хибно
      if (!name && ![1, 2, 3, 6, 12].includes(k)) continue
      // ця оплата вже записана (±7 днів, схожа сума)
      const recorded = (c.payments || []).some(p => Math.abs(parseDate(p.date).getTime() - t) <= 7 * MS_DAY &&
        Math.abs(convert(p.amountNative, p.cur || c.cur, 'USD', rates) - usd) <= usd * 0.1)
      if (recorded) continue
      // гроші приходять близько до дати оплати (або коли вже прострочено), а не за місяць до неї
      if (t < nextPayDate(c).getTime() - 20 * MS_DAY) continue
      cands.push({ c, k, name })
    }
    if (!cands.length) continue
    cands.sort((a, b) => b.name - a.name)
    // кілька орендарів з такою ставкою і без підказки в імені — не вгадуємо
    if (cands.length > 1 && cands[0].name === cands[1].name) continue
    found.push({ id: r.bankId || r.id, row: r, client: cands[0].c, months: cands[0].k, strong: cands[0].name > 0 })
  }
  // на кожного орендаря — одна, найсвіжіша підказка
  const seen = new Set()
  return found.sort((a, b) => timeOf(b.row) - timeOf(a.row)).filter(x => (seen.has(x.client.id) ? false : seen.add(x.client.id))).slice(0, 5)
}
