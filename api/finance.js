// Банки й біржі для Rent·Control.
// Ключі лежать тільки у змінних середовища Vercel; у браузер не потрапляють.
// Доступ: запит, підписаний Telegram (TG_BOT_TOKEN), і лише від власника (OWNER_TG_ID).
// Винятки — вебхук Монобанку й щохвилинна перевірка бірж: їх захищає секрет в адресі.
const { authFromRequest, isOwner, parseIds } = require('./_lib/telegram');
const mono = require('./_lib/mono');
const { EXCHANGES, spotPrices } = require('./_lib/exchanges');
const ledger = require('./_lib/ledger');
const expenses = require('./_lib/expenses');
const { suggestCategory } = require('./_lib/categorize');
const tg = require('./_lib/tgbot');
const { monoMessage } = require('./_lib/notify');
const transfers = require('./_lib/transfers');

const ownerId = () => parseIds(process.env.OWNER_TG_ID)[0] || null;

function errOut(e) {
  return { ok: false, code: e.code || 'error', error: e.message || 'Помилка' };
}

// Скільки доларів в одиниці валюти (за курсами Монобанку) — для оцінки операцій у USD
async function usdConverter(currencies) {
  const out = {};
  let uahPerUsd = null;
  try { uahPerUsd = await mono.uahRate('USD'); } catch { uahPerUsd = null; }
  for (const c of new Set(currencies)) {
    if (c === 'USD') out[c] = 1;
    else if (!uahPerUsd) out[c] = null;
    else if (c === 'UAH') out[c] = 1 / uahPerUsd;
    else { try { out[c] = (await mono.uahRate(c)) / uahPerUsd; } catch { out[c] = null; } }
  }
  return c => (out[c] !== undefined ? out[c] : null);
}

async function priceFn() {
  const prices = await spotPrices().catch(() => new Map());
  return coin => prices.get(String(coin).toUpperCase()) || null;
}

function status(auth) {
  const env = process.env;
  const owner = auth.mode === 'on' ? isOwner(auth.userId) : false;
  // іншим користувачам застосунку не розповідаємо, які банки й біржі підключив власник
  const hide = auth.mode === 'on' && !owner;
  return {
    auth: auth.mode,
    owner,
    setup: { bot: !!env.TG_BOT_TOKEN, owner: !!ownerId(), expensesDb: !!env.DB_EXPENSES, categoriesDb: !!env.DB_CAT_EXPENSES },
    providers: hide ? {} : {
      mono: !!env.MONO_TOKEN,
      bybit: EXCHANGES.bybit.configured(),
      bingx: EXCHANGES.bingx.configured(),
      mexc: EXCHANGES.mexc.configured(),
      enablebanking: !!(env.ENABLEBANKING_APP_ID && env.ENABLEBANKING_PRIVATE_KEY),
    },
    region: env.VERCEL_REGION || null,
    // сповіщення в бот: адреса для cron-job.org містить секрет, тож лише власнику
    notify: owner ? { bot: !!env.TG_BOT_TOKEN, pollUrl: transfers.pollUrl(auth.host) } : null,
  };
}

// Усі баланси паралельно; помилка одного сервісу не ламає решту
async function balances(only) {
  const want = name => !only || only.includes(name);
  const jobs = [];
  if (process.env.MONO_TOKEN && want('mono')) jobs.push(mono.balances().catch(e => ({ provider: 'mono', label: 'Монобанк', ...errOut(e) })));
  for (const [name, ex] of Object.entries(EXCHANGES)) {
    if (ex.configured() && want(name)) jobs.push(ex.balances().catch(e => ({ provider: name, label: ex.label, ...errOut(e) })));
  }
  const results = await Promise.all(jobs);
  return { providers: results, fetchedAt: Date.now() };
}

// Виписка Монобанку за період → кандидати з підказкою категорії й позначкою «вже записано»
async function monoPreview({ account, days = 31 }) {
  if (!account || !/^[\w-]{6,80}$/.test(account)) throw Object.assign(new Error('Не вказано рахунок'), { status: 400 });
  const owner = ownerId();
  const info = await mono.clientInfo({ maxAgeMs: 10 * 60e3 });
  const acc = (info.accounts || []).find(a => a.id === account) || (info.jars || []).find(j => j.id === account);
  const accCur = acc ? mono.curOf(acc.currencyCode) : null;
  const to = Math.floor(Date.now() / 1000);
  const from = to - Math.min(31, Math.max(1, Number(days) || 31)) * 86400 + 3600;
  const list = await mono.statement(account, from, to);
  const categories = owner ? await expenses.loadCategories(owner) : [];
  const existing = owner && process.env.DB_EXPENSES ? await expenses.existingBankIds(owner, 'mono:', mono.localDate(from - 86400)).catch(() => new Set()) : new Set();
  const items = [];
  for (const it of Array.isArray(list) ? list : []) {
    const c = mono.toCandidate(it, accCur);
    const e = c.kind === 'expense' ? await expenses.toExpense(c, { categories, uahRate: mono.uahRate }).catch(() => null) : null;
    items.push({
      bankId: c.bankId, date: c.date, title: c.title, kind: c.kind, mcc: c.mcc, hold: c.hold,
      accountCurrency: c.accountCurrency, amountAccount: c.amountAccount, opCurrency: c.opCurrency, amountOp: c.amountOp,
      expense: e, exists: existing.has(c.bankId),
    });
  }
  return { account, currency: accCur, items, categories: categories.map(c => ({ id: c.id, name: c.name })) };
}

