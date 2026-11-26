// Біржі: баланси за ключами тільки на читання (HMAC-SHA256). Вартість у USD — за цінами самої біржі.
const { ProviderError, fetchT, readJson, hmacHex, STABLE, FIAT, EURO_STABLE } = require('./http');

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Ціна в USD: стейблкоїни = 1, фіат рахує застосунок за своїми курсами
function valueHoldings(holdings, priceOf) {
  for (const h of holdings) {
    if (h.usd != null && h.usd > 0) continue;
    if (STABLE.has(h.asset)) { h.usd = h.qty; continue; }
    if (FIAT.has(h.asset) || EURO_STABLE.has(h.asset)) { h.usd = null; h.fiat = EURO_STABLE.has(h.asset) ? 'EUR' : h.asset; continue; }
    const p = priceOf(h.asset);
    h.usd = p ? h.qty * p : null;
  }
  return holdings.filter(h => h.qty > 0);
}

/* ===================== Bybit (V5) ===================== */
// Глобальний Bybit і Bybit EU — різні компанії з різними ключами; хост визначаємо самі
const BYBIT_HOSTS = ['api.bybit.com', 'api.bybit.eu'];
let bybitHost = null;

function bybitError(d, status) {
  const code = d && d.retCode;
  const msg = (d && d.retMsg) || 'HTTP ' + status;
  if (status === 403) return new ProviderError('region', 'Bybit не приймає запити з цього сервера (обмеження регіону)');
  if (code === 10003 || code === 10004) return new ProviderError('auth', 'Bybit: ключ API недійсний — перевір BYBIT_API_KEY і BYBIT_API_SECRET', { raw: msg, retCode: code });
  if (code === 10005) return new ProviderError('auth', 'Bybit: у ключа немає прав на читання гаманця', { raw: msg, retCode: code });
  if (code === 10010) return new ProviderError('ip', 'Bybit: ключ привʼязаний до IP — зніми привʼязку, бо сервер не має сталої адреси', { raw: msg, retCode: code });
  if (code === 33004) return new ProviderError('expired', 'Bybit: термін дії ключа минув — створи новий', { raw: msg, retCode: code });
  if (code === 10006 || code === 10018) return new ProviderError('rate', 'Bybit: забагато запитів, спробуй за хвилину', { raw: msg, retCode: code });
  return new ProviderError('http', 'Bybit: ' + msg, { retCode: code });
}

async function bybitGet(host, path, params = {}, signed = true) {
  const qs = new URLSearchParams(params).toString();
  const headers = {};
  if (signed) {
    const key = process.env.BYBIT_API_KEY, secret = process.env.BYBIT_API_SECRET;
    const ts = String(Date.now()), rw = '10000';
    headers['X-BAPI-API-KEY'] = key;
    headers['X-BAPI-TIMESTAMP'] = ts;
    headers['X-BAPI-RECV-WINDOW'] = rw;
    headers['X-BAPI-SIGN'] = hmacHex(secret, ts + key + rw + qs);
  }
  const r = await fetchT(`https://${host}${path}${qs ? '?' + qs : ''}`, { headers });
  const d = await readJson(r);
  if (r.status === 403 || !d) throw bybitError(d, r.status);
  if (d.retCode !== 0) throw bybitError(d, r.status);
  return d.result || {};
}

