// «Рух коштів» — база в Notion з усіма операціями Монобанку й поповненнями/виведеннями на біржах.
// З неї застосунок показує історію за будь-який місяць і аналітику по місяцях.
// Базу знаходимо за DB_LEDGER (ID чи посилання) або за назвою, а створюємо поруч з іншими базами.
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
// базу, створену вручну, впізнаємо за словами «Рух коштів» у назві (без урахування регістру й зайвих пробілів)
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const KEY = 'рух коштів';
let cache = { id: null, missAt: 0, schemaAt: 0, titleProp: 'Назва', types: {}, envError: null };

// DB_LEDGER можна вставити як ID, ID з дефісами або все посилання з Notion (беремо ID бази, а не ?v= вигляду)
function envLedgerId(raw = process.env.DB_LEDGER) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const path = v.split(/[?#]/)[0];
  const dashed = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig);
  if (dashed) return dashed[dashed.length - 1].toLowerCase();
  const plain = path.split(/[^0-9a-fA-F]+/).filter(x => x.length === 32);
  return plain.length ? plain[plain.length - 1].toLowerCase() : v;
}

// ID з DB_LEDGER: сама база або сторінка, всередині якої вона лежить
async function resolveEnvId(id) {
  try {
    const db = await notion(`/databases/${id}`, 'GET', null, { retries: 1 });
    cache.envError = null;
    return db.id || id;
  } catch (e) {
    if (e.status !== 400 && e.status !== 404) throw e;
    try {
      const kids = await notion(`/blocks/${id}/children?page_size=100`, 'GET', null, { retries: 1 });
      const dbs = (kids.results || []).filter(b => b.type === 'child_database' && !b.archived && !b.in_trash);
      const hit = dbs.find(b => norm(b.child_database && b.child_database.title).includes(KEY)) || (dbs.length === 1 ? dbs[0] : null);
      if (hit) { cache.envError = null; return hit.id; }
    } catch { /* це не сторінка з базою */ }
    cache.envError = e.message || 'Notion HTTP ' + e.status;
    console.warn('DB_LEDGER не відкривається:', cache.envError);
    return null;
  }
}

