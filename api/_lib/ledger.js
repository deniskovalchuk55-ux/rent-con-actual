// «Рух коштів» — база в Notion з усіма операціями Монобанку й поповненнями/виведеннями на біржах.
// З неї застосунок показує історію за будь-який місяць і аналітику по місяцях.
// Базу знаходимо за назвою (змінна DB_LEDGER не обовʼязкова), а створюємо поруч з іншими базами.
const { notion, queryAll, getRich } = require('./notion');
const { flowOf } = require('./categorize');
const { STABLE } = require('./http');

const TITLE = 'Rent·Control · Рух коштів';
const BANK_COL = 'Банк ID';
const TYPES = [
  { kind: 'income', name: 'Надходження', color: 'green' },
  { kind: 'expense', name: 'Покупка', color: 'red' },
  { kind: 'transfer', name: 'Переказ', color: 'orange' },
  { kind: 'cash', name: 'Готівка', color: 'yellow' },
  { kind: 'deposit', name: 'Поповнення біржі', color: 'blue' },
  { kind: 'withdrawal', name: 'Виведення з біржі', color: 'purple' },
];
const TYPE_NAME = Object.fromEntries(TYPES.map(t => [t.kind, t.name]));

const SCHEMA = {
  'Назва': { title: {} },
  'Сума': { number: { format: 'number' } },
  'Валюта': { select: { options: [] } },
  'USD': { number: { format: 'number' } },
  'Дата': { date: {} },
  'Тип': { select: { options: TYPES.map(t => ({ name: t.name, color: t.color })) } },
  'Рахунок': { select: { options: [] } },
  'Опис': { rich_text: {} },
  [BANK_COL]: { rich_text: {} },
  'Telegram ID': { number: { format: 'number' } },
};

const titleOf = d => (d.title || []).map(t => t.plain_text || (t.text && t.text.content) || '').join('');
let cache = { id: null, missAt: 0, schemaAt: 0, titleProp: 'Назва' };

// Знайти базу (без створення). Негативну відповідь памʼятаємо хвилину, щоб не шукати на кожному запиті.
async function findLedger({ fresh = false } = {}) {
  if (process.env.DB_LEDGER) return process.env.DB_LEDGER;
  if (cache.id) return cache.id;
  if (!fresh && Date.now() - cache.missAt < 60e3) return null;
  const r = await notion('/search', 'POST', { query: TITLE, filter: { property: 'object', value: 'database' }, page_size: 25 });
  const hit = (r.results || []).find(d => d.object === 'database' && !d.archived && !d.in_trash && titleOf(d) === TITLE);
  if (hit) cache.id = hit.id;
  else cache.missAt = Date.now();
  return cache.id;
}

// Сторінка, на якій лежить база (для вбудованих баз піднімаємось через блоки)
async function parentPageFor(dbId) {
  const db = await notion(`/databases/${dbId}`, 'GET');
  let parent = db.parent;
  for (let i = 0; i < 4 && parent && parent.type === 'block_id'; i++) parent = (await notion(`/blocks/${parent.block_id}`, 'GET')).parent;
  return parent && parent.type === 'page_id' ? { pageId: parent.page_id, inline: !!db.is_inline } : null;
}

// Бракує колонок (базу створили вручну) — додаємо; назву колонки-заголовка беремо, яка є
async function ensureSchema(dbId) {
  if (Date.now() - cache.schemaAt < 3600e3) return;
  const db = await notion(`/databases/${dbId}`, 'GET');
  const props = db.properties || {};
  const titleEntry = Object.entries(props).find(([, v]) => v && v.type === 'title');
  cache.titleProp = titleEntry ? titleEntry[0] : 'Назва';
  const missing = {};
  for (const [name, def] of Object.entries(SCHEMA)) if (!def.title && !props[name]) missing[name] = def;
  if (Object.keys(missing).length) await notion(`/databases/${dbId}`, 'PATCH', { properties: missing });
  cache.schemaAt = Date.now();
}