async function bybitCollect(host) {
  const holdings = [];
  // Єдиний торговий акаунт (UTA); у старих акаунтах — окремо CONTRACT і SPOT
  let wallets = [];
  try {
    wallets = [{ label: 'Торговий', res: await bybitGet(host, '/v5/account/wallet-balance', { accountType: 'UNIFIED' }) }];
  } catch (e) {
    if (e.code !== 'http') throw e;
    for (const t of ['CONTRACT', 'SPOT']) {
      try { wallets.push({ label: t === 'SPOT' ? 'Спот' : 'Деривативи', res: await bybitGet(host, '/v5/account/wallet-balance', { accountType: t }) }); } catch { /* немає такого */ }
    }
  }
  for (const w of wallets) for (const acc of w.res.list || []) for (const c of acc.coin || []) {
    const qty = num(c.walletBalance) || num(c.equity);
    if (qty > 0) holdings.push({ asset: c.coin, qty, usd: num(c.usdValue) || null, account: w.label });
  }
  // Фінансовий (Funding) і Earn — якщо ключ має права; помилки тут не критичні
  try {
    const f = await bybitGet(host, '/v5/asset/transfer/query-account-coins-balance', { accountType: 'FUND' });
    for (const b of f.balance || []) { const qty = num(b.walletBalance); if (qty > 0) holdings.push({ asset: b.coin, qty, usd: null, account: 'Фінансовий' }); }
  } catch { /* немає прав або не підтримується */ }
  for (const category of ['FlexibleSaving', 'OnChain']) {
    try {
      const e = await bybitGet(host, '/v5/earn/position', { category });
      for (const p of e.list || []) { const qty = num(p.amount); if (qty > 0) holdings.push({ asset: p.coin, qty, usd: null, account: 'Earn' }); }
    } catch { /* немає прав або не підтримується */ }
  }
  if (holdings.some(h => !h.usd)) {
    let prices = new Map();
    try {
      const t = await bybitGet(host, '/v5/market/tickers', { category: 'spot' }, false);
      for (const x of t.list || []) if (x.symbol.endsWith('USDT')) prices.set(x.symbol.slice(0, -4), num(x.lastPrice));
    } catch { /* без цін — значення порахує застосунок за CoinGecko */ }
    // ціна з UTA для тієї ж монети, якщо є
    for (const h of holdings) if (h.usd && h.qty) prices.set(h.asset, prices.get(h.asset) || h.usd / h.qty);
    valueHoldings(holdings, a => prices.get(a));
  }
  return holdings;
}

// Ключ від bybit.com не працює на bybit.eu і навпаки — пробуємо обидва й запамʼятовуємо вдалий
async function bybitWithHost(fn) {
  if (!process.env.BYBIT_API_KEY || !process.env.BYBIT_API_SECRET) throw new ProviderError('setup', 'Не задано BYBIT_API_KEY / BYBIT_API_SECRET');
  const hosts = process.env.BYBIT_HOST ? [process.env.BYBIT_HOST] : bybitHost ? [bybitHost] : BYBIT_HOSTS;
  let last;
  for (const host of hosts) {
    try {
      const result = await fn(host);
      bybitHost = host;
      return { host, label: host.endsWith('.eu') ? 'Bybit EU' : 'Bybit', result };
    } catch (e) {
      last = e;
      if (e.code !== 'auth' || e.retCode !== 10003) throw e; // інший хост пробуємо лише коли ключ «не той»
    }
  }
  throw last;
}

async function bybitBalances() {
  const { label, result } = await bybitWithHost(bybitCollect);
  return { provider: 'bybit', label, ok: true, holdings: result };
}

/* ---------- Поповнення й виведення (для сповіщень у бот) ---------- */
// Час у мс: приймає мс, секунди або рядок дати
function toMs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) { const n = Number(v); return n < 1e12 ? n * 1000 : n; }
  const s = String(v).trim();
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? 0 : t;
}

// Подія: { key, provider, label, dir: in|out, coin, amount, network, txId, address, fee, internal, from, time }
async function bybitTransfers(now, windowMs) {
  const range = { startTime: now - windowMs, endTime: now, limit: 50 };
  const { label, result } = await bybitWithHost(async host => {
    const [dep, wd] = await Promise.all([
      bybitGet(host, '/v5/asset/deposit/query-record', range),
      bybitGet(host, '/v5/asset/withdraw/query-record', { ...range, withdrawType: 2 }),
    ]);
    // внутрішні поповнення (від інших користувачів Bybit) — якщо ключ має права
    const idep = await bybitGet(host, '/v5/asset/deposit/query-internal-record', range).catch(() => ({ rows: [] }));
    return { dep, wd, idep };
  });
  const out = [];
  for (const r of result.dep.rows || []) {
    if (Number(r.status) !== 3) continue; // 3 — зараховано
    out.push({ key: 'bybit:dep:' + (r.id || `${r.txID}:${r.coin}:${r.amount}`), provider: 'bybit', label, dir: 'in', coin: r.coin, amount: num(r.amount), network: r.chain, txId: r.txID || '', time: toMs(r.successAt) });
  }
  for (const r of result.idep.rows || []) {
    if (Number(r.status) !== 2) continue; // 2 — успішно
    out.push({ key: 'bybit:idep:' + (r.id || r.txID), provider: 'bybit', label, dir: 'in', coin: r.coin, amount: num(r.amount), internal: true, from: r.address || '', txId: r.txID || '', time: toMs(r.createdTime) });
  }
  for (const r of result.wd.rows || []) {
    if (String(r.status).toLowerCase() !== 'success') continue;
    const internal = Number(r.withdrawType) === 1 || r.chain === 'internalAddressChain';
    out.push({ key: 'bybit:wd:' + (r.withdrawId || r.txID), provider: 'bybit', label, dir: 'out', coin: r.coin, amount: num(r.amount), network: internal ? '' : r.chain, txId: r.txID || '', address: internal ? 'UID ' + r.toAddress : r.toAddress, fee: num(r.withdrawFee), internal, time: toMs(r.updateTime || r.createTime) });
  }
  return out;
}

