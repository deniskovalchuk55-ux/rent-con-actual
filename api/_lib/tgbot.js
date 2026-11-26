// Повідомлення від бота власнику (той самий бот, що відкриває застосунок: TG_BOT_TOKEN).
const { fetchT, readJson } = require('./http');

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// → { ok, messageId } або { ok:false, code: forbidden | token | rate | server | bad | http | network | setup, error }
async function sendMessage(chatId, text, { silent = false } = {}) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token || !chatId) return { ok: false, code: 'setup', error: 'Не задано TG_BOT_TOKEN або OWNER_TG_ID' };
  let r;
  try {
    r = await fetchT(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, disable_notification: !!silent }),
    }, 8000);
  } catch (e) {
    return { ok: false, code: 'network', error: e.message };
  }
  const d = await readJson(r);
  if (r.ok && d && d.ok) return { ok: true, messageId: d.result && d.result.message_id };
  const error = (d && d.description) || 'Telegram відповів ' + r.status;
  // 403 — користувач ще не натискав «Почати» в боті або заблокував його
  const code = r.status === 403 ? 'forbidden' : r.status === 401 || r.status === 404 ? 'token' : r.status === 429 ? 'rate' : r.status >= 500 ? 'server' : r.status === 400 ? 'bad' : 'http';
  return { ok: false, code, error };
}

const HINT = {
  forbidden: 'Відкрий чат із ботом і натисни «Почати» (Start) — без цього бот не може писати першим',
  token: 'Telegram не прийняв TG_BOT_TOKEN — перевір токен у @BotFather',
  rate: 'Telegram просить зачекати — спробуй за хвилину',
};

module.exports = { sendMessage, esc, HINT };
