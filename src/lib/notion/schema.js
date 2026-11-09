// Контракт з базами Notion. Назви колонок, типи й формати записів — ті самі, що у v3,
// щоб нова версія читала й писала твої бази без жодних змін у Notion.

export const COL = {
  // Клієнти
  CL_NAME: 'Назва', CL_RATE: 'Ставка', CL_CUR: 'Валюта', CL_START: 'Старт', CL_PHONE: 'Телефон', CL_TG: 'Telegram',
  CL_SETUP_AMT: 'Setup сума', CL_SETUP_CUR: 'Setup валюта', CL_PAYMODE: 'Тип оплати', CL_BONUS_DAYS: 'Бонусні дні',
  CL_REF: 'Реферал', CL_BONUS_AMT: 'Бонус-сума', CL_BONUS_GRANTED: 'Бонус виданий',
  // Оплати
  PAY_ID: 'ID', PAY_CLIENT: 'Клієнт', PAY_DATE: 'Дата', PAY_MONTHS: 'Місяців', PAY_AMT: 'Сума', PAY_CUR: 'Валюта',
  // Робота — записи
  WE_ID: 'ID', WE_DATE: 'Дата', WE_KIND: 'Тип', WE_HOURS: 'Години', WE_RATE: 'Ставка', WE_RATE_CUR: 'Ставка валюта',
  WE_CAT: 'Категорія', WE_TITLE: 'Назва', WE_AMT: 'Сума', WE_CUR: 'Валюта', WE_NOTE: 'Опис',
  // Категорії робіт
  WC_NAME: 'Назва', WC_RATE: 'Ставка', WC_CUR: 'Валюта', WC_DEFAULT: 'За замовчуванням',
  // Виплати по місяцях
  PO_ID: 'ID', PO_MONTH: 'Місяць', PO_DATE: 'Дата', PO_AMT: 'Сума', PO_CUR: 'Валюта', PO_TYPE: 'Тип', PO_CAT: 'Категорія',
  // Цілі
  G_NAME: 'Назва', G_TARGET: 'Поточна ціль', G_CUR: 'Валюта', G_START: 'Старт', G_DEADLINE: 'Дедлайн', G_ICON: 'Іконка',
  G_LEVELS: 'Історія рівнів', G_STATUS: 'Статус',
  // Історія цілей
  GT_ID: 'ID', GT_GOAL: 'Ціль', GT_DATE: 'Дата', GT_AMT: 'Сума', GT_CUR: 'Валюта', GT_TYPE: 'Тип', GT_NOTE: 'Опис',
  // Активи
  AS_SYMBOL: 'Символ', AS_NAME: 'Назва', AS_CG_ID: 'CoinGecko ID', AS_TYPE: 'Тип', AS_ICON: 'Іконка',
  // Транзакції активів
  AT_ID: 'ID', AT_ASSET: 'Актив', AT_DATE: 'Дата', AT_TXTYPE: 'Тип', AT_QTY: 'Кількість', AT_PRICE: 'Ціна', AT_CUR: 'Валюта',
  AT_FEE: 'Комісія', AT_NOTE: 'Опис',
  // Загальне
  TG_ID: 'Telegram ID',
}

export const DB = {
  CLIENTS: 'DB_CLIENTS', PAYMENTS: 'DB_PAYMENTS', WORK_ENTRIES: 'DB_WORK_ENTRIES', WORK_CATEGORIES: 'DB_WORK_CATEGORIES',
  PAYOUTS: 'DB_PAYOUTS', GOALS: 'DB_GOALS', GOAL_TX: 'DB_GOAL_TX', ASSETS: 'DB_ASSETS', ASSET_TX: 'DB_ASSET_TX',
  EXPENSES: 'DB_EXPENSES', CAT_EXPENSES: 'DB_CAT_EXPENSES',
}

const todayISO = () => new Date().toISOString().slice(0, 10)

/* ===== читання властивостей ===== */
export function getTitle(props, name) { const p = props[name]; return p && p.title ? p.title.map(t => t.plain_text || '').join('') : '' }
export function getRichText(props, name) { const p = props[name]; return p && p.rich_text ? p.rich_text.map(t => t.plain_text || '').join('') : '' }
export function getNumber(props, name) { const p = props[name]; return p && p.number != null ? p.number : null }
export function getSelect(props, name) { const p = props[name]; return p && p.select ? p.select.name : null }
export function getDate(props, name) { const p = props[name]; return p && p.date ? p.date.start : null }
export function getCheckbox(props, name) { const p = props[name]; return !!(p && p.checkbox) }
export function getRelationFirst(props, name) { const p = props[name]; return p && p.relation && p.relation.length ? p.relation[0].id : null }

