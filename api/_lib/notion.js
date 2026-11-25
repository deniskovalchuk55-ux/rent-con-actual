// Серверні виклики Notion API (для інтеграцій): повтори при 429/5xx, вибірка всіх сторінок.
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notion(path, method = 'GET', payload, { retries = 3 } = {}) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw Object.assign(new Error('NOTION_TOKEN not set'), { status: 500 });
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(NOTION_API + path, {
        method,
        headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined
      });
    } catch (e) {
      if (attempt >= retries) throw Object.assign(new Error('Notion недоступний'), { status: 502 });
      await sleep(400 * 2 ** attempt);
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < retries) {
      const ra = Number(r.headers.get('retry-after'));
      await sleep(ra > 0 ? ra * 1000 : 400 * 2 ** attempt);
      continue;
    }
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) throw Object.assign(new Error((data && data.message) || 'Notion HTTP ' + r.status), { status: r.status, data });
    return data;
  }
}

async function queryAll(dbId, filter, { limit = 2000 } = {}) {
  let out = [];
  let cursor;
  do {
    const payload = { page_size: 100 };
    if (filter) payload.filter = filter;
    if (cursor) payload.start_cursor = cursor;
    const data = await notion(`/databases/${dbId}/query`, 'POST', payload);
    out = out.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && out.length < limit);
  return out;
}

const getTitle = (p, n) => (p[n] && p[n].title ? p[n].title.map(t => t.plain_text || '').join('') : '');
const getRich = (p, n) => (p[n] && p[n].rich_text ? p[n].rich_text.map(t => t.plain_text || '').join('') : '');
const getNumber = (p, n) => (p[n] && p[n].number != null ? p[n].number : null);
const getCheckbox = (p, n) => !!(p[n] && p[n].checkbox);

module.exports = { notion, queryAll, getTitle, getRich, getNumber, getCheckbox, sleep };
