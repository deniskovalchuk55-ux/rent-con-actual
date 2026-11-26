// Сповіщення про поповнення й виведення на біржах. Біржі самі нічого не надсилають, тому
// зовнішній розклад (cron-job.org) щохвилини смикає /api/finance?hook=poll, а ми дивимось,
// що нового зʼявилось в історії.
const crypto = require('crypto');
const { EXCHANGES } = require('./exchanges');
const { transfersMessage } = require('./notify');

const WINDOW_MS = 24 * 3600e3; // скільки історії переглядаємо щоразу (довгі підтвердження теж встигнуть)
const RECENT_MS = 65e3;        // після «холодного» старту надсилаємо лише події останньої хвилини
const KEEP_MS = 48 * 3600e3;

// Памʼять теплого екземпляра функції: що вже бачили й куди йшли виведення (для «з Bybit»)
const state = { seen: new Map(), primed: new Set(), outTx: new Map(), lastRun: 0 };

function pollSecret() {
  const t = process.env.TG_BOT_TOKEN;
  return t ? crypto.createHmac('sha256', t).update('rent-control:transfers-poll').digest('hex').slice(0, 32) : null;
}

function pollUrl(host) {
  const k = pollSecret();
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL || host;
  return k && base ? `https://${base}/api/finance?hook=poll&k=${k}` : null;
}

const configured = () => Object.keys(EXCHANGES).filter(n => EXCHANGES[n].configured());

async function collect(now) {
  const names = configured();
  const settled = await Promise.allSettled(names.map(n => EXCHANGES[n].transfers(now, WINDOW_MS)));
  return names.map((name, i) => {
    const s = settled[i];
    if (s.status === 'fulfilled') return { name, ok: true, events: s.value || [] };
    return { name, ok: false, error: (s.reason && s.reason.message) || 'Помилка', code: (s.reason && s.reason.code) || 'error' };
  });
}

// Нові події з минулого запуску. Після холодного старту історію лише запамʼятовуємо,
// щоб не надіслати повторно те, що вже надсилав попередній екземпляр.
function pick(results, now) {
  const fresh = [];
  for (const r of results) {
    if (!r.ok) continue; // біржа не відповіла — запамʼятаємо її історію наступного разу
    const cold = !state.primed.has(r.name);
    for (const e of r.events) {
      if (e.dir === 'out' && e.txId) state.outTx.set(e.txId, e.label);
      if (state.seen.has(e.key)) continue;
      state.seen.set(e.key, now);
      if (!cold || (e.time && now - e.time <= RECENT_MS)) fresh.push(e);
    }
    state.primed.add(r.name);
  }
  // переказ між своїми біржами: той самий txId у виведенні й поповненні
  for (const e of fresh) if (e.dir === 'in' && e.txId && state.outTx.has(e.txId) && state.outTx.get(e.txId) !== e.label) e.peer = state.outTx.get(e.txId);
  for (const [k, t] of state.seen) if (now - t > KEEP_MS) state.seen.delete(k);
  if (state.outTx.size > 1000) state.outTx.clear();
  return fresh.sort((a, b) => (a.time || 0) - (b.time || 0));
}

const TRANSIENT = new Set(['network', 'rate', 'server']);

async function poll({ now = Date.now(), send, onFresh }) {
  const results = await collect(now);
  const fresh = pick(results, now);
  if (fresh.length && onFresh) await onFresh(fresh);
  let sent = 0, sendError = null;
  for (const text of fresh.length ? transfersMessage(fresh) : []) {
    const r = await send(text);
    if (r && r.ok) { sent++; continue; }
    sendError = r || { code: 'http' };
    break;
  }
  // Telegram тимчасово не прийняв — спробуємо ці події ще раз наступного запуску
  if (sendError && TRANSIENT.has(sendError.code)) for (const e of fresh) state.seen.delete(e.key);
  state.lastRun = now;
  return {
    checked: results.map(r => ({ provider: r.name, ok: r.ok, error: r.ok ? undefined : r.error, code: r.ok ? undefined : r.code })),
    fresh: fresh.length, sent, sendError: sendError ? { code: sendError.code, error: sendError.error } : null,
  };
}

// Перевірка з застосунку: чи відповідають біржі на запити історії (стан опитування не змінює)
async function check(now = Date.now()) {
  const results = await collect(now);
  return results.map(r => ({
    provider: r.name, ok: r.ok, error: r.ok ? undefined : r.error, code: r.ok ? undefined : r.code,
    deposits: r.ok ? r.events.filter(e => e.dir === 'in').length : 0,
    withdrawals: r.ok ? r.events.filter(e => e.dir === 'out').length : 0,
  }));
}

// для тестів
function _reset() { state.seen.clear(); state.primed.clear(); state.outTx.clear(); state.lastRun = 0; }

module.exports = { pollSecret, pollUrl, poll, check, configured, _reset, WINDOW_MS, RECENT_MS };