/* ===================== BingX ===================== */
const BINGX = 'https://open-api.bingx.com';

function bingxError(d, status) {
  const code = d && d.code;
  const msg = (d && (d.msg || d.message)) || 'HTTP ' + status;
  if (status === 403 || status === 451) return new ProviderError('region', 'BingX не приймає запити з цього сервера (обмеження регіону)');
  if (/signature/i.test(msg) || code === 100001) return new ProviderError('auth', 'BingX: підпис не підходить — перевір BINGX_API_SECRET', { raw: msg });
  if (/api ?key|apikey/i.test(msg) || code === 100413 || code === 100412) return new ProviderError('auth', 'BingX: ключ API недійсний — перевір BINGX_API_KEY', { raw: msg });
  if (/ip/i.test(msg) && /white|allow/i.test(msg)) return new ProviderError('ip', 'BingX: ключ привʼязаний до IP — зніми привʼязку', { raw: msg });
  if (code === 100410 || status === 429) return new ProviderError('rate', 'BingX: забагато запитів, спробуй за хвилину', { raw: msg });
  return new ProviderError('http', 'BingX: ' + msg);
}

// Підпис: параметри за абеткою, без кодування, HMAC-SHA256 hex → &signature=
function bingxQuery(params, secret) {
  const keys = Object.keys(params).sort();
  const qs = keys.map(k => `${k}=${params[k]}`).join('&');
  return secret ? qs + '&signature=' + hmacHex(secret, qs) : qs;
}

async function bingxGet(path, params = {}, signed = true) {
  const all = { ...params, timestamp: Date.now() };
  const headers = {};
  if (signed) headers['X-BX-APIKEY'] = process.env.BINGX_API_KEY;
  const q = bingxQuery(all, signed ? process.env.BINGX_API_SECRET : null);
  const r = await fetchT(`${BINGX}${path}?${q}`, { headers });
  const d = await readJson(r);
  if (!r.ok || !d || (d.code !== 0 && d.code !== undefined)) throw bingxError(d, r.status);
  return Array.isArray(d) ? d : d.data; // історія поповнень і виведень — голий масив
}

const BINGX_ACCOUNT = { stdFutures: 'Стандартні фʼючерси', coinMPerp: 'Безстрокові COIN-M', USDTMPerp: 'Безстрокові USDT-M', copyTrading: 'Копітрейдинг', grid: 'Сіткові боти', eran: 'Earn', c2c: 'P2P' };

async function bingxBalances() {
  if (!process.env.BINGX_API_KEY || !process.env.BINGX_API_SECRET) throw new ProviderError('setup', 'Не задано BINGX_API_KEY / BINGX_API_SECRET');
  const spot = await bingxGet('/openApi/spot/v1/account/balance');
  const holdings = [];
  for (const b of (spot && spot.balances) || []) {
    const qty = num(b.free) + num(b.locked);
    if (qty > 0) holdings.push({ asset: b.asset, qty, usd: null, account: 'Спот' });
  }
  let prices = new Map();
  try {
    const t = await bingxGet('/openApi/spot/v1/ticker/24hr', {}, false);
    for (const x of t || []) if (String(x.symbol).endsWith('-USDT')) prices.set(x.symbol.slice(0, -5), num(x.lastPrice));
  } catch { /* без цін */ }
  valueHoldings(holdings, a => prices.get(a));
  // Інші рахунки (ф'ючерси, копітрейдинг, боти, Earn) — сума в USDT
  try {
    const all = await bingxGet('/openApi/account/v1/allAccountBalance');
    for (const a of all || []) {
      const usdt = num(a.usdtBalance);
      if (usdt <= 0) continue;
      if (a.accountType === 'sopt') {
        // спот/фінансовий: якщо монет на споті менше, ніж каже огляд, — решта на фінансовому рахунку
        const spotUsd = holdings.reduce((s, h) => s + (h.usd || 0), 0);
        if (usdt - spotUsd > Math.max(1, usdt * 0.02)) holdings.push({ asset: 'USDT', qty: usdt - spotUsd, usd: usdt - spotUsd, account: 'Фінансовий', approx: true });
        continue;
      }
      holdings.push({ asset: 'USDT', qty: usdt, usd: usdt, account: BINGX_ACCOUNT[a.accountType] || a.accountType, approx: true });
    }
  } catch { /* огляд необовʼязковий */ }
  return { provider: 'bingx', label: 'BingX', ok: true, holdings };
}

