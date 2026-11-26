// Тексти повідомлень бота: операції Монобанку й рух коштів на біржах (HTML-розмітка Telegram).
const { esc } = require('./tgbot');

const NNBSP = ' ';
const PRE = { USD: '$', EUR: '€', GBP: '£' };
const POST = { UAH: '₴', PLN: 'zł', CZK: 'Kč' };
const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);

// 18 450,32 ₴ · $1 240,50 · €312 · 86,20 zł
function fmtMoney(n, cur) {
  const [i, f] = (Math.round(Math.abs(Number(n) || 0) * 100) / 100).toFixed(2).split('.');
  const s = group(i) + (f === '00' ? '' : ',' + f);
  return PRE[cur] ? PRE[cur] + s : s + NNBSP + (POST[cur] || cur);
}

// Кількість монет: 0,0215 · 2 500 000 · 1 234,57
function fmtQty(q) {
  const a = Math.abs(Number(q) || 0);
  if (!a) return '0';
  const s = a >= 1000 ? a.toFixed(2) : a >= 1 ? a.toFixed(4) : a.toFixed(Math.min(10, Math.max(6, 2 - Math.floor(Math.log10(a)))));
  const [i, f = ''] = s.split('.');
  const frac = f.replace(/0+$/, '');
  return group(i) + (frac ? ',' + frac : '');
}

const shortAddr = a => {
  const s = String(a || '');
  return s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-4) : s;
};

const MONO_ICON = { expense: '💳', transfer: '↗️', cash: '🏧', income: '💰' };

// Операція Монобанку. amount — зі знаком, у валюті рахунку; balance — власні гроші після операції (або null)
function monoMessage({ amount, accCur, opAmount, opCur, title, counterName, comment, label, balance, kind, category, imported }) {
  const icon = amount > 0 ? MONO_ICON.income : MONO_ICON[kind] || MONO_ICON.expense;
  const sign = amount > 0 ? '+' : '−';
  let head = `${icon} <b>${sign}${fmtMoney(amount, accCur)}</b>`;
  if (opCur && opCur !== accCur && opAmount) head += ` (${fmtMoney(opAmount, opCur)})`;
  head += ' · ' + esc(title || 'Операція');
  const lines = [head];
  if (counterName && !String(title || '').includes(counterName)) lines.push(esc(counterName));
  if (comment) lines.push('«' + esc(String(comment).slice(0, 200)) + '»');
  const where = [label || 'Монобанк'];
  if (balance != null) where.push('залишок ' + fmtMoney(balance, accCur));
  lines.push(esc(where.join(' · ')));
  if (imported) lines.push(category ? '→ у витратах: ' + esc(category) : '→ записано у витрати');
  return lines.join('\n');
}

// Поповнення / виведення на біржі
function transferLine(e) {
  const qty = `${fmtQty(e.amount)} ${esc(e.coin)}`;
  return e.dir === 'in' ? `⬇️ <b>+${qty}</b> на ${esc(e.label)}` : `⬆️ <b>−${qty}</b> з ${esc(e.label)}`;
}

function transferDetails(e) {
  const parts = [];
  if (e.internal) parts.push('внутрішній переказ');
  else if (e.network) parts.push('мережа ' + esc(e.network));
  if (e.dir === 'in' && e.peer) parts.push('з ' + esc(e.peer));
  if (e.dir === 'in' && !e.peer && e.from) parts.push('від ' + esc(e.from));
  if (e.dir === 'out' && e.address) parts.push('на ' + esc(e.internal ? e.address : shortAddr(e.address)));
  if (e.dir === 'out' && e.fee) parts.push('комісія ' + fmtQty(e.fee) + ' ' + esc(e.coin));
  return parts.join(' · ');
}

function transferMessage(e) {
  const d = transferDetails(e);
  return transferLine(e) + (d ? '\n' + d : '');
}

// Кілька подій одразу — одним повідомленням, щоб не засипати чат
function transfersMessage(list) {
  if (list.length <= 3) return list.map(transferMessage);
  return ['Рух коштів на біржах · ' + list.length + '\n\n' + list.map(e => {
    const d = transferDetails(e);
    return transferLine(e) + (d ? '\n' + d : '');
  }).join('\n\n')];
}

module.exports = { fmtMoney, fmtQty, monoMessage, transferMessage, transfersMessage, shortAddr };