// Знайти базу (без створення): спершу DB_LEDGER, інакше пошуком за назвою.
// Негативну відповідь памʼятаємо хвилину, щоб не шукати на кожному запиті.
async function findLedger({ fresh = false } = {}) {
  if (cache.id) return cache.id;
  if (!fresh && Date.now() - cache.missAt < 60e3) return null;
  const env = envLedgerId();
  if (env) {
    const id = await resolveEnvId(env);
    if (id) { cache.id = id; return id; }
  }
  const r = await notion('/search', 'POST', { query: 'Рух коштів', filter: { property: 'object', value: 'database' }, page_size: 25 });
  const live = (r.results || []).filter(d => d.object === 'database' && !d.archived && !d.in_trash);
  const hit = live.find(d => titleOf(d) === TITLE) || live.find(d => norm(titleOf(d)).includes(KEY));
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

// Які типи колонок підходять. Валюту, тип і рахунок можна тримати й текстом — так часто створюють вручну.
const ACCEPT = {
  'Сума': ['number'], 'Валюта': ['select', 'rich_text'], 'USD': ['number'], 'Дата': ['date'],
  'Тип': ['select', 'rich_text'], 'Рахунок': ['select', 'rich_text'], 'Опис': ['rich_text'], [BANK_COL]: ['rich_text'], 'Telegram ID': ['number'],
};
const TYPE_UA = {
  title: 'Title', rich_text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', status: 'Status', date: 'Date',
  checkbox: 'Checkbox', url: 'URL', email: 'Email', phone_number: 'Phone', formula: 'Formula', relation: 'Relation', rollup: 'Rollup',
  people: 'Person', files: 'Files & media', created_time: 'Created time', last_edited_time: 'Last edited time', unique_id: 'ID',
};
// «telegram id», «Банк Id», «сума » — та сама колонка
const canon = s => String(s || '').toLowerCase().replace(/[\s_\-·.]+/g, '');

async function patchProps(dbId, properties) {
  const db = await notion(`/databases/${dbId}`, 'PATCH', { properties });
  return db && db.properties;
}

// Базу створили вручну: перейменовуємо колонки з іншим написанням, додаємо відсутні, виправляємо типи.
// Що виправити не вдалось — кажемо людською мовою, яку колонку й на який тип змінити.
async function ensureSchema(dbId, { force = false } = {}) {
  if (!force && Date.now() - cache.schemaAt < 3600e3) return;
  const db = await notion(`/databases/${dbId}`, 'GET');
  let props = db.properties || {};
  const titleEntry = Object.entries(props).find(([, v]) => v && v.type === 'title');
  cache.titleProp = titleEntry ? titleEntry[0] : 'Назва';

  const renames = {};
  for (const name of Object.keys(ACCEPT)) {
    if (props[name]) continue;
    const alt = Object.keys(props).find(k => k !== name && canon(k) === canon(name) && props[k].type !== 'title' && !renames[k]);
    if (alt) renames[alt] = { name };
  }
  if (Object.keys(renames).length) {
    try { props = (await patchProps(dbId, renames)) || props; } catch (e) { console.warn('ledger rename failed', e.message); }
  }

  const fixes = {};
  for (const [name, types] of Object.entries(ACCEPT)) if (!props[name] || !types.includes(props[name].type)) fixes[name] = SCHEMA[name];
  if (Object.keys(fixes).length) {
    try { props = (await patchProps(dbId, fixes)) || props; } catch {
      for (const [name, def] of Object.entries(fixes)) {
        try { props = (await patchProps(dbId, { [name]: def })) || props; } catch (e) { console.warn('ledger column fix failed', name, e.message); }
      }
    }
  }

  const bad = Object.entries(ACCEPT).filter(([name, types]) => !props[name] || !types.includes(props[name].type));
  if (bad.length) {
    const list = bad.map(([name, types]) => (props[name]
      ? `«${name}» має тип ${TYPE_UA[props[name].type] || props[name].type}, а треба ${TYPE_UA[types[0]]}`
      : `немає колонки «${name}» (${TYPE_UA[types[0]]})`)).join('; ');
    throw Object.assign(new Error(`База «Рух коштів» не підходить: ${list}. У Notion натисни на назву колонки → Edit property → Type, потім «Перевірити ще раз».`), { status: 409, code: 'ledger-schema' });
  }
  cache.types = Object.fromEntries(Object.keys(ACCEPT).map(n => [n, props[n].type]));
  cache.schemaAt = Date.now();
}

// Стан бази для застосунку: чи можна писати й читати історію, а якщо ні — що саме не так
const MSG_NOT_FOUND = 'Не бачу базу «Рух коштів». Перевір: у назві бази є слова «Рух коштів»; до бази підключена інтеграція Notion (••• → Connections); якщо задано DB_LEDGER — після цього зроблено Redeploy.';
let health$ = { at: 0, value: null };
async function health({ fresh = false } = {}) {
  if (!fresh && health$.value && Date.now() - health$.at < 60e3) return health$.value;
  let value;
  try {
    const id = await findLedger({ fresh });
    if (!id) value = { ready: false, code: 'ledger-missing', error: cache.envError ? `DB_LEDGER не відкривається (${cache.envError}). ${MSG_NOT_FOUND}` : null };
    else { await ensureSchema(id, { force: fresh }); value = { ready: true }; }
  } catch (e) {
    value = { ready: false, code: e.code || 'ledger-error', error: humanError(e) };
  }
  health$ = { at: Date.now(), value };
  return value;
}

// Помилки Notion — зрозумілою мовою
function humanError(e) {
  const m = String((e && e.message) || '');
  if (e && /^ledger-/.test(String(e.code || ''))) return m;
  if (e && e.status === 401) return 'Notion не приймає NOTION_TOKEN — перевір токен інтеграції у Vercel.';
  if (e && e.status === 404) return 'Інтеграція Notion не бачить базу «Рух коштів»: відкрий базу → ••• → Connections → додай інтеграцію.';
  if (/expected to be|is not a property that exists|Could not find property|validation/i.test(m)) return `Notion не прийняв запис (${m}). Перевір колонки в «Рух коштів».`;
  return 'Notion: ' + (m || 'помилка');
}

// Знайти або створити базу поруч із базами застосунку
async function setupLedger() {
  const found = await findLedger({ fresh: true });
  if (found) { await ensureSchema(found, { force: true }); health$ = { at: Date.now(), value: { ready: true } }; return { id: found, created: false }; }
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
      cache = { id: db.id, missAt: 0, schemaAt: Date.now(), titleProp: 'Назва', types: {}, envError: null };
      health$ = { at: Date.now(), value: { ready: true } };
      return { id: db.id, created: true };
    } catch { /* немає доступу до цієї сторінки — пробуємо іншу */ }
  }
  throw Object.assign(new Error((cache.envError ? `DB_LEDGER не відкривається (${cache.envError}). ` : '') + 'Не вдалось ні знайти, ні створити базу «Рух коштів». Якщо створив її сам: у назві мають бути слова «Рух коштів», а до бази — підключена інтеграція Notion (••• → Connections). Інакше відкрий сторінку, де лежать твої бази → ••• → Connections → додай інтеграцію, і застосунок створить базу сам.'), { status: 409, code: 'ledger-access' });
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
// колонка-вибір або текстова (якщо базу створили вручну з текстом)
const choice = (col, v) => (cache.types && cache.types[col] === 'rich_text' ? { rich_text: text(v || '—') } : { select: { name: opt(v) } });

function buildProps(e, owner) {
  return {
    [cache.titleProp || 'Назва']: { title: text(e.title || TYPE_NAME[e.kind]) },
    'Сума': { number: Math.round(Number(e.amount) * 1e8) / 1e8 },
    'Валюта': choice('Валюта', e.currency),
    'USD': { number: e.usd == null ? null : Math.round(Number(e.usd) * 100) / 100 },
    'Дата': { date: { start: e.date } },
    'Тип': choice('Тип', TYPE_NAME[e.kind]),
    'Рахунок': choice('Рахунок', e.account),
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

function _reset() { cache = { id: null, missAt: 0, schemaAt: 0, titleProp: 'Назва', types: {}, envError: null }; health$ = { at: 0, value: null }; }

module.exports = { TITLE, TYPES, TYPE_NAME, SCHEMA, findLedger, setupLedger, health, humanError, envLedgerId, append, validEntry, buildProps, monoEntry, transferEntry, _reset };