/* ===== запис властивостей ===== */
export function pTitle(text) { return { title: [{ text: { content: String(text || '') } }] } }
export function pRichText(text) { return { rich_text: [{ text: { content: String(text || '') } }] } }
export function pNumber(n) { return { number: n == null || isNaN(n) ? null : Number(n) } }
export function pSelect(name) { return { select: name ? { name: String(name) } : null } }
export function pDate(iso) { return { date: iso ? { start: iso } : null } }
export function pCheckbox(b) { return { checkbox: !!b } }
export function pRelation(id) { return { relation: id ? [{ id }] : [] } }

const dateOnly = s => (s ? String(s).slice(0, 10) : s)

/* ===== парсери ===== */
export function parseClient(page) {
  const p = page.properties
  return {
    id: page.id,
    name: getTitle(p, COL.CL_NAME),
    rate: getNumber(p, COL.CL_RATE) || 0,
    cur: getSelect(p, COL.CL_CUR) || 'USD',
    start: dateOnly(getDate(p, COL.CL_START)) || todayISO(),
    phone: getRichText(p, COL.CL_PHONE),
    tg: getRichText(p, COL.CL_TG),
    setupAmount: getNumber(p, COL.CL_SETUP_AMT) || 0,
    setupCur: getSelect(p, COL.CL_SETUP_CUR) || 'USD',
    payMode: getSelect(p, COL.CL_PAYMODE) || 'prepaid',
    bonusDays: getNumber(p, COL.CL_BONUS_DAYS) || 0,
    referredBy: getRelationFirst(p, COL.CL_REF),
    bonusAmount: getNumber(p, COL.CL_BONUS_AMT) || 0,
    bonusGranted: getCheckbox(p, COL.CL_BONUS_GRANTED),
    tgId: getNumber(p, COL.TG_ID),
    created: page.created_time || null,
    payments: [],
  }
}

export function parsePayment(page) {
  const p = page.properties
  return {
    id: page.id,
    clientId: getRelationFirst(p, COL.PAY_CLIENT),
    date: dateOnly(getDate(p, COL.PAY_DATE)) || todayISO(),
    months: getNumber(p, COL.PAY_MONTHS) || 0,
    amountNative: getNumber(p, COL.PAY_AMT) || 0,
    cur: getSelect(p, COL.PAY_CUR) || null,
    tgId: getNumber(p, COL.TG_ID),
    created: page.created_time || null,
  }
}

export function parseWorkEntry(page) {
  const p = page.properties
  return {
    id: page.id,
    date: dateOnly(getDate(p, COL.WE_DATE)) || todayISO(),
    kind: getSelect(p, COL.WE_KIND) || 'hourly',
    hours: getNumber(p, COL.WE_HOURS) || 0,
    rate: getNumber(p, COL.WE_RATE) || 0,
    rateCur: getSelect(p, COL.WE_RATE_CUR) || 'USD',
    categoryId: getRelationFirst(p, COL.WE_CAT),
    title: getRichText(p, COL.WE_TITLE),
    amountNative: getNumber(p, COL.WE_AMT) || 0,
    cur: getSelect(p, COL.WE_CUR) || 'USD',
    note: getRichText(p, COL.WE_NOTE),
    tgId: getNumber(p, COL.TG_ID),
  }
}

export function parseWorkCategory(page) {
  const p = page.properties
  return {
    id: page.id,
    name: getTitle(p, COL.WC_NAME),
    rate: getNumber(p, COL.WC_RATE) || 0,
    cur: getSelect(p, COL.WC_CUR) || 'USD',
    isDefault: getCheckbox(p, COL.WC_DEFAULT),
    tgId: getNumber(p, COL.TG_ID),
  }
}

export function parsePayout(page) {
  const p = page.properties
  return {
    id: page.id,
    month: getRichText(p, COL.PO_MONTH) || getTitle(p, COL.PO_MONTH) || '',
    date: dateOnly(getDate(p, COL.PO_DATE)) || todayISO(),
    amount: getNumber(p, COL.PO_AMT) || 0,
    cur: getSelect(p, COL.PO_CUR) || 'USD',
    type: getSelect(p, COL.PO_TYPE) || 'advance',
    categoryId: getRelationFirst(p, COL.PO_CAT),
    tgId: getNumber(p, COL.TG_ID),
  }
}

