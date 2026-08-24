// Vercel serverless function: proxy для Notion API
// Безпека: ENV NOTION_TOKEN ніколи не йде у браузер.
// Whitelist баз: тільки ці ключі дозволені для запитів.

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
  DB_PAYOUTS:         process.env.DB_PAYOUTS
};

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not set' });

  try {
    const body = req.body || {};
    const { action, database, pageId, properties, cursor, sorts, filter } = body;

    // resolve database id (only via whitelist)
    let dbId = null;
    if (database) {
      dbId = DB_WHITELIST[database];
      if (!dbId) return res.status(400).json({ error: 'Bad or missing database: ' + database });
    }

    let url, method = 'POST', payload = null;

    if (action === 'query') {
      url = `${NOTION_API}/databases/${dbId}/query`;
      payload = {};
      if (cursor) payload.start_cursor = cursor;
      if (sorts) payload.sorts = sorts;
      if (filter) payload.filter = filter;
    } else if (action === 'create') {
      url = `${NOTION_API}/pages`;
      payload = {
        parent: { database_id: dbId },
        properties: properties || {}
      };
    } else if (action === 'update') {
      if (!pageId) return res.status(400).json({ error: 'pageId required' });
      url = `${NOTION_API}/pages/${pageId}`;
      method = 'PATCH';
      payload = { properties: properties || {} };
    } else if (action === 'archive') {
      if (!pageId) return res.status(400).json({ error: 'pageId required' });
      url = `${NOTION_API}/pages/${pageId}`;
      method = 'PATCH';
      payload = { archived: true };
    } else {
      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    const notionRes = await fetch(url, {
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await notionRes.json();
    return res.status(notionRes.status).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
};
