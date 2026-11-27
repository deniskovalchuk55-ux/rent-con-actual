// Тести серверних функцій без мережі: підроблений fetch відповідає за Notion, Монобанк і біржі.
// Запуск: node dev/tests/server.test.cjs
const crypto = require('crypto');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0, failed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; results.push('PASS ' + name); }
  catch (e) { failed++; results.push('FAIL ' + name + ' — ' + (e && e.message)); }
}

/* ---------- підроблена мережа ---------- */
const BOT = '123456:TEST-BOT-TOKEN';
const OWNER = 111, OTHER = 222;
let routes = [];
let calls = [];
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const call = { url: String(url), host: u.host, path: u.pathname, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null, query: u.searchParams };
  calls.push(call);
  for (const r of routes) {
    if (r.match(call)) {
      const out = await r.reply(call);
      const status = out.status || 200;
      return { ok: status >= 200 && status < 300, status, headers: { get: k => (out.headers || {})[k.toLowerCase()] || null }, json: async () => out.body };
    }
  }
  return { ok: false, status: 599, headers: { get: () => null }, json: async () => ({ message: 'no route ' + url }) };
};

// фейкова база Notion
const DB = { DB_CLIENTS: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', DB_EXPENSES: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', DB_CAT_EXPENSES: 'cccccccc-cccc-cccc-cccc-cccccccccccc' };
const pages = new Map();
const dbSchemas = { [DB.DB_EXPENSES]: { 'Назва': {}, 'Сума': {}, 'Валюта': {}, 'Дата': {}, 'Категорія': {}, 'Опис': {}, 'Telegram ID': {} } };
const uuid = () => crypto.randomUUID();
function addPage(db, props) { const id = uuid(); pages.set(id, { id, object: 'page', parent: { database_id: db.replace(/-/g, '') }, properties: props, archived: false }); return id; }
const num = n => ({ type: 'number', number: n });
const title = t => ({ type: 'title', title: [{ plain_text: t }] });
const rich = t => ({ type: 'rich_text', rich_text: t ? [{ plain_text: t }] : [] });
const chk = b => ({ type: 'checkbox', checkbox: b });