async function bingxTransfers(now, windowMs) {
  if (!process.env.BINGX_API_KEY || !process.env.BINGX_API_SECRET) throw new ProviderError('setup', 'Не задано BINGX_API_KEY / BINGX_API_SECRET');
  const range = { startTime: now - windowMs, endTime: now, limit: 1000 };
  const [dep, wd] = await Promise.all([
    bingxGet('/openApi/api/v3/capital/deposit/hisrec', range),
    bingxGet('/openApi/api/v3/capital/withdraw/history', range),
  ]);
  const out = [];
  for (const r of Array.isArray(dep) ? dep : []) {
    // 6 — підтверджено в мережі; 1 — завершено (за старою схемою BingX). Ключ однаковий, тож без дублів
    if (![1, 6].includes(Number(r.status))) continue;
    out.push({ key: 'bingx:dep:' + (r.id || `${r.txId}:${r.coin}:${r.amount}:${r.insertTime}`), provider: 'bingx', label: 'BingX', dir: 'in', coin: r.coin, amount: num(r.amount), network: r.network, txId: r.txId || '', time: toMs(r.insertTime) });
  }
  for (const r of Array.isArray(wd) ? wd : []) {
    if (Number(r.status) !== 6) continue; // 6 — завершено
    out.push({ key: 'bingx:wd:' + (r.id || r.txId), provider: 'bingx', label: 'BingX', dir: 'out', coin: r.coin, amount: num(r.amount), network: r.network, txId: r.txId || '', address: r.address, fee: num(r.transactionFee), time: toMs(r.applyTime) });
  }
  return out;
}

/* ===================== MEXC ===================== */
const MEXC = 'https://api.mexc.com';

function mexcError(d, status) {
  const code = d && d.code;
  const msg = (d && (d.msg || d.message)) || 'HTTP ' + status;
  if (status === 403 && !code) return new ProviderError('region', 'MEXC не приймає запити з цього сервера (обмеження регіону)');
  if (code === 700006 || /ip/i.test(msg) && /white/i.test(msg)) return new ProviderError('ip', 'MEXC: ключ привʼязаний до IP — зніми привʼязку', { raw: msg });
  if (code === 700002 || /signature/i.test(msg)) return new ProviderError('auth', 'MEXC: підпис не підходить — перевір MEXC_API_SECRET', { raw: msg });
  if (code === 10072 || code === 700001 || /api ?key/i.test(msg)) return new ProviderError('auth', 'MEXC: ключ API недійсний або прострочений — перевір MEXC_API_KEY', { raw: msg });
  if (status === 429) return new ProviderError('rate', 'MEXC: забагато запитів, спробуй за хвилину', { raw: msg });
  return new ProviderError('http', 'MEXC: ' + msg);
}

// Підпис: HMAC-SHA256 від рядка запиту (totalParams), hex у нижньому регістрі
function mexcQuery(params, secret) {
  const qs = new URLSearchParams(params).toString();
  return secret ? qs + '&signature=' + hmacHex(secret, qs) : qs;
}

