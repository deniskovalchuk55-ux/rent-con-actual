// Прогноз заробітку на поточний місяць. Лінійний «темп» (зароблене ÷ частку місяця) бреше, коли оренда
// приходить нерівно: два орендарі заплатили 2-го — і «темп» обіцяє вдесятеро більше. Тому рахуємо так:
// уже зароблене + оплати оренди, які мають прийти до кінця місяця + робота за середнім темпом останніх 4 тижнів.
import { nextPayDate } from './rent.js'
import { workEarnedBetweenUSD } from './work.js'
import { convert } from '../money.js'
import { MS_DAY } from '../dates.js'

const OVERDUE_MAX_DAYS = 31 // давно прострочених (схоже, вже не орендують) у прогноз не беремо

export function monthForecast(data, mode, rates, now = new Date()) {
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const nowMs = now.getTime()

  // 1) оренда: наступна оплата до кінця місяця; сума — як зазвичай платить (на скільки місяців)
  const rentItems = []
  for (const c of data.clients || []) {
    const due = nextPayDate(c).getTime()
    if (due >= monthEnd) continue
    if (todayStart - due > OVERDUE_MAX_DAYS * MS_DAY) continue
    // зазвичай на скільки місяців платить: медіана трьох останніх оплат
    const recent = (c.payments || []).slice(-3).map(p => p.months).filter(x => x > 0).sort((a, b) => a - b)
    const months = recent.length ? recent[Math.floor(recent.length / 2)] : 1
    const usd = convert((c.rate || 0) * months, c.cur || 'USD', 'USD', rates)
    if (usd > 0) rentItems.push({ id: c.id, name: c.name, usd, due, overdue: due < todayStart, months })
  }
  rentItems.sort((a, b) => a.due - b.due)
  const rent = rentItems.reduce((s, x) => s + x.usd, 0)

  // 2) робота: середнє за день за 28 повних днів до сьогодні × скільки лишилось до кінця місяця
  const worked = workEarnedBetweenUSD(data.workEntries || [], data.payouts || [], todayStart - 28 * MS_DAY, todayStart, mode, rates)
  const perDay = worked / 28
  const daysLeft = Math.max(0, (monthEnd - nowMs) / MS_DAY)
  const work = perDay * daysLeft

  return { rent, rentItems, work, perDay, daysLeft, overdue: rentItems.filter(x => x.overdue).length }
}