// Вебхук Монобанку: оплата карткою → витрата в Expense·Control (imp=1), кожна операція → повідомлення в бот (ntf=1)
const notified = new Map(); // id операції → час: Монобанк повторює запит, якщо ми відповіли повільно

async function accountMetaFor(account) {
  let meta = mono.accountMeta.get(account);
  if (!meta) {
    try { await mono.clientInfo({ maxAgeMs: 6 * 3600e3 }); meta = mono.accountMeta.get(account); } catch { /* обійдемось без назви */ }
  }
  return meta || null;
}

async function monoHook(req, res) {
  const secret = mono.hookSecret();
  const q = req.query || {};
  if (!secret || q.k !== secret) return res.status(403).json({ ok: false });
  if (req.method === 'GET') return res.status(200).send('ok'); // Монобанк перевіряє адресу GET-запитом
  if (req.method !== 'POST') return res.status(405).end();
  const body = req.body || {};
  const item = body.data && body.data.statementItem;
  if (body.type !== 'StatementItem' || !item) return res.status(200).json({ ok: true, skipped: 'type' });
  const flags = mono.hookFlags(q);
  const owner = ownerId();
  if (!owner) return res.status(200).json({ ok: true, skipped: 'setup' });

  const meta = await accountMetaFor(body.data.account);
  const c = mono.toCandidate(item, meta && meta.currency);
  const out = { ok: true };

  // 1) витрата в Expense·Control і 2) запис в історію «Рух коштів» — паралельно
  let imported = null;
  const importTask = async () => {
    if (!(flags.imp && c.kind === 'expense' && process.env.DB_EXPENSES)) { if (c.kind !== 'expense') out.skipped = c.kind; return; }
    const categories = await expenses.loadCategories(owner).catch(() => []);
    const e = await expenses.toExpense(c, { categories, uahRate: mono.uahRate });
    if (!e) { out.skipped = 'currency'; return; }
    const r = await expenses.importExpenses([e], owner);
    const cat = e.categoryId && categories.find(x => x.id === e.categoryId);
    imported = { created: r.created.length, duplicate: r.duplicates.length, category: cat ? cat.name : null };
    out.created = r.created.length; out.duplicate = r.duplicates.length;
  };
  const logTask = async () => {
    if (!flags.log || !meta) return;
    const toUsd = await usdConverter([meta.currency]);
    const entry = ledger.monoEntry(item, { accCur: meta.currency, opCur: c.opCurrency, label: meta.label, toUsd });
    const r = await ledger.append([entry], owner);
    out.logged = r.missing ? 'no-ledger' : r.created;
  };
  const results = await Promise.allSettled([importTask(), logTask()]);
  const failed = results.filter(r => r.status === 'rejected').map(r => r.reason);
  for (const e of failed) console.error('mono webhook failed', e && e.message);
  // 5xx — Монобанк повторить спробу пізніше (тимчасовий збій Notion); повідомлення надішлемо тоді ж.
  // Повтор безпечний: і витрати, і історія відсіюють дублікати за «Банк ID».
  if (failed.some(e => e && e.status >= 500)) return res.status(502).json({ ok: false });

  // 2) повідомлення в бот — після запису, щоб показати категорію; повтор тієї ж операції не дублюємо
  if (flags.ntf && process.env.TG_BOT_TOKEN) {
    const now = Date.now();
    for (const [k, t] of notified) if (now - t > 6 * 3600e3) notified.delete(k);
    const repeat = notified.has(item.id) || (imported && imported.duplicate && !imported.created);
    if (!repeat) {
      const accCur = c.accountCurrency;
      const balance = typeof item.balance === 'number' && meta ? item.balance / 100 - (meta.creditLimit || 0) : null;
      const text = monoMessage({
        amount: (item.amount || 0) / 100, accCur, opAmount: c.amountOp, opCur: c.opCurrency,
        title: c.title, counterName: item.counterName, comment: item.comment,
        label: meta ? meta.label : 'Монобанк', balance, kind: c.kind,
        imported: !!(imported && imported.created), category: imported && imported.category,
      });
      const r = await tg.sendMessage(owner, text);
      out.notified = r.ok;
      if (r.ok) notified.set(item.id, now);
      else console.error('telegram notify failed', r.code, r.error);
    } else out.notified = 'repeat';
  }
  return res.status(200).json(out);
}

