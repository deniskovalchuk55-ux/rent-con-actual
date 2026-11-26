// Монобанк: особистий API (токен з api.monobank.ua). Ліміт — 1 запит на хвилину на кожен метод.
const crypto = require('crypto');
const { ProviderError, fetchT, readJson } = require('./http');
const { kindOf } = require('./categorize');

const API = 'https://api.monobank.ua';

const CUR = {
  980: 'UAH', 840: 'USD', 978: 'EUR', 985: 'PLN', 826: 'GBP', 203: 'CZK', 756: 'CHF', 348: 'HUF', 946: 'RON',
  208: 'DKK', 752: 'SEK', 578: 'NOK', 124: 'CAD', 36: 'AUD', 392: 'JPY', 156: 'CNY', 949: 'TRY', 498: 'MDL',
  981: 'GEL', 51: 'AMD', 398: 'KZT', 944: 'AZN', 860: 'UZS', 376: 'ILS', 784: 'AED', 933: 'BYN', 191: 'HRK'
};
const curOf = code => CUR[code] || String(code);

const TYPE_LABEL = {
  black: 'Чорна картка', white: 'Біла картка', platinum: 'Platinum', iron: 'Iron', fop: 'Рахунок ФОП',
  yellow: 'Дитяча картка', eAid: 'єПідтримка', madeInUkraine: 'Made in Ukraine', rebuilding: 'єВідновлення'
};

const token = () => process.env.MONO_TOKEN;

async function monoGet(path) {
  if (!token()) throw new ProviderError('setup', 'Не задано MONO_TOKEN');
  const r = await fetchT(API + path, { headers: { 'X-Token': token() } });
  if (r.status === 429) throw new ProviderError('rate', 'Монобанк дозволяє один запит на хвилину — спробуй трохи згодом');
  if (r.status === 401 || r.status === 403) throw new ProviderError('auth', 'Токен Монобанку недійсний — створи новий на api.monobank.ua');
  const data = await readJson(r);
  if (!r.ok) throw new ProviderError('http', (data && data.errorDescription) || 'Монобанк відповів ' + r.status);
  return data;
}

// Інформація про клієнта кешується на хвилину: так вкладаємось у ліміт і переживаємо 429
let infoCache = { at: 0, data: null };
const accountCurrency = new Map(); // id рахунку → валюта (для вебхука)

async function clientInfo({ maxAgeMs = 60000 } = {}) {
  if (infoCache.data && Date.now() - infoCache.at < maxAgeMs) return infoCache.data;
  try {
    const data = await monoGet('/personal/client-info');
    infoCache = { at: Date.now(), data };
    for (const a of data.accounts || []) accountCurrency.set(a.id, curOf(a.currencyCode));
    for (const j of data.jars || []) accountCurrency.set(j.id, curOf(j.currencyCode));
    return data;
  } catch (e) {
    if (e.code === 'rate' && infoCache.data) return infoCache.data; // старіші дані краще, ніж помилка
    throw e;
  }
}

// Секрет вебхука виводимо з токена — окрема змінна не потрібна, а чужий запит не пройде
function hookSecret() {
  return token() ? crypto.createHmac('sha256', token()).update('rent-control:mono-webhook').digest('hex').slice(0, 32) : null;
}

function hookUrl(host) {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL || host;
  return `https://${base}/api/finance?hook=mono&k=${hookSecret()}`;
}

async function balances() {
  const info = await clientInfo();
  const ours = info.webHookUrl && hookSecret() && info.webHookUrl.includes('k=' + hookSecret());
  const accounts = (info.accounts || []).map(a => {
    const pan = (a.maskedPan && a.maskedPan[0]) || '';
    return {
      id: 'mono:' + a.id,
      kind: 'card',
      name: TYPE_LABEL[a.type] || 'Рахунок',
      mask: pan ? '•' + pan.slice(-4) : a.iban ? '…' + a.iban.slice(-4) : '',
      currency: curOf(a.currencyCode),
      balance: (a.balance - (a.creditLimit || 0)) / 100, // власні гроші без кредитного ліміту
      creditLimit: (a.creditLimit || 0) / 100,
      ref: a.id,
    };
  });
  const jars = (info.jars || []).map(j => ({
    id: 'mono:jar:' + j.id,
    kind: 'jar',
    name: j.title || 'Банка',
    currency: curOf(j.currencyCode),
    balance: (j.balance || 0) / 100,
    goal: j.goal ? j.goal / 100 : null,
  }));
  return {
    provider: 'mono', label: 'Монобанк', ok: true,
    accounts: [...accounts, ...jars],
    webhook: info.webHookUrl ? (ours ? 'on' : 'other') : 'off',
    fetchedAt: infoCache.at,
  };
}

