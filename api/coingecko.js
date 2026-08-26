// Vercel serverless function: проксі до CoinGecko API
// Обходить CORS обмеження + дозволені endpoint'и через whitelist.

const CG_API = 'https://api.coingecko.com/api/v3';

// Whitelist endpoint шаблонів (простіший регекс)
const ALLOWED = [
  /^\/search$/,
  /^\/coins\/markets$/,
  /^\/coins\/[a-z0-9-]+$/,
  /^\/coins\/[a-z0-9-]+\/market_chart$/,
  /^\/simple\/price$/,
  /^\/coins\/list$/
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { path, query } = body;
    if (!path) return res.status(400).json({ error: 'path required' });

    // Перевірка whitelist
    const ok = ALLOWED.some(rx => rx.test(path));
    if (!ok) return res.status(400).json({ error: 'Path not allowed: ' + path });

    // Будуємо URL
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const url = CG_API + path + qs;

    const r = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    const data = await r.json();
    // Кешуємо на клієнті 60 секунд для економії rate limit
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
};