// Щохвилинна перевірка бірж (cron-job.org): нові поповнення й виведення → повідомлення в бот
async function pollHook(req, res) {
  const secret = transfers.pollSecret();
  if (!secret || (req.query || {}).k !== secret) return res.status(403).json({ ok: false });
  const owner = ownerId();
  if (!owner) return res.status(200).json({ ok: true, skipped: 'setup' });
  if (!transfers.configured().length) return res.status(200).json({ ok: true, skipped: 'no-exchanges' });
  const r = await transfers.poll({
    send: text => tg.sendMessage(owner, text),
    onFresh: async fresh => {
      if (!(await ledger.findLedger().catch(() => null))) return;
      const price = await priceFn();
      await ledger.append(fresh.map(e => ledger.transferEntry(e, { priceUSD: price })), owner).catch(e => console.error('ledger append failed', e && e.message));
    },
  });
  return res.status(200).json({ ok: true, ...r });
}

module.exports = async (req, res) => {
  if (req.query && req.query.hook === 'mono') return monoHook(req, res);
  if (req.query && req.query.hook === 'poll') return pollHook(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = authFromRequest(req);
  res.setHeader('X-RC-Auth', auth.mode);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, reason: auth.reason });

  const body = req.body || {};
  if (body.action === 'status') {
    const st = status({ ...auth, host: req.headers['x-forwarded-host'] || req.headers.host });
    // база «Рух коштів» (історія й аналітика) — лише власнику
    // (з причиною, якщо база не підходить: немає доступу, не ті типи колонок, хибний DB_LEDGER)
    if (st.owner) st.ledger = await ledger.health({ fresh: !!body.fresh });
    return res.status(200).json(st);
  }

  // Банківські дані — тільки з увімкненим захистом і тільки власнику ключів
  if (auth.mode !== 'on') return res.status(412).json({ error: 'Спершу увімкни захист: додай TG_BOT_TOKEN і OWNER_TG_ID у Vercel', code: 'setup-auth' });
  if (!ownerId()) return res.status(412).json({ error: 'Додай OWNER_TG_ID у Vercel', code: 'setup-owner' });
  if (!isOwner(auth.userId)) return res.status(403).json({ error: 'Ці дані бачить лише власник', code: 'not-owner' });

  try {
    switch (body.action) {
      case 'balances':
        return res.status(200).json(await balances(Array.isArray(body.only) ? body.only : null));

      case 'mono-webhook': {
        // { log, import, notify } — що робити з операціями; усе вимкнено → вебхук знімаємо
        const imp = body.import !== undefined ? !!body.import : body.enable !== false;
        const ntf = !!body.notify;
        const log = !!body.log;
        const url = imp || ntf || log ? mono.hookUrl(req.headers['x-forwarded-host'] || req.headers.host, { imp, ntf, log }) : '';
        await mono.setWebhook(url);
        return res.status(200).json({ ok: true, webhook: url ? 'on' : 'off', hookImport: !!url && imp, hookNotify: !!url && ntf, hookLog: !!url && log });
      }

      case 'ledger-setup':
        try {
          return res.status(200).json({ ok: true, ...(await ledger.setupLedger()) });
        } catch (e) {
          return res.status(409).json({ error: ledger.humanError(e), code: e.code || 'ledger-error' });
        }

      case 'ledger-write': {
        const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
        let r;
        // помилку запису в Notion віддаємо окремим кодом: застосунок не має плутати її з «банк не віддав період»
        try { r = await ledger.append(items, ownerId()); } catch (e) {
          console.error('ledger write failed', e.status, e.message);
          return res.status(409).json({ error: ledger.humanError(e), code: e.code || 'ledger-write' });
        }
        if (r.missing) return res.status(409).json({ error: 'Базу «Рух коштів» ще не створено', code: 'ledger-missing' });
        return res.status(200).json({ ok: true, ...r });
      }

      case 'mono-statement': {
        // Виписка за період (≤ 31 доби) → записи для історії. Монобанк дає 1 запит на хвилину.
        const account = String(body.account || '');
        if (!/^[\w-]{6,80}$/.test(account)) return res.status(400).json({ error: 'Не вказано рахунок' });
        const now = Math.floor(Date.now() / 1000);
        let to = Math.min(Math.floor(Number(body.to) / 1000) || now, now);
        let from = Math.floor(Number(body.from) / 1000) || to - 31 * 86400;
        if (to - from > 31 * 86400 + 3600) from = to - 31 * 86400;
        if (from >= to) return res.status(200).json({ entries: [], more: null });
        let meta = mono.accountMeta.get(account);
        if (!meta) { await mono.clientInfo({ maxAgeMs: 10 * 60e3 }); meta = mono.accountMeta.get(account); }
        if (!meta) return res.status(404).json({ error: 'Немає такого рахунку в Монобанку' });
        const list = await mono.statementCached(account, from, to);
        const toUsd = await usdConverter([meta.currency]);
        const entries = list.map(it => ledger.monoEntry(it, { accCur: meta.currency, opCur: mono.curOf(it.currencyCode), label: meta.label, toUsd }));
        // понад 500 операцій Монобанк віддає частинами: наступна частина — до найстаршої з цих
        const more = list.length >= 500 ? { to: Math.min(...list.map(x => Number(x.time) || now)) * 1000 } : null;
        return res.status(200).json({ entries, more, account: meta.label });
      }

      case 'exchange-history': {
        const name = String(body.provider || '');
        const ex = EXCHANGES[name];
        if (!ex || !ex.configured()) return res.status(400).json({ error: 'Біржу не підключено' });
        const to = Math.min(Number(body.to) || Date.now(), Date.now());
        const span = Math.min(Math.max(to - (Number(body.from) || 0), 60e3), 30 * 864e5 - 60e3); // Bybit дозволяє до 30 днів
        const events = await ex.transfers(to, span);
        const price = await priceFn();
        return res.status(200).json({ entries: events.map(e => ledger.transferEntry(e, { priceUSD: price })) });
      }

      case 'ledger-sync': {
        // поповнення й виведення за останні 30 днів з усіх бірж → в історію (дублікати пропускаються)
        if (!(await ledger.findLedger())) return res.status(409).json({ error: 'Базу «Рух коштів» ще не створено', code: 'ledger-missing' });
        const names = transfers.configured();
        const now = Date.now();
        const settled = await Promise.allSettled(names.map(n => EXCHANGES[n].transfers(now, 30 * 864e5 - 60e3)));
        const price = await priceFn();
        const entries = settled.flatMap(x => (x.status === 'fulfilled' ? x.value.map(e => ledger.transferEntry(e, { priceUSD: price })) : []));
        let r;
        try { r = await ledger.append(entries, ownerId()); } catch (e) {
          console.error('ledger sync failed', e.status, e.message);
          return res.status(409).json({ error: ledger.humanError(e), code: e.code || 'ledger-write' });
        }
        return res.status(200).json({ ok: true, created: r.created, duplicates: r.duplicates, remaining: r.remaining, errors: names.filter((n, i) => settled[i].status === 'rejected') });
      }

      case 'notify-test': {
        const r = await tg.sendMessage(ownerId(), '✅ <b>Rent·Control</b>: сповіщення працюють.\nСюди приходитимуть операції Монобанку, поповнення й виведення на біржах.');
        if (r.ok) return res.status(200).json({ ok: true });
        return res.status(r.code === 'forbidden' || r.code === 'token' ? 424 : 502).json({ error: tg.HINT[r.code] || r.error || 'Telegram не прийняв повідомлення', code: 'tg-' + r.code });
      }

      case 'transfers-check':
        return res.status(200).json({ providers: await transfers.check(), pollUrl: transfers.pollUrl(req.headers['x-forwarded-host'] || req.headers.host) });

      case 'mono-preview':
        return res.status(200).json(await monoPreview(body));

      case 'expenses-import': {
        const items = Array.isArray(body.items) ? body.items.slice(0, 25) : [];
        const r = await expenses.importExpenses(items, ownerId());
        return res.status(200).json({ ok: true, ...r });
      }

      case 'suggest': {
        // підказка категорії для довільної операції (для перевірок у застосунку)
        const categories = await expenses.loadCategories(ownerId());
        return res.status(200).json({ categoryId: suggestCategory(body.tx || {}, categories) });
      }

      default:
        return res.status(400).json({ error: 'Unknown action: ' + body.action });
    }
  } catch (e) {
    const code = e.code || 'error';
    // 424 — проблема з ключем самого сервісу (не плутати з 401 «не через Telegram»)
    const st = e.status || (code === 'rate' ? 429 : code === 'auth' || code === 'ip' || code === 'expired' ? 424 : code === 'setup' ? 412 : 502);
    return res.status(st).json({ error: e.message || 'Помилка', code });
  }
};