async function setWebhook(url) {
  if (!token()) throw new ProviderError('setup', 'Не задано MONO_TOKEN');
  const r = await fetchT(API + '/personal/webhook', {
    method: 'POST',
    headers: { 'X-Token': token(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ webHookUrl: url })
  }, 15000);
  if (r.status === 429) throw new ProviderError('rate', 'Монобанк дозволяє один запит на хвилину — спробуй трохи згодом');
  if (!r.ok) {
    const data = await readJson(r);
    throw new ProviderError('http', (data && data.errorDescription) || 'Монобанк не прийняв адресу вебхука (' + r.status + ')');
  }
  infoCache = { at: 0, data: null };
  return true;
}

// Дата операції в часовому поясі користувача (у Notion зберігається лише дата)
function localDate(sec, tz = process.env.APP_TZ || 'Europe/Warsaw') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sec * 1000));
  } catch { return new Date(sec * 1000).toISOString().slice(0, 10); }
}

const fmtNum = n => String(Math.round(n * 100) / 100).replace('.', ',');

// Операція з виписки/вебхука → кандидат у витрати
function toCandidate(item, accCurrency) {
  const opCurrency = curOf(item.currencyCode);
  const accCur = accCurrency || (item.amount === item.operationAmount ? opCurrency : 'UAH');
  const title = String(item.description || '').replace(/\s+/g, ' ').trim() || 'Оплата карткою';
  const mcc = item.mcc || item.originalMcc || 0;
  const amountAccount = Math.abs(item.amount || 0) / 100;
  const amountOp = Math.abs(item.operationAmount || item.amount || 0) / 100;
  const parts = [];
  if (opCurrency !== accCur) parts.push(`${fmtNum(amountOp)} ${opCurrency}`);
  parts.push('Монобанк');
  if (item.comment) parts.push(String(item.comment).slice(0, 120));
  return {
    bankId: 'mono:' + item.id,
    date: localDate(item.time),
    title,
    mcc,
    kind: kindOf({ amount: item.amount, mcc, title }),
    hold: !!item.hold,
    accountCurrency: accCur,
    amountAccount,
    opCurrency,
    amountOp,
    note: parts.join(' · '),
  };
}

async function statement(accountId, fromSec, toSec) {
  return monoGet(`/personal/statement/${encodeURIComponent(accountId)}/${fromSec}/${toSec}`);
}

// Курси Монобанку для валют, яких не розуміє Expense·Control (EUR тощо) → у гривні
let ratesCache = { at: 0, list: null };
async function uahRate(cur) {
  if (cur === 'UAH') return 1;
  if (!ratesCache.list || Date.now() - ratesCache.at > 15 * 60000) {
    const r = await fetchT(API + '/bank/currency', {}, 8000);
    if (!r.ok) throw new ProviderError('rate', 'Немає курсу валют від Монобанку');
    ratesCache = { at: Date.now(), list: await readJson(r) };
  }
  const code = Number(Object.keys(CUR).find(k => CUR[k] === cur));
  const row = (ratesCache.list || []).find(x => x.currencyCodeA === code && x.currencyCodeB === 980);
  if (!row) throw new ProviderError('http', 'Немає курсу ' + cur + '/UAH');
  return row.rateCross || (row.rateBuy && row.rateSell ? (row.rateBuy + row.rateSell) / 2 : row.rateSell || row.rateBuy);
}

module.exports = { clientInfo, balances, setWebhook, hookSecret, hookUrl, toCandidate, statement, uahRate, accountCurrency, curOf, localDate };
