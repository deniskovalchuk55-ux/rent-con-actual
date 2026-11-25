// Запис витрат із банку в базу витрат Expense·Control — у тому самому форматі, що пише сам Expense·Control,
// плюс колонка «Банк ID», щоб та сама операція ніколи не записалась двічі.
const { notion, queryAll, getTitle, getRich, getCheckbox } = require('./notion');
const { suggestCategory } = require('./categorize');

const BANK_COL = 'Банк ID';
const SUPPORTED = ['UAH', 'USD', 'PLN']; // валюти, які розуміє Expense·Control
// id операцій Монобанку — base64 (букви, цифри, + / =), у Enable Banking — довільні рядки
const BANK_ID_RX = /^(mono|eb):[A-Za-z0-9:_\-.=+/]{1,160}$/;
const UUID_RX = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const expensesDb = () => process.env.DB_EXPENSES;

let schemaOk = 0;
async function ensureBankColumn() {
  if (Date.now() - schemaOk < 3600e3) return;
  const db = await notion(`/databases/${expensesDb()}`, 'GET');
  if (!db.properties || !db.properties[BANK_COL]) {
    try {
      await notion(`/databases/${expensesDb()}`, 'PATCH', { properties: { [BANK_COL]: { rich_text: {} } } });
    } catch (e) {
      throw Object.assign(new Error('Не вдалось додати колонку «Банк ID» у базу витрат. Додай її вручну в Notion (тип Text) і спробуй ще раз'), { status: 409 });
    }
  }
  schemaOk = Date.now();
}

let catCache = { at: 0, owner: null, list: [] };
async function loadCategories(owner) {
  const dbId = process.env.DB_CAT_EXPENSES;
  if (!dbId) return [];
  if (catCache.owner === owner && Date.now() - catCache.at < 10 * 60e3) return catCache.list;
  const pages = await queryAll(dbId, { or: [{ property: 'Telegram ID', number: { equals: owner } }, { property: 'Загальна', checkbox: { equals: true } }] });
  const list = pages.map(p => ({ id: p.id, name: getTitle(p.properties, 'Назва'), shared: getCheckbox(p.properties, 'Загальна') }));
  catCache = { at: Date.now(), owner, list };
  return list;
}

// Які з цих операцій уже є в базі (дивимось лише свої записи з банку за потрібний період)
async function existingBankIds(owner, prefix, sinceISO) {
  const and = [
    { property: 'Telegram ID', number: { equals: owner } },
    { property: BANK_COL, rich_text: { starts_with: prefix } },
  ];
  if (sinceISO) and.push({ property: 'Дата', date: { on_or_after: sinceISO } });
  const pages = await queryAll(expensesDb(), { and });
  return new Set(pages.map(p => getRich(p.properties, BANK_COL)).filter(Boolean));
}

function buildExpenseProps(e, owner) {
  return {
    'Назва': { title: [{ text: { content: String(e.title || 'Витрата').slice(0, 200) } }] },
    'Сума': { number: Math.round(Number(e.amount) * 100) / 100 },
    'Валюта': { select: { name: e.currency } },
    'Дата': { date: { start: e.date } },
    'Категорія': { relation: e.categoryId ? [{ id: e.categoryId }] : [] },
    'Опис': { rich_text: e.note ? [{ text: { content: String(e.note).slice(0, 500) } }] : [] },
    'Telegram ID': { number: owner },
    [BANK_COL]: { rich_text: [{ text: { content: e.bankId } }] },
  };
}

function validItem(e) {
  return e && BANK_ID_RX.test(e.bankId) && DATE_RX.test(e.date) && Number(e.amount) > 0 && Number.isFinite(Number(e.amount)) &&
    SUPPORTED.includes(e.currency) && (!e.categoryId || UUID_RX.test(e.categoryId)) && String(e.title || '').length <= 300;
}

// Кандидат із банку → витрата у валюті, яку розуміє Expense·Control.
// Справжня вартість — у валюті рахунку; якщо її Expense·Control не знає (EUR тощо), беремо валюту покупки або гривні за курсом.
async function toExpense(c, { categories, uahRate } = {}) {
  let amount = c.amountAccount, currency = c.accountCurrency;
  if (!SUPPORTED.includes(currency)) {
    if (SUPPORTED.includes(c.opCurrency)) { amount = c.amountOp; currency = c.opCurrency; }
    else if (uahRate) { amount = c.amountAccount * (await uahRate(c.accountCurrency)); currency = 'UAH'; }
    else return null;
  }
  return {
    bankId: c.bankId, date: c.date, title: c.title, amount: Math.round(amount * 100) / 100, currency,
    note: c.note, categoryId: c.categoryId !== undefined ? c.categoryId : suggestCategory(c, categories),
  };
}

// Записати витрати (до ~25 за виклик, щоб вкластись у час функції). Повертає створені й дублікати.
async function importExpenses(items, owner) {
  if (!expensesDb()) throw Object.assign(new Error('Не задано DB_EXPENSES'), { status: 412 });
  const valid = items.filter(validItem);
  if (!valid.length) return { created: [], duplicates: [], invalid: items.length };
  await ensureBankColumn();
  const since = valid.reduce((m, e) => (e.date < m ? e.date : m), valid[0].date);
  const sinceISO = new Date(Date.parse(since) - 5 * 864e5).toISOString().slice(0, 10);
  const prefixes = [...new Set(valid.map(e => e.bankId.split(':')[0] + ':'))];
  const existing = new Set();
  for (const p of prefixes) for (const id of await existingBankIds(owner, p, sinceISO)) existing.add(id);
  const created = [], duplicates = [];
  for (const e of valid) {
    if (existing.has(e.bankId)) { duplicates.push(e.bankId); continue; }
    const page = await notion('/pages', 'POST', { parent: { database_id: expensesDb() }, properties: buildExpenseProps(e, owner) });
    existing.add(e.bankId);
    created.push({ bankId: e.bankId, id: page.id });
  }
  return { created, duplicates, invalid: items.length - valid.length };
}

module.exports = { BANK_COL, SUPPORTED, ensureBankColumn, loadCategories, existingBankIds, buildExpenseProps, importExpenses, toExpense, validItem };
