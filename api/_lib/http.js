// Дрібні спільні помічники для інтеграцій.
const crypto = require('crypto');

class ProviderError extends Error {
  // code: auth | region | rate | ip | expired | network | http | setup
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

async function fetchT(url, opts = {}, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    throw new ProviderError('network', e && e.name === 'AbortError' ? 'Сервіс не відповів вчасно' : 'Немає зʼєднання з сервісом');
  } finally { clearTimeout(t); }
}

async function readJson(r) {
  try { return await r.json(); } catch { return null; }
}

const hmacHex = (secret, msg) => crypto.createHmac('sha256', String(secret)).update(String(msg)).digest('hex');

const STABLE = new Set(['USDT', 'USDC', 'FDUSD', 'DAI', 'TUSD', 'USDE', 'PYUSD', 'USD1', 'BUSD', 'USDD', 'USDP', 'RLUSD']);
const FIAT = new Set(['USD', 'EUR', 'PLN', 'UAH', 'GBP', 'CHF', 'CZK', 'TRY', 'BRL', 'KZT', 'GEL', 'RON', 'HUF', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY']);
const EURO_STABLE = new Set(['EURC', 'EURT', 'EURI', 'EURR']);

module.exports = { ProviderError, fetchT, readJson, hmacHex, STABLE, FIAT, EURO_STABLE };