// Знайти або створити базу поруч із базами застосунку
async function setupLedger() {
  const found = await findLedger({ fresh: true });
  if (found) { await ensureSchema(found); return { id: found, created: false }; }
  for (const key of ['DB_CLIENTS', 'DB_EXPENSES', 'DB_PAYMENTS', 'DB_WORK_ENTRIES', 'DB_GOALS', 'DB_ASSETS']) {
    const id = process.env[key];
    if (!id) continue;
    let parent = null;
    try { parent = await parentPageFor(id); } catch { parent = null; }
    if (!parent) continue;
    try {
      const db = await notion('/databases', 'POST', {
        parent: { type: 'page_id', page_id: parent.pageId }, is_inline: parent.inline,
        title: [{ type: 'text', text: { content: TITLE } }], properties: SCHEMA,
      });
      cache = { id: db.id, missAt: 0, schemaAt: Date.now(), titleProp: 'Назва' };
      return { id: db.id, created: true };
    } catch { /* немає доступу до цієї сторінки — пробуємо іншу */ }
  }
  throw Object.assign(new Error('Не вдалось створити базу «' + TITLE + '»: у інтеграції Notion немає доступу до сторінки з твоїми базами. Відкрий у Notion сторінку, де лежать бази, → ••• → Connections → додай свою інтеграцію й спробуй ще раз. Або створи базу з такою назвою сам і підключи до неї інтеграцію.'), { status: 409, code: 'ledger-access' });
}

/* ---------- записи ---------- */
// { bankId, title, amount (зі знаком), currency, usd (зі знаком або null), date (ISO), kind, account, note }
const ID_RX = /^(mono|bybit|bingx|mexc|eb):\S{1,200}$/;
const CUR_RX = /^[A-Z0-9]{2,12}$/;
const ISO_RX = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

function validEntry(e) {
  return !!e && ID_RX.test(String(e.bankId || '')) && Number.isFinite(Number(e.amount)) && Number(e.amount) !== 0 &&
    CUR_RX.test(String(e.currency || '')) && ISO_RX.test(String(e.date || '')) && !!TYPE_NAME[e.kind] &&
    String(e.title || '').length <= 300 && String(e.account || '').length <= 100 && String(e.note || '').length <= 600 &&
    (e.usd == null || Number.isFinite(Number(e.usd)));
}

const text = s => (s ? [{ text: { content: String(s).slice(0, 1900) } }] : []);
// у назвах опцій select Notion не приймає коми
const opt = s => String(s || '').replace(/,/g, ' ').trim().slice(0, 100) || '—';

function buildProps(e, owner) {
  return {
    [cache.titleProp || 'Назва']: { title: text(e.title || TYPE_NAME[e.kind]) },
    'Сума': { number: Math.round(Number(e.amount) * 1e8) / 1e8 },
    'Валюта': { select: { name: opt(e.currency) } },
    'USD': { number: e.usd == null ? null : Math.round(Number(e.usd) * 100) / 100 },
    'Дата': { date: { start: e.date } },
    'Тип': { select: { name: TYPE_NAME[e.kind] } },
    'Рахунок': { select: { name: opt(e.account) } },
    'Опис': { rich_text: text(e.note) },
    [BANK_COL]: { rich_text: text(e.bankId) },
    'Telegram ID': { number: owner },
  };
}

async function existingIds(dbId, owner, entries) {
  const filter = { and: [{ property: 'Telegram ID', number: { equals: owner } }] };
  if (entries.length === 1) filter.and.push({ property: BANK_COL, rich_text: { equals: entries[0].bankId } });
  else {
    const days = entries.map(e => e.date.slice(0, 10)).sort();
    const shift = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
    filter.and.push({ property: 'Дата', date: { on_or_after: shift(days[0], -1) } }, { property: 'Дата', date: { on_or_before: shift(days[days.length - 1], 1) } });
  }
  const pages = await queryAll(dbId, filter, { limit: 5000 });
  return new Set(pages.map(p => getRich(p.properties, BANK_COL)).filter(Boolean));
}