export function parseGoal(page) {
  const p = page.properties
  let levels = []
  try { levels = JSON.parse(getRichText(p, COL.G_LEVELS) || '[]') } catch { /* порожньо */ }
  return {
    id: page.id,
    name: getTitle(p, COL.G_NAME),
    target: getNumber(p, COL.G_TARGET) || 0,
    cur: getSelect(p, COL.G_CUR) || 'USD',
    start: dateOnly(getDate(p, COL.G_START)) || todayISO(),
    deadline: dateOnly(getDate(p, COL.G_DEADLINE)),
    icon: getRichText(p, COL.G_ICON) || '🎯',
    levels: Array.isArray(levels) ? levels : [],
    status: getSelect(p, COL.G_STATUS) || 'active',
    tgId: getNumber(p, COL.TG_ID),
  }
}

export function parseGoalTx(page) {
  const p = page.properties
  return {
    id: page.id,
    goalId: getRelationFirst(p, COL.GT_GOAL),
    date: dateOnly(getDate(p, COL.GT_DATE)) || todayISO(),
    amount: getNumber(p, COL.GT_AMT) || 0,
    cur: getSelect(p, COL.GT_CUR) || 'USD',
    type: getSelect(p, COL.GT_TYPE) || 'add',
    note: getRichText(p, COL.GT_NOTE),
    tgId: getNumber(p, COL.TG_ID),
  }
}

export function parseAsset(page) {
  const p = page.properties
  return {
    id: page.id,
    symbol: getTitle(p, COL.AS_SYMBOL),
    name: getRichText(p, COL.AS_NAME),
    cgId: getRichText(p, COL.AS_CG_ID),
    type: getSelect(p, COL.AS_TYPE) || 'crypto',
    icon: getRichText(p, COL.AS_ICON),
    tgId: getNumber(p, COL.TG_ID),
  }
}

export function parseAssetTx(page) {
  const p = page.properties
  return {
    id: page.id,
    assetId: getRelationFirst(p, COL.AT_ASSET),
    date: dateOnly(getDate(p, COL.AT_DATE)) || todayISO(),
    txType: getSelect(p, COL.AT_TXTYPE) || 'buy',
    qty: getNumber(p, COL.AT_QTY) || 0,
    price: getNumber(p, COL.AT_PRICE) || 0,
    cur: getSelect(p, COL.AT_CUR) || 'USD',
    fee: getNumber(p, COL.AT_FEE) || 0,
    note: getRichText(p, COL.AT_NOTE),
    tgId: getNumber(p, COL.TG_ID),
  }
}

// Expense·Control (лише читання)
export function parseExpense(page) {
  const p = page.properties
  return {
    id: page.id,
    amount: getNumber(p, 'Сума') || 0,
    currency: getSelect(p, 'Валюта') || 'UAH',
    date: dateOnly(getDate(p, 'Дата')) || todayISO(),
    categoryId: getRelationFirst(p, 'Категорія'),
    note: getRichText(p, 'Опис'),
    tgId: getNumber(p, 'Telegram ID'),
  }
}

export function parseExpenseCat(page) {
  return {
    id: page.id,
    name: getTitle(page.properties, 'Назва'),
    shared: getCheckbox(page.properties, 'Загальна'),
    tgId: getNumber(page.properties, 'Telegram ID'),
  }
}

/* ===== білдери (той самий формат, що v3) ===== */
const stamp = prefix => prefix + '-' + Date.now().toString(36)

export function buildClientProps(c, tgId) {
  return {
    [COL.CL_NAME]: pTitle(c.name),
    [COL.CL_RATE]: pNumber(c.rate),
    [COL.CL_CUR]: pSelect(c.cur),
    [COL.CL_START]: pDate(c.start),
    [COL.CL_PHONE]: pRichText(c.phone || ''),
    [COL.CL_TG]: pRichText(c.tg || ''),
    [COL.CL_SETUP_AMT]: pNumber(c.setupAmount || 0),
    [COL.CL_SETUP_CUR]: pSelect(c.setupCur || c.cur),
    [COL.CL_PAYMODE]: pSelect(c.payMode || 'prepaid'),
    [COL.CL_BONUS_DAYS]: pNumber(c.bonusDays || 0),
    [COL.CL_REF]: pRelation(c.referredBy),
    [COL.CL_BONUS_AMT]: pNumber(c.bonusAmount || 0),
    [COL.CL_BONUS_GRANTED]: pCheckbox(!!c.bonusGranted),
    [COL.TG_ID]: pNumber(tgId),
  }
}

