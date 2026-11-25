// Банки й біржі для Rent·Control.
// Ключі лежать тільки у змінних середовища Vercel; у браузер не потрапляють.
// Доступ: запит, підписаний Telegram (TG_BOT_TOKEN), і лише від власника (OWNER_TG_ID).
// Виняток — вебхук Монобанку: його захищає секрет в адресі, виведений з MONO_TOKEN.
const { authFromRequest, isOwner, parseIds } = require('./_lib/telegram');
const mono = require('./_lib/mono');
const { EXCHANGES } = require('./_lib/exchanges');
const expenses = require('./_lib/expenses');
const { suggestCategory } = require('./_lib/categorize');

const ownerId = () => parseIds(process.env.OWNER_TG_ID)[0] || null;

function errOut(e) {
  return { ok: false, code: e.code || 'error', error: e.message || 'Помилка' };
}

function status(auth) {
  const env = process.env;
  return {
    auth: auth.mode,
    owner: auth.mode === 'on' ? isOwner(auth.userId) : false,
    setup: { bot: !!env.TG_BOT_TOKEN, owner: !!ownerId(), expensesDb: !!env.DB_EXPENSES, categoriesDb: !!env.DB_CAT_EXPENSES },
    providers: {
      mono: !!env.MONO_TOKEN,
      bybit: EXCHANGES.bybit.configured(),
      bingx: EXCHANGES.bingx.configured(),
      mexc: EXCHANGES.mexc.configured(),
      enablebanking: !!(env.ENABLEBANKING_APP_ID && env.ENABLEBANKING_PRIVATE_KEY),
    },
    region: env.VERCEL_REGION || null,
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

// Вебхук Монобанку: кожна оплата карткою одразу стає витратою в Expense·Control
async function monoHook(req, res) {
  const secret = mono.hookSecret();
  const k = req.query && req.query.k;
  if (!secret || k !== secret) return res.status(403).json({ ok: false });
  if (req.method === 'GET') return res.status(200).send('ok'); // Монобанк перевіряє адресу GET-запитом
  if (req.method !== 'POST') return res.status(405).end();
  const body = req.body || {};
  const item = body.data && body.data.statementItem;
  if (body.type !== 'StatementItem' || !item) return res.status(200).json({ ok: true, skipped: 'type' });
  const owner = ownerId();
  if (!owner || !process.env.DB_EXPENSES) return res.status(200).json({ ok: true, skipped: 'setup' });
  try {
    let accCur = mono.accountCurrency.get(body.data.account);
    if (!accCur) {
      try { await mono.clientInfo({ maxAgeMs: 6 * 3600e3 }); accCur = mono.accountCurrency.get(body.data.account); } catch { /* вгадаємо */ }
    }
    const c = mono.toCandidate(item, accCur);
    if (c.kind !== 'expense') return res.status(200).json({ ok: true, skipped: c.kind });
    const categories = await expenses.loadCategories(owner).catch(() => []);
    const e = await expenses.toExpense(c, { categories, uahRate: mono.uahRate });
    if (!e) return res.status(200).json({ ok: true, skipped: 'currency' });
    const r = await expenses.importExpenses([e], owner);
    return res.status(200).json({ ok: true, created: r.created.length, duplicate: r.duplicates.length });
  } catch (e) {
    console.error('mono webhook failed', e && e.message);
    // 5xx — Монобанк повторить спробу пізніше (тимчасовий збій Notion)
    return res.status(e && e.status >= 500 ? 502 : 200).json({ ok: false });
  }
}

module.exports = async (req, res) => {
  if (req.query && req.query.hook === 'mono') return monoHook(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = authFromRequest(req);
  res.setHeader('X-RC-Auth', auth.mode);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, reason: auth.reason });

  const body = req.body || {};
  if (body.action === 'status') return res.status(200).json(status(auth));

  // Банківські дані — тільки з увімкненим захистом і тільки власнику ключів
  if (auth.mode !== 'on') return res.status(412).json({ error: 'Спершу увімкни захист: додай TG_BOT_TOKEN і OWNER_TG_ID у Vercel', code: 'setup-auth' });
  if (!ownerId()) return res.status(412).json({ error: 'Додай OWNER_TG_ID у Vercel', code: 'setup-owner' });
  if (!isOwner(auth.userId)) return res.status(403).json({ error: 'Ці дані бачить лише власник', code: 'not-owner' });

  try {
    switch (body.action) {
      case 'balances':
        return res.status(200).json(await balances(Array.isArray(body.only) ? body.only : null));

      case 'mono-webhook': {
        const url = body.enable === false ? '' : mono.hookUrl(req.headers['x-forwarded-host'] || req.headers.host);
        await mono.setWebhook(url);
        return res.status(200).json({ ok: true, webhook: url ? 'on' : 'off' });
      }

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
