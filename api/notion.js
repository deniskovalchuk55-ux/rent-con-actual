// Vercel serverless function: проксі для Notion API
// Безпека:
// - NOTION_TOKEN ніколи не йде у браузер;
// - тільки бази з білого списку;
// - коли задано TG_BOT_TOKEN: запит має бути підписаний Telegram (initData), а сервер сам
//   обмежує записи Telegram ID користувача: читає лише свої, створює зі своїм ID,
//   змінює й архівує тільки свої сторінки з цих баз.
const { authFromRequest } = require('./_lib/telegram');
const ledger = require('./_lib/ledger');

const DB_WHITELIST = {
  // === Expense·Control ===
  DB_EXPENSES:        process.env.DB_EXPENSES,
  DB_INCOMES:         process.env.DB_INCOMES,
  DB_CAT_EXPENSES:    process.env.DB_CAT_EXPENSES,
  DB_CAT_INCOMES:     process.env.DB_CAT_INCOMES,
  DB_REGULARS:        process.env.DB_REGULARS,
  // === Rent·Control ===
  DB_CLIENTS:         process.env.DB_CLIENTS,
  DB_PAYMENTS:        process.env.DB_PAYMENTS,
  DB_WORK_ENTRIES:    process.env.DB_WORK_ENTRIES,
  DB_WORK_CATEGORIES: process.env.DB_WORK_CATEGORIES,
  DB_PAYOUTS:         process.env.DB_PAYOUTS,
  // === Цілі ===
  DB_GOALS:           process.env.DB_GOALS,
  DB_GOAL_TX:         process.env.DB_GOAL_TX,
  // === Активи ===
  DB_ASSETS:          process.env.DB_ASSETS,
  DB_ASSET_TX:        process.env.DB_ASSET_TX,
  // === Рух коштів (історія банків і бірж) — змінна необовʼязкова, базу знаходимо за назвою ===
  DB_LEDGER:          process.env.DB_LEDGER
};

// Категорії Expense·Control бувають спільними (без Telegram ID) — їх бачать усі
const SHARED_FLAG = { DB_CAT_EXPENSES: 'Загальна', DB_CAT_INCOMES: 'Загальна' };
const TG_COL = 'Telegram ID';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const norm = id => String(id || '').replace(/-/g, '').toLowerCase();

async function notion(token, path, method, payload) {
  const r = await fetch(NOTION_API + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
  let data = null;
  try { data = await r.json(); } catch { data = { error: 'Bad JSON from Notion' }; }
  return { status: r.status, data };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not set' });

  const auth = authFromRequest(req);
  res.setHeader('X-RC-Auth', auth.mode);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, reason: auth.reason });
  const uid = auth.mode === 'on' ? auth.userId : null;

  try {
    const body = req.body || {};
    const { action, database, pageId, cursor, sorts, filter } = body;
    const properties = body.properties && typeof body.properties === 'object' ? { ...body.properties } : {};

    // resolve database id (only via whitelist)
    let dbId = null;
    if (database) {
      dbId = DB_WHITELIST[database];
      if (!dbId && database === 'DB_LEDGER') dbId = await ledger.findLedger().catch(() => null);
      if (!dbId) return res.status(400).json({ error: 'Bad or missing database: ' + database });
    }

    if (action === 'query') {
      if (!dbId) return res.status(400).json({ error: 'database required' });
      const payload = {};
      if (cursor) payload.start_cursor = cursor;
      if (sorts) payload.sorts = sorts;
      let f = filter || null;
      if (uid != null) {
        const own = { property: TG_COL, number: { equals: uid } };
        const flag = SHARED_FLAG[database];
        const scope = flag ? { or: [own, { property: flag, checkbox: { equals: true } }] } : own;
        f = f ? { and: [f, scope] } : scope;
      }
      if (f) payload.filter = f;
      const r = await notion(token, `/databases/${dbId}/query`, 'POST', payload);
      return res.status(r.status).json(r.data);
    }

    if (action === 'create') {
      if (!dbId) return res.status(400).json({ error: 'database required' });
      if (uid != null) properties[TG_COL] = { number: uid };
      const r = await notion(token, '/pages', 'POST', { parent: { database_id: dbId }, properties });
      return res.status(r.status).json(r.data);
    }

    if (action === 'update' || action === 'archive') {
      if (!pageId || !/^[0-9a-f-]{32,36}$/i.test(String(pageId))) return res.status(400).json({ error: 'pageId required' });
      if (uid != null) {
        // змінювати можна тільки свої записи з наших баз
        const page = await notion(token, `/pages/${pageId}`, 'GET');
        if (page.status !== 200) return res.status(page.status).json(page.data);
        const parent = page.data.parent && page.data.parent.database_id;
        const ledgerId = await ledger.findLedger().catch(() => null);
        const allowed = [...Object.values(DB_WHITELIST), ledgerId].filter(Boolean).map(norm);
        if (!parent || !allowed.includes(norm(parent))) return res.status(403).json({ error: 'Немає доступу до цього запису' });
        const ownerProp = page.data.properties && page.data.properties[TG_COL];
        if (!ownerProp || ownerProp.number !== uid) return res.status(403).json({ error: 'Немає доступу до цього запису' });
        if (action === 'update') properties[TG_COL] = { number: uid };
      }
      const payload = action === 'archive' ? { archived: true } : { properties };
      const r = await notion(token, `/pages/${pageId}`, 'PATCH', payload);
      return res.status(r.status).json(r.data);
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
};