// Дописати нові операції (дублікати за «Банк ID» пропускаємо). budgetMs — щоб вкластись у час функції.
async function append(entries, owner, { budgetMs = 18000 } = {}) {
  const t0 = Date.now();
  const dbId = await findLedger();
  if (!dbId) return { created: 0, duplicates: 0, invalid: 0, remaining: [], missing: true };
  const valid = entries.filter(validEntry);
  const invalid = entries.length - valid.length;
  if (!valid.length) return { created: 0, duplicates: 0, invalid, remaining: [] };
  await ensureSchema(dbId);
  const have = await existingIds(dbId, owner, valid);
  let created = 0, duplicates = 0;
  const remaining = [];
  for (const e of valid) {
    if (have.has(e.bankId)) { duplicates++; continue; }
    if (Date.now() - t0 > budgetMs) { remaining.push(e); continue; }
    await notion('/pages', 'POST', { parent: { database_id: dbId }, properties: buildProps(e, owner) });
    have.add(e.bankId);
    created++;
  }
  return { created, duplicates, invalid, remaining };
}

/* ---------- з операцій банку й бірж ---------- */
const fmt = n => String(Math.round(Math.abs(n) * 100) / 100).replace('.', ',');

// Операція Монобанку. toUsd(cur) → скільки доларів в одиниці валюти (або null)
function monoEntry(item, { accCur, opCur, label, toUsd }) {
  const amount = (Number(item.amount) || 0) / 100;
  const title = String(item.description || '').replace(/\s+/g, ' ').trim() || 'Операція';
  const kind = flowOf({ amount: item.amount, mcc: item.mcc || item.originalMcc, title });
  const note = [];
  if (opCur && opCur !== accCur && item.operationAmount) note.push(`${fmt(item.operationAmount / 100)} ${opCur}`);
  if (item.counterName && !title.includes(item.counterName)) note.push(item.counterName);
  if (item.comment) note.push(String(item.comment));
  const rate = toUsd ? toUsd(accCur) : null;
  return {
    bankId: 'mono:' + item.id, title, amount, currency: accCur, usd: rate != null ? amount * rate : null,
    date: new Date((Number(item.time) || 0) * 1000).toISOString(), kind, account: label || 'Монобанк', note: note.join(' · '),
  };
}

// Поповнення/виведення на біржі (подія з exchanges.transfers)
function transferEntry(e, { priceUSD } = {}) {
  const sign = e.dir === 'in' ? 1 : -1;
  const amount = sign * (Number(e.amount) || 0);
  const price = STABLE.has(String(e.coin).toUpperCase()) ? 1 : priceUSD ? priceUSD(e.coin) : null;
  const note = [];
  if (e.internal) note.push('внутрішній переказ');
  else if (e.network) note.push('мережа ' + e.network);
  if (e.peer) note.push('з ' + e.peer);
  if (e.from) note.push('від ' + e.from);
  if (e.dir === 'out' && e.address) note.push('на ' + e.address);
  if (e.fee) note.push('комісія ' + fmt(e.fee) + ' ' + e.coin);
  return {
    bankId: e.key, title: (e.dir === 'in' ? 'Поповнення ' : 'Виведення ') + e.coin, amount, currency: String(e.coin).toUpperCase(),
    usd: price != null ? amount * price : null, date: new Date(e.time || Date.now()).toISOString(),
    kind: e.dir === 'in' ? 'deposit' : 'withdrawal', account: e.label, note: note.join(' · '),
  };
}

function _reset() { cache = { id: null, missAt: 0, schemaAt: 0, titleProp: 'Назва' }; }

module.exports = { TITLE, TYPES, TYPE_NAME, SCHEMA, findLedger, setupLedger, append, validEntry, buildProps, monoEntry, transferEntry, _reset };