function evalFilter(f, p) {
  if (!f) return true;
  if (f.and) return f.and.every(x => evalFilter(x, p));
  if (f.or) return f.or.some(x => evalFilter(x, p));
  const v = p.properties[f.property];
  if (f.number) return v && v.number === f.number.equals;
  if (f.checkbox) return v && !!v.checkbox === f.checkbox.equals;
  if (f.rich_text) {
    const s = v && v.rich_text ? v.rich_text.map(t => t.plain_text || (t.text && t.text.content) || '').join('') : '';
    if (f.rich_text.starts_with != null) return s.startsWith(f.rich_text.starts_with);
    if (f.rich_text.equals != null) return s === f.rich_text.equals;
  }
  if (f.date) {
    const d = v && v.date && v.date.start && v.date.start.slice(0, 10);
    if (!d) return false;
    if (f.date.on_or_after && d < f.date.on_or_after) return false;
    if (f.date.on_or_before && d > f.date.on_or_before) return false;
    return true;
  }
  return true;
}
function toStored(props) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (v.title) out[k] = { type: 'title', title: v.title.map(t => ({ plain_text: t.text.content })) };
    else if (v.rich_text) out[k] = { type: 'rich_text', rich_text: v.rich_text.map(t => ({ plain_text: t.text.content })) };
    else out[k] = v;
  }
  return out;
}
// сторінка, на якій лежать бази застосунку, і бази, створені сервером (база «Рух коштів»)
const PARENT_PAGE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const createdDbs = new Map();
const pageChildren = new Map(); // id сторінки → блоки всередині (вбудовані бази)
const notionOpts = { parentAccess: true, searchCalls: 0, rejectTypeChange: false, failPages: null };
// як Notion: у кожної колонки є type; можна перейменувати (name) і змінити тип
const TYPE_KEYS = ['title', 'rich_text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'phone_number', 'status', 'formula', 'relation', 'rollup', 'people', 'files'];
function applyProps(target, patch) {
  for (const [name, def] of Object.entries(patch || {})) {
    if (def === null) { delete target[name]; continue; }
    let key = name;
    if (def.name && def.name !== name) { if (target[name]) { target[def.name] = target[name]; delete target[name]; } key = def.name; }
    const type = def.type || TYPE_KEYS.find(k => k in def);
    if (!type) continue;
    if (notionOpts.rejectTypeChange && target[key] && target[key].type && target[key].type !== type) {
      return { status: 400, body: { object: 'error', code: 'validation_error', message: `Cannot update property "${key}" type via the API.` } };
    }
    const { name: _n, ...rest } = def;
    target[key] = { ...rest, type };
  }
  return null;
}
routes.push({
  match: c => c.host === 'api.notion.com',
  reply: c => {
    let m;
    if (c.path === '/v1/search') {
      notionOpts.searchCalls++;
      const q = (c.body && c.body.query) || '';
      return { body: { results: [...createdDbs.values()].filter(d => d.title[0].plain_text.includes(q)).map(d => ({ object: 'database', id: d.id, title: d.title, archived: false })), has_more: false } };
    }
    if ((m = c.path.match(/^\/v1\/blocks\/([^/]+)\/children$/))) {
      const kids = pageChildren.get(m[1]);
      if (!kids) return { status: 404, body: { object: 'error', code: 'object_not_found', message: 'Could not find block with ID: ' + m[1] } };
      return { body: { results: kids, has_more: false } };
    }
    if (c.path === '/v1/databases' && c.method === 'POST') {
      if (!notionOpts.parentAccess || c.body.parent.page_id !== PARENT_PAGE) return { status: 404, body: { message: 'Could not find page with ID: ' + c.body.parent.page_id } };
      const id = uuid();
      const props = {}; applyProps(props, JSON.parse(JSON.stringify(c.body.properties)));
      const d = { id, title: [{ plain_text: c.body.title[0].text.content }], properties: props, parent: c.body.parent, is_inline: c.body.is_inline };
      createdDbs.set(id, d); dbSchemas[id] = d.properties;
      return { body: { object: 'database', ...d } };
    }
    // Notion приймає ID і з дефісами, і без
    const createdKey = raw => [...createdDbs.keys()].find(k => k.replace(/-/g, '') === String(raw).replace(/-/g, ''));
    if ((m = c.path.match(/^\/v1\/databases\/([^/]+)$/)) && createdKey(m[1])) {
      const d = createdDbs.get(createdKey(m[1]));
      if (c.method === 'PATCH') { const err = applyProps(d.properties, c.body.properties); if (err) return err; }
      return { body: { object: 'database', ...d } };
    }
    if ((m = c.path.match(/^\/v1\/databases\/([^/]+)\/query$/))) {
      const db = m[1].replace(/-/g, '');
      const list = [...pages.values()].filter(p => p.parent.database_id === db && !p.archived && evalFilter(c.body && c.body.filter, p));
      return { body: { results: list, has_more: false, next_cursor: null } };
    }
    if ((m = c.path.match(/^\/v1\/databases\/([^/]+)$/))) {
      const db = Object.values(DB).find(d => d === m[1] || d.replace(/-/g, '') === m[1].replace(/-/g, ''));
      if (!db) return { status: 404, body: { object: 'error', code: 'object_not_found', message: 'Could not find database with ID: ' + m[1] + '. Make sure the relevant pages and databases are shared with your integration.' } };
      if (c.method === 'PATCH') { Object.assign(dbSchemas[db], c.body.properties); return { body: { properties: dbSchemas[db] } }; }
      return { body: { properties: dbSchemas[db] || {}, parent: { type: 'page_id', page_id: PARENT_PAGE }, is_inline: true } };
    }
    if (c.path === '/v1/pages' && c.method === 'POST') {
      const db = c.body.parent.database_id;
      if (notionOpts.failPages) return { status: 400, body: { object: 'error', code: 'validation_error', message: notionOpts.failPages } };
      if (db === DB.DB_EXPENSES && !dbSchemas[DB.DB_EXPENSES]['Банк ID'] && c.body.properties['Банк ID']) return { status: 400, body: { message: 'Банк ID is not a property that exists.' } };
      const id = addPage(db, toStored(c.body.properties));
      return { body: pages.get(id) };
    }
    if ((m = c.path.match(/^\/v1\/pages\/([^/]+)$/))) {
      const p = pages.get(m[1]);
      if (!p) return { status: 404, body: { message: 'Could not find page' } };
      if (c.method === 'GET') return { body: p };
      if (c.body.archived) p.archived = true;
      if (c.body.properties) Object.assign(p.properties, toStored(c.body.properties));
      return { body: p };
    }
    return { status: 400, body: { message: 'bad notion path ' + c.path } };
  }
});

// Підписаний initData так само, як його формує Telegram
function initDataFor(user, { botToken = BOT, authDate = Math.floor(Date.now() / 1000), signature = 'sig-abc' } = {}) {
  const fields = { auth_date: String(authDate), query_id: 'AAE', user: JSON.stringify(user), signature };
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const check = Object.keys(fields).sort().map(k => k + '=' + fields[k]).join('\n');
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  res.send = b => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
async function call(handler, { method = 'POST', body, user, initData, query = {}, headers = {} } = {}) {
  const h = { host: 'rent.example.app', ...headers };
  if (initData !== undefined) h['x-telegram-init-data'] = initData;
  else if (user) h['x-telegram-init-data'] = initDataFor(user);
  const res = mockRes();
  await handler({ method, body, query, headers: h }, res);
  return res;
}

function freshEnv(extra = {}) {
  for (const k of Object.keys(process.env)) if (/^(TG_BOT_TOKEN|OWNER_TG_ID|ALLOWED_TG_IDS|MONO_TOKEN|BYBIT_|BINGX_|MEXC_|DB_|NOTION_TOKEN|VERCEL_PROJECT_PRODUCTION_URL)/.test(k)) delete process.env[k];
  Object.assign(process.env, { NOTION_TOKEN: 'secret_x', DB_CLIENTS: DB.DB_CLIENTS, DB_EXPENSES: DB.DB_EXPENSES, DB_CAT_EXPENSES: DB.DB_CAT_EXPENSES }, extra);
}
function fresh(mod) { delete require.cache[require.resolve(mod)]; return require(mod); }
const lib = p => path.join(ROOT, 'api', p);

(async () => {
  /* ===== Telegram ===== */
  const tg = require(lib('_lib/telegram.js'));
  await test('telegram: valid initData passes', () => {
    const v = tg.verifyInitData(initDataFor({ id: OWNER, first_name: 'Д' }), BOT);
    assert.ok(v.ok, v.reason); assert.strictEqual(v.userId, OWNER);
  });
  await test('telegram: wrong bot token fails', () => {
    assert.strictEqual(tg.verifyInitData(initDataFor({ id: OWNER }), '999:OTHER').ok, false);
  });
  await test('telegram: tampered user fails', () => {
    const s = initDataFor({ id: OWNER }).replace(encodeURIComponent('"id":' + OWNER), encodeURIComponent('"id":' + OTHER));
    assert.strictEqual(tg.verifyInitData(s, BOT).ok, false);
  });
  await test('telegram: expired initData fails', () => {
    const v = tg.verifyInitData(initDataFor({ id: OWNER }, { authDate: Math.floor(Date.now() / 1000) - 8 * 86400 }), BOT);
    assert.strictEqual(v.ok, false); assert.strictEqual(v.reason, 'expired');
    process.env.TG_BOT_TOKEN = BOT;
    const a = tg.authFromRequest({ headers: { 'x-telegram-init-data': initDataFor({ id: OWNER }, { authDate: Math.floor(Date.now() / 1000) - 8 * 86400 }) } });
    delete process.env.TG_BOT_TOKEN;
    assert.strictEqual(a.status, 401); assert.ok(/застаріла/.test(a.error), a.error);
  });
  await test('telegram: hash computed without signature field also accepted', () => {
    const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: OWNER }), signature: 'zzz' };
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
    const check = ['auth_date', 'user'].map(k => k + '=' + fields[k]).join('\n');
    const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
    assert.ok(tg.verifyInitData(new URLSearchParams({ ...fields, hash }).toString(), BOT).ok);
  });

  /* ===== Notion proxy ===== */
  const notionPath = lib('notion.js');
  // дані: двоє користувачів
  const mine = addPage(DB.DB_CLIENTS, { 'Назва': title('Мій'), 'Telegram ID': num(OWNER) });
  const theirs = addPage(DB.DB_CLIENTS, { 'Назва': title('Чужий'), 'Telegram ID': num(OTHER) });
  const sharedCat = addPage(DB.DB_CAT_EXPENSES, { 'Назва': title('Продукти'), 'Загальна': chk(true), 'Telegram ID': num(null) });
  const myCat = addPage(DB.DB_CAT_EXPENSES, { 'Назва': title('Кафе і ресторани'), 'Загальна': chk(false), 'Telegram ID': num(OWNER) });
  addPage(DB.DB_CAT_EXPENSES, { 'Назва': title('Чужа категорія'), 'Загальна': chk(false), 'Telegram ID': num(OTHER) });
  const foreignPage = uuid(); pages.set(foreignPage, { id: foreignPage, parent: { database_id: 'ffffffffffffffffffffffffffffffff' }, properties: { 'Telegram ID': num(OWNER) } });

  await test('notion: without TG_BOT_TOKEN works as before (legacy)', async () => {
    freshEnv(); const h = fresh(notionPath);
    const r = await call(h, { body: { action: 'query', database: 'DB_CLIENTS' } });
    assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.headers['X-RC-Auth'], 'off'); assert.strictEqual(r.body.results.length, 2);
  });
  await test('notion: with TG_BOT_TOKEN, request without initData → 401', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT }); const h = fresh(notionPath);
    const r = await call(h, { body: { action: 'query', database: 'DB_CLIENTS' } });
    assert.strictEqual(r.statusCode, 401);
  });
  await test('notion: forged initData → 401', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT }); const h = fresh(notionPath);
    const r = await call(h, { initData: initDataFor({ id: OWNER }, { botToken: '1:FAKE' }), body: { action: 'query', database: 'DB_CLIENTS' } });
    assert.strictEqual(r.statusCode, 401);
  });
  await test('notion: query returns only own rows', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT }); const h = fresh(notionPath);
    const r = await call(h, { user: { id: OWNER }, body: { action: 'query', database: 'DB_CLIENTS' } });
    assert.strictEqual(r.statusCode, 200); assert.deepStrictEqual(r.body.results.map(p => p.id), [mine]);
  });
  await test('notion: categories include shared ones, not others', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT }); const h = fresh(notionPath);
    const r = await call(h, { user: { id: OWNER }, body: { action: 'query', database: 'DB_CAT_EXPENSES' } });
    assert.deepStrictEqual(r.body.results.map(p => p.id).sort(), [sharedCat, myCat].sort());
  });
  await test('notion: create forces own Telegram ID', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT }); const h = fresh(notionPath);
    const r = await call(h, { user: { id: OWNER }, body: { action: 'create', database: 'DB_CLIENTS', properties: { 'Назва': { title: [{ text: { content: 'Новий' } }] }, 'Telegram ID': { number: OTHER } } } });
    assert.strictEqual(r.statusCode, 200); assert.strictEqual(pages.get(r.body.id).properties['Telegram ID'].number, OWNER);
  });
  await test('notion: cannot update or archive someone else’s record', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT }); const h = fresh(notionPath);
    const u = await call(h, { user: { id: OWNER }, body: { action: 'update', pageId: theirs, properties: { 'Назва': { title: [{ text: { content: 'hack' } }] } } } });
    const a = await call(h, { user: { id: OWNER }, body: { action: 'archive', pageId: theirs } });
    assert.strictEqual(u.statusCode, 403); assert.strictEqual(a.statusCode, 403); assert.strictEqual(pages.get(theirs).archived, false);
  });
  await test('notion: cannot touch pages outside whitelisted databases', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT }); const h = fresh(notionPath);
    const a = await call(h, { user: { id: OWNER }, body: { action: 'archive', pageId: foreignPage } });
    assert.strictEqual(a.statusCode, 403);
  });
  await test('notion: own record update works and keeps ownership', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT }); const h = fresh(notionPath);
    const u = await call(h, { user: { id: OWNER }, body: { action: 'update', pageId: mine, properties: { 'Назва': { title: [{ text: { content: 'Мій 2' } }] }, 'Telegram ID': { number: OTHER } } } });
    assert.strictEqual(u.statusCode, 200); assert.strictEqual(pages.get(mine).properties['Telegram ID'].number, OWNER);
  });
  await test('notion: ALLOWED_TG_IDS blocks other users', async () => {
    freshEnv({ TG_BOT_TOKEN: BOT, ALLOWED_TG_IDS: String(OWNER) }); const h = fresh(notionPath);
    const r = await call(h, { user: { id: OTHER }, body: { action: 'query', database: 'DB_CLIENTS' } });
    assert.strictEqual(r.statusCode, 403);
  });

  /* ===== Підписи бірж ===== */
  const ex = fresh(lib('_lib/exchanges.js'));
  await test('mexc: signature matches the docs curl example (verified with openssl)', () => {
    const q = ex.mexcQuery({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 1, price: 11, recvWindow: 5000, timestamp: 1644489390087 }, '45d0b3c26f2644f19bfb98b07741b2f5');
    assert.ok(q.endsWith('&signature=fd3e4e8543c5188531eb7279d68ae7d26a573d0fc5ab0d18eb692451654d837a'), q);
  });
  await test('mono: real-looking base64 ids are accepted', () => {
    const e = require(lib('_lib/expenses.js'));
    assert.ok(e.validItem({ bankId: 'mono:ZuHWzqkKGVo=', date: '2026-11-25', amount: 12.5, currency: 'UAH', title: 'Сільпо' }));
    assert.ok(!e.validItem({ bankId: 'mono:<script>', date: '2026-11-25', amount: 12.5, currency: 'UAH' }));
  });
  await test('bingx: params sorted, unencoded, signature appended', () => {
    const q = ex.bingxQuery({ timestamp: 1696751141337, symbol: 'BTC-USDT', recvWindow: 0 }, 'SECRET_KEY');
    const expect = 'recvWindow=0&symbol=BTC-USDT&timestamp=1696751141337';
    assert.ok(q.startsWith(expect + '&signature='));
    assert.strictEqual(q.split('signature=')[1], crypto.createHmac('sha256', 'SECRET_KEY').update(expect).digest('hex'));
  });

  /* ===== Категорії ===== */
  const cat = require(lib('_lib/categorize.js'));
  const cats = [{ id: 'c1', name: 'Продукти' }, { id: 'c2', name: 'Кафе і ресторани' }, { id: 'c3', name: 'Транспорт' }, { id: 'c9', name: 'Інше' }];
  await test('categorize: shop name wins (Biedronka → Продукти)', () => assert.strictEqual(cat.suggestCategory({ title: 'BIEDRONKA 1234 WARSZAWA', mcc: 0 }, cats), 'c1'));
  await test('categorize: MCC fallback (5812 → Кафе)', () => assert.strictEqual(cat.suggestCategory({ title: 'Some place', mcc: 5812 }, cats), 'c2'));
  await test('categorize: Bolt → Транспорт', () => assert.strictEqual(cat.suggestCategory({ title: 'Bolt.eu/o/2511', mcc: 4121 }, cats), 'c3'));
  await test('categorize: unknown → Інше', () => assert.strictEqual(cat.suggestCategory({ title: 'XYZ', mcc: 1234 }, cats), 'c9'));
  await test('kind: transfers, cash and income are not expenses', () => {
    assert.strictEqual(cat.kindOf({ amount: -1000, mcc: 4829, title: 'Переказ' }), 'transfer');
    assert.strictEqual(cat.kindOf({ amount: -1000, mcc: 6011, title: 'Банкомат' }), 'cash');
    assert.strictEqual(cat.kindOf({ amount: 5000, mcc: 4829, title: 'Від Олени' }), 'income');
    assert.strictEqual(cat.kindOf({ amount: -500, mcc: 4829, title: 'На банку «Відпустка»' }), 'transfer');
    assert.strictEqual(cat.kindOf({ amount: -500, mcc: 5411, title: 'Сільпо' }), 'expense');
  });

  /* ===== Монобанк + фінанси ===== */
  const MONO_TOKEN = 'mono-test-token';
  let monoInfoCalls = 0, webhookSet = null;
  routes.unshift({
    match: c => c.host === 'api.monobank.ua',
    reply: c => {
      if (c.headers['X-Token'] !== MONO_TOKEN && c.path !== '/bank/currency') return { status: 403, body: { errorDescription: "Unknown 'X-Token'" } };
      if (c.path === '/personal/client-info') {
        monoInfoCalls++;
        return { body: { clientId: 'x', name: 'Тест', webHookUrl: webhookSet || '', accounts: [
          { id: 'accUAH', balance: 1250050, creditLimit: 1000000, currencyCode: 980, type: 'black', maskedPan: ['537541******1234'], iban: 'UA00' },
          { id: 'accEUR', balance: 12000, creditLimit: 0, currencyCode: 978, type: 'white', maskedPan: ['444111******9999'] },
        ], jars: [{ id: 'jar1', title: 'Відпустка', currencyCode: 980, balance: 500000, goal: 2000000 }] } };
      }
      if (c.path === '/personal/webhook') { webhookSet = c.body.webHookUrl; return { body: { status: 'ok' } }; }
      if (c.path === '/bank/currency') return { body: [{ currencyCodeA: 978, currencyCodeB: 980, rateBuy: 45, rateSell: 46 }, { currencyCodeA: 840, currencyCodeB: 980, rateBuy: 41.5, rateSell: 42 }] };
      if (c.path.startsWith('/personal/statement/accUAH/')) {
        const t = Math.floor(Date.now() / 1000) - 3600;
        return { body: [
          { id: 'tx1', time: t, description: 'Сільпо', mcc: 5411, amount: -45000, operationAmount: -45000, currencyCode: 980, hold: false },
          { id: 'tx2', time: t, description: 'Переказ на картку', mcc: 4829, amount: -100000, operationAmount: -100000, currencyCode: 980, hold: false },
          { id: 'tx3', time: t, description: 'BIEDRONKA WARSZAWA', mcc: 5411, amount: -152000, operationAmount: -15000, currencyCode: 985, hold: true },
          { id: 'tx4', time: t, description: 'Від: Олена', mcc: 4829, amount: 200000, operationAmount: 200000, currencyCode: 980, hold: false },
        ] };
      }
      return { status: 404, body: {} };
    }
  });
  const finPath = lib('finance.js');
  const ENV_FIN = { TG_BOT_TOKEN: BOT, OWNER_TG_ID: String(OWNER), MONO_TOKEN, VERCEL_PROJECT_PRODUCTION_URL: 'rent.example.app' };
  const reloadFin = () => { for (const m of ['_lib/mono.js', '_lib/expenses.js', '_lib/exchanges.js', '_lib/tgbot.js', '_lib/notify.js', '_lib/ledger.js', '_lib/transfers.js']) fresh(lib(m)); return fresh(finPath); };

  await test('finance: status works without protection and reveals only flags', async () => {
    freshEnv({ MONO_TOKEN }); const h = reloadFin();
    const r = await call(h, { body: { action: 'status' } });
    assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.auth, 'off'); assert.strictEqual(r.body.providers.mono, true);
    assert.ok(!JSON.stringify(r.body).includes(MONO_TOKEN));
  });
  await test('finance: balances refused while protection is off (412)', async () => {
    freshEnv({ MONO_TOKEN }); const h = reloadFin();
    const r = await call(h, { body: { action: 'balances' } });
    assert.strictEqual(r.statusCode, 412);
  });
  await test('finance: other Telegram user cannot see owner’s bank data (403)', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const r = await call(h, { user: { id: OTHER }, body: { action: 'balances' } });
    assert.strictEqual(r.statusCode, 403);
  });
  await test('finance: status hides which banks are connected from other users, shows owner', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const other = await call(h, { user: { id: OTHER }, body: { action: 'status' } });
    assert.strictEqual(other.statusCode, 200); assert.strictEqual(other.body.owner, false);
    assert.deepStrictEqual(other.body.providers, {});
    const own = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    assert.strictEqual(own.body.owner, true); assert.strictEqual(own.body.providers.mono, true);
    const anon = await call(h, { body: { action: 'status' } });
    assert.strictEqual(anon.statusCode, 401);
  });
  await test('finance: owner gets Monobank balances (own money without credit limit, jars)', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const r = await call(h, { user: { id: OWNER }, body: { action: 'balances' } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    const m = r.body.providers.find(p => p.provider === 'mono');
    assert.ok(m.ok, JSON.stringify(m));
    const uah = m.accounts.find(a => a.id === 'mono:accUAH');
    assert.strictEqual(uah.balance, 2500.5); assert.strictEqual(uah.mask, '•1234');
    assert.ok(m.accounts.find(a => a.kind === 'jar' && a.balance === 5000));
  });
  await test('finance: client-info cached (rate limit 1/min)', async () => {
    const before = monoInfoCalls; freshEnv(ENV_FIN); const h = fresh(finPath);
    await call(h, { user: { id: OWNER }, body: { action: 'balances' } });
    assert.strictEqual(monoInfoCalls, before);
  });
  await test('finance: enabling webhook registers secret URL on production domain', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const r = await call(h, { user: { id: OWNER }, body: { action: 'mono-webhook' } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.ok(/^https:\/\/rent\.example\.app\/api\/finance\?hook=mono&k=[0-9a-f]{32}&imp=1&ntf=0&log=0$/.test(webhookSet), webhookSet);
  });
  const hookK = () => new URL(webhookSet).searchParams.get('k');
  await test('webhook: GET verification returns 200 with right key, 403 with wrong', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const ok = await call(h, { method: 'GET', query: { hook: 'mono', k: hookK() } });
    const bad = await call(h, { method: 'GET', query: { hook: 'mono', k: 'nope' } });
    assert.strictEqual(ok.statusCode, 200); assert.strictEqual(bad.statusCode, 403);
  });
  const hookBody = item => ({ type: 'StatementItem', data: { account: 'accUAH', statementItem: item } });
  const expRows = () => [...pages.values()].filter(p => p.parent.database_id === DB.DB_EXPENSES.replace(/-/g, '') && !p.archived);
  await test('webhook: card payment becomes an expense in Expense·Control with category and Банк ID', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const t = Math.floor(Date.now() / 1000);
    const r = await call(h, { method: 'POST', query: { hook: 'mono', k: hookK() }, body: hookBody({ id: 'w1', time: t, description: 'Пузата Хата', mcc: 5812, amount: -23400, operationAmount: -23400, currencyCode: 980 }) });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.created, 1);
    const row = expRows().find(p => p.properties['Банк ID'].rich_text[0].plain_text === 'mono:w1');
    assert.ok(row); assert.strictEqual(row.properties['Сума'].number, 234); assert.strictEqual(row.properties['Валюта'].select.name, 'UAH');
    assert.strictEqual(row.properties['Telegram ID'].number, OWNER);
    assert.deepStrictEqual(row.properties['Категорія'].relation, [{ id: myCat }]);
    assert.ok(dbSchemas[DB.DB_EXPENSES]['Банк ID'], 'column Банк ID added');
  });
  await test('webhook: same operation twice is written once', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const t = Math.floor(Date.now() / 1000);
    const r = await call(h, { method: 'POST', query: { hook: 'mono', k: hookK() }, body: hookBody({ id: 'w1', time: t, description: 'Пузата Хата', mcc: 5812, amount: -23400, operationAmount: -23400, currencyCode: 980 }) });
    assert.strictEqual(r.body.duplicate, 1); assert.strictEqual(expRows().filter(p => p.properties['Банк ID'].rich_text[0].plain_text === 'mono:w1').length, 1);
  });
  await test('webhook: transfers and income are skipped', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const n = expRows().length, t = Math.floor(Date.now() / 1000);
    const a = await call(h, { method: 'POST', query: { hook: 'mono', k: hookK() }, body: hookBody({ id: 'w2', time: t, description: 'Переказ', mcc: 4829, amount: -5000, operationAmount: -5000, currencyCode: 980 }) });
    const b = await call(h, { method: 'POST', query: { hook: 'mono', k: hookK() }, body: hookBody({ id: 'w3', time: t, description: 'Поповнення', mcc: 4829, amount: 5000, operationAmount: 5000, currencyCode: 980 }) });
    assert.strictEqual(a.body.skipped, 'transfer'); assert.strictEqual(b.body.skipped, 'income'); assert.strictEqual(expRows().length, n);
  });
  await test('webhook: EUR card purchase stored in UAH by Monobank rate', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    await call(h, { user: { id: OWNER }, body: { action: 'balances' } }); // знає валюту рахунків
    const t = Math.floor(Date.now() / 1000);
    const r = await call(h, { method: 'POST', query: { hook: 'mono', k: hookK() }, body: { type: 'StatementItem', data: { account: 'accEUR', statementItem: { id: 'w4', time: t, description: 'Zara', mcc: 5651, amount: -1000, operationAmount: -1000, currencyCode: 978 } } } });
    assert.strictEqual(r.body.created, 1, JSON.stringify(r.body));
    const row = expRows().find(p => p.properties['Банк ID'].rich_text[0].plain_text === 'mono:w4');
    assert.strictEqual(row.properties['Валюта'].select.name, 'UAH'); assert.strictEqual(row.properties['Сума'].number, 455);
  });
  await test('finance: preview marks kinds, suggests categories, flags existing', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const r = await call(h, { user: { id: OWNER }, body: { action: 'mono-preview', account: 'accUAH', days: 31 } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    const by = Object.fromEntries(r.body.items.map(i => [i.bankId, i]));
    assert.strictEqual(by['mono:tx1'].kind, 'expense'); assert.strictEqual(by['mono:tx1'].expense.categoryId, sharedCat);
    assert.strictEqual(by['mono:tx2'].kind, 'transfer'); assert.strictEqual(by['mono:tx4'].kind, 'income');
    assert.strictEqual(by['mono:tx3'].expense.currency, 'UAH'); assert.strictEqual(by['mono:tx3'].expense.amount, 1520);
    assert.ok(by['mono:tx3'].expense.note.startsWith('150 PLN'));
  });
  await test('finance: import writes selected items once, validates input', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const pr = await call(h, { user: { id: OWNER }, body: { action: 'mono-preview', account: 'accUAH', days: 31 } });
    const items = pr.body.items.filter(i => i.kind === 'expense').map(i => i.expense);
    const bad = { bankId: 'evil:1', date: 'x', amount: -1, currency: 'BTC' };
    const r1 = await call(h, { user: { id: OWNER }, body: { action: 'expenses-import', items: [...items, bad] } });
    const r2 = await call(h, { user: { id: OWNER }, body: { action: 'expenses-import', items } });
    assert.strictEqual(r1.body.created.length, 2); assert.strictEqual(r1.body.invalid, 1);
    assert.strictEqual(r2.body.created.length, 0); assert.strictEqual(r2.body.duplicates.length, 2);
  });

  /* ===== Сповіщення в бот: Монобанк ===== */
  const tgSent = []; let tgMode = 'ok';
  routes.unshift({
    match: c => c.host === 'api.telegram.org',
    reply: c => {
      if (c.path !== '/bot' + BOT + '/sendMessage') return { status: 404, body: { ok: false, description: 'Not Found' } };
      if (tgMode === 'forbidden') return { status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" } };
      if (tgMode === 'down') return { status: 502, body: { ok: false, description: 'Bad Gateway' } };
      tgSent.push({ chat: c.body.chat_id, text: c.body.text, mode: c.body.parse_mode });
      return { body: { ok: true, result: { message_id: tgSent.length } } };
    }
  });
  const hookQuery = () => Object.fromEntries(new URL(webhookSet).searchParams);
  const nowSec = () => Math.floor(Date.now() / 1000);
  await test('notify: switches live in the webhook address (import/notify) and come back in balances', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const a = await call(h, { user: { id: OWNER }, body: { action: 'mono-webhook', import: false, notify: true } });
    assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body)); assert.ok(webhookSet.endsWith('&imp=0&ntf=1&log=0'), webhookSet);
    const b = await call(h, { user: { id: OWNER }, body: { action: 'balances', only: ['mono'] } });
    const m = b.body.providers[0];
    assert.strictEqual(m.webhook, 'on'); assert.strictEqual(m.hookImport, false); assert.strictEqual(m.hookNotify, true);
    await call(h, { user: { id: OWNER }, body: { action: 'mono-webhook', import: false, notify: false } });
    assert.strictEqual(webhookSet, '');
    await call(h, { user: { id: OWNER }, body: { action: 'mono-webhook', import: true, notify: true } });
    assert.ok(webhookSet.endsWith('&imp=1&ntf=1&log=0'), webhookSet);
  });
  await test('notify: card purchase → expense + message with category, card name and own balance', async () => {
    freshEnv(ENV_FIN); const h = reloadFin(); tgSent.length = 0; tgMode = 'ok';
    const r = await call(h, { method: 'POST', query: hookQuery(), body: hookBody({ id: 'n1', time: nowSec(), description: 'Сільпо', mcc: 5411, amount: -61240, operationAmount: -61240, currencyCode: 980, balance: 1188810 }) });
    assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.created, 1); assert.strictEqual(r.body.notified, true, JSON.stringify(r.body));
    assert.strictEqual(tgSent.length, 1); assert.strictEqual(tgSent[0].chat, OWNER); assert.strictEqual(tgSent[0].mode, 'HTML');
    const t = tgSent[0].text;
    for (const part of ['💳', '−612,40 ₴', 'Сільпо', 'Чорна картка •1234', 'залишок 1 888,10 ₴', 'у витратах: Продукти']) assert.ok(t.includes(part), part + ' ∉ ' + t);
  });
  await test('notify: transfer → message only (no expense); same operation again → no second message', async () => {
    freshEnv(ENV_FIN); const h = reloadFin(); tgSent.length = 0;
    const n = expRows().length;
    const item = { id: 'n2', time: nowSec(), description: 'Переказ на картку', mcc: 4829, amount: -200000, operationAmount: -200000, currencyCode: 980, comment: 'за <квартиру>', counterName: 'Олена К.', balance: 1500000 };
    const a = await call(h, { method: 'POST', query: hookQuery(), body: hookBody(item) });
    const b = await call(h, { method: 'POST', query: hookQuery(), body: hookBody(item) });
    assert.strictEqual(a.body.skipped, 'transfer'); assert.strictEqual(a.body.notified, true); assert.strictEqual(b.body.notified, 'repeat');
    assert.strictEqual(expRows().length, n); assert.strictEqual(tgSent.length, 1);
    const t = tgSent[0].text;
    for (const part of ['↗️', '−2 000 ₴', 'Олена К.', '«за &lt;квартиру&gt;»']) assert.ok(t.includes(part), part + ' ∉ ' + t);
  });
  await test('notify: income, foreign-currency purchase, jar; notify off → silent', async () => {
    freshEnv(ENV_FIN); const h = reloadFin(); tgSent.length = 0;
    await call(h, { method: 'POST', query: hookQuery(), body: hookBody({ id: 'n3', time: nowSec(), description: 'Від: Олена К.', mcc: 4829, amount: 350000, operationAmount: 350000, currencyCode: 980 }) });
    await call(h, { method: 'POST', query: hookQuery(), body: hookBody({ id: 'n4', time: nowSec(), description: 'BIEDRONKA', mcc: 5411, amount: -89907, operationAmount: -8620, currencyCode: 985 }) });
    await call(h, { method: 'POST', query: hookQuery(), body: { type: 'StatementItem', data: { account: 'jar1', statementItem: { id: 'n5', time: nowSec(), description: 'Поповнення банки', mcc: 4829, amount: 100000, operationAmount: 100000, currencyCode: 980, balance: 600000 } } } });
    await call(h, { method: 'POST', query: { ...hookQuery(), ntf: '0' }, body: hookBody({ id: 'n6', time: nowSec(), description: 'Netflix', mcc: 4899, amount: -38900, operationAmount: -38900, currencyCode: 980 }) });
    assert.strictEqual(tgSent.length, 3, tgSent.map(x => x.text).join(' | '));
    assert.ok(tgSent[0].text.startsWith('💰 <b>+3 500 ₴</b>'), tgSent[0].text);
    assert.ok(tgSent[1].text.includes('−899,07 ₴</b> (86,20 zł)'), tgSent[1].text);
    assert.ok(tgSent[2].text.includes('Банка «Відпустка» · залишок 6 000 ₴'), tgSent[2].text);
  });
  await test('notify: Telegram refuses → webhook still 200 (Monobank must not retry), expense kept', async () => {
    freshEnv(ENV_FIN); const h = reloadFin(); tgMode = 'forbidden';
    const r = await call(h, { method: 'POST', query: hookQuery(), body: hookBody({ id: 'n7', time: nowSec(), description: 'Аптека', mcc: 5912, amount: -4500, operationAmount: -4500, currencyCode: 980 }) });
    tgMode = 'ok';
    assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.created, 1); assert.strictEqual(r.body.notified, false);
  });
  await test('notify: test message from the app; forbidden → hint to press Start (424)', async () => {
    freshEnv(ENV_FIN); const h = reloadFin(); tgSent.length = 0;
    const ok = await call(h, { user: { id: OWNER }, body: { action: 'notify-test' } });
    tgMode = 'forbidden';
    const bad = await call(h, { user: { id: OWNER }, body: { action: 'notify-test' } });
    tgMode = 'ok';
    const other = await call(h, { user: { id: OTHER }, body: { action: 'notify-test' } });
    assert.strictEqual(ok.statusCode, 200); assert.strictEqual(tgSent.length, 1);
    assert.strictEqual(bad.statusCode, 424); assert.ok(/Почати/.test(bad.body.error), bad.body.error);
    assert.strictEqual(other.statusCode, 403);
  });
  await test('notify: status gives the owner the exchange-check address, other users nothing', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const own = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    const other = await call(h, { user: { id: OTHER }, body: { action: 'status' } });
    assert.ok(/^https:\/\/rent\.example\.app\/api\/finance\?hook=poll&k=[0-9a-f]{32}$/.test(own.body.notify.pollUrl), JSON.stringify(own.body.notify));
    assert.strictEqual(other.body.notify, null);
  });

  /* ===== Біржі (баланси) ===== */
  routes.unshift(
    { match: c => c.host === 'api.bybit.com' && c.path === '/v5/account/wallet-balance', reply: c => (c.headers['X-BAPI-API-KEY'] === 'eu-key' ? { body: { retCode: 10003, retMsg: 'API key is invalid.' } } : { body: { retCode: 0, result: { list: [{ coin: [{ coin: 'BTC', walletBalance: '0.01', usdValue: '650.5' }, { coin: 'USDT', walletBalance: '100', usdValue: '100' }] }] } } }) },
    { match: c => c.host === 'api.bybit.eu' && c.path === '/v5/account/wallet-balance', reply: () => ({ body: { retCode: 0, result: { list: [{ coin: [{ coin: 'ETH', walletBalance: '0.5', usdValue: '1500' }] }] } } }) },
    { match: c => /bybit\.(com|eu)$/.test(c.host) && c.path === '/v5/asset/transfer/query-account-coins-balance', reply: () => ({ body: { retCode: 0, result: { balance: [{ coin: 'SOL', walletBalance: '2' }] } } }) },
    { match: c => /bybit\.(com|eu)$/.test(c.host) && c.path === '/v5/earn/position', reply: () => ({ body: { retCode: 10005, retMsg: 'Permission denied' } }) },
    { match: c => /bybit\.(com|eu)$/.test(c.host) && c.path === '/v5/market/tickers', reply: () => ({ body: { retCode: 0, result: { list: [{ symbol: 'SOLUSDT', lastPrice: '150' }] } } }) },
    { match: c => c.host === 'open-api.bingx.com' && c.path === '/openApi/spot/v1/account/balance', reply: c => {
      const q = c.url.split('?')[1]; const [qs, sig] = q.split('&signature=');
      const ok = sig === crypto.createHmac('sha256', 'bx-secret').update(qs).digest('hex') && c.headers['X-BX-APIKEY'] === 'bx-key';
      return ok ? { body: { code: 0, data: { balances: [{ asset: 'TON', free: '10', locked: '0' }, { asset: 'USDT', free: '5', locked: '0' }] } } } : { body: { code: 100001, msg: 'Signature verification failed' } };
    } },
    { match: c => c.host === 'open-api.bingx.com' && c.path === '/openApi/spot/v1/ticker/24hr', reply: () => ({ body: { code: 0, data: [{ symbol: 'TON-USDT', lastPrice: '5' }] } }) },
    { match: c => c.host === 'open-api.bingx.com' && c.path === '/openApi/account/v1/allAccountBalance', reply: () => ({ body: { code: 0, data: [{ accountType: 'sopt', usdtBalance: '55' }, { accountType: 'USDTMPerp', usdtBalance: '20' }] } }) },
    { match: c => c.host === 'api.mexc.com' && c.path === '/api/v3/account', reply: c => {
      const q = c.url.split('?')[1]; const [qs, sig] = q.split('&signature=');
      const ok = sig === crypto.createHmac('sha256', 'mx-secret').update(qs).digest('hex') && c.headers['X-MEXC-APIKEY'] === 'mx-key';
      return ok ? { body: { balances: [{ asset: 'PEPE', free: '1000000', locked: '0' }, { asset: 'EUR', free: '10', locked: '0' }] } } : { status: 400, body: { code: 700002, msg: 'Signature for this request is not valid.' } };
    } },
    { match: c => c.host === 'api.mexc.com' && c.path === '/api/v3/ticker/price', reply: () => ({ body: [{ symbol: 'PEPEUSDT', price: '0.00001' }, { symbol: 'TONUSDT', price: '5' }] }) },
  );
  const EX_ENV = { ...ENV_FIN, BYBIT_API_KEY: 'k', BYBIT_API_SECRET: 's', BINGX_API_KEY: 'bx-key', BINGX_API_SECRET: 'bx-secret', MEXC_API_KEY: 'mx-key', MEXC_API_SECRET: 'mx-secret' };
  await test('exchanges: Bybit/BingX/MEXC balances with USD values', async () => {
    freshEnv(EX_ENV); const h = reloadFin();
    const r = await call(h, { user: { id: OWNER }, body: { action: 'balances', only: ['bybit', 'bingx', 'mexc'] } });
    const by = Object.fromEntries(r.body.providers.map(p => [p.provider, p]));
    assert.ok(by.bybit.ok, JSON.stringify(by.bybit)); assert.ok(by.bingx.ok, JSON.stringify(by.bingx)); assert.ok(by.mexc.ok, JSON.stringify(by.mexc));
    const sol = by.bybit.holdings.find(h => h.asset === 'SOL'); assert.strictEqual(sol.usd, 300);
    assert.strictEqual(by.bingx.holdings.find(h => h.asset === 'TON').usd, 50);
    assert.ok(by.bingx.holdings.find(h => h.account.includes('USDT-M') && h.usd === 20));
    assert.ok(Math.abs(by.mexc.holdings.find(h => h.asset === 'PEPE').usd - 10) < 1e-9);
    assert.strictEqual(by.mexc.holdings.find(h => h.asset === 'EUR').fiat, 'EUR');
  });
  await test('exchanges: Bybit EU key detected automatically', async () => {
    freshEnv({ ...EX_ENV, BYBIT_API_KEY: 'eu-key' }); const h = reloadFin();
    const r = await call(h, { user: { id: OWNER }, body: { action: 'balances', only: ['bybit'] } });
    const b = r.body.providers[0];
    assert.ok(b.ok, JSON.stringify(b)); assert.strictEqual(b.label, 'Bybit EU'); assert.ok(b.holdings.find(h => h.asset === 'ETH'));
  });
  await test('exchanges: wrong secret gives a clear error, others still work', async () => {
    freshEnv({ ...EX_ENV, MEXC_API_SECRET: 'wrong' }); const h = reloadFin();
    const r = await call(h, { user: { id: OWNER }, body: { action: 'balances', only: ['bingx', 'mexc'] } });
    const by = Object.fromEntries(r.body.providers.map(p => [p.provider, p]));
    assert.strictEqual(by.mexc.ok, false); assert.strictEqual(by.mexc.code, 'auth'); assert.ok(by.bingx.ok);
  });

  /* ===== Сповіщення в бот: біржі (щохвилинна перевірка) ===== */
  const hist = { bybitDep: [], bybitWd: [], bybitIdep: [], bingxDep: [], bingxWd: [], mexcDep: [], mexcWd: [], failBybit: false };
  const signedOk = (c, secret, key, header) => { const q = c.url.split('?')[1]; const [qs, sig] = q.split('&signature='); return sig === crypto.createHmac('sha256', secret).update(qs).digest('hex') && c.headers[header] === key; };
  routes.unshift(
    { match: c => c.host === 'api.bybit.com' && c.path === '/v5/asset/deposit/query-record', reply: c => {
      if (hist.failBybit) return { body: { retCode: 10005, retMsg: 'Permission denied, please check your API key permissions.' } };
      const q = c.query; assert.ok(Number(q.get('endTime')) - Number(q.get('startTime')) <= 30 * 864e5);
      return { body: { retCode: 0, result: { rows: hist.bybitDep } } };
    } },
    { match: c => c.host === 'api.bybit.com' && c.path === '/v5/asset/withdraw/query-record', reply: () => (hist.failBybit ? { body: { retCode: 10005, retMsg: 'Permission denied' } } : { body: { retCode: 0, result: { rows: hist.bybitWd } } }) },
    { match: c => c.host === 'api.bybit.com' && c.path === '/v5/asset/deposit/query-internal-record', reply: () => ({ body: { retCode: 0, result: { rows: hist.bybitIdep } } }) },
    { match: c => c.host === 'open-api.bingx.com' && c.path === '/openApi/api/v3/capital/deposit/hisrec', reply: c => (signedOk(c, 'bx-secret', 'bx-key', 'X-BX-APIKEY') ? { body: hist.bingxDep } : { body: { code: 100001, msg: 'Signature verification failed' } }) },
    { match: c => c.host === 'open-api.bingx.com' && c.path === '/openApi/api/v3/capital/withdraw/history', reply: () => ({ body: hist.bingxWd }) },
    { match: c => c.host === 'api.mexc.com' && c.path === '/api/v3/capital/deposit/hisrec', reply: c => (signedOk(c, 'mx-secret', 'mx-key', 'X-MEXC-APIKEY') ? { body: hist.mexcDep } : { status: 400, body: { code: 700002, msg: 'Signature for this request is not valid.' } }) },
    { match: c => c.host === 'api.mexc.com' && c.path === '/api/v3/capital/withdraw/history', reply: () => ({ body: hist.mexcWd }) },
  );
  const pollK = () => crypto.createHmac('sha256', BOT).update('rent-control:transfers-poll').digest('hex').slice(0, 32);
  const poll = h => call(h, { method: 'GET', query: { hook: 'poll', k: pollK() } });
  const resetHist = () => { for (const k of Object.keys(hist)) hist[k] = Array.isArray(hist[k]) ? [] : false; };

  await test('poll: wrong key 403; without exchanges nothing to do', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const bad = await call(h, { method: 'GET', query: { hook: 'poll', k: 'nope' } });
    const none = await poll(h);
    assert.strictEqual(bad.statusCode, 403); assert.strictEqual(none.statusCode, 200); assert.strictEqual(none.body.skipped, 'no-exchanges');
  });
  await test('poll: first run only remembers history (sends just the last minute), then each new transfer once', async () => {
    freshEnv(EX_ENV); const h = reloadFin(); resetHist(); tgSent.length = 0; tgMode = 'ok';
    const now = Date.now();
    hist.bybitDep = [{ id: 'd-old', coin: 'USDT', chain: 'TRX', amount: '500', txID: 'tx-old', status: 3, successAt: String(now - 3600e3) }];
    hist.bingxDep = [{ coin: 'TON', network: 'TON', amount: '12.5', txId: 'bx-recent', status: 6, insertTime: now - 20e3 }];
    hist.mexcDep = [{ coin: 'KAS', network: 'KAS', amount: '800', txId: 'mx-pend', status: 4, insertTime: now - 30e3 }];
    let r = await poll(h);
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body)); assert.ok(r.body.checked.every(x => x.ok), JSON.stringify(r.body.checked));
    assert.strictEqual(tgSent.length, 1, tgSent.map(x => x.text).join(' | '));
    assert.ok(tgSent[0].text.includes('⬇️ <b>+12,5 TON</b> на BingX'), tgSent[0].text);
    // переказ Bybit → BingX: виведення й поповнення з одним txId; MEXC-поповнення підтвердилось
    hist.bybitWd = [{ withdrawId: 'w-1', coin: 'USDT', chain: 'TRX', amount: '300', txID: 'x-move', status: 'success', toAddress: 'TXabcdefghijklmnop1234', withdrawFee: '1', withdrawType: 0, createTime: String(now), updateTime: String(now) }];
    hist.bingxDep.push({ coin: 'USDT', network: 'TRC20', amount: '299', txId: 'x-move', status: 1, insertTime: now });
    hist.mexcDep[0].status = 5;
    r = await poll(h);
    assert.strictEqual(r.body.sent, 3, JSON.stringify(r.body)); assert.strictEqual(tgSent.length, 4);
    const texts = tgSent.slice(1).map(x => x.text).join('\n---\n');
    assert.ok(texts.includes('⬆️ <b>−300 USDT</b> з Bybit\nмережа TRX · на TXabcd…1234 · комісія 1 USDT'), texts);
    assert.ok(texts.includes('⬇️ <b>+299 USDT</b> на BingX\nмережа TRC20 · з Bybit'), texts);
    assert.ok(texts.includes('⬇️ <b>+800 KAS</b> на MEXC'), texts);
    r = await poll(h);
    assert.strictEqual(r.body.fresh, 0); assert.strictEqual(tgSent.length, 4);
  });
  await test('poll: exchange that failed on the first run does not flood its old history later', async () => {
    freshEnv(EX_ENV); const h = reloadFin(); resetHist(); tgSent.length = 0;
    const now = Date.now();
    hist.failBybit = true;
    hist.bybitDep = [{ id: 'd-2h', coin: 'BTC', chain: 'BTC', amount: '0.01', txID: 't2', status: 3, successAt: String(now - 7200e3) }];
    let r = await poll(h);
    const by = r.body.checked.find(x => x.provider === 'bybit');
    assert.strictEqual(by.ok, false); assert.ok(/прав|Permission/i.test(by.error), by.error);
    hist.failBybit = false;
    r = await poll(h);
    assert.strictEqual(tgSent.length, 0, tgSent.map(x => x.text).join(' | '));
    hist.bybitIdep = [{ id: 'i-1', type: 1, coin: 'ETH', amount: '0.1', status: 2, address: 'xxxx***@gmail.com', createdTime: String(Math.floor(now / 1000)), txID: 'int-1' }];
    hist.mexcWd = [{ id: 'mw-1', coin: 'USDT', network: 'BEP20(BSC)', address: '0x1234567890abcdef1234', amount: '50', transferType: 0, status: 7, transactionFee: '0.5', applyTime: now, updateTime: now }];
    r = await poll(h);
    const texts = tgSent.map(x => x.text).join('\n---\n');
    assert.strictEqual(tgSent.length, 2, texts);
    assert.ok(texts.includes('⬇️ <b>+0,1 ETH</b> на Bybit\nвнутрішній переказ · від xxxx***@gmail.com'), texts);
    assert.ok(texts.includes('⬆️ <b>−50 USDT</b> з MEXC\nмережа BEP20(BSC) · на 0x1234…1234 · комісія 0,5 USDT'), texts);
  });
  await test('poll: many transfers at once → one message; Telegram down → retried next run', async () => {
    freshEnv(EX_ENV); const h = reloadFin(); resetHist(); tgSent.length = 0;
    await poll(h); // запамʼятали порожню історію
    const now = Date.now();
    hist.bingxWd = [1, 2, 3, 4].map(i => ({ id: 'bw' + i, coin: 'USDT', network: 'TRC20', address: 'TXzz' + i, amount: String(10 * i), status: 6, transactionFee: '1', applyTime: now }));
    tgMode = 'down';
    let r = await poll(h);
    assert.strictEqual(r.body.sent, 0); assert.strictEqual(tgSent.length, 0); assert.strictEqual(r.body.sendError.code, 'server');
    tgMode = 'ok';
    r = await poll(h);
    assert.strictEqual(tgSent.length, 1, JSON.stringify(r.body));
    assert.ok(tgSent[0].text.startsWith('Рух коштів на біржах · 4'), tgSent[0].text);
    assert.strictEqual((tgSent[0].text.match(/⬆️/g) || []).length, 4);
  });
  await test('poll: app check reports which exchanges answer, without touching notifications', async () => {
    freshEnv(EX_ENV); const h = reloadFin(); resetHist(); tgSent.length = 0;
    hist.failBybit = true;
    hist.mexcDep = [{ coin: 'KAS', network: 'KAS', amount: '1', txId: 'z', status: 5, insertTime: Date.now() - 10e3 }];
    const r = await call(h, { user: { id: OWNER }, body: { action: 'transfers-check' } });
    const by = Object.fromEntries(r.body.providers.map(p => [p.provider, p]));
    assert.strictEqual(by.bybit.ok, false); assert.strictEqual(by.mexc.deposits, 1); assert.ok(by.bingx.ok);
    assert.ok(r.body.pollUrl.includes('hook=poll&k=')); assert.strictEqual(tgSent.length, 0);
    hist.failBybit = false;
    const p = await poll(h); // перший запуск після перевірки: свіже поповнення таки надсилається
    assert.strictEqual(p.body.sent, 1, JSON.stringify(p.body));
  });

  /* ===== Історія «Рух коштів» ===== */
  const fullLedgerProps = () => ({ 'Назва': { title: {} }, 'Сума': { number: {} }, 'Валюта': { select: {} }, 'USD': { number: {} }, 'Дата': { date: {} }, 'Тип': { select: {} }, 'Рахунок': { select: {} }, 'Опис': { rich_text: {} }, 'Банк ID': { rich_text: {} }, 'Telegram ID': { number: {} } });
  const ledgerRowsOf = id => [...pages.values()].filter(p => p.parent.database_id === id.replace(/-/g, '') && !p.archived);
  const ledgerRows = () => { const id = [...createdDbs.keys()][0]; return id ? [...pages.values()].filter(p => p.parent.database_id === id.replace(/-/g, '') && !p.archived) : []; };
  const prop = (p, n) => { const v = p.properties[n]; return v.title ? v.title[0].plain_text : v.rich_text ? (v.rich_text[0] || {}).plain_text : v.select ? v.select.name : v.date ? v.date.start : v.number; };
  await test('ledger: no access to the page with databases → clear 409 with what to do', async () => {
    freshEnv(ENV_FIN); const h = reloadFin(); notionOpts.parentAccess = false;
    const r = await call(h, { user: { id: OWNER }, body: { action: 'ledger-setup' } });
    notionOpts.parentAccess = true;
    assert.strictEqual(r.statusCode, 409); assert.ok(/Connections/.test(r.body.error), r.body.error); assert.strictEqual(createdDbs.size, 0);
  });
  await test('ledger: base created by hand as «Рух коштів» (title column «Name») is found; missing columns added', async () => {
    freshEnv(ENV_FIN); const h = reloadFin(); notionOpts.parentAccess = false;
    const id = uuid();
    createdDbs.set(id, { id, title: [{ plain_text: 'Рух коштів' }], properties: { 'Name': { type: 'title', title: {} }, 'Сума': { type: 'number', number: {} } }, parent: { type: 'workspace' } });
    dbSchemas[id] = createdDbs.get(id).properties;
    const r = await call(h, { user: { id: OWNER }, body: { action: 'ledger-setup' } });
    notionOpts.parentAccess = true;
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.id, id); assert.strictEqual(r.body.created, false);
    const props = createdDbs.get(id).properties;
    for (const col of ['Валюта', 'USD', 'Дата', 'Тип', 'Рахунок', 'Опис', 'Банк ID', 'Telegram ID']) assert.ok(props[col], col);
    // запис іде в колонку-заголовок «Name»
    const w = await call(h, { user: { id: OWNER }, body: { action: 'ledger-write', items: [{ bankId: 'mono:hand-1', title: 'Сільпо', amount: -100, currency: 'UAH', usd: -2.4, date: new Date().toISOString(), kind: 'expense', account: 'Чорна картка •1234', note: '' }] } });
    assert.strictEqual(w.body.created, 1, JSON.stringify(w.body));
    const row = [...pages.values()].find(p => p.parent.database_id === id.replace(/-/g, ''));
    assert.ok(row && row.properties['Name'] && row.properties['Name'].title[0].plain_text === 'Сільпо', JSON.stringify(row && row.properties));
    createdDbs.delete(id); for (const [pid, pg] of pages) if (pg.parent.database_id === id.replace(/-/g, '')) pages.delete(pid);
  });
  await test('ledger: setup creates «Рух коштів» next to the app databases; later found by title', async () => {
    freshEnv(ENV_FIN); let h = reloadFin();
    const before = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    assert.strictEqual(before.body.ledger.ready, false);
    const a = await call(h, { user: { id: OWNER }, body: { action: 'ledger-setup' } });
    assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body)); assert.strictEqual(a.body.created, true);
    const d = createdDbs.get(a.body.id);
    assert.strictEqual(d.parent.page_id, PARENT_PAGE); assert.strictEqual(d.title[0].plain_text, 'Rent·Control · Рух коштів');
    for (const col of ['Сума', 'Валюта', 'USD', 'Дата', 'Тип', 'Рахунок', 'Опис', 'Банк ID', 'Telegram ID']) assert.ok(d.properties[col], col);
    h = reloadFin(); // новий екземпляр функції: базу знаходить пошуком
    const b = await call(h, { user: { id: OWNER }, body: { action: 'ledger-setup' } });
    assert.strictEqual(b.body.created, false); assert.strictEqual(b.body.id, a.body.id); assert.strictEqual(createdDbs.size, 1);
    const st = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    assert.strictEqual(st.body.ledger.ready, true);
    const other = await call(h, { user: { id: OTHER }, body: { action: 'status' } });
    assert.strictEqual(other.body.ledger, undefined);
  });
  await test('ledger: webhook with history on writes every operation once — USD estimate, card, type', async () => {
    freshEnv(ENV_FIN); const h = reloadFin(); tgSent.length = 0;
    await call(h, { user: { id: OWNER }, body: { action: 'mono-webhook', log: true, import: false, notify: false } });
    assert.ok(webhookSet.endsWith('&imp=0&ntf=0&log=1'), webhookSet);
    const t = nowSec();
    const ops = [
      { id: 'L1', time: t, description: 'Сільпо', mcc: 5411, amount: -41750, operationAmount: -41750, currencyCode: 980, balance: 1100000 },
      { id: 'L2', time: t, description: 'Від: Олена К.', mcc: 4829, amount: 835000, operationAmount: 835000, currencyCode: 980, comment: 'оренда' },
      { id: 'L3', time: t, description: 'На банку «Відпустка»', mcc: 4829, amount: -100000, operationAmount: -100000, currencyCode: 980 },
      { id: 'L4', time: t, description: 'Банкомат', mcc: 6011, amount: -50000, operationAmount: -50000, currencyCode: 980 },
    ];
    for (const it of ops) { const r = await call(h, { method: 'POST', query: hookQuery(), body: hookBody(it) }); assert.strictEqual(r.body.logged, 1, JSON.stringify(r.body)); }
    const again = await call(h, { method: 'POST', query: hookQuery(), body: hookBody(ops[0]) });
    assert.strictEqual(again.body.logged, 0);
    const rows = ledgerRows().filter(p => prop(p, 'Банк ID').startsWith('mono:L'));
    assert.strictEqual(rows.length, 4); assert.strictEqual(tgSent.length, 0);
    const by = Object.fromEntries(rows.map(p => [prop(p, 'Банк ID'), p]));
    assert.strictEqual(prop(by['mono:L1'], 'Тип'), 'Покупка'); assert.strictEqual(prop(by['mono:L1'], 'Сума'), -417.5);
    assert.strictEqual(prop(by['mono:L1'], 'USD'), -10); assert.strictEqual(prop(by['mono:L1'], 'Рахунок'), 'Чорна картка •1234');
    assert.strictEqual(prop(by['mono:L2'], 'Тип'), 'Надходження'); assert.ok(prop(by['mono:L2'], 'Опис').includes('оренда'));
    assert.strictEqual(prop(by['mono:L3'], 'Тип'), 'Переказ'); assert.strictEqual(prop(by['mono:L4'], 'Тип'), 'Готівка');
    assert.strictEqual(prop(by['mono:L1'], 'Telegram ID'), OWNER);
    assert.strictEqual(expRows().filter(p => prop(p, 'Банк ID') === 'mono:L1').length, 0, 'imp=0 → no expense');
  });
  await test('ledger: month statement → entries; ledger-write validates and skips duplicates', async () => {
    freshEnv(ENV_FIN); const h = reloadFin();
    const r = await call(h, { user: { id: OWNER }, body: { action: 'mono-statement', account: 'accUAH', from: Date.now() - 20 * 864e5, to: Date.now() } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    const e = r.body.entries;
    assert.strictEqual(e.length, 4); assert.strictEqual(r.body.more, null);
    const pl = e.find(x => x.bankId === 'mono:tx3');
    assert.strictEqual(pl.amount, -1520); assert.strictEqual(pl.currency, 'UAH'); assert.ok(pl.note.startsWith('150 PLN'), pl.note); assert.strictEqual(pl.kind, 'expense');
    const evil = { bankId: 'x:1', amount: 'NaN', currency: 'uah', date: 'yesterday', kind: 'hack' };
    const w1 = await call(h, { user: { id: OWNER }, body: { action: 'ledger-write', items: [...e, evil] } });
    const w2 = await call(h, { user: { id: OWNER }, body: { action: 'ledger-write', items: e } });
    assert.strictEqual(w1.body.created, 4); assert.strictEqual(w1.body.invalid, 1);
    assert.strictEqual(w2.body.created, 0); assert.strictEqual(w2.body.duplicates, 4);
    const bad = await call(h, { user: { id: OWNER }, body: { action: 'mono-statement', account: '../etc' } });
    assert.strictEqual(bad.statusCode, 400);
  });
  await test('ledger: exchanges — history entries and 30-day sync; stablecoins 1:1, others by spot price', async () => {
    freshEnv(EX_ENV); const h = reloadFin(); resetHist();
    const now = Date.now();
    hist.bybitWd = [{ withdrawId: 'lw-1', coin: 'USDT', chain: 'TRX', amount: '300', txID: 'l-move', status: 'success', toAddress: 'TXabcdefghijklmnop1234', withdrawFee: '1', withdrawType: 0, createTime: String(now - 864e5), updateTime: String(now - 864e5) }];
    hist.bingxDep = [{ coin: 'TON', network: 'TON', amount: '10', txId: 'l-ton', status: 6, insertTime: now - 2 * 864e5 }];
    const hb = await call(h, { user: { id: OWNER }, body: { action: 'exchange-history', provider: 'bybit', from: now - 60 * 864e5, to: now } });
    assert.strictEqual(hb.statusCode, 200, JSON.stringify(hb.body));
    const w = hb.body.entries[0];
    assert.strictEqual(w.kind, 'withdrawal'); assert.strictEqual(w.amount, -300); assert.strictEqual(w.usd, -300); assert.strictEqual(w.account, 'Bybit');
    const s1 = await call(h, { user: { id: OWNER }, body: { action: 'ledger-sync' } });
    const s2 = await call(h, { user: { id: OWNER }, body: { action: 'ledger-sync' } });
    assert.strictEqual(s1.body.created, 2, JSON.stringify(s1.body)); assert.strictEqual(s2.body.created, 0); assert.strictEqual(s2.body.duplicates, 2);
    const ton = ledgerRows().find(p => prop(p, 'Банк ID').startsWith('bingx:dep:'));
    assert.strictEqual(prop(ton, 'Тип'), 'Поповнення біржі'); assert.strictEqual(prop(ton, 'USD'), 50); assert.strictEqual(prop(ton, 'Валюта'), 'TON');
    const none = await call(h, { user: { id: OWNER }, body: { action: 'exchange-history', provider: 'kraken' } });
    assert.strictEqual(none.statusCode, 400);
  });

  const handDb = (title, properties, extra = {}) => {
    const id = uuid();
    const props = {}; applyProps(props, properties);
    createdDbs.set(id, { id, title: [{ plain_text: title }], properties: props, parent: { type: 'workspace' }, ...extra });
    return id;
  };
  const dropDb = id => { createdDbs.delete(id); for (const [pid, pg] of pages) if (pg.parent.database_id === id.replace(/-/g, '')) pages.delete(pid); };
  const anEntry = n => ({ bankId: 'mono:hand-' + n, title: 'Сільпо', amount: -100, currency: 'UAH', usd: -2.4, date: new Date().toISOString(), kind: 'expense', account: 'Чорна картка •1234', note: '' });

  // далі — бази, створені «вручну»; базу з попередніх тестів ховаємо, щоб пошук за назвою її не знаходив
  const stashedDbs = new Map(createdDbs); createdDbs.clear();
  await test('ledger: DB_LEDGER may be a full Notion link, an ID with dashes, or a bare ID', async () => {
    const L = fresh(lib('_lib/ledger.js'));
    const id = '1a2b3c4d5e6f47a89b0c1d2e3f4a5b6c';
    assert.strictEqual(L.envLedgerId(`https://www.notion.so/myspace/Rukh-koshtiv-${id}?v=99999999999999999999999999999999&pvs=4`), id);
    assert.strictEqual(L.envLedgerId(`https://www.notion.so/${id}?v=abc`), id);
    assert.strictEqual(L.envLedgerId('1a2b3c4d-5e6f-47a8-9b0c-1d2e3f4a5b6c'), '1a2b3c4d-5e6f-47a8-9b0c-1d2e3f4a5b6c');
    assert.strictEqual(L.envLedgerId(` ${id.toUpperCase()} `), id);
    assert.strictEqual(L.envLedgerId(''), null);
  });

  await test('ledger: DB_LEDGER pasted as a link works for writes and for the app proxy', async () => {
    const id = handDb('Рух коштів', fullLedgerProps());
    freshEnv({ ...ENV_FIN, NOTION_TOKEN: 'secret_x', DB_LEDGER: `https://www.notion.so/me/Ruh-${id.replace(/-/g, '')}?v=0000000000000000000000000000000a` });
    const h = reloadFin();
    const st = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    assert.deepStrictEqual(st.body.ledger, { ready: true });
    const w = await call(h, { user: { id: OWNER }, body: { action: 'ledger-write', items: [anEntry(1)] } });
    assert.strictEqual(w.body.created, 1, JSON.stringify(w.body));
    const hp = fresh(notionPath);
    const q = await call(hp, { user: { id: OWNER }, body: { action: 'query', database: 'DB_LEDGER' } });
    assert.strictEqual(q.statusCode, 200, JSON.stringify(q.body)); assert.strictEqual(q.body.results.length, 1);
    dropDb(id);
  });

  await test('ledger: DB_LEDGER pointing at the page that holds the database finds the database inside', async () => {
    const id = handDb('Рух коштів', fullLedgerProps());
    const pageId = uuid();
    pageChildren.set(pageId, [{ object: 'block', id: uuid(), type: 'paragraph' }, { object: 'block', id, type: 'child_database', child_database: { title: 'Рух коштів' } }]);
    freshEnv({ ...ENV_FIN, DB_LEDGER: pageId }); const h = reloadFin();
    const st = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    assert.deepStrictEqual(st.body.ledger, { ready: true });
    const w = await call(h, { user: { id: OWNER }, body: { action: 'ledger-write', items: [anEntry(2)] } });
    assert.strictEqual(w.body.created, 1, JSON.stringify(w.body));
    pageChildren.delete(pageId); dropDb(id);
  });

  await test('ledger: wrong DB_LEDGER → falls back to the title; nothing found → status says why', async () => {
    const id = handDb('Рух коштів', fullLedgerProps());
    freshEnv({ ...ENV_FIN, DB_LEDGER: '0123456789abcdef0123456789abcdef' }); let h = reloadFin();
    let st = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    assert.deepStrictEqual(st.body.ledger, { ready: true }, JSON.stringify(st.body.ledger));
    dropDb(id);
    h = reloadFin();
    st = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    assert.strictEqual(st.body.ledger.ready, false); assert.ok(/DB_LEDGER/.test(st.body.ledger.error) && /Connections/.test(st.body.ledger.error), st.body.ledger.error);
    const set = await call(h, { user: { id: OWNER }, body: { action: 'ledger-setup' } });
    notionOpts.parentAccess = true;
    assert.ok(set.statusCode === 200 || set.statusCode === 409);
    if (set.body.created) dropDb(set.body.id);
  });

  await test('ledger: hand-made columns — renamed spelling, text numbers and date fixed, text choices kept', async () => {
    const id = handDb('Рух коштів', {
      'Назва': { title: {} }, 'сума': { rich_text: {} }, 'Валюта': { rich_text: {} }, 'USD': { number: {} }, 'Дата': { rich_text: {} },
      'Тип': { rich_text: {} }, 'Рахунок': { select: {} }, 'Опис': { rich_text: {} }, 'Банк Id': { rich_text: {} }, 'telegram id': { rich_text: {} },
    });
    freshEnv(ENV_FIN); const h = reloadFin();
    const st = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    assert.deepStrictEqual(st.body.ledger, { ready: true }, JSON.stringify(st.body.ledger));
    const props = createdDbs.get(id).properties;
    assert.strictEqual(props['Сума'].type, 'number'); assert.strictEqual(props['Дата'].type, 'date'); assert.strictEqual(props['Telegram ID'].type, 'number');
    assert.strictEqual(props['Банк ID'].type, 'rich_text'); assert.ok(!props['сума'] && !props['telegram id'] && !props['Банк Id']);
    assert.strictEqual(props['Валюта'].type, 'rich_text'); assert.strictEqual(props['Тип'].type, 'rich_text');
    const w = await call(h, { user: { id: OWNER }, body: { action: 'ledger-write', items: [anEntry(3)] } });
    assert.strictEqual(w.body.created, 1, JSON.stringify(w.body));
    const row = ledgerRowsOf(id)[0];
    assert.strictEqual(prop(row, 'Валюта'), 'UAH'); assert.strictEqual(prop(row, 'Тип'), 'Покупка'); assert.strictEqual(prop(row, 'Рахунок'), 'Чорна картка •1234');
    assert.ok(row.properties['Валюта'].rich_text && row.properties['Рахунок'].select, 'text column gets text, select column gets select');
    dropDb(id);
  });

  await test('ledger: column type Notion refuses to change → clear 409 with the column and the type to set', async () => {
    const id = handDb('Рух коштів', { ...fullLedgerProps(), 'Сума': { rich_text: {} } });
    freshEnv(ENV_FIN); const h = reloadFin(); notionOpts.rejectTypeChange = true;
    const st = await call(h, { user: { id: OWNER }, body: { action: 'status' } });
    const set = await call(h, { user: { id: OWNER }, body: { action: 'ledger-setup' } });
    const w = await call(h, { user: { id: OWNER }, body: { action: 'ledger-write', items: [anEntry(4)] } });
    notionOpts.rejectTypeChange = false;
    assert.strictEqual(st.body.ledger.ready, false); assert.strictEqual(st.body.ledger.code, 'ledger-schema');
    assert.ok(/«Сума» має тип Text, а треба Number/.test(st.body.ledger.error), st.body.ledger.error);
    assert.strictEqual(set.statusCode, 409); assert.ok(/«Сума»/.test(set.body.error), set.body.error);
    assert.strictEqual(w.statusCode, 409, 'not 400/404: the app must not mark the month as done'); assert.strictEqual(w.body.code, 'ledger-schema');
    dropDb(id);
  });

  await test('ledger: Notion rejects the page → 409 «ledger-write» with a readable reason', async () => {
    const id = handDb('Рух коштів', fullLedgerProps());
    freshEnv(ENV_FIN); const h = reloadFin(); notionOpts.failPages = 'Сума is expected to be number.';
    const w = await call(h, { user: { id: OWNER }, body: { action: 'ledger-write', items: [anEntry(5)] } });
    notionOpts.failPages = null;
    assert.strictEqual(w.statusCode, 409); assert.strictEqual(w.body.code, 'ledger-write'); assert.ok(/Notion не прийняв запис/.test(w.body.error), w.body.error);
    dropDb(id);
  });

  for (const [k, v] of stashedDbs) createdDbs.set(k, v);
  await test('ledger: app reads «Рух коштів» through the Notion proxy — only own rows', async () => {
    freshEnv({ ...ENV_FIN, NOTION_TOKEN: 'secret_x' });
    fresh(lib('_lib/ledger.js')); const h = fresh(notionPath);
    const own = await call(h, { user: { id: OWNER }, body: { action: 'query', database: 'DB_LEDGER' } });
    const other = await call(h, { user: { id: OTHER }, body: { action: 'query', database: 'DB_LEDGER' } });
    assert.strictEqual(own.statusCode, 200, JSON.stringify(own.body)); assert.ok(own.body.results.length >= 6, own.body.results.length);
    assert.strictEqual(other.body.results.length, 0);
  });

  console.log(results.join('\n'));
  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
