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
  if (f.date) { const d = v && v.date && v.date.start; return !!d && d >= f.date.on_or_after; }
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
routes.push({
  match: c => c.host === 'api.notion.com',
  reply: c => {
    let m;
    if ((m = c.path.match(/^\/v1\/databases\/([^/]+)\/query$/))) {
      const db = m[1].replace(/-/g, '');
      const list = [...pages.values()].filter(p => p.parent.database_id === db && !p.archived && evalFilter(c.body && c.body.filter, p));
      return { body: { results: list, has_more: false, next_cursor: null } };
    }
    if ((m = c.path.match(/^\/v1\/databases\/([^/]+)$/))) {
      const db = Object.values(DB).find(d => d === m[1] || d.replace(/-/g, '') === m[1].replace(/-/g, ''));
      if (c.method === 'PATCH') { Object.assign(dbSchemas[db], c.body.properties); return { body: { properties: dbSchemas[db] } }; }
      return { body: { properties: dbSchemas[db] || {} } };
    }
    if (c.path === '/v1/pages' && c.method === 'POST') {
      const db = c.body.parent.database_id;
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
      if (c.path === '/bank/currency') return { body: [{ currencyCodeA: 978, currencyCodeB: 980, rateBuy: 45, rateSell: 46 }] };
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
  const reloadFin = () => { for (const m of ['_lib/mono.js', '_lib/expenses.js', '_lib/exchanges.js']) fresh(lib(m)); return fresh(finPath); };

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
    assert.ok(/^https:\/\/rent\.example\.app\/api\/finance\?hook=mono&k=[0-9a-f]{32}$/.test(webhookSet), webhookSet);
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
    { match: c => c.host === 'api.mexc.com' && c.path === '/api/v3/ticker/price', reply: () => ({ body: [{ symbol: 'PEPEUSDT', price: '0.00001' }] }) },
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

  console.log(results.join('\n'));
  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
