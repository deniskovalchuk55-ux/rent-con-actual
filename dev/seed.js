// Демо-дані (вигадані): орендарі сайтів, оплати, робота на будові й підробітки, виплати, витрати, цілі, монети.
const T = s => ({ title: [{ text: { content: s } }] })
const R = s => ({ rich_text: [{ text: { content: s || '' } }] })
const N = v => ({ number: v })
const S = v => ({ select: v ? { name: v } : null })
const D = v => ({ date: v ? { start: v } : null })
const C = v => ({ checkbox: !!v })
const REL = id => ({ relation: id ? [{ id }] : [] })

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296) }
const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysAgo = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d }
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x }

export function seed(fake, tgId = 111) {
  const r = rng(20261108)
  const TG = { 'Telegram ID': N(tgId) }

  /* ===== Орендарі ===== */
  // cover: до якої дати (від сьогодні) оплачено — щоб у демо були різні статуси
  const clients = [
    { name: 'Сайт «Квітковий двір»', rate: 45, cur: 'USD', startAgo: 520, block: 3, cover: 40, setup: 600, phone: '+380671234567', tg: 'kvitkovyi_dvir' },
    { name: 'СТО «Мотор» — лендінг', rate: 1200, cur: 'UAH', startAgo: 330, block: 1, cover: 5, setup: 9000, setupCur: 'UAH', tg: 'motor_sto' },
    { name: 'Магазин «Ремонт-Плюс»', rate: 80, cur: 'USD', startAgo: 400, block: 6, cover: 150, setup: 1200, phone: '+380501112233' },
    { name: 'Стоматологія «Дент-Арт»', rate: 60, cur: 'USD', startAgo: 210, block: 1, cover: 2, ref: 0, bonus: 3, tg: 'dentart_clinic' },
    { name: 'Барбершоп «Борода»', rate: 900, cur: 'UAH', startAgo: 160, block: 1, cover: 0, payMode: 'postpaid', tg: 'boroda_barber' },
    { name: 'Кавʼярня «Зерно»', rate: 35, cur: 'USD', startAgo: 95, block: 1, cover: -3, ref: 2, bonus: 4.5, bonusDays: 14 },
    { name: 'Адвокат Олена К.', rate: 150, cur: 'PLN', startAgo: 64, block: 1, cover: 25, tg: 'olena_lawyer' },
    { name: 'Фітнес-клуб «Пульс»', rate: 55, cur: 'USD', startAgo: 26, block: 1, cover: 9, setup: 450, ref: 3, bonus: 3 },
  ]
  const ids = []
  clients.forEach((c, i) => {
    const page = fake.insert('DB_CLIENTS', {
      'Назва': T(c.name), 'Ставка': N(c.rate), 'Валюта': S(c.cur), 'Старт': D(iso(daysAgo(c.startAgo))),
      'Телефон': R(c.phone || ''), 'Telegram': R(c.tg || ''), 'Setup сума': N(c.setup || 0), 'Setup валюта': S(c.setupCur || c.cur),
      'Тип оплати': S(c.payMode || 'prepaid'), 'Бонусні дні': N(c.bonusDays || 0), 'Реферал': REL(c.ref != null ? ids[c.ref] : null),
      'Бонус-сума': N(c.bonus || 0), 'Бонус виданий': C(false), ...TG,
    }, { created: daysAgo(c.startAgo).toISOString() })
    ids.push(page.id)
    const start = daysAgo(c.startAgo)
    const effStart = new Date(start); if (c.bonusDays) effStart.setDate(effStart.getDate() + c.bonusDays)
    const target = daysAgo(-c.cover)
    if (c.payMode === 'postpaid') {
      // постоплата: платить наприкінці кожного місяця користування; наступна оплата = остання + 1 міс
      let cursor = addMonths(effStart, 1)
      let k = 0
      while (addMonths(cursor, 1) <= addMonths(target, 0) && cursor <= new Date()) {
        fake.insert('DB_PAYMENTS', { 'ID': T('pay-' + k++), 'Клієнт': REL(page.id), 'Дата': D(iso(cursor)), 'Місяців': N(1), 'Сума': N(c.rate), 'Валюта': S(c.cur), ...TG })
        cursor = addMonths(cursor, 1)
      }
    } else {
      // передплата: блоками на початку періоду; останній платіж може бути частковим («за сумою»)
      const totalM = Math.max(0, (target - effStart) / 86400000 / 30.44)
      let left = Math.round(totalM * 100) / 100
      let cursor = new Date(start)
      let k = 0
      while (left > 0.05) {
        const months = left >= c.block ? c.block : Math.round(left * 100) / 100
        const payDate = new Date(cursor); payDate.setDate(payDate.getDate() - Math.floor(r() * 3))
        if (payDate > new Date()) break
        fake.insert('DB_PAYMENTS', { 'ID': T('pay-' + k++), 'Клієнт': REL(page.id), 'Дата': D(iso(payDate)), 'Місяців': N(months), 'Сума': N(Math.round(months * c.rate * 100) / 100), 'Валюта': S(c.cur), ...TG })
        cursor = new Date(cursor.getTime() + months * 30.44 * 86400000)
        left = Math.round((left - months) * 100) / 100
      }
    }
  })

  /* ===== Категорії й робота ===== */
  const build = fake.insert('DB_WORK_CATEGORIES', { 'Назва': T('Будова'), 'Ставка': N(15), 'Валюта': S('USD'), 'За замовчуванням': C(true), ...TG })
  const side = fake.insert('DB_WORK_CATEGORIES', { 'Назва': T('Підробіток'), 'Ставка': N(10), 'Валюта': S('USD'), 'За замовчуванням': C(false), ...TG })
  const electric = fake.insert('DB_WORK_CATEGORIES', { 'Назва': T('Електрика'), 'Ставка': N(750), 'Валюта': S('UAH'), 'За замовчуванням': C(false), ...TG })
  const notes = ['', '', '', 'опалубка', 'кладка 2 поверх', 'армування', 'штукатурка', 'покрівля', '']
  for (let ago = 335; ago >= 0; ago--) {
    const d = daysAgo(ago)
    const wd = d.getDay()
    if (wd === 0) continue
    if (wd === 6 && r() < 0.55) continue
    if (r() < 0.12) continue
    const roll = r()
    const cat = roll < 0.78 ? build : roll < 0.9 ? electric : side
    const hours = cat === side ? [3, 4, 5][Math.floor(r() * 3)] : [8, 8, 9, 10, 8.5, 7, 11][Math.floor(r() * 7)]
    const rate = cat === build ? (ago > 220 ? 13 : ago > 100 ? 14 : 15) : cat === electric ? 750 : 10
    const cur = cat === electric ? 'UAH' : 'USD'
    fake.insert('DB_WORK_ENTRIES', {
      'ID': T('we-' + ago), 'Дата': D(iso(d)), 'Тип': S('hourly'), 'Години': N(hours), 'Ставка': N(rate), 'Ставка валюта': S(cur),
      'Категорія': REL(cat.id), 'Назва': R(''), 'Сума': N(null), 'Валюта': S(null), 'Опис': R(notes[Math.floor(r() * notes.length)]), ...TG,
    })
  }
  const gigs = [
    [130, 'Лендінг для салону краси', 350, 'USD'], [88, 'Правки на сайті кавʼярні', 2000, 'UAH'], [54, 'Налаштування реклами', 120, 'USD'],
    [19, 'Логотип для СТО', 3500, 'UAH'], [6, 'Перенесення сайту на новий хостинг', 80, 'USD'],
  ]
  for (const [ago, title, amt, cur] of gigs) {
    fake.insert('DB_WORK_ENTRIES', { 'ID': T('we-f' + ago), 'Дата': D(iso(daysAgo(ago))), 'Тип': S('fixed'), 'Години': N(null), 'Ставка': N(null), 'Ставка валюта': S(null), 'Категорія': REL(null), 'Назва': R(title), 'Сума': N(amt), 'Валюта': S(cur), 'Опис': R(''), ...TG })
  }

  // виплати: аванс 15-го і фактична на початку наступного місяця
  const now = new Date()
  for (let k = 11; k >= 0; k--) {
    const m = new Date(now.getFullYear(), now.getMonth() - k, 1)
    const key = m.getFullYear() + '-' + pad(m.getMonth() + 1)
    const adv = new Date(m.getFullYear(), m.getMonth(), 15)
    if (adv <= now) fake.insert('DB_PAYOUTS', { 'ID': T('po-a' + key), 'Місяць': R(key), 'Дата': D(iso(adv)), 'Сума': N(18000), 'Валюта': S('UAH'), 'Тип': S('advance'), 'Категорія': REL(null), ...TG })
    if (k >= 1) {
      const fin = new Date(m.getFullYear(), m.getMonth() + 1, 3)
      if (k === 1 && fin > now) continue
      fake.insert('DB_PAYOUTS', { 'ID': T('po-f' + key), 'Місяць': R(key), 'Дата': D(iso(fin)), 'Сума': N(k === 3 ? 1650 : 1980 + Math.round(r() * 350)), 'Валюта': S('USD'), 'Тип': S(k === 1 ? 'advance' : 'final'), 'Категорія': REL(null), ...TG })
    }
  }

  /* ===== Витрати (Expense·Control) ===== */
  const ecats = ['Продукти', 'Житло й комуналка', 'Транспорт', 'Сервери й домени', 'Ресторани', 'Здоровʼя', 'Розваги'].map((name, i) =>
    fake.insert('DB_CAT_EXPENSES', { 'Назва': T(name), 'Загальна': C(i < 3), ...TG }))
  const plan = [[0, 1900, 8], [1, 13500, 1], [2, 900, 4], [3, 38, 1, 'USD'], [4, 800, 3], [5, 1100, 1], [6, 600, 2]]
  for (let k = 11; k >= 0; k--) {
    const base = new Date(now.getFullYear(), now.getMonth() - k, 1)
    for (const [ci, amt, times, cur] of plan) {
      for (let t = 0; t < times; t++) {
        const day = 1 + Math.floor(r() * 27)
        const d = new Date(base.getFullYear(), base.getMonth(), day)
        if (d > now) continue
        fake.insert('DB_EXPENSES', { 'Назва': T('витрата'), 'Сума': N(Math.round(amt * (0.7 + r() * 0.6))), 'Валюта': S(cur || 'UAH'), 'Дата': D(iso(d)), 'Категорія': REL(ecats[ci].id), 'Опис': R(''), ...TG })
      }
    }
  }

  /* ===== Цілі ===== */
  const goals = [
    { name: 'MacBook Pro 16', target: 2600, cur: 'USD', icon: '💻', startAgo: 150, deadlineIn: 75, adds: [400, 350, 300, 280, 230] },
    { name: 'Подушка безпеки', target: 6000, cur: 'USD', icon: '🛡️', startAgo: 300, deadlineIn: null, adds: [500, 500, 400, 300, 450, 250], takes: [300] },
    { name: 'Відпустка в Карпатах', target: 40000, cur: 'UAH', icon: '🏝️', startAgo: 120, deadlineIn: 30, adds: [12000, 10000, 9000, 6000, 5000], levels: [30000] },
  ]
  for (const g of goals) {
    const page = fake.insert('DB_GOALS', {
      'Назва': T(g.name), 'Поточна ціль': N(g.target), 'Валюта': S(g.cur), 'Старт': D(iso(daysAgo(g.startAgo))),
      'Дедлайн': D(g.deadlineIn != null ? iso(daysAgo(-g.deadlineIn)) : null), 'Іконка': R(g.icon), 'Історія рівнів': R(JSON.stringify(g.levels || [])),
      'Статус': S('active'), ...TG,
    })
    g.adds.forEach((a, i) => fake.insert('DB_GOAL_TX', { 'ID': T('gt'), 'Ціль': REL(page.id), 'Дата': D(iso(daysAgo(g.startAgo - 5 - i * 24))), 'Сума': N(a), 'Валюта': S(g.cur), 'Тип': S('add'), 'Опис': R(i === 0 ? 'старт' : ''), ...TG }))
    ;(g.takes || []).forEach((a, i) => fake.insert('DB_GOAL_TX', { 'ID': T('gt'), 'Ціль': REL(page.id), 'Дата': D(iso(daysAgo(40 + i * 10))), 'Сума': N(a), 'Валюта': S(g.cur), 'Тип': S('take'), 'Опис': R('ремонт авто'), ...TG }))
  }

  /* ===== Активи ===== */
  const assets = [
    { id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', icon: 'https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png', tx: [[200, 0.012, 61200], [120, 0.015, 67800], [40, 0.008, 88400]] },
    { id: 'ethereum', sym: 'ETH', name: 'Ethereum', icon: 'https://assets.coingecko.com/coins/images/279/thumb/ethereum.png', tx: [[180, 0.4, 2980], [70, 0.25, 3720]] },
    { id: 'solana', sym: 'SOL', name: 'Solana', icon: 'https://assets.coingecko.com/coins/images/4128/thumb/solana.png', tx: [[150, 10, 142], [60, 4, 198], [20, 2, 176, 'sell']] },
    { id: 'the-open-network', sym: 'TON', name: 'Toncoin', icon: 'https://assets.coingecko.com/coins/images/17980/thumb/ton_symbol.png', tx: [[100, 150, 6.9]] },
  ]
  for (const a of assets) {
    const page = fake.insert('DB_ASSETS', { 'Символ': T(a.sym), 'Назва': R(a.name), 'CoinGecko ID': R(a.id), 'Тип': S('crypto'), 'Іконка': R(a.icon), ...TG })
    for (const [ago, qty, price, type] of a.tx) {
      fake.insert('DB_ASSET_TX', { 'ID': T('at'), 'Актив': REL(page.id), 'Дата': D(iso(daysAgo(ago))), 'Тип': S(type || 'buy'), 'Кількість': N(qty), 'Ціна': N(price), 'Валюта': S('USD'), 'Комісія': N(0), 'Опис': R(type === 'sell' ? 'частково зафіксував' : 'Binance'), ...TG })
    }
  }
  return { clientIds: ids }
}