export function buildPaymentProps(clientId, p, tgId) {
  return {
    [COL.PAY_ID]: pTitle(stamp('pay')),
    [COL.PAY_CLIENT]: pRelation(clientId),
    [COL.PAY_DATE]: pDate(p.date),
    [COL.PAY_MONTHS]: pNumber(p.months),
    [COL.PAY_AMT]: pNumber(p.amountNative),
    [COL.PAY_CUR]: pSelect(p.cur),
    [COL.TG_ID]: pNumber(tgId),
  }
}

export function buildWorkEntryProps(e, tgId) {
  return {
    [COL.WE_ID]: pTitle(stamp('we')),
    [COL.WE_DATE]: pDate(e.date),
    [COL.WE_KIND]: pSelect(e.kind),
    [COL.WE_HOURS]: pNumber(e.hours),
    [COL.WE_RATE]: pNumber(e.rate),
    [COL.WE_RATE_CUR]: pSelect(e.rateCur),
    [COL.WE_CAT]: pRelation(e.categoryId),
    [COL.WE_TITLE]: pRichText(e.title || ''),
    [COL.WE_AMT]: pNumber(e.amountNative),
    [COL.WE_CUR]: pSelect(e.cur),
    [COL.WE_NOTE]: pRichText(e.note || ''),
    [COL.TG_ID]: pNumber(tgId),
  }
}

export function buildWorkCategoryProps(c, tgId) {
  return {
    [COL.WC_NAME]: pTitle(c.name),
    [COL.WC_RATE]: pNumber(c.rate),
    [COL.WC_CUR]: pSelect(c.cur),
    [COL.WC_DEFAULT]: pCheckbox(!!c.isDefault),
    [COL.TG_ID]: pNumber(tgId),
  }
}

export function buildPayoutProps(p, tgId) {
  return {
    [COL.PO_ID]: pTitle(stamp('po')),
    [COL.PO_MONTH]: pRichText(p.month),
    [COL.PO_DATE]: pDate(p.date),
    [COL.PO_AMT]: pNumber(p.amount),
    [COL.PO_CUR]: pSelect(p.cur),
    [COL.PO_TYPE]: pSelect(p.type),
    [COL.PO_CAT]: pRelation(p.categoryId),
    [COL.TG_ID]: pNumber(tgId),
  }
}

export function buildGoalProps(g, tgId) {
  return {
    [COL.G_NAME]: pTitle(g.name),
    [COL.G_TARGET]: pNumber(g.target),
    [COL.G_CUR]: pSelect(g.cur),
    [COL.G_START]: pDate(g.start),
    [COL.G_DEADLINE]: pDate(g.deadline),
    [COL.G_ICON]: pRichText(g.icon || '🎯'),
    [COL.G_LEVELS]: pRichText(JSON.stringify(g.levels || [])),
    [COL.G_STATUS]: pSelect(g.status || 'active'),
    [COL.TG_ID]: pNumber(tgId),
  }
}

export function buildGoalTxProps(goalId, tx, tgId) {
  return {
    [COL.GT_ID]: pTitle(stamp('gt')),
    [COL.GT_GOAL]: pRelation(goalId),
    [COL.GT_DATE]: pDate(tx.date),
    [COL.GT_AMT]: pNumber(tx.amount),
    [COL.GT_CUR]: pSelect(tx.cur),
    [COL.GT_TYPE]: pSelect(tx.type),
    [COL.GT_NOTE]: pRichText(tx.note || ''),
    [COL.TG_ID]: pNumber(tgId),
  }
}

export function buildAssetProps(a, tgId) {
  return {
    [COL.AS_SYMBOL]: pTitle(a.symbol),
    [COL.AS_NAME]: pRichText(a.name || ''),
    [COL.AS_CG_ID]: pRichText(a.cgId || ''),
    [COL.AS_TYPE]: pSelect(a.type || 'crypto'),
    [COL.AS_ICON]: pRichText(a.icon || ''),
    [COL.TG_ID]: pNumber(tgId),
  }
}

export function buildAssetTxProps(assetId, tx, tgId) {
  return {
    [COL.AT_ID]: pTitle(stamp('at')),
    [COL.AT_ASSET]: pRelation(assetId),
    [COL.AT_DATE]: pDate(tx.date),
    [COL.AT_TXTYPE]: pSelect(tx.txType),
    [COL.AT_QTY]: pNumber(tx.qty),
    [COL.AT_PRICE]: pNumber(tx.price),
    [COL.AT_CUR]: pSelect(tx.cur),
    [COL.AT_FEE]: pNumber(tx.fee || 0),
    [COL.AT_NOTE]: pRichText(tx.note || ''),
    [COL.TG_ID]: pNumber(tgId),
  }
}
