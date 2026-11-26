// Перевірка, що запит прийшов із нашого Mini App у Telegram.
// Telegram підписує initData токеном бота (HMAC-SHA256); без токена підпис не підробити.
// Файли з «_» на початку Vercel не робить окремими функціями — це спільна бібліотека.
const crypto = require('crypto');

const MAX_AGE_SEC = 7 * 24 * 3600; // Mini App може бути відкритий кілька днів поспіль

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
}

function verifyInitData(initData, botToken, { maxAgeSec = MAX_AGE_SEC, now = Date.now() } = {}) {
  if (!initData || typeof initData !== 'string') return { ok: false, reason: 'no-init-data' };
  if (!botToken) return { ok: false, reason: 'no-bot-token' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no-hash' };
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const matches = exclude => {
    const pairs = [];
    for (const [k, v] of params) if (k !== 'hash' && !exclude.includes(k)) pairs.push([k, v]);
    pairs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    const checkString = pairs.map(([k, v]) => k + '=' + v).join('\n');
    return safeEqualHex(crypto.createHmac('sha256', secret).update(checkString).digest('hex'), hash.toLowerCase());
  };
  // за документацією в рядок входять усі поля, крім hash; деякі клієнти не включали signature — перевіряємо обидва варіанти
  if (!matches([]) && !(params.has('signature') && matches(['signature']))) return { ok: false, reason: 'bad-signature' };
  const authDate = Number(params.get('auth_date')) || 0;
  if (!authDate || now / 1000 - authDate > maxAgeSec) return { ok: false, reason: 'expired' };
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { user = null; }
  if (!user || !user.id) return { ok: false, reason: 'no-user' };
  return { ok: true, user, userId: Number(user.id), authDate };
}

const parseIds = s => String(s || '').split(/[\s,;]+/).map(x => Number(x)).filter(x => Number.isFinite(x) && x > 0);

// mode: 'off' — захист ще не налаштований (немає TG_BOT_TOKEN), поводимось як раніше
function authFromRequest(req) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) return { mode: 'off', ok: true, userId: null };
  const v = verifyInitData(req.headers['x-telegram-init-data'], token);
  if (!v.ok) {
    const error = v.reason === 'expired' ? 'Сесія Telegram застаріла — закрий застосунок і відкрий знову' : 'Відкрий застосунок через бота в Telegram';
    return { mode: 'on', ok: false, status: 401, error, reason: v.reason };
  }
  const allowed = parseIds(process.env.ALLOWED_TG_IDS);
  if (allowed.length && !allowed.includes(v.userId)) return { mode: 'on', ok: false, status: 403, error: 'Немає доступу', reason: 'not-allowed' };
  return { mode: 'on', ok: true, userId: v.userId, user: v.user };
}

// Власник банківських і біржових ключів зі змінних середовища — лише він бачить ці дані
function isOwner(userId) {
  const owners = parseIds(process.env.OWNER_TG_ID);
  return owners.length > 0 && owners.includes(Number(userId));
}

module.exports = { verifyInitData, authFromRequest, isOwner, parseIds };