async function mexcGet(path, params = {}, signed = true) {
  const headers = { 'Content-Type': 'application/json' };
  let q;
  if (signed) {
    headers['X-MEXC-APIKEY'] = process.env.MEXC_API_KEY;
    q = mexcQuery({ ...params, recvWindow: 10000, timestamp: Date.now() }, process.env.MEXC_API_SECRET);
  } else q = mexcQuery(params, null);
  const r = await fetchT(`${MEXC}${path}${q ? '?' + q : ''}`, { headers });
  const d = await readJson(r);
  if (!r.ok || !d || (d.code && d.code !== 200 && d.code !== 0)) throw mexcError(d, r.status);
  return d;
}

async function mexcBalances() {
  if (!process.env.MEXC_API_KEY || !process.env.MEXC_API_SECRET) throw new ProviderError('setup', 'Не задано MEXC_API_KEY / MEXC_API_SECRET');
  const acc = await mexcGet('/api/v3/account');
  const holdings = [];
  for (const b of acc.balances || []) {
    const qty = num(b.free) + num(b.locked);
    if (qty > 0) holdings.push({ asset: b.asset, qty, usd: null, account: 'Спот' });
  }
  if (holdings.length) {
    let prices = new Map();
    try {
      const t = await mexcGet('/api/v3/ticker/price', {}, false);
      for (const x of Array.isArray(t) ? t : []) if (String(x.symbol).endsWith('USDT')) prices.set(x.symbol.slice(0, -4), num(x.price));
    } catch { /* без цін */ }
    valueHoldings(holdings, a => prices.get(a));
  }
  return { provider: 'mexc', label: 'MEXC', ok: true, holdings };
}

async function mexcTransfers(now, windowMs) {
  if (!process.env.MEXC_API_KEY || !process.env.MEXC_API_SECRET) throw new ProviderError('setup', 'Не задано MEXC_API_KEY / MEXC_API_SECRET');
  const range = { startTime: now - windowMs, endTime: now, limit: 1000 };
  const [dep, wd] = await Promise.all([
    mexcGet('/api/v3/capital/deposit/hisrec', range),
    mexcGet('/api/v3/capital/withdraw/history', range),
  ]);
  const out = [];
  for (const r of Array.isArray(dep) ? dep : []) {
    if (![5, 12].includes(Number(r.status))) continue; // 5 SUCCESS, 12 COMPLETED
    out.push({ key: 'mexc:dep:' + (r.id || `${r.txId}:${r.coin}:${r.amount}:${r.insertTime}`), provider: 'mexc', label: 'MEXC', dir: 'in', coin: r.coin, amount: num(r.amount), network: r.network || r.netWork, txId: r.txId || '', time: toMs(r.updateTime || r.insertTime) });
  }
  for (const r of Array.isArray(wd) ? wd : []) {
    if (Number(r.status) !== 7) continue; // 7 SUCCESS
    const internal = Number(r.transferType) === 1;
    out.push({ key: 'mexc:wd:' + (r.id || r.txId), provider: 'mexc', label: 'MEXC', dir: 'out', coin: r.coin, amount: num(r.amount), network: internal ? '' : r.network, txId: r.txId || '', address: r.address, fee: num(r.transactionFee), internal, time: toMs(r.updateTime || r.applyTime) });
  }
  return out;
}

// Поточні ціни монет у USDT (публічний ціновий список MEXC) — щоб оцінити поповнення не-стейблкоїнами
let priceCache = { at: 0, map: null };
async function spotPrices() {
  if (priceCache.map && Date.now() - priceCache.at < 5 * 60e3) return priceCache.map;
  const t = await mexcGet('/api/v3/ticker/price', {}, false);
  const map = new Map();
  for (const x of Array.isArray(t) ? t : []) if (String(x.symbol).endsWith('USDT')) map.set(x.symbol.slice(0, -4), num(x.price));
  priceCache = { at: Date.now(), map };
  return map;
}

const EXCHANGES = {
  bybit: { label: 'Bybit', configured: () => !!(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET), balances: bybitBalances, transfers: bybitTransfers },
  bingx: { label: 'BingX', configured: () => !!(process.env.BINGX_API_KEY && process.env.BINGX_API_SECRET), balances: bingxBalances, transfers: bingxTransfers },
  mexc: { label: 'MEXC', configured: () => !!(process.env.MEXC_API_KEY && process.env.MEXC_API_SECRET), balances: mexcBalances, transfers: mexcTransfers },
};

module.exports = { EXCHANGES, bingxQuery, mexcQuery, valueHoldings, toMs, spotPrices };
