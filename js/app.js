/* =========================================================
   NOTION INTEGRATION LAYER
   ========================================================= */

// === TELEGRAM USER ID ===
let currentTgId = null;

function initTelegram() {
  if (window.Telegram && window.Telegram.WebApp) {
    try {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      const u = window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user;
      if (u && u.id) { currentTgId = u.id; return true; }
    } catch (e) { console.warn('TG init failed', e); }
  }
  const params = new URLSearchParams(location.search);
  const devId = params.get('tg');
  if (devId) { currentTgId = parseInt(devId); return true; }
  return false;
}

function showNoTgScreen() {
  document.body.innerHTML = `
    <div style="position:fixed; inset:0; background:#000; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; color:#fff; font-family:'Geist',sans-serif; padding:24px; text-align:center;">
      <div style="font-family:'Geist Mono',monospace; font-weight:800; font-size:22px; letter-spacing:3px;">RENT <span style="color:#ffd60a;">·</span> CONTROL</div>
      <div style="color:#888; font-family:'Geist Mono',monospace; font-size:13px; line-height:1.6; max-width:320px;">
        Відкрий цю апку через Telegram-бот.<br><br>
        <span style="font-size:11px; opacity:0.7;">Поза Telegram дані недоступні.</span>
      </div>
    </div>`;
}

// === NOTION COLUMN NAMES ===
const COL = {
  // Клієнти
  CL_NAME: 'Назва',
  CL_RATE: 'Ставка',
  CL_CUR: 'Валюта',
  CL_START: 'Старт',
  CL_PHONE: 'Телефон',
  CL_TG: 'Telegram',
  CL_SETUP_AMT: 'Setup сума',
  CL_SETUP_CUR: 'Setup валюта',
  CL_PAYMODE: 'Тип оплати',
  CL_BONUS_DAYS: 'Бонусні дні',
  CL_REF: 'Реферал',
  CL_BONUS_AMT: 'Бонус-сума',
  CL_BONUS_GRANTED: 'Бонус виданий',
  // Оплати
  PAY_ID: 'ID',
  PAY_CLIENT: 'Клієнт',
  PAY_DATE: 'Дата',
  PAY_MONTHS: 'Місяців',
  PAY_AMT: 'Сума',
  PAY_CUR: 'Валюта',
  // Робота — записи
  WE_ID: 'ID',
  WE_DATE: 'Дата',
  WE_KIND: 'Тип',
  WE_HOURS: 'Години',
  WE_RATE: 'Ставка',
  WE_RATE_CUR: 'Ставка валюта',
  WE_CAT: 'Категорія',
  WE_TITLE: 'Назва',
  WE_AMT: 'Сума',
  WE_CUR: 'Валюта',
  WE_NOTE: 'Опис',
  // Категорії робіт
  WC_NAME: 'Назва',
  WC_RATE: 'Ставка',
  WC_CUR: 'Валюта',
  WC_DEFAULT: 'За замовчуванням',
  // Виплати по місяцях
  PO_ID: 'ID',
  PO_MONTH: 'Місяць',
  PO_DATE: 'Дата',
  PO_AMT: 'Сума',
  PO_CUR: 'Валюта',
  PO_TYPE: 'Тип',
  PO_CAT: 'Категорія',
  // Цілі
  G_NAME: 'Назва',
  G_TARGET: 'Поточна ціль',
  G_CUR: 'Валюта',
  G_START: 'Старт',
  G_DEADLINE: 'Дедлайн',
  G_ICON: 'Іконка',
  G_LEVELS: 'Історія рівнів',
  G_STATUS: 'Статус',
  // Історія цілей
  GT_ID: 'ID',
  GT_GOAL: 'Ціль',
  GT_DATE: 'Дата',
  GT_AMT: 'Сума',
  GT_CUR: 'Валюта',
  GT_TYPE: 'Тип',
  GT_NOTE: 'Опис',
  // Загальне
  TG_ID: 'Telegram ID'
};

// === SYNC INDICATOR ===
let syncBusy = 0;
function syncStart() { syncBusy++; updateSyncDot(); }
function syncEnd()   { syncBusy = Math.max(0, syncBusy - 1); updateSyncDot(); }
function updateSyncDot() {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  dot.className = 'sync-dot ' + (syncBusy > 0 ? 'syncing' : 'ok');
}

// === NOTION PROXY CALLS ===
// Видиме помилкове повідомлення (банер що НЕ зникає)
function showErrorBanner(msg) {
  let el = document.getElementById('error-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'error-banner';
    el.style.cssText = 'position:fixed; top:0; left:0; right:0; background:#ff4d4d; color:#fff; padding:12px 16px; font-family:"Geist Mono",monospace; font-size:11px; z-index:9999; border-bottom:2px solid #000; word-break:break-word; max-height:40vh; overflow-y:auto;';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:start; gap:10px;"><div style="flex:1;"><b>NOTION ERROR:</b><br>${escapeHtml(msg)}</div><button onclick="document.getElementById('error-banner').remove()" style="background:transparent; border:1px solid #fff; color:#fff; padding:4px 8px; font-family:inherit; font-size:11px; cursor:pointer; border-radius:4px;">×</button></div>`;
}

async function notionCall(payload) {
  syncStart();
  try {
    const res = await fetch('/api/notion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      const errMsg = `${res.status}: ${data.error || data.message || 'Unknown'}\nAction: ${payload.action}, DB: ${payload.database || '(n/a)'}`;
      console.error('Notion call failed:', errMsg, data);
      showErrorBanner(errMsg);
      throw new Error(errMsg);
    }
    return data;
  } catch (e) {
    if (!String(e.message).startsWith('4') && !String(e.message).startsWith('5')) {
      showErrorBanner('Network: ' + e.message);
    }
    throw e;
  } finally { syncEnd(); }
}

async function notionQueryAll(dbKey, sorts) {
  let all = [], cursor = null;
  do {
    const data = await notionCall({ action: 'query', database: dbKey, cursor, sorts });
    all = all.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

// === NOTION PROPERTY HELPERS ===
function getTitle(props, name) {
  const p = props[name]; if (!p || !p.title) return '';
  return p.title.map(t => t.plain_text || '').join('');
}
function getRichText(props, name) {
  const p = props[name]; if (!p || !p.rich_text) return '';
  return p.rich_text.map(t => t.plain_text || '').join('');
}
function getNumber(props, name) {
  const p = props[name]; return (p && p.number != null) ? p.number : null;
}
function getSelect(props, name) {
  const p = props[name]; return (p && p.select) ? p.select.name : null;
}
function getDate(props, name) {
  const p = props[name]; return (p && p.date) ? p.date.start : null;
}
function getCheckbox(props, name) {
  const p = props[name]; return !!(p && p.checkbox);
}
function getRelationFirst(props, name) {
  const p = props[name]; if (!p || !p.relation || !p.relation.length) return null;
  return p.relation[0].id;
}

function pTitle(text) { return { title: [{ text: { content: String(text || '') } }] }; }
function pRichText(text) { return { rich_text: [{ text: { content: String(text || '') } }] }; }
function pNumber(n) { return { number: (n == null || isNaN(n)) ? null : Number(n) }; }
function pSelect(name) { return { select: name ? { name: String(name) } : null }; }
function pDate(iso) { return { date: iso ? { start: iso } : null }; }
function pCheckbox(b) { return { checkbox: !!b }; }
function pRelation(id) { return { relation: id ? [{ id }] : [] }; }

// === PARSERS ===
function parseClient(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: getTitle(p, COL.CL_NAME),
    rate: getNumber(p, COL.CL_RATE) || 0,
    cur: getSelect(p, COL.CL_CUR) || 'USD',
    start: getDate(p, COL.CL_START) || new Date().toISOString().slice(0,10),
    phone: getRichText(p, COL.CL_PHONE),
    tg: getRichText(p, COL.CL_TG),
    setupAmount: getNumber(p, COL.CL_SETUP_AMT) || 0,
    setupCur: getSelect(p, COL.CL_SETUP_CUR) || 'USD',
    payMode: getSelect(p, COL.CL_PAYMODE) || 'prepaid',
    bonusDays: getNumber(p, COL.CL_BONUS_DAYS) || 0,
    referredBy: getRelationFirst(p, COL.CL_REF),
    bonusAmount: getNumber(p, COL.CL_BONUS_AMT) || 0,
    bonusGranted: getCheckbox(p, COL.CL_BONUS_GRANTED),
    tgId: getNumber(p, COL.TG_ID),
    // обчислювальні (заповнюємо з оплат окремо)
    payments: [],
    bonusMonths: 0,
    bonusLog: [],
    pendingPayments: []
  };
}

function parsePayment(page) {
  const p = page.properties;
  return {
    pageId: page.id,
    clientId: getRelationFirst(p, COL.PAY_CLIENT),
    date: getDate(p, COL.PAY_DATE),
    months: getNumber(p, COL.PAY_MONTHS) || 0,
    amountNative: getNumber(p, COL.PAY_AMT) || 0,
    cur: getSelect(p, COL.PAY_CUR) || 'USD',
    tgId: getNumber(p, COL.TG_ID)
  };
}

function parseWorkEntry(page) {
  const p = page.properties;
  return {
    id: page.id,
    date: getDate(p, COL.WE_DATE) || new Date().toISOString().slice(0,10),
    kind: getSelect(p, COL.WE_KIND) || 'hourly',
    hours: getNumber(p, COL.WE_HOURS) || 0,
    rate: getNumber(p, COL.WE_RATE) || 0,
    rateCur: getSelect(p, COL.WE_RATE_CUR) || 'USD',
    categoryId: getRelationFirst(p, COL.WE_CAT),
    title: getRichText(p, COL.WE_TITLE),
    amountNative: getNumber(p, COL.WE_AMT) || 0,
    cur: getSelect(p, COL.WE_CUR) || 'USD',
    note: getRichText(p, COL.WE_NOTE),
    tgId: getNumber(p, COL.TG_ID)
  };
}

function parseWorkCategory(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: getTitle(p, COL.WC_NAME),
    rate: getNumber(p, COL.WC_RATE) || 0,
    cur: getSelect(p, COL.WC_CUR) || 'USD',
    isDefault: getCheckbox(p, COL.WC_DEFAULT),
    tgId: getNumber(p, COL.TG_ID)
  };
}

function parsePayout(page) {
  const p = page.properties;
  return {
    id: page.id,
    month: getRichText(p, COL.PO_MONTH) || getTitle(p, COL.PO_MONTH) || '',
    date: getDate(p, COL.PO_DATE),
    amount: getNumber(p, COL.PO_AMT) || 0,
    cur: getSelect(p, COL.PO_CUR) || 'USD',
    type: getSelect(p, COL.PO_TYPE) || 'advance',
    categoryId: getRelationFirst(p, COL.PO_CAT), // null = "загальна" (для старих виплат)
    tgId: getNumber(p, COL.TG_ID)
  };
}

// === BUILDERS ===
function buildClientProps(c) {
  return {
    [COL.CL_NAME]: pTitle(c.name),
    [COL.CL_RATE]: pNumber(c.rate),
    [COL.CL_CUR]: pSelect(c.cur),
    [COL.CL_START]: pDate(c.start),
    [COL.CL_PHONE]: pRichText(c.phone || ''),
    [COL.CL_TG]: pRichText(c.tg || ''),
    [COL.CL_SETUP_AMT]: pNumber(c.setupAmount || 0),
    [COL.CL_SETUP_CUR]: pSelect(c.setupCur || c.cur),
    [COL.CL_PAYMODE]: pSelect(c.payMode || 'prepaid'),
    [COL.CL_BONUS_DAYS]: pNumber(c.bonusDays || 0),
    [COL.CL_REF]: pRelation(c.referredBy),
    [COL.CL_BONUS_AMT]: pNumber(c.bonusAmount || 0),
    [COL.CL_BONUS_GRANTED]: pCheckbox(!!c.bonusGranted),
    [COL.TG_ID]: pNumber(currentTgId)
  };
}
function buildPaymentProps(clientId, p) {
  return {
    [COL.PAY_ID]: pTitle('pay-' + Date.now().toString(36)),
    [COL.PAY_CLIENT]: pRelation(clientId),
    [COL.PAY_DATE]: pDate(p.date),
    [COL.PAY_MONTHS]: pNumber(p.months),
    [COL.PAY_AMT]: pNumber(p.amountNative),
    [COL.PAY_CUR]: pSelect(p.cur),
    [COL.TG_ID]: pNumber(currentTgId)
  };
}
function buildWorkEntryProps(e) {
  return {
    [COL.WE_ID]: pTitle('we-' + Date.now().toString(36)),
    [COL.WE_DATE]: pDate(e.date),
    [COL.WE_KIND]: pSelect(e.kind),
    [COL.WE_HOURS]: pNumber(e.hours),
    [COL.WE_RATE]: pNumber(e.rate),
    [COL.WE_RATE_CUR]: pSelect(e.rateCur),
    [COL.WE_CAT]: pRelation(e.categoryId),
    [COL.WE_TITLE]: pRichText(e.title || ''),
    [COL.WE_AMT]: pNumber(e.amountNative),
    [COL.WE_CUR]: pSelect(e.cur),
    [COL.WE_NOTE]: pRichText(e.note || ''),
    [COL.TG_ID]: pNumber(currentTgId)
  };
}
function buildWorkCategoryProps(c) {
  return {
    [COL.WC_NAME]: pTitle(c.name),
    [COL.WC_RATE]: pNumber(c.rate),
    [COL.WC_CUR]: pSelect(c.cur),
    [COL.WC_DEFAULT]: pCheckbox(!!c.isDefault),
    [COL.TG_ID]: pNumber(currentTgId)
  };
}
function buildPayoutProps(p) {
  return {
    [COL.PO_ID]: pTitle('po-' + Date.now().toString(36)),
    [COL.PO_MONTH]: pRichText(p.month),
    [COL.PO_DATE]: pDate(p.date),
    [COL.PO_AMT]: pNumber(p.amount),
    [COL.PO_CUR]: pSelect(p.cur),
    [COL.PO_TYPE]: pSelect(p.type),
    [COL.PO_CAT]: pRelation(p.categoryId),
    [COL.TG_ID]: pNumber(currentTgId)
  };
}

// === ЦІЛІ ===
function parseGoal(page) {
  const p = page.properties;
  let levels = [];
  try { levels = JSON.parse(getRichText(p, COL.G_LEVELS) || '[]'); } catch(_){}
  return {
    id: page.id,
    name: getTitle(p, COL.G_NAME),
    target: getNumber(p, COL.G_TARGET) || 0,
    cur: getSelect(p, COL.G_CUR) || 'USD',
    start: getDate(p, COL.G_START) || new Date().toISOString().slice(0,10),
    deadline: getDate(p, COL.G_DEADLINE),
    icon: getRichText(p, COL.G_ICON) || '🎯',
    levels: Array.isArray(levels) ? levels : [],
    status: getSelect(p, COL.G_STATUS) || 'active',
    tgId: getNumber(p, COL.TG_ID),
    // обчислювальні
    transactions: [],
    saved: 0
  };
}
function buildGoalProps(g) {
  return {
    [COL.G_NAME]: pTitle(g.name),
    [COL.G_TARGET]: pNumber(g.target),
    [COL.G_CUR]: pSelect(g.cur),
    [COL.G_START]: pDate(g.start),
    [COL.G_DEADLINE]: pDate(g.deadline),
    [COL.G_ICON]: pRichText(g.icon || '🎯'),
    [COL.G_LEVELS]: pRichText(JSON.stringify(g.levels || [])),
    [COL.G_STATUS]: pSelect(g.status || 'active'),
    [COL.TG_ID]: pNumber(currentTgId)
  };
}
function parseGoalTx(page) {
  const p = page.properties;
  return {
    id: page.id,
    goalId: getRelationFirst(p, COL.GT_GOAL),
    date: getDate(p, COL.GT_DATE),
    amount: getNumber(p, COL.GT_AMT) || 0,
    cur: getSelect(p, COL.GT_CUR) || 'USD',
    type: getSelect(p, COL.GT_TYPE) || 'add', // 'add' | 'take' | 'spent'
    note: getRichText(p, COL.GT_NOTE),
    tgId: getNumber(p, COL.TG_ID)
  };
}
function buildGoalTxProps(goalId, tx) {
  return {
    [COL.GT_ID]: pTitle('gt-' + Date.now().toString(36)),
    [COL.GT_GOAL]: pRelation(goalId),
    [COL.GT_DATE]: pDate(tx.date),
    [COL.GT_AMT]: pNumber(tx.amount),
    [COL.GT_CUR]: pSelect(tx.cur),
    [COL.GT_TYPE]: pSelect(tx.type),
    [COL.GT_NOTE]: pRichText(tx.note || ''),
    [COL.TG_ID]: pNumber(currentTgId)
  };
}

// === LOAD ALL FROM NOTION ===
async function loadAllFromNotion() {
  try {
    const [clientsRaw, paymentsRaw, weRaw, wcRaw, poRaw] = await Promise.all([
      notionQueryAll('DB_CLIENTS'),
      notionQueryAll('DB_PAYMENTS'),
      notionQueryAll('DB_WORK_ENTRIES'),
      notionQueryAll('DB_WORK_CATEGORIES'),
      notionQueryAll('DB_PAYOUTS')
    ]);
    const mine = x => x.tgId === currentTgId;
    const clients = clientsRaw.map(parseClient).filter(mine);
    const payments = paymentsRaw.map(parsePayment).filter(mine);
    const workEntries = weRaw.map(parseWorkEntry).filter(mine);
    const workCats = wcRaw.map(parseWorkCategory).filter(mine);
    const payouts = poRaw.map(parsePayout).filter(mine);

    // payments → клієнти.payments
    for (const c of clients) {
      c.payments = payments
        .filter(p => p.clientId === c.id)
        .map(p => ({ pageId: p.pageId, date: p.date, months: p.months, amountNative: p.amountNative }))
        .sort((a,b) => new Date(a.date) - new Date(b.date));
    }

    state.clients = clients;
    state.work.entries = workEntries;
    state.work.monthlyPayouts = payouts;
    state.workCategories = workCats.length > 0 ? workCats : state.workCategories;
    state.loaded = true;

    // Витрати з Expense (для Dashboard) — окремо, не критично якщо впаде
    loadExpensesFromNotion().catch(e => console.warn('expenses load failed', e));
    // Цілі — окремо, тільки якщо увімкнено
    if (state.settings && state.settings.goalsEnabled) {
      loadGoalsFromNotion().catch(e => console.warn('goals load failed', e));
    }
    return true;
  } catch (e) {
    console.error('Load failed:', e);
    return false;
  }
}

async function loadGoalsFromNotion() {
  try {
    const [gRaw, gtRaw] = await Promise.all([
      notionQueryAll('DB_GOALS'),
      notionQueryAll('DB_GOAL_TX')
    ]);
    const mine = x => x.tgId === currentTgId;
    const goals = gRaw.map(parseGoal).filter(mine);
    const txs = gtRaw.map(parseGoalTx).filter(mine);
    // групуємо транзакції по цілях + рахуємо saved
    for (const g of goals) {
      g.transactions = txs
        .filter(t => t.goalId === g.id)
        .sort((a,b) => new Date(b.date) - new Date(a.date));
      // saved = сума add - сума take (spent теж прибирає)
      g.saved = 0;
      for (const t of g.transactions) {
        const usd = convert(t.amount, t.cur, 'USD');
        const nativeUsd = convert(usd, 'USD', g.cur);
        if (t.type === 'add') g.saved += nativeUsd;
        else if (t.type === 'take' || t.type === 'spent') g.saved -= nativeUsd;
      }
      g.saved = Math.max(0, g.saved);
    }
    state.goals = goals;
    state.goalTransactions = txs;
    if (typeof renderGoals === 'function') renderGoals();
    if (typeof renderDashboard === 'function') renderDashboard();
  } catch (e) {
    console.warn('Цілі не доступні:', e);
    state.goals = [];
    state.goalTransactions = [];
  }
}

async function loadExpensesFromNotion() {
  try {
    const [expRaw, catRaw] = await Promise.all([
      notionQueryAll('DB_EXPENSES'),
      notionQueryAll('DB_CAT_EXPENSES')
    ]);
    const mineOrShared = x => x.shared || x.tgId === currentTgId;
    const mine = x => x.tgId === currentTgId;
    state.expensesFromNotion = expRaw.map(parseExpenseFromNotion).filter(mine);
    state.expenseCats = catRaw.map(parseExpenseCat).filter(mineOrShared);
    renderDashboard();
  } catch (e) {
    console.warn('Експенс-витрати не доступні:', e);
    state.expensesFromNotion = [];
    state.expenseCats = [];
  }
}

// Парсери для бази Expense·Control
function parseExpenseFromNotion(page) {
  const p = page.properties;
  return {
    id: page.id,
    amount: getNumber(p, 'Сума') || 0,
    currency: getSelect(p, 'Валюта') || 'UAH',
    date: getDate(p, 'Дата') || new Date().toISOString().slice(0,10),
    categoryId: getRelationFirst(p, 'Категорія'),
    note: getRichText(p, 'Опис'),
    tgId: getNumber(p, 'Telegram ID')
  };
}
function parseExpenseCat(page) {
  return {
    id: page.id,
    name: getTitle(page.properties, 'Назва'),
    shared: getCheckbox(page.properties, 'Загальна'),
    tgId: getNumber(page.properties, 'Telegram ID')
  };
}

// === CRUD HELPERS ===
// Усі ці функції зберігають локально + асинхронно пушать у Notion.
// Якщо Notion-запит впав — toast, але локально вже є.

// Notion UUID має формат 32-hex з тире або 32 hex без тире (мінімум 30+ символів)
function isNotionId(id) {
  return typeof id === 'string' && id.length >= 30 && /^[a-f0-9-]+$/i.test(id);
}

async function createClientInNotion(localClient) {
  // referredBy може бути локальним id — пропустимо якщо не Notion UUID
  const propsClient = { ...localClient };
  if (propsClient.referredBy && !isNotionId(propsClient.referredBy)) {
    propsClient.referredBy = null;
  }
  try {
    const res = await notionCall({ action: 'create', database: 'DB_CLIENTS', properties: buildClientProps(propsClient) });
    if (res && res.id) localClient.id = res.id;
  } catch (e) { console.warn(e); }
}

async function updateClientInNotion(c) {
  if (!c.id || c.id.length < 30) return; // ще не в Notion
  try {
    await notionCall({ action: 'update', pageId: c.id, properties: buildClientProps(c) });
  } catch (e) { toast('Notion: не вдалось оновити клієнта', 'error'); console.warn(e); }
}

async function deleteClientInNotion(clientId) {
  if (!clientId || clientId.length < 30) return;
  try {
    await notionCall({ action: 'archive', pageId: clientId });
  } catch (e) { toast('Notion: не вдалось видалити клієнта', 'error'); console.warn(e); }
}

async function createPaymentInNotion(clientId, payment) {
  // Якщо клієнт ще не записаний у Notion — чекаємо до 5 секунд
  if (!isNotionId(clientId)) {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      // шукаємо клієнта по локальному id чи по новому id
      const c = state.clients.find(x => x.id === clientId);
      if (c && isNotionId(c.id)) { clientId = c.id; break; }
    }
    if (!isNotionId(clientId)) {
      console.warn('Payment не збережено: клієнт ще не в Notion. Спробуй ще раз пізніше.');
      showErrorBanner('Клієнт ще створюється в Notion. Зачекай 5-10 секунд і додай оплату ще раз.');
      return;
    }
  }
  try {
    const res = await notionCall({ action: 'create', database: 'DB_PAYMENTS', properties: buildPaymentProps(clientId, payment) });
    if (res && res.id) payment.pageId = res.id;
  } catch (e) { console.warn(e); }
}

async function createWorkEntryInNotion(entry) {
  // Якщо категорія ще не в Notion — спершу чекаємо
  if (entry.categoryId && !isNotionId(entry.categoryId)) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 500));
      const cat = state.workCategories.find(c => c.id === entry.categoryId);
      if (cat && isNotionId(cat.id)) { entry.categoryId = cat.id; break; }
    }
    if (!isNotionId(entry.categoryId)) {
      // якщо категорія не встигла — шлемо без неї
      entry.categoryId = null;
    }
  }
  try {
    const res = await notionCall({ action: 'create', database: 'DB_WORK_ENTRIES', properties: buildWorkEntryProps(entry) });
    if (res && res.id) entry.id = res.id;
  } catch (e) { console.warn(e); }
}

async function updateWorkEntryInNotion(entry) {
  if (!entry.id || entry.id.length < 30) return;
  try {
    await notionCall({ action: 'update', pageId: entry.id, properties: buildWorkEntryProps(entry) });
  } catch (e) { toast('Notion: не вдалось оновити запис', 'error'); console.warn(e); }
}

async function deleteWorkEntryInNotion(entryId) {
  if (!entryId || entryId.length < 30) return;
  try {
    await notionCall({ action: 'archive', pageId: entryId });
  } catch (e) { console.warn(e); }
}

async function deletePaymentInNotion(paymentPageId) {
  if (!paymentPageId || paymentPageId.length < 30) return;
  try {
    await notionCall({ action: 'archive', pageId: paymentPageId });
  } catch (e) { console.warn(e); }
}

async function createWorkCategoryInNotion(cat) {
  try {
    const res = await notionCall({ action: 'create', database: 'DB_WORK_CATEGORIES', properties: buildWorkCategoryProps(cat) });
    if (res && res.id) cat.id = res.id;
  } catch (e) { toast('Notion: не вдалось зберегти категорію', 'error'); console.warn(e); }
}

async function updateWorkCategoryInNotion(cat) {
  if (!cat.id || cat.id.length < 30) return;
  try {
    await notionCall({ action: 'update', pageId: cat.id, properties: buildWorkCategoryProps(cat) });
  } catch (e) { toast('Notion: не вдалось оновити категорію', 'error'); console.warn(e); }
}

async function deleteWorkCategoryInNotion(catId) {
  if (!catId || catId.length < 30) return;
  try {
    await notionCall({ action: 'archive', pageId: catId });
  } catch (e) { console.warn(e); }
}

async function createPayoutInNotion(payout) {
  try {
    const res = await notionCall({ action: 'create', database: 'DB_PAYOUTS', properties: buildPayoutProps(payout) });
    if (res && res.id) payout.id = res.id;
  } catch (e) { toast('Notion: не вдалось зберегти виплату', 'error'); console.warn(e); }
}

async function updatePayoutInNotion(payout) {
  if (!payout.id || payout.id.length < 30) return;
  try {
    await notionCall({ action: 'update', pageId: payout.id, properties: buildPayoutProps(payout) });
  } catch (e) { console.warn(e); }
}

async function deletePayoutInNotion(payoutId) {
  if (!payoutId || payoutId.length < 30) return;
  try {
    await notionCall({ action: 'archive', pageId: payoutId });
  } catch (e) { console.warn(e); }
}

// === ЦІЛІ CRUD ===
async function createGoalInNotion(g) {
  try {
    const res = await notionCall({ action: 'create', database: 'DB_GOALS', properties: buildGoalProps(g) });
    if (res && res.id) g.id = res.id;
  } catch (e) { toast('Notion: не вдалось зберегти ціль', 'error'); console.warn(e); }
}
async function updateGoalInNotion(g) {
  if (!g.id || g.id.length < 30) return;
  try {
    await notionCall({ action: 'update', pageId: g.id, properties: buildGoalProps(g) });
  } catch (e) { console.warn(e); }
}
async function deleteGoalInNotion(goalId) {
  if (!goalId || goalId.length < 30) return;
  try {
    await notionCall({ action: 'archive', pageId: goalId });
  } catch (e) { console.warn(e); }
}
async function createGoalTxInNotion(goalId, tx) {
  // якщо goalId ще не Notion UUID — чекаємо
  if (!isNotionId(goalId)) {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      const g = state.goals.find(x => x.id === goalId);
      if (g && isNotionId(g.id)) { goalId = g.id; break; }
    }
    if (!isNotionId(goalId)) {
      showErrorBanner('Ціль ще створюється. Зачекай і повтори.');
      return;
    }
  }
  try {
    const res = await notionCall({ action: 'create', database: 'DB_GOAL_TX', properties: buildGoalTxProps(goalId, tx) });
    if (res && res.id) tx.id = res.id;
  } catch (e) { console.warn(e); }
}
async function deleteGoalTxInNotion(txId) {
  if (!txId || txId.length < 30) return;
  try {
    await notionCall({ action: 'archive', pageId: txId });
  } catch (e) { console.warn(e); }
}

/* =========================================================
   STATE
   ========================================================= */
const STORE = 'rent-control-v3';
let state = loadState();
let openBoardId = null;
let payDraft = { months: 0, mode: 'months' };

function loadState() {
  let s = null;
  // 1) пробуємо localStorage (основне сховище)
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) s = JSON.parse(raw);
  } catch (e) {}
  // 2) якщо нема — пробуємо window.name (для міграції зі старих версій)
  if (!s) {
    try {
      if (window.name && window.name.startsWith(STORE)) {
        s = JSON.parse(window.name.slice(STORE.length));
      }
    } catch (e) {}
  }
  if (!s) {
    s = {
      rates: { UAH: 41, PLN: 4.0 },
      ratesAuto: true,
      ratesUpdated: null,
      ratesSource: null,
      display: 'USD',
      view: 'clients',
      clients: [],
      work: null,
      workCategories: null,
      incomePeriod: 'all',
      dashboardPeriod: 'month'
    };
  }
  // міграція: гарантуємо що work існує
  if (!s.work) {
    s.work = {
      mode: 'hourly',
      hourlyRate: 15,
      hourlyCur: 'USD',
      period: 'month',
      entries: []
    };
  }
  // міграція: категорії робіт (нова фіча)
  if (!s.workCategories) {
    s.workCategories = [
      { id: 'budova', name: 'Будова', rate: 15, cur: 'USD', isDefault: true },
      { id: 'pidrobitok', name: 'Підробіток', rate: 10, cur: 'USD', isDefault: false }
    ];
  }
  // міграція: проставити ставку в існуючі hourly-записи що її не мали
  for (const e of s.work.entries) {
    if (e.kind === 'hourly' && e.rate == null) {
      e.rate = s.work.hourlyRate;
      e.rateCur = s.work.hourlyCur;
    }
    if (e.kind === 'hourly' && !e.categoryId) {
      e.categoryId = s.workCategories[0].id;
    }
  }
  // міграція: bonusDays на клієнтах
  for (const c of s.clients) {
    if (c.bonusDays == null) c.bonusDays = 0;
    if (!c.payMode) c.payMode = 'prepaid';
    if (!c.pendingPayments) c.pendingPayments = [];
  }
  // міграція: monthlyPayouts (виплати за місяці роботи)
  if (!s.work.monthlyPayouts) {
    s.work.monthlyPayouts = [];
    // позначаємо всі існуючі місяці з роботою як виплачені
    const monthsWithWork = new Set();
    for (const e of s.work.entries) {
      if (e.kind !== 'hourly') continue;
      const d = new Date(e.date);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      monthsWithWork.add(key);
    }
    for (const monthKey of monthsWithWork) {
      // нараховано за цей місяць
      let accrued = 0;
      for (const e of s.work.entries) {
        if (e.kind !== 'hourly') continue;
        const d = new Date(e.date);
        const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (k !== monthKey) continue;
        const rate = e.rate != null ? e.rate : s.work.hourlyRate;
        const cur = e.rateCur || s.work.hourlyCur;
        accrued += (e.hours || 0) * rate; // у валюті ставки; для міграції спрощено в USD
      }
      const [y, m] = monthKey.split('-').map(Number);
      const lastDay = new Date(y, m, 0); // останній день місяця
      s.work.monthlyPayouts.push({
        id: 'mig-' + monthKey,
        month: monthKey,
        date: lastDay.toISOString().slice(0, 10),
        amount: accrued,
        cur: s.work.hourlyCur || 'USD',
        type: 'final' // 'advance' або 'final'
      });
    }
  }
  if (!s.workEarnedMode) s.workEarnedMode = 'accrued'; // 'accrued' | 'paid'
  if (!s.incomePeriod) s.incomePeriod = 'all';
  if (!s.dashboardPeriod) s.dashboardPeriod = 'month';
  // Цілі
  if (!s.goals) s.goals = [];
  if (!s.goalTransactions) s.goalTransactions = [];
  if (!s.settings) s.settings = {};
  if (s.settings.goalsEnabled == null) s.settings.goalsEnabled = false;
  // Тумблери вкладок
  if (s.settings.tabClients == null) s.settings.tabClients = true;
  if (s.settings.tabWork == null) s.settings.tabWork = true;
  if (s.settings.tabOverview == null) s.settings.tabOverview = true;
  // Огляд (обʼєднана Статистика+Dashboard) — стейт для пікера періоду
  if (!s.overview) s.overview = {
    kind: 'month',   // 'day' | 'week' | 'month' | 'year'
    anchor: toISOsafe(new Date())  // якір, з якого рахуємо період
  };
  return s;
}

function toISOsafe(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.toISOString().slice(0,10);
}
function saveState() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch (e) {
    // якщо квоту перевищено або приватний режим — fallback на window.name
    try { window.name = STORE + JSON.stringify(state); } catch (e2) {}
  }
}

/* =========================================================
   ТОСТИ + КОНФІРМИ
   ========================================================= */
function toast(msg, kind = '') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  c.appendChild(t);
  haptic(kind === 'error' ? 'error' : 'light');
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 250);
  }, 2400);
}

function haptic(kind = 'light') {
  if (!navigator.vibrate) return;
  if (kind === 'light') navigator.vibrate(8);
  else if (kind === 'medium') navigator.vibrate(15);
  else if (kind === 'success') navigator.vibrate([10, 40, 10]);
  else if (kind === 'error') navigator.vibrate([30, 30, 30]);
}

let confirmCb = null;
function confirmDialog({ title, text, icon = '⚠️', okText = 'Так', cancelText = 'Скасувати', danger = true }) {
  return new Promise(resolve => {
    document.getElementById('cm-title').textContent = title;
    document.getElementById('cm-text').textContent = text;
    document.getElementById('cm-icon').textContent = icon;
    document.getElementById('cm-ok').textContent = okText;
    document.getElementById('cm-cancel').textContent = cancelText;
    document.getElementById('cm-ok').style.background = danger ? 'var(--danger)' : 'var(--yellow)';
    document.getElementById('cm-ok').style.color = danger ? '#fff' : '#000';
    confirmCb = resolve;
    document.getElementById('ov-confirm').classList.add('open');
  });
}
document.getElementById('cm-ok').addEventListener('click', () => {
  document.getElementById('ov-confirm').classList.remove('open');
  if (confirmCb) { confirmCb(true); confirmCb = null; }
});
document.getElementById('cm-cancel').addEventListener('click', () => {
  document.getElementById('ov-confirm').classList.remove('open');
  if (confirmCb) { confirmCb(false); confirmCb = null; }
});

/* =========================================================
   КУРСИ — БАГАТО ДЖЕРЕЛ
   ========================================================= */
const FX_SOURCES = [
  {
    name: 'НБУ',
    url: 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json',
    parse: data => {
      if (!Array.isArray(data)) return null;
      const usd = data.find(x => x.cc === 'USD');
      const pln = data.find(x => x.cc === 'PLN');
      if (!usd) return null;
      // НБУ дає курс UAH за 1 одиницю валюти
      const uahPerUsd = usd.rate;
      const uahPerPln = pln ? pln.rate : null;
      // PLN за 1 USD = UAH/USD ÷ UAH/PLN
      const plnPerUsd = uahPerPln ? uahPerUsd / uahPerPln : null;
      return { UAH: uahPerUsd, PLN: plnPerUsd };
    }
  },
  {
    name: 'ExchangeRate-API',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: data => {
      if (!data || !data.rates) return null;
      return {
        UAH: data.rates.UAH || null,
        PLN: data.rates.PLN || null
      };
    }
  },
  {
    name: 'PrivatBank',
    url: 'https://api.privatbank.ua/p24api/pubinfo?json&exchange&coursid=11',
    parse: data => {
      if (!Array.isArray(data)) return null;
      const usd = data.find(x => x.ccy === 'USD');
      const pln = data.find(x => x.ccy === 'PLN');
      const uahPerUsd = usd ? parseFloat(usd.sale) : null;
      const uahPerPln = pln ? parseFloat(pln.sale) : null;
      if (!uahPerUsd) return null;
      return {
        UAH: uahPerUsd,
        PLN: uahPerPln ? uahPerUsd / uahPerPln : null
      };
    }
  }
];

async function fetchRates() {
  setFxDot('loading');
  for (const src of FX_SOURCES) {
    try {
      const r = await fetch(src.url);
      if (!r.ok) continue;
      const data = await r.json();
      const rates = src.parse(data);
      if (!rates || !rates.UAH) continue;
      state.rates.UAH = Math.round(rates.UAH * 100) / 100;
      if (rates.PLN) state.rates.PLN = Math.round(rates.PLN * 1000) / 1000;
      state.ratesAuto = true;
      state.ratesSource = src.name;
      state.ratesUpdated = new Date().toISOString();
      saveState();
      renderFx();
      renderAll();
      setFxDot('ok');
      return true;
    } catch (e) { continue; }
  }
  setFxDot('error');
  return false;
}

function setFxDot(s) {
  document.getElementById('fx-dot').className = 'fx-dot' + (s === 'ok' ? '' : ' ' + s);
}
function renderFx() {
  document.getElementById('fx-summary').textContent =
    '$1 = ' + state.rates.UAH.toFixed(2) + '₴ · ' + state.rates.PLN.toFixed(2) + 'zł';
}

/* =========================================================
   КОНВЕРТАЦІЯ
   ========================================================= */
const SYM = { USD: '$', UAH: '₴', PLN: 'zł' };

// у будь-яку валюту з будь-якої через USD як base
function convert(amount, fromCur, toCur) {
  if (fromCur === toCur) return amount;
  // → USD
  let usd;
  if (fromCur === 'USD') usd = amount;
  else usd = amount / state.rates[fromCur];
  // USD → toCur
  if (toCur === 'USD') return usd;
  return usd * state.rates[toCur];
}

function fmtMoney(amount, fromCur, toCur = null) {
  const target = toCur || state.display;
  const v = convert(amount, fromCur, target);
  return formatNum(v, target);
}

function formatNum(v, cur) {
  const sym = SYM[cur];
  const abs = Math.abs(v);
  let n;
  if (abs >= 10000) n = Math.round(v).toLocaleString('en-US');
  else if (abs >= 1000) n = Math.round(v).toLocaleString('en-US');
  else if (abs >= 100) n = Math.round(v).toString();
  else if (abs >= 10) n = (Math.round(v * 10) / 10).toString();
  else n = (Math.round(v * 100) / 100).toString();
  // символ ліворуч для $, праворуч для ₴ і zł
  if (cur === 'USD') return sym + n;
  return n + sym;
}

/* =========================================================
   ДАТИ
   ========================================================= */
const MS_DAY = 86400000;
const AVG_MONTH_DAYS = 30.44;

function today() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function parseDate(s) { const d = new Date(s + 'T00:00:00'); d.setHours(0,0,0,0); return d; }
function toISO(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}
function fmtDate(d) {
  return d.toLocaleDateString('uk-UA', { day:'2-digit', month:'short', year:'numeric' });
}
function daysBetween(a, b) { return Math.round((b - a) / MS_DAY); }
function addMonthsDays(date, monthsFloat) {
  const whole = Math.floor(monthsFloat);
  const frac = monthsFloat - whole;
  const d = new Date(date);
  d.setMonth(d.getMonth() + whole);
  d.setDate(d.getDate() + Math.round(frac * AVG_MONTH_DAYS));
  d.setHours(0,0,0,0);
  return d;
}
function splitMonthsDays(m) {
  const whole = Math.floor(m);
  const days = Math.round((m - whole) * AVG_MONTH_DAYS);
  return { months: whole, days };
}
function fmtMonthsDays(m) {
  const { months, days } = splitMonthsDays(m);
  if (months === 0 && days === 0) return '0 дн';
  const parts = [];
  if (months > 0) parts.push(months + ' міс');
  if (days > 0) parts.push(days + ' дн');
  return parts.join(' ');
}

/* =========================================================
   КЛІЄНТИ
   ========================================================= */
function rateInDisplay(c) {
  // ставка клієнта переводиться в обрану для відображення валюту
  return convert(c.rate, c.cur, state.display);
}
function totalMonths(c) { return c.payments.reduce((s, p) => s + p.months, 0); }
function bonusMonths(c) { return (c.bonusMonths || 0); }
function totalAllMonths(c) { return totalMonths(c) + bonusMonths(c); }

/* ефективна стартова дата клієнта (з врахуванням бонусних днів — разовий зсув) */
function effectiveStart(c) {
  const d = parseDate(c.start);
  if (c.bonusDays && c.bonusDays > 0) {
    d.setDate(d.getDate() + c.bonusDays);
  }
  return d;
}

/* дата кінця ПЛАТНОГО періоду (без реферал-бонусу) */
function paidUntilDate(c) {
  // постоплата: "оплачений" період — це effectiveStart + кількість оплачених місяців
  // (1 оплата = 1 місяць закрито від ефективного старту)
  if (c.payMode === 'postpaid') {
    return addMonthsDays(effectiveStart(c), totalMonths(c));
  }
  // передплата: те саме
  return addMonthsDays(effectiveStart(c), totalMonths(c));
}

/* дата КОЛИ ОЧІКУЄТЬСЯ НАСТУПНА ОПЛАТА */
function nextPayDate(c) {
  // постоплата: завжди наступний місяць після останньої оплати (або після effectiveStart якщо ще не платив)
  if (c.payMode === 'postpaid') {
    // якщо вже платили — від останньої оплати + 1 місяць
    if (c.payments && c.payments.length > 0) {
      const lastDate = parseDate(c.payments[c.payments.length - 1].date);
      return addMonthsDays(lastDate, 1);
    }
    // ще не платили — effectiveStart + 1 місяць (тобто завершення першого "користувацького" місяця)
    return addMonthsDays(effectiveStart(c), 1);
  }
  // передплата: ефективний старт + усі оплачені місяці + реферал-бонус
  return addMonthsDays(effectiveStart(c), totalAllMonths(c));
}
function statusOf(c) {
  const d = daysBetween(today(), nextPayDate(c));
  if (d <= 0) return { cls: 's-due', days: d };
  if (d <= 3) return { cls: 's-warn', days: d };
  if (d <= 7) return { cls: 's-soon', days: d };
  return { cls: 's-ok', days: d };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

/* =========================================================
   CASHFLOW HERO
   ========================================================= */
function portfolioMonthlyInDisplay() {
  return state.clients.reduce((s, c) => s + rateInDisplay(c), 0);
}
function renderHero() {
  const m = portfolioMonthlyInDisplay();
  const y = m * 12;
  const d = m / AVG_MONTH_DAYS;
  const h = d / 24;
  const cells = [
    { p: 'година', v: h },
    { p: 'день',   v: d },
    { p: 'місяць', v: m },
    { p: 'рік',    v: y },
  ];
  document.getElementById('cf-grid').innerHTML = cells.map(c => `
    <div class="cf-oval">
      <div class="cf-period">${c.p}</div>
      <div class="cf-val">${formatNum(c.v, state.display)}</div>
    </div>
  `).join('');
}

/* =========================================================
   LIST
   ========================================================= */
function renderClients() {
  const list = document.getElementById('client-list');
  const n = state.clients.length;
  document.getElementById('client-count').textContent =
    n === 0 ? '0' : n + (n === 1 ? ' активний' : ' активних');

  if (n === 0) {
    list.innerHTML = '<div class="empty"><div class="em-emoji">∅</div>Поки немає орендарів<br>Тапни «Додати орендаря» вгорі</div>';
    return;
  }

  const sorted = [...state.clients].sort((a,b) => statusOf(a).days - statusOf(b).days);

  list.innerHTML = sorted.map(c => {
    const st = statusOf(c);
    const next = nextPayDate(c);
    const m = rateInDisplay(c);
    const d = m / AVG_MONTH_DAYS;
    const y = m * 12;

    let nextTxt, nextCls = '';
    if (st.days > 1) nextTxt = 'через ' + st.days + ' дн · ' + fmtDate(next);
    else if (st.days === 1) { nextTxt = 'завтра · ' + fmtDate(next); nextCls = 'warn'; }
    else if (st.days === 0) { nextTxt = 'СЬОГОДНІ · ' + fmtDate(next); nextCls = 'due'; }
    else { nextTxt = 'прострочено ' + Math.abs(st.days) + ' дн'; nextCls = 'due'; }

    return `
      <div class="client ${st.cls}" data-id="${c.id}">
        <div class="client-top">
          <div><div class="client-name">${escapeHtml(c.name)}</div></div>
          <div class="client-rate">
            <div class="rate-val">${formatNum(m, state.display)}/міс</div>
            <div class="rate-next ${nextCls}">${nextTxt}</div>
          </div>
        </div>
        <div class="pods">
          <div class="pod"><div class="pod-label">день</div><div class="pod-val">${formatNum(d, state.display)}</div></div>
          <div class="pod"><div class="pod-label">місяць</div><div class="pod-val">${formatNum(m, state.display)}</div></div>
          <div class="pod"><div class="pod-label">рік</div><div class="pod-val">${formatNum(y, state.display)}</div></div>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.client').forEach(el =>
    el.addEventListener('click', () => { haptic('light'); openBoard(el.dataset.id); }));
}

/* =========================================================
   СТАТИСТИКА — виконано vs процес
   =========================================================
   Кожна оплата покриває певний період починаючи з поточної дати
   "наступної оплати" на момент зарахування. Але простіше: оплата
   стартує там, де закінчилася попередня (або від client.start
   для першої). Тривалість = months × AVG_MONTH_DAYS.

   На сьогодні:
   - якщо вся тривалість позаду → 100% виконано
   - якщо вся попереду → 100% в процесі
   - якщо частково → пропорційно
   ========================================================= */

function paymentSpans(c) {
  // повертає масив { startDate, endDate, amountNative, cur }
  const spans = [];
  let cursor = parseDate(c.start);
  // оплати ідуть в тому ж порядку, в якому додавалися
  for (const p of c.payments) {
    const start = new Date(cursor);
    const end = addMonthsDays(cursor, p.months);
    spans.push({
      start, end,
      amountNative: p.amountNative,
      cur: p.cur || c.cur
    });
    cursor = end;
  }
  return spans;
}

function spanDoneRatio(span, now) {
  const total = span.end - span.start;
  if (total <= 0) return 1;
  if (now >= span.end) return 1;
  if (now <= span.start) return 0;
  return (now - span.start) / total;
}

/* виконане до моменту `now` (за весь період <= now) */
function clientDoneUSD(c, now) {
  let done = 0;
  for (const s of paymentSpans(c)) {
    const ratio = spanDoneRatio(s, now);
    const usd = convert(s.amountNative, s.cur, 'USD');
    done += usd * ratio;
  }
  return done;
}

/* виконане в межах інтервалу [from, to] */
function clientDoneBetweenUSD(c, from, to) {
  let done = 0;
  for (const s of paymentSpans(c)) {
    // перетин span ∩ [from, to]
    const start = Math.max(s.start, from);
    const end = Math.min(s.end, to);
    if (end <= start) continue;
    const total = s.end - s.start;
    if (total <= 0) continue;
    const portion = (end - start) / total;
    const usd = convert(s.amountNative, s.cur, 'USD');
    done += usd * portion;
  }
  return done;
}

/* в процесі — все що ще попереду на сьогодні */
function clientInProgressUSD(c, now) {
  let prog = 0;
  for (const s of paymentSpans(c)) {
    if (now >= s.end) continue;
    const total = s.end - s.start;
    if (total <= 0) continue;
    let remaining;
    if (now <= s.start) remaining = 1;
    else remaining = (s.end - now) / total;
    const usd = convert(s.amountNative, s.cur, 'USD');
    prog += usd * remaining;
  }
  return prog;
}

/* =========================================================
   REFERRAL / БОНУСИ
   =========================================================
   Бонус для реферера спрацьовує коли НОВИЙ клієнт:
   1) має оплат ≥ 1 місяць
   2) пройшов ≥ 1 місяць з дати start
   ========================================================= */
function isReferralReady(newClient, now = today()) {
  if (totalMonths(newClient) < 1) return false;
  const startMs = parseDate(newClient.start).getTime();
  const daysPassed = (now.getTime() - startMs) / MS_DAY;
  if (daysPassed < AVG_MONTH_DAYS) return false;
  return true;
}

/* Перевіряємо всіх клієнтів — якщо реферал готовий і ще не нараховано — нараховуємо */
function settleReferrals(silent = false) {
  let granted = 0;
  const now = today();
  for (const c of state.clients) {
    if (!c.referredBy || !c.bonusAmount) continue;
    if (c.bonusGranted) continue;
    if (!isReferralReady(c, now)) continue;
    const referrer = state.clients.find(x => x.id === c.referredBy);
    if (!referrer) continue;
    referrer.bonusMonths = (referrer.bonusMonths || 0) + c.bonusAmount;
    referrer.bonusLog = referrer.bonusLog || [];
    referrer.bonusLog.push({
      fromId: c.id,
      fromName: c.name,
      months: c.bonusAmount,
      date: toISO(now)
    });
    c.bonusGranted = true;
    c.bonusGrantedDate = toISO(now);
    granted++;
  }
  if (granted > 0) {
    saveState();
    if (!silent) {
      toast(`Нараховано бонус: ${granted}`, 'success');
      haptic('success');
    }
  }
  return granted;
}

/* для статистики — отримані вхідні реферали (хто кого привів) */
function referralsBroughtBy(c) {
  return state.clients.filter(x => x.referredBy === c.id);
}

/* ВАРТІСТЬ нарахованих бонусів у USD (за поточною ставкою реферера) */
function totalGrantedBonusUSD() {
  let sum = 0;
  for (const c of state.clients) {
    if (!c.referredBy || !c.bonusGranted) continue;
    const referrer = state.clients.find(x => x.id === c.referredBy);
    if (!referrer) continue;
    const rateUSD = convert(referrer.rate, referrer.cur, 'USD');
    sum += rateUSD * c.bonusAmount;
  }
  return sum;
}

function totalPendingBonusUSD() {
  let sum = 0;
  for (const c of state.clients) {
    if (!c.referredBy || c.bonusGranted) continue;
    if (!c.bonusAmount) continue;
    const referrer = state.clients.find(x => x.id === c.referredBy);
    if (!referrer) continue;
    const rateUSD = convert(referrer.rate, referrer.cur, 'USD');
    sum += rateUSD * c.bonusAmount;
  }
  return sum;
}

function startOf(unit, now = new Date()) {
  const d = new Date(now);
  d.setHours(0,0,0,0);
  if (unit === 'day') return d;
  if (unit === 'week') {
    const wd = (d.getDay() + 6) % 7; // понеділок = 0
    d.setDate(d.getDate() - wd);
    return d;
  }
  if (unit === 'month') { d.setDate(1); return d; }
  if (unit === 'year') { d.setMonth(0,1); return d; }
  return d;
}

/* дохід з оренди (виконане) за період [from, to] в USD */
function rentEarnedUSD(period) {
  const now = new Date();
  if (period === 'all') {
    // все виконане до сьогодні
    let s = 0;
    for (const c of state.clients) s += clientDoneUSD(c, now.getTime());
    return s;
  }
  const from = startOf(period, now).getTime();
  const to = now.getTime() + MS_DAY;
  let s = 0;
  for (const c of state.clients) {
    s += clientDoneBetweenUSD(c, from, to);
  }
  return s;
}

const INCOME_PERIOD_TAG = { day: 'сьогодні', week: 'цей тиждень', month: 'цей місяць', all: 'за весь час' };

/* дохід з разових плат (розробка) за період в USD */
function setupEarnedUSD(period) {
  const now = new Date();
  let from, to;
  if (period === 'all') { from = 0; to = Infinity; }
  else { from = startOf(period, now).getTime(); to = now.getTime() + MS_DAY; }
  let sum = 0;
  for (const c of state.clients) {
    if (!c.setupAmount || c.setupAmount <= 0) continue;
    // разова плата зараховується на дату старту
    const t = parseDate(c.start).getTime();
    if (t >= from && t < to) {
      sum += convert(c.setupAmount, c.setupCur || 'USD', 'USD');
    }
  }
  return sum;
}

function renderIncomeSplit() {
  const p = state.incomePeriod;
  // активний стан перемикача нараховане/виплачене
  document.querySelectorAll('#work-mode-pick button').forEach(b =>
    b.classList.toggle('active', b.dataset.wm === (state.workEarnedMode || 'accrued')));
  const rentUSD = rentEarnedUSD(p);
  const workUSD = workEarnedUSD(p);
  const setupUSD = setupEarnedUSD(p);
  const totalUSD = rentUSD + workUSD + setupUSD;

  document.getElementById('income-period-tag').textContent = INCOME_PERIOD_TAG[p];
  document.querySelectorAll('#income-period-pick button').forEach(b =>
    b.classList.toggle('active', b.dataset.ip === p));

  document.getElementById('inc-rent').textContent =
    formatNum(convert(rentUSD, 'USD', state.display), state.display);
  document.getElementById('inc-work').textContent =
    formatNum(convert(workUSD, 'USD', state.display), state.display);
  document.getElementById('inc-setup').textContent =
    formatNum(convert(setupUSD, 'USD', state.display), state.display);
  document.getElementById('inc-total').textContent =
    formatNum(convert(totalUSD, 'USD', state.display), state.display);

  const rentPct = totalUSD > 0 ? (rentUSD / totalUSD) * 100 : 0;
  const workPct = totalUSD > 0 ? (workUSD / totalUSD) * 100 : 0;
  const setupPct = totalUSD > 0 ? (setupUSD / totalUSD) * 100 : 0;
  document.getElementById('inc-bar-rent').style.width = rentPct + '%';
  document.getElementById('inc-bar-work').style.width = workPct + '%';
  document.getElementById('inc-bar-setup').style.width = setupPct + '%';
  document.getElementById('inc-leg-rent').innerHTML = '● оренда ' + Math.round(rentPct) + '%';
  document.getElementById('inc-leg-work').innerHTML = '● робота ' + Math.round(workPct) + '%';
  document.getElementById('inc-leg-setup').innerHTML = '● розробка ' + Math.round(setupPct) + '%';
}

function renderStats() {
  renderIncomeSplit();
  const now = new Date();
  const nowMs = now.getTime();

  let doneTotalUSD = 0;
  let progTotalUSD = 0;
  for (const c of state.clients) {
    doneTotalUSD += clientDoneUSD(c, nowMs);
    progTotalUSD += clientInProgressUSD(c, nowMs);
  }
  const totalUSD = doneTotalUSD + progTotalUSD;

  // великі блоки
  document.getElementById('st-done-val').textContent =
    formatNum(convert(doneTotalUSD, 'USD', state.display), state.display);
  document.getElementById('st-prog-val').textContent =
    formatNum(convert(progTotalUSD, 'USD', state.display), state.display);

  // split bar
  const donePct = totalUSD > 0 ? (doneTotalUSD / totalUSD) * 100 : 0;
  const progPct = totalUSD > 0 ? (progTotalUSD / totalUSD) * 100 : 0;
  document.getElementById('split-done').style.width = donePct + '%';
  document.getElementById('split-prog').style.width = progPct + '%';
  document.getElementById('split-pct').textContent =
    totalUSD > 0 ? Math.round(donePct) + '% / ' + Math.round(progPct) + '%' : '—';
  document.getElementById('leg-done').innerHTML =
    '● виконано ' + formatNum(convert(doneTotalUSD, 'USD', state.display), state.display);
  document.getElementById('leg-prog').innerHTML =
    '● процес ' + formatNum(convert(progTotalUSD, 'USD', state.display), state.display);

  // періоди
  const periods = [
    { label: 'сьогодні', from: startOf('day', now) },
    { label: 'цей тижд', from: startOf('week', now) },
    { label: 'цей міс',  from: startOf('month', now) },
    { label: 'цей рік',  from: startOf('year', now) },
  ];
  const periodHtml = periods.map(p => {
    let s = 0;
    for (const c of state.clients) {
      s += clientDoneBetweenUSD(c, p.from.getTime(), nowMs);
    }
    return `
      <div class="per-cell">
        <div class="pc-l">${p.label}</div>
        <div class="pc-v">${formatNum(convert(s, 'USD', state.display), state.display)}</div>
      </div>`;
  }).join('');
  document.getElementById('period-grid').innerHTML = periodHtml;

  // leaderboard — топ за done всього часу
  const lb = state.clients
    .map(c => ({ c, done: clientDoneUSD(c, nowMs) }))
    .filter(x => x.done > 0)
    .sort((a,b) => b.done - a.done)
    .slice(0, 10);

  const lbWrap = document.getElementById('leaderboard');
  if (lb.length === 0) {
    lbWrap.innerHTML = '<div class="empty"><div class="em-emoji">∅</div>Ще немає виконаних оплат</div>';
  } else {
    lbWrap.innerHTML = lb.map((x, i) => `
      <div class="lb-row">
        <div class="lb-rank ${i === 0 ? 'first' : ''}">#${i+1}</div>
        <div class="lb-name">${escapeHtml(x.c.name)}</div>
        <div class="lb-val">${formatNum(convert(x.done, 'USD', state.display), state.display)}</div>
      </div>
    `).join('');
  }

  // ============ БОНУСИ ============
  const grantedUSD = totalGrantedBonusUSD();
  const pendingUSD = totalPendingBonusUSD();
  document.getElementById('st-bonus-granted').textContent =
    formatNum(convert(grantedUSD, 'USD', state.display), state.display);
  document.getElementById('st-bonus-pending').textContent =
    formatNum(convert(pendingUSD, 'USD', state.display), state.display);

  const refList = document.getElementById('ref-list');
  const allRefs = state.clients.filter(c => c.referredBy && c.bonusAmount);
  if (allRefs.length === 0) {
    refList.innerHTML = '<div class="empty"><div class="em-emoji">∅</div>Ще немає приведених клієнтів</div>';
  } else {
    refList.innerHTML = allRefs.map(c => {
      const referrer = state.clients.find(x => x.id === c.referredBy);
      if (!referrer) return '';
      const rateUSD = convert(referrer.rate, referrer.cur, 'USD');
      const bonusUSD = rateUSD * c.bonusAmount;
      const bonusDisp = convert(bonusUSD, 'USD', state.display);
      const ready = isReferralReady(c, today());
      return `
        <div class="referral-row ${c.bonusGranted ? 'granted' : 'pending'}">
          <span class="rr-name">${escapeHtml(referrer.name)} ← ${escapeHtml(c.name)}</span>
          <span class="rr-months">+${c.bonusAmount} міс · ${formatNum(bonusDisp, state.display)}</span>
          <span class="rr-status">${c.bonusGranted ? '✓ нараховано' : (ready ? '⏳ готує' : 'очікує')}</span>
        </div>
      `;
    }).join('');
  }
}

/* =========================================================
   РОБОТА — погодинно / фікс
   ========================================================= */
function workEntryUSD(e) {
  if (e.kind === 'hourly') {
    // використовуємо ставку з самого запису (зафіксована при створенні)
    const rate = (e.rate != null) ? e.rate : state.work.hourlyRate;
    const cur = e.rateCur || state.work.hourlyCur;
    const rateUSD = convert(rate, cur, 'USD');
    return rateUSD * (e.hours || 0);
  } else {
    return convert(e.amountNative || 0, e.cur || 'USD', 'USD');
  }
}

function workCategoryById(id) {
  return state.workCategories.find(c => c.id === id) || state.workCategories[0];
}

/* =========================================================
   МІСЯЧНІ ВИПЛАТИ ЗА РОБОТУ
   ========================================================= */
function monthKeyOf(date) {
  const d = (date instanceof Date) ? date : parseDate(date);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// нараховано за конкретний місяць (USD, тільки hourly)
function accruedUSDForMonth(monthKey) {
  let s = 0;
  for (const e of state.work.entries) {
    if (e.kind !== 'hourly') continue;
    if (monthKeyOf(e.date) !== monthKey) continue;
    s += workEntryUSD(e);
  }
  return s;
}

// нараховано за місяць по конкретній категорії
function accruedUSDForMonthCat(monthKey, catId) {
  let s = 0;
  for (const e of state.work.entries) {
    if (e.kind !== 'hourly') continue;
    if (monthKeyOf(e.date) !== monthKey) continue;
    if ((e.categoryId || null) !== (catId || null)) continue;
    s += workEntryUSD(e);
  }
  return s;
}

// категорії з активністю в місяці (в яких є записи)
function categoriesInMonth(monthKey) {
  const set = new Set();
  for (const e of state.work.entries) {
    if (e.kind !== 'hourly') continue;
    if (monthKeyOf(e.date) !== monthKey) continue;
    set.add(e.categoryId || 'no-cat');
  }
  return Array.from(set);
}

// виплачено за місяць (USD, сума всіх payouts)
function paidUSDForMonth(monthKey) {
  let s = 0;
  for (const p of state.work.monthlyPayouts) {
    if (p.month !== monthKey) continue;
    s += convert(p.amount, p.cur || 'USD', 'USD');
  }
  return s;
}

// виплачено за місяць+категорію (загальні виплати БЕЗ категорії ТУТ НЕ РАХУЮТЬСЯ окремо)
function paidUSDForMonthCat(monthKey, catId) {
  let s = 0;
  for (const p of state.work.monthlyPayouts) {
    if (p.month !== monthKey) continue;
    if ((p.categoryId || null) !== (catId || null)) continue;
    s += convert(p.amount, p.cur || 'USD', 'USD');
  }
  return s;
}

// сума "загальних" виплат (без категорії) — вони закривають місяць повністю
function generalPaidUSDForMonth(monthKey) {
  let s = 0;
  for (const p of state.work.monthlyPayouts) {
    if (p.month !== monthKey) continue;
    if (p.categoryId) continue;
    s += convert(p.amount, p.cur || 'USD', 'USD');
  }
  return s;
}

// чи є загальна final-виплата на місяць (закриває все повністю)
function hasGeneralFinal(monthKey) {
  return state.work.monthlyPayouts.some(p =>
    p.month === monthKey && !p.categoryId && p.type === 'final');
}

// статус загальний по місяцю: 'paid' | 'partial' | 'pending'
function monthPayoutStatus(monthKey) {
  const payouts = state.work.monthlyPayouts.filter(p => p.month === monthKey);
  if (payouts.length === 0) return 'pending';
  // якщо є "загальна" final — весь місяць закритий
  if (hasGeneralFinal(monthKey)) return 'paid';
  // рахуємо по категоріях
  const cats = categoriesInMonth(monthKey);
  const statuses = cats.map(c => categoryStatus(monthKey, c === 'no-cat' ? null : c));
  if (statuses.every(s => s === 'paid')) return 'paid';
  if (statuses.every(s => s === 'pending')) return 'pending';
  return 'partial';
}

// статус конкретної категорії у місяці
function categoryStatus(monthKey, catId) {
  // якщо є загальна final-виплата → всі категорії paid
  if (hasGeneralFinal(monthKey)) return 'paid';
  const catPayouts = state.work.monthlyPayouts.filter(p =>
    p.month === monthKey && (p.categoryId || null) === (catId || null));
  const generalAdvance = state.work.monthlyPayouts.filter(p =>
    p.month === monthKey && !p.categoryId && p.type === 'advance');
  // якщо є категорійна final → paid для цієї категорії
  if (catPayouts.some(p => p.type === 'final')) return 'paid';
  const accrued = accruedUSDForMonthCat(monthKey, catId);
  const paid = catPayouts.reduce((s,p) => s + convert(p.amount, p.cur || 'USD', 'USD'), 0);
  // додаємо загальні аванси пропорційно (спрощення — всі йдуть у "загальний пул")
  // краще: якщо є загальні аванси і немає категорійних виплат, то показуємо частково
  if (paid === 0 && generalAdvance.length === 0) return 'pending';
  if (paid >= accrued) return 'paid';
  return 'partial';
}

const STATUS_INFO = {
  paid:    { emoji: '🟢', label: 'виплачено', color: 'var(--ok)' },
  partial: { emoji: '🟠', label: 'частково',  color: '#ff9c3f' },
  pending: { emoji: '🟡', label: 'очікує',    color: 'var(--yellow)' }
};

function workPeriodBounds(period, now = new Date()) {
  if (period === 'all') return { from: 0, to: Infinity };
  const from = startOf(period, now).getTime();
  return { from, to: now.getTime() + MS_DAY }; // включно з сьогодні
}

function workEarnedUSD(period) {
  // якщо режим "виплачене" — рахуємо по виплатах за датою виплати
  if (state.workEarnedMode === 'paid') {
    const { from, to } = workPeriodBounds(period);
    let sum = 0;
    // hourly через monthlyPayouts (по даті виплати)
    for (const p of state.work.monthlyPayouts) {
      const t = parseDate(p.date).getTime();
      if (t >= from && t < to) sum += convert(p.amount, p.cur || 'USD', 'USD');
    }
    // fixed (підробіток) лишаємо як є — вони одразу "виплачені"
    for (const e of state.work.entries) {
      if (e.kind !== 'fixed') continue;
      const t = parseDate(e.date).getTime();
      if (t >= from && t < to) sum += workEntryUSD(e);
    }
    return sum;
  }
  // режим "нараховане" — як було
  const { from, to } = workPeriodBounds(period);
  let sum = 0;
  for (const e of state.work.entries) {
    const t = parseDate(e.date).getTime();
    if (t >= from && t < to) sum += workEntryUSD(e);
  }
  return sum;
}

function workHours(period) {
  const { from, to } = workPeriodBounds(period);
  let h = 0;
  for (const e of state.work.entries) {
    if (e.kind !== 'hourly') continue;
    const t = parseDate(e.date).getTime();
    if (t >= from && t < to) h += (e.hours || 0);
  }
  return h;
}

const WORK_PERIOD_LABEL = { day: 'За день', week: 'За тиждень', month: 'За місяць', all: 'За весь час' };

function renderWork() {
  const w = state.work;

  // режим
  document.querySelectorAll('#work-mode button').forEach(b =>
    b.classList.toggle('active', b.dataset.wmode === w.mode));
  // період
  document.querySelectorAll('#work-period-pick button').forEach(b =>
    b.classList.toggle('active', b.dataset.wp === w.period));

  // категорії робіт показуються тільки в погодинному
  renderWorkCats();
  document.getElementById('work-cat-list').style.display = w.mode === 'hourly' ? '' : 'none';
  document.querySelector('#view-work .sec-title button#btn-add-work-cat')?.parentElement &&
    (document.querySelector('#view-work .sec-title button#btn-add-work-cat').parentElement.style.display = w.mode === 'hourly' ? '' : 'none');

  // топ-блоки
  const earnedUSD = workEarnedUSD(w.period);
  document.getElementById('work-period-label').textContent = WORK_PERIOD_LABEL[w.period];
  document.getElementById('work-period-val').textContent =
    formatNum(convert(earnedUSD, 'USD', state.display), state.display);

  if (w.mode === 'hourly') {
    const h = workHours(w.period);
    document.getElementById('work-second-label').textContent = 'Годин';
    document.getElementById('work-second-val').textContent =
      (Math.round(h * 10) / 10).toString();
    document.getElementById('work-second-sub').textContent = 'за період';
  } else {
    // у фікс-режимі другий блок — кількість підробітків
    const { from, to } = workPeriodBounds(w.period);
    const cnt = w.entries.filter(e => {
      const t = parseDate(e.date).getTime();
      return t >= from && t < to;
    }).length;
    document.getElementById('work-second-label').textContent = 'Підробітків';
    document.getElementById('work-second-val').textContent = cnt.toString();
    document.getElementById('work-second-sub').textContent = 'за період';
  }

  // заголовок списку
  document.getElementById('work-list-title').textContent =
    w.mode === 'hourly' ? 'Відпрацьовані дні' : 'Підробітки';

  // список (фільтруємо за режимом, сортуємо за датою спадання)
  const filtered = w.entries
    .filter(e => (w.mode === 'hourly' ? e.kind === 'hourly' : e.kind === 'fixed'))
    .sort((a,b) => parseDate(b.date) - parseDate(a.date));

  document.getElementById('work-count').textContent = filtered.length;

  const list = document.getElementById('work-list');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty"><div class="em-emoji">∅</div>' +
      (w.mode === 'hourly' ? 'Ще немає записів годин' : 'Ще немає підробітків') +
      '<br>Тапни «Додати запис» вгорі</div>';
    return;
  }

  list.innerHTML = filtered.map(e => {
    const usd = workEntryUSD(e);
    const disp = formatNum(convert(usd, 'USD', state.display), state.display);
    let main, sub;
    if (e.kind === 'hourly') {
      main = (Math.round((e.hours||0)*10)/10) + ' год';
      sub = fmtDate(parseDate(e.date)) + (e.note ? ' · ' + escapeHtml(e.note) : '');
    } else {
      main = escapeHtml(e.title || 'Підробіток');
      sub = fmtDate(parseDate(e.date)) + (e.note ? ' · ' + escapeHtml(e.note) : '');
    }
    return `
      <div class="work-item">
        <div class="wi-left">
          <div class="wi-main">${main}</div>
          <div class="wi-sub">${sub}</div>
        </div>
        <div class="wi-right">
          <span class="wi-amount">+${disp}</span>
          <button class="wi-del" data-wid="${e.id}" title="видалити">&times;</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.wi-del').forEach(b =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        icon: '×', title: 'Видалити запис?',
        text: 'Цю операцію не можна скасувати', okText: 'Видалити'
      });
      if (!ok) return;
      const wid = b.dataset.wid;
      w.entries = w.entries.filter(e => e.id !== wid);
      saveState();
      deleteWorkEntryInNotion(wid);
      toast('Запис видалено', 'warn');
      renderWork();
    }));
}

/* ----- введення запису роботи ----- */
function fillWorkCategorySelect(selectedId) {
  const sel = document.getElementById('wk-category');
  if (!sel) return;
  const cats = state.workCategories || [];
  sel.innerHTML = cats.map(c =>
    `<option value="${c.id}">${escapeHtml(c.name)} (${c.rate} ${c.cur}/год)</option>`).join('');
  let target = selectedId;
  if (!target) {
    const def = cats.find(c => c.isDefault);
    target = def ? def.id : (cats[0] && cats[0].id);
  }
  if (target) sel.value = target;
}

// ===== Управління категоріями робіт =====
let editingWorkCatId = null;

function renderWorkCats() {
  const wrap = document.getElementById('work-cat-list');
  if (!wrap) return;
  const cats = state.workCategories || [];
  if (cats.length === 0) {
    wrap.innerHTML = '<div style="color:var(--muted); font-size:12px; padding:8px 0;">Немає категорій</div>';
    return;
  }
  wrap.innerHTML = cats.map(c => {
    const defaultBadge = c.isDefault ? `<span class="clr-default-badge">за замовч.</span>` : '';
    return `<div class="cat-list-row" data-id="${c.id}">
      <div class="clr-name">${escapeHtml(c.name)} ${defaultBadge}</div>
      <div class="clr-rate">${c.rate} ${c.cur}/год</div>
      <button class="clr-edit" data-edit="${c.id}">✎</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      haptic('light');
      openWorkCatModal(b.dataset.edit);
    }));
}

function openWorkCatModal(id) {
  editingWorkCatId = id || null;
  const c = id ? state.workCategories.find(x => x.id === id) : null;
  document.getElementById('wcat-modal-title').textContent = c ? 'Редагувати категорію' : 'Нова категорія';
  document.getElementById('wcat-name').value = c ? c.name : '';
  document.getElementById('wr-rate').value = c ? c.rate : '';
  document.getElementById('wr-cur').value = c ? c.cur : 'USD';
  document.getElementById('wcat-default').checked = c ? !!c.isDefault : false;
  document.getElementById('wcat-delete').style.display = (c && state.workCategories.length > 1) ? '' : 'none';
  document.getElementById('ov-wrate').classList.add('open');
}

function saveWorkCat() {
  const name = document.getElementById('wcat-name').value.trim();
  const rate = parseFloat(document.getElementById('wr-rate').value);
  const cur = document.getElementById('wr-cur').value;
  const isDefault = document.getElementById('wcat-default').checked;
  if (!name) { toast('Введи назву', 'error'); return; }
  if (!rate || rate <= 0) { toast('Введи ставку', 'error'); return; }

  if (isDefault) {
    // зняти default з усіх
    state.workCategories.forEach(c => c.isDefault = false);
  }

  if (editingWorkCatId) {
    const c = state.workCategories.find(x => x.id === editingWorkCatId);
    if (c) {
      c.name = name; c.rate = rate; c.cur = cur; c.isDefault = isDefault;
      updateWorkCategoryInNotion(c).then(() => saveState());
    }
  } else {
    const newCat = {
      id: 'cat-' + Date.now().toString(36),
      name, rate, cur, isDefault
    };
    state.workCategories.push(newCat);
    createWorkCategoryInNotion(newCat).then(() => { saveState(); renderAll(); });
  }
  // якщо жодної default — робимо першу
  if (!state.workCategories.some(c => c.isDefault) && state.workCategories.length > 0) {
    state.workCategories[0].isDefault = true;
  }
  saveState();
  haptic('success');
  toast('Збережено', 'success');
  document.getElementById('ov-wrate').classList.remove('open');
  renderAll();
}

function deleteWorkCat() {
  if (!editingWorkCatId) return;
  if (state.workCategories.length <= 1) {
    toast('Має бути хоча б одна категорія', 'error');
    return;
  }
  const catId = editingWorkCatId;
  state.workCategories = state.workCategories.filter(c => c.id !== catId);
  if (!state.workCategories.some(c => c.isDefault)) {
    state.workCategories[0].isDefault = true;
  }
  saveState();
  deleteWorkCategoryInNotion(catId);
  haptic('warning');
  toast('Категорію видалено', 'warn');
  document.getElementById('ov-wrate').classList.remove('open');
  renderAll();
}

function openWorkModal() {
  const w = state.work;
  document.getElementById('wk-date').value = toISO(today());
  document.getElementById('wk-hours').value = '';
  document.getElementById('wk-title').value = '';
  document.getElementById('wk-amount').value = '';
  document.getElementById('wk-note').value = '';
  document.getElementById('wk-cur').value = state.display;

  const isHourly = w.mode === 'hourly';
  document.getElementById('wk-hourly-fields').style.display = isHourly ? '' : 'none';
  document.getElementById('wk-fixed-fields').style.display = isHourly ? 'none' : '';
  document.getElementById('work-modal-title').textContent =
    isHourly ? 'Додати години' : 'Додати підробіток';

  // це створення нового — скидаємо editId, приховуємо кнопку видалення
  const saveBtn = document.getElementById('wk-save');
  saveBtn._editId = null;
  saveBtn.textContent = 'Додати запис';
  const delBtn = document.getElementById('wk-delete');
  if (delBtn) delBtn.style.display = 'none';

  if (isHourly) {
    fillWorkCategorySelect();
    // підставляємо ставку з обраної (дефолтної) категорії
    const cat = workCategoryById(document.getElementById('wk-category').value);
    document.getElementById('wk-rate').value = cat.rate;
    document.getElementById('wk-rate-cur').value = cat.cur;
  }

  renderWorkPreview();
  document.getElementById('ov-work').classList.add('open');
}

function renderWorkPreview() {
  const w = state.work;
  const prev = document.getElementById('wk-preview');
  if (w.mode === 'hourly') {
    const h = parseFloat(document.getElementById('wk-hours').value) || 0;
    const rate = parseFloat(document.getElementById('wk-rate').value) || 0;
    const rateCur = document.getElementById('wk-rate-cur').value;
    if (h <= 0 || rate <= 0) { prev.innerHTML = 'Введи години і ставку'; return; }
    const usd = convert(rate, rateCur, 'USD') * h;
    prev.innerHTML = `${h} год × ${formatNum(convert(rate, rateCur, state.display), state.display)} = <b class="accent">${formatNum(convert(usd,'USD',state.display), state.display)}</b>`;
  } else {
    const amt = parseFloat(document.getElementById('wk-amount').value) || 0;
    const cur = document.getElementById('wk-cur').value;
    if (amt <= 0) { prev.innerHTML = 'Введи суму'; return; }
    prev.innerHTML = `Заробіток: <b class="accent">${formatNum(convert(amt, cur, state.display), state.display)}</b>`;
  }
}

function saveWorkEntry() {
  const w = state.work;
  const date = document.getElementById('wk-date').value;
  if (!date) { toast('Вкажи дату', 'error'); return; }
  const note = document.getElementById('wk-note').value.trim();
  const saveBtn = document.getElementById('wk-save');
  const editId = saveBtn._editId;

  // визначаємо mode по тому що видно
  const isHourlyVisible = document.getElementById('wk-hourly-fields').style.display !== 'none';

  if (isHourlyVisible) {
    const hours = parseFloat(document.getElementById('wk-hours').value);
    if (!hours || hours <= 0) { toast('Введи години', 'error'); return; }
    const categoryId = document.getElementById('wk-category').value;
    const rate = parseFloat(document.getElementById('wk-rate').value);
    const rateCur = document.getElementById('wk-rate-cur').value;
    if (!rate || rate <= 0) { toast('Введи ставку', 'error'); return; }

    if (editId) {
      const e = w.entries.find(x => x.id === editId);
      if (e) {
        e.date = date; e.hours = hours; e.note = note;
        e.categoryId = categoryId; e.rate = rate; e.rateCur = rateCur;
        updateWorkEntryInNotion(e).then(() => saveState());
      }
    } else {
      const newE = {
        id: Date.now().toString(36),
        date, kind: 'hourly', hours, note,
        categoryId, rate, rateCur
      };
      w.entries.push(newE);
      createWorkEntryInNotion(newE).then(() => saveState());
    }
  } else {
    const title = document.getElementById('wk-title').value.trim();
    const amount = parseFloat(document.getElementById('wk-amount').value);
    const cur = document.getElementById('wk-cur').value;
    if (!title) { toast('Введи назву', 'error'); return; }
    if (!amount || amount <= 0) { toast('Введи суму', 'error'); return; }
    if (editId) {
      const e = w.entries.find(x => x.id === editId);
      if (e) { e.date = date; e.title = title; e.amountNative = amount; e.cur = cur; e.note = note;
        updateWorkEntryInNotion(e).then(() => saveState());
      }
    } else {
      const newE = {
        id: Date.now().toString(36),
        date, kind: 'fixed', title, amountNative: amount, cur, note
      };
      w.entries.push(newE);
      createWorkEntryInNotion(newE).then(() => saveState());
    }
  }
  saveState();
  haptic('success');
  toast(editId ? 'Збережено' : 'Запис додано', 'success');
  saveBtn._editId = null;
  saveBtn.textContent = 'Додати запис';
  document.getElementById('ov-work').classList.remove('open');
  renderWork();
  // якщо ми були в drill-day — оновлюємо його
  if (drillDayDate && document.getElementById('ov-drill').classList.contains('open')) {
    openDrillDay(drillDayDate);
  }
}

/* =========================================================
   BOARD
   ========================================================= */
function openBoard(id) {
  openBoardId = id;
  payDraft = { months: 0, mode: 'months' };
  renderBoard();
  document.getElementById('ov-board').classList.add('open');
}

function renderBoard() {
  const c = state.clients.find(x => x.id === openBoardId);
  if (!c) return;

  // референс на реферера (якщо є)
  const referrer = c.referredBy ? state.clients.find(x => x.id === c.referredBy) : null;
  // людей, яких привів ЦЕЙ клієнт
  const broughtList = referralsBroughtBy(c);

  // заголовок з бейджем якщо приведений
  const titleHtml = referrer
    ? escapeHtml(c.name) + '<span class="bonus-chip" style="font-size:8px;">REF</span>'
    : escapeHtml(c.name);
  document.getElementById('bd-title').innerHTML = titleHtml;

  // контакти
  let contactsHtml = '';
  const contactBtns = [];
  if (c.phone) {
    contactBtns.push(`<a class="contact-btn" href="tel:${escapeHtml(c.phone)}"><span class="cb-ico">📞</span> ${escapeHtml(c.phone)}</a>`);
  }
  if (c.tg) {
    contactBtns.push(`<a class="contact-btn" href="https://t.me/${escapeHtml(c.tg)}" target="_blank" rel="noopener"><span class="cb-ico">✈️</span> @${escapeHtml(c.tg)}</a>`);
  }
  if (contactBtns.length > 0) {
    contactsHtml = `<div class="contact-row">${contactBtns.join('')}</div>`;
  }

  const st = statusOf(c);
  const m = rateInDisplay(c);
  const paidM = totalMonths(c);
  const bonusM = bonusMonths(c);
  const totalPaidNative = c.payments.reduce((s,p) => s + p.amountNative, 0);
  const totalPaidDisp = convert(totalPaidNative, c.cur, state.display);

  // ДАТИ ПЕРІОДІВ
  const now = today();
  const paidUntil = paidUntilDate(c);
  const totalUntil = nextPayDate(c); // з бонусом
  const paidDaysLeft = Math.max(0, daysBetween(now, paidUntil));
  const bonusDaysLeft = bonusM > 0 ? Math.max(0, daysBetween(paidUntil > now ? paidUntil : now, totalUntil)) : 0;
  const totalDaysLeft = Math.max(0, daysBetween(now, totalUntil));

  let bannerCls = st.days <= 0 ? 'due' : '';
  let bannerTxt;
  if (st.days > 1) bannerTxt = `Наступна оплата через <b>${st.days}</b> дн`;
  else if (st.days === 1) bannerTxt = `Наступна оплата <b>завтра</b>`;
  else if (st.days === 0) bannerTxt = `Оплата <b>СЬОГОДНІ</b>`;
  else bannerTxt = `Прострочено на <b>${Math.abs(st.days)}</b> дн`;

  // рядок разової плати
  let setupRowHtml = '';
  if (c.setupAmount && c.setupAmount > 0) {
    const setupDisp = convert(c.setupAmount, c.setupCur || 'USD', state.display);
    setupRowHtml = `
      <div class="period-row">
        <span class="pr-label">🛠 розробка</span>
        <span class="pr-val" style="color:var(--dev);">${formatNum(setupDisp, state.display)} <span class="pr-days">разово</span></span>
      </div>`;
  }

  // блок про реферал-статус нового клієнта
  let refStatusHtml = '';
  if (referrer) {
    const ready = isReferralReady(c, now);
    if (c.bonusGranted) {
      refStatusHtml = `
        <div class="period-row" style="background:rgba(95,217,127,0.06);">
          <span class="pr-label">приведений</span>
          <span class="pr-val" style="color:var(--ok); font-size:12px;">
            ${escapeHtml(referrer.name)} · бонус ${c.bonusAmount} міс ✓
          </span>
        </div>`;
    } else {
      refStatusHtml = `
        <div class="period-row">
          <span class="pr-label">приведений</span>
          <span class="pr-val" style="color:var(--muted); font-size:12px;">
            ${escapeHtml(referrer.name)} · бонус ${c.bonusAmount} міс ${ready ? '⏳' : '— очікує'}
          </span>
        </div>`;
    }
  }

  // блок про приведених цим клієнтом
  let broughtHtml = '';
  if (broughtList.length > 0) {
    broughtHtml = `
      <div class="divider"></div>
      <label>Привів орендарів · ${broughtList.length}</label>
      ${broughtList.map(b => `
        <div class="referral-row ${b.bonusGranted ? 'granted' : 'pending'}">
          <span class="rr-name">${escapeHtml(b.name)}</span>
          <span class="rr-months">+${b.bonusAmount} міс</span>
          <span class="rr-status">${b.bonusGranted ? 'нараховано' : 'очікує'}</span>
        </div>
      `).join('')}
    `;
  }

  const body = document.getElementById('bd-body');
  const isPostpaid = c.payMode === 'postpaid';

  // блок про тип оплати
  let payModeHtml = '';
  if (isPostpaid) {
    // вираховуємо коли очікується наступна оплата
    // для постоплати: якщо ще не платили — очікується від effectiveStart + 1 місяць
    // якщо платили — від останньої оплати + 1 місяць
    const lastPayDate = c.payments.length > 0
      ? parseDate(c.payments[c.payments.length - 1].date)
      : effectiveStart(c);
    const expectedDate = addMonthsDays(lastPayDate, 1);
    const daysToExpected = daysBetween(now, expectedDate);
    const overdueExpected = daysToExpected < 0;
    payModeHtml = `
      <div class="period-row" style="background:${overdueExpected ? 'rgba(255,77,77,0.08)' : 'rgba(255,214,10,0.08)'}; border:1px solid ${overdueExpected ? 'rgba(255,77,77,0.3)' : 'rgba(255,214,10,0.3)'};">
        <span class="pr-label" style="color:${overdueExpected ? 'var(--danger)' : 'var(--yellow)'};">⏳ постоплата</span>
        <span class="pr-val" style="color:${overdueExpected ? 'var(--danger)' : 'var(--yellow)'};">
          ${overdueExpected ? 'прострочено' : 'очікується'} ${fmtDate(expectedDate)}
          <span class="pr-days">(${overdueExpected ? '−' + Math.abs(daysToExpected) : '+' + daysToExpected} дн)</span>
        </span>
      </div>
      <button class="btn-primary" id="bd-mark-paid" style="background:var(--ok); color:#000; margin-top:8px;">✓ Оплачено за період (1 міс)</button>`;
  }

  body.innerHTML = `
    <div class="board-stat">
      <div class="bs"><div class="bs-l">ставка/міс</div><div class="bs-v">${formatNum(m, state.display)}</div></div>
      <div class="bs"><div class="bs-l">оплачено</div><div class="bs-v">${fmtMonthsDays(paidM)}</div></div>
      <div class="bs"><div class="bs-l">всього</div><div class="bs-v">${formatNum(totalPaidDisp, state.display)}</div></div>
    </div>

    ${payModeHtml}

    ${!isPostpaid ? `
    <div class="period-rows">
      <div class="period-row">
        <span class="pr-label">платний до</span>
        <span class="pr-val">${fmtDate(paidUntil)} <span class="pr-days">(${paidDaysLeft} дн)</span></span>
      </div>
      ${c.bonusDays > 0 ? `
      <div class="period-row bonus">
        <span class="pr-label">+ бонус днів</span>
        <span class="pr-val" style="color:var(--yellow);">+${c.bonusDays} дн (зсув старту)</span>
      </div>` : ''}
      ${bonusM > 0 ? `
      <div class="period-row bonus">
        <span class="pr-label">+ реферал</span>
        <span class="pr-val">+${fmtMonthsDays(bonusM)} <span class="pr-days">(${bonusDaysLeft} дн)</span></span>
      </div>` : ''}
      <div class="period-row total">
        <span class="pr-label">всього до</span>
        <span class="pr-val">${fmtDate(totalUntil)} <span class="pr-days">(${totalDaysLeft} дн)</span></span>
      </div>
      ${setupRowHtml}
      ${refStatusHtml}
    </div>

    <div class="next-banner ${bannerCls}">
      ${bannerTxt} <span class="nb-date">· ${fmtDate(totalUntil)}</span>
    </div>
    ` : `
    ${(setupRowHtml || refStatusHtml || c.bonusDays > 0) ? `
    <div class="period-rows">
      ${c.bonusDays > 0 ? `
      <div class="period-row bonus">
        <span class="pr-label">+ бонус днів</span>
        <span class="pr-val" style="color:var(--yellow);">+${c.bonusDays} дн (зсув старту)</span>
      </div>` : ''}
      ${setupRowHtml}
      ${refStatusHtml}
    </div>
    ` : ''}
    `}

    ${contactsHtml}

    <div class="divider"></div>

    <label>Додати оплату</label>
    <div class="seg" id="pay-seg">
      <button data-mode="months" class="${payDraft.mode==='months'?'active':''}">За періодом</button>
      <button data-mode="money" class="${payDraft.mode==='money'?'active':''}">За сумою</button>
    </div>

    <div id="pay-input"></div>

    <div class="quick-row">
      <button data-add="1">+1 міс</button>
      <button data-add="3">+3 міс</button>
      <button data-add="6">+6 міс</button>
    </div>

    <div class="pay-preview ${payDraft.months > 0 ? 'has-data' : ''}" id="pay-preview"></div>

    <button class="btn-primary" id="bd-confirm" ${payDraft.months > 0 ? '' : 'disabled'}>
      Зарахувати оплату
    </button>

    <div class="divider"></div>

    <label>Історія оплат · ${c.payments.length}</label>
    <div id="pay-history"></div>

    ${broughtHtml}

    <button class="danger-link" id="bd-delete">Видалити орендаря</button>
  `;

  renderPayInput();
  renderPayPreview();
  renderHistory();

  body.querySelectorAll('#pay-seg button').forEach(b =>
    b.addEventListener('click', () => {
      haptic('light');
      payDraft = { months: 0, mode: b.dataset.mode };
      renderBoard();
    }));
  body.querySelectorAll('.quick-row button').forEach(b =>
    b.addEventListener('click', () => {
      haptic('light');
      payDraft.months += parseFloat(b.dataset.add);
      payDraft.mode = 'months';
      renderBoard();
    }));
  document.getElementById('bd-confirm').addEventListener('click', confirmPayment);

  // постоплата — кнопка "Оплачено за період"
  const markBtn = document.getElementById('bd-mark-paid');
  if (markBtn) {
    markBtn.addEventListener('click', () => {
      haptic('success');
      const months = 1;
      const amountNative = c.rate * months;
      const newPay = { date: toISO(today()), months, amountNative };
      c.payments.push(newPay);
      saveState();
      createPaymentInNotion(c.id, newPay).then(() => saveState());
      toast('Оплату зараховано', 'success');
      renderBoard();
      renderAll();
    });
  }

  document.getElementById('bd-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({
      icon: '🗑',
      title: 'Видалити орендаря?',
      text: '«' + c.name + '» разом з історією оплат',
      okText: 'Видалити'
    });
    if (!ok) return;
    const delId = openBoardId;
    state.clients = state.clients.filter(x => x.id !== delId);
    saveState();
    deleteClientInNotion(delId);
    document.getElementById('ov-board').classList.remove('open');
    renderAll();
    toast('Орендаря видалено', 'warn');
  });
}

function renderPayInput() {
  const c = state.clients.find(x => x.id === openBoardId);
  const wrap = document.getElementById('pay-input');
  if (payDraft.mode === 'months') {
    wrap.innerHTML = `
      <input class="fld" id="pi-months" type="number" min="0" step="0.25" inputmode="decimal"
        placeholder="скільки місяців" value="${payDraft.months || ''}">
      <div class="hint">Можна дробове: 1.5 → 1 міс 15 дн</div>
    `;
    document.getElementById('pi-months').addEventListener('input', e => {
      payDraft.months = parseFloat(e.target.value) || 0;
      renderPayPreview();
      updateConfirmBtn();
    });
  } else {
    wrap.innerHTML = `
      <div class="two-col">
        <div><input class="fld" id="pi-amount" type="number" min="0" step="any" inputmode="decimal" placeholder="сума"></div>
        <div>
          <select class="fld" id="pi-cur">
            <option value="USD">$ USD</option>
            <option value="UAH">₴ UAH</option>
            <option value="PLN">zł PLN</option>
          </select>
        </div>
      </div>
      <div class="hint">Програма порахує період сама</div>
    `;
    // дефолт — валюта клієнта
    document.getElementById('pi-cur').value = c.cur;
    const recalc = () => {
      const amt = parseFloat(document.getElementById('pi-amount').value) || 0;
      const cur = document.getElementById('pi-cur').value;
      // переводимо введене → у валюту клієнта (де знаходиться його ставка)
      const amtInClientCur = convert(amt, cur, c.cur);
      payDraft.months = c.rate > 0 ? amtInClientCur / c.rate : 0;
      renderPayPreview();
      updateConfirmBtn();
    };
    document.getElementById('pi-amount').addEventListener('input', recalc);
    document.getElementById('pi-cur').addEventListener('change', recalc);
  }
}

function updateConfirmBtn() {
  const btn = document.getElementById('bd-confirm');
  const prev = document.getElementById('pay-preview');
  if (payDraft.months > 0) {
    btn.removeAttribute('disabled');
    prev.classList.add('has-data');
  } else {
    btn.setAttribute('disabled', '');
    prev.classList.remove('has-data');
  }
}

function renderPayPreview() {
  const c = state.clients.find(x => x.id === openBoardId);
  const prev = document.getElementById('pay-preview');
  if (!prev) return;
  const m = payDraft.months;
  if (!m || m <= 0) {
    prev.innerHTML = 'Вкажи період або суму — і тут зʼявиться розрахунок';
    return;
  }
  const amountNative = m * c.rate;
  const amountDisp = convert(amountNative, c.cur, state.display);
  const curNext = nextPayDate(c);
  const afterDate = addMonthsDays(parseDate(c.start), totalMonths(c) + m);
  // покажемо суму у обраній для дисплея валюті + у валюті клієнта (якщо інша)
  let amountLine = '<b>' + formatNum(amountDisp, state.display) + '</b>';
  if (c.cur !== state.display) {
    amountLine += ' <span style="opacity:.6">(' + formatNum(amountNative, c.cur) + ')</span>';
  }
  prev.innerHTML = `
    Період: <b class="accent">${fmtMonthsDays(m)}</b> · сума ${amountLine}<br>
    Нова дата: <b class="accent">${fmtDate(afterDate)}</b>
    <span style="opacity:.55">(було ${fmtDate(curNext)})</span>
  `;
}

function confirmPayment() {
  const c = state.clients.find(x => x.id === openBoardId);
  const m = payDraft.months;
  if (!m || m <= 0) return;
  const newPay = {
    id: Date.now().toString(36),
    date: toISO(today()),
    months: m,
    amountNative: m * c.rate,
    cur: c.cur
  };
  c.payments.push(newPay);
  payDraft = { months: 0, mode: payDraft.mode };
  saveState();
  createPaymentInNotion(c.id, newPay).then(() => saveState());
  haptic('success');
  toast('Оплату зараховано', 'success');
  // перевіряємо чи спрацював реферал-бонус
  settleReferrals();
  renderBoard();
  renderHero();
  renderClients();
  renderStats();
}

function renderHistory() {
  const c = state.clients.find(x => x.id === openBoardId);
  const wrap = document.getElementById('pay-history');
  if (c.payments.length === 0) {
    wrap.innerHTML = '<div class="hint" style="padding-left:0;">Оплат ще не було</div>';
    return;
  }
  wrap.innerHTML = [...c.payments].reverse().map(p => {
    const disp = convert(p.amountNative, p.cur || c.cur, state.display);
    return `
      <div class="history-item">
        <span class="hi-date">${fmtDate(parseDate(p.date))}</span>
        <span class="hi-right">
          <span class="hi-amount">+${formatNum(disp, state.display)}</span>
          <span class="hi-months">· ${fmtMonthsDays(p.months)}</span>
          <button class="hi-del" data-pid="${p.id}" title="видалити">&times;</button>
        </span>
      </div>`;
  }).join('');
  wrap.querySelectorAll('.hi-del').forEach(b =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        icon: '×',
        title: 'Видалити оплату?',
        text: 'Цю операцію не можна скасувати',
        okText: 'Видалити'
      });
      if (!ok) return;
      c.payments = c.payments.filter(p => p.id !== b.dataset.pid);
      saveState();
      toast('Оплату видалено', 'warn');
      renderBoard(); renderHero(); renderClients();
    }));
}

/* =========================================================
   ADD CLIENT
   ========================================================= */
function normalizeTg(raw) {
  if (!raw) return '';
  let s = raw.trim();
  // прибираємо посилання
  s = s.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '');
  s = s.replace(/^@/, '');
  s = s.replace(/\/$/, '');
  return s;
}

function addClient(thenAddPayment = false) {
  const name = document.getElementById('ac-name').value.trim();
  const rate = parseFloat(document.getElementById('ac-rate').value);
  const cur = document.getElementById('ac-cur').value;
  const start = document.getElementById('ac-start').value;
  if (!name) { toast('Введи ім\'я', 'error'); return; }
  if (!rate || rate <= 0) { toast('Введи місячну ставку', 'error'); return; }
  if (!start) { toast('Вкажи дату старту', 'error'); return; }

  const phone = document.getElementById('ac-phone').value.trim();
  const tg = normalizeTg(document.getElementById('ac-tg').value);
  const setupAmount = parseFloat(document.getElementById('ac-setup').value) || 0;
  const setupCur = document.getElementById('ac-setup-cur').value;

  // referral
  const srcMode = acSource; // 'self' | 'ref'
  let referredBy = null;
  let bonusAmount = 0;
  if (srcMode === 'ref') {
    referredBy = document.getElementById('ac-referrer').value;
    if (!referredBy) { toast('Вибери, хто привів', 'error'); return; }
    bonusAmount = acBonus;
  }

  const newId = Date.now().toString(36);
  const payMode = acPayMode || 'prepaid';
  const bonusDays = parseInt(document.getElementById('ac-bonus-days').value) || 0;
  const newClient = {
    id: newId,
    name, rate, cur, start,
    phone, tg,
    setupAmount, setupCur,
    payments: [],
    bonusMonths: 0,
    bonusLog: [],
    referredBy,
    bonusAmount,
    bonusGranted: false,
    payMode,
    bonusDays,
    pendingPayments: []
  };
  state.clients.push(newClient);
  saveState();
  // Notion: створюємо і оновлюємо id у локальному обʼєкті
  createClientInNotion(newClient).then(() => { saveState(); renderAll(); });
  haptic('success');
  document.getElementById('ac-name').value = '';
  document.getElementById('ac-rate').value = '';
  document.getElementById('ac-start').value = '';
  document.getElementById('ac-phone').value = '';
  document.getElementById('ac-tg').value = '';
  document.getElementById('ac-setup').value = '';
  resetAcForm();
  document.getElementById('ov-add').classList.remove('open');
  toast('Орендаря додано', 'success');
  renderAll();
  // одразу відкриваємо картку нового орендаря в режимі оплати
  if (thenAddPayment) {
    setTimeout(() => openBoard(newId), 220);
  }
}

/* ===== РЕДАГУВАННЯ ===== */
let editClientId = null;

function openEditClient(id) {
  const c = state.clients.find(x => x.id === id);
  if (!c) return;
  editClientId = id;
  // заповнюємо поля
  document.getElementById('ac-name').value = c.name;
  document.getElementById('ac-rate').value = c.rate;
  document.getElementById('ac-cur').value = c.cur;
  document.getElementById('ac-start').value = c.start;
  document.getElementById('ac-phone').value = c.phone || '';
  document.getElementById('ac-tg').value = c.tg ? '@' + c.tg : '';
  document.getElementById('ac-setup').value = c.setupAmount || '';
  document.getElementById('ac-setup-cur').value = c.setupCur || 'USD';
  // у режимі редагування ховаємо реферал-секцію (вона про створення) і кнопки додавання
  document.getElementById('ac-modal-title').textContent = 'Редагувати орендаря';
  document.getElementById('ac-source-group').style.display = 'none';
  document.getElementById('ac-add-buttons').style.display = 'none';
  document.getElementById('ac-edit-buttons').style.display = '';
  document.getElementById('ov-add').classList.add('open');
}

function saveEditClient() {
  const c = state.clients.find(x => x.id === editClientId);
  if (!c) return;
  const name = document.getElementById('ac-name').value.trim();
  const rate = parseFloat(document.getElementById('ac-rate').value);
  const cur = document.getElementById('ac-cur').value;
  const start = document.getElementById('ac-start').value;
  if (!name) { toast('Введи ім\'я', 'error'); return; }
  if (!rate || rate <= 0) { toast('Введи ставку', 'error'); return; }
  if (!start) { toast('Вкажи дату', 'error'); return; }
  c.name = name;
  c.rate = rate;
  c.cur = cur;
  c.start = start;
  c.phone = document.getElementById('ac-phone').value.trim();
  c.tg = normalizeTg(document.getElementById('ac-tg').value);
  c.setupAmount = parseFloat(document.getElementById('ac-setup').value) || 0;
  c.setupCur = document.getElementById('ac-setup-cur').value;
  saveState();
  updateClientInNotion(c).then(() => saveState());
  haptic('success');
  toast('Зміни збережено', 'success');
  document.getElementById('ov-add').classList.remove('open');
  // скидаємо форму назад у режим додавання
  resetAddMode();
  editClientId = null;
  renderAll();
  // якщо картка відкрита — оновити
  if (document.getElementById('ov-board').classList.contains('open')) {
    renderBoard();
  }
}

function resetAddMode() {
  document.getElementById('ac-modal-title').textContent = 'Новий орендар';
  document.getElementById('ac-source-group').style.display = '';
  document.getElementById('ac-add-buttons').style.display = '';
  document.getElementById('ac-edit-buttons').style.display = 'none';
  document.getElementById('ac-phone').value = '';
  document.getElementById('ac-tg').value = '';
  document.getElementById('ac-setup').value = '';
  editClientId = null;
}

// стан форми додавання
let acSource = 'self';
let acBonus = 3;
let acPayMode = 'prepaid';
function resetAcForm() {
  acSource = 'self';
  acBonus = 3;
  acPayMode = 'prepaid';
  document.querySelectorAll('#ac-source button').forEach(b => {
    b.classList.toggle('active', b.dataset.src === 'self');
  });
  document.querySelectorAll('#ac-bonus-pick button').forEach(b => {
    b.classList.toggle('active', b.dataset.bonus === '3');
  });
  document.querySelectorAll('#ac-paymode button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'prepaid');
  });
  document.getElementById('ac-ref-block').style.display = 'none';
  document.getElementById('ac-referrer').value = '';
  const bd = document.getElementById('ac-bonus-days');
  if (bd) bd.value = 0;
}
function refreshReferrerOptions() {
  const sel = document.getElementById('ac-referrer');
  sel.innerHTML = '<option value="">— оберіть, хто привів —</option>' +
    state.clients.map(c =>
      `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

/* =========================================================
   FX EDIT
   ========================================================= */
function openFxEdit() {
  document.getElementById('fx-uah').value = state.rates.UAH;
  document.getElementById('fx-pln').value = state.rates.PLN;
  const meta = document.getElementById('fx-meta');
  if (state.ratesAuto && state.ratesUpdated) {
    const src = state.ratesSource || '—';
    meta.textContent = 'Авто з ' + src + ': ' + new Date(state.ratesUpdated).toLocaleString('uk-UA');
  } else {
    meta.textContent = 'Введено вручну';
  }
  document.getElementById('ov-fx').classList.add('open');
}

/* =========================================================
   INIT
   ========================================================= */
function renderAll() {
  try {
    renderFx();
    renderHero();
    renderClients();
    renderStats();
    renderWork();
    renderDashboard();
    renderOverview();
    renderGoals();
  } catch (e) {
    console.error('renderAll error:', e);
  }
  // видимість вкладок за налаштуваннями
  const s = state.settings || {};
  const setTabVis = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  setTabVis('tab-btn-clients', s.tabClients !== false);
  setTabVis('tab-btn-work', s.tabWork !== false);
  setTabVis('tab-btn-overview', s.tabOverview !== false);
  setTabVis('tab-btn-goals', !!s.goalsEnabled);
  // якщо поточна вкладка вимкнена — перекидаємо на першу видиму
  const visibleViews = [];
  if (s.tabClients !== false) visibleViews.push('clients');
  if (s.tabWork !== false) visibleViews.push('work');
  if (s.tabOverview !== false) visibleViews.push('overview');
  if (s.goalsEnabled) visibleViews.push('goals');
  if (!visibleViews.includes(state.view)) {
    state.view = visibleViews[0] || 'clients';
  }
  // активна валюта у пікері
  document.querySelectorAll('#disp-picker button').forEach(b => {
    b.classList.toggle('active', b.dataset.cur === state.display);
  });
  // активний view
  document.querySelectorAll('#view-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === state.view);
  });
  document.getElementById('view-clients').style.display = state.view === 'clients' ? '' : 'none';
  document.getElementById('view-stats').style.display = 'none';       // видалено з UI
  document.getElementById('view-work').style.display = state.view === 'work' ? '' : 'none';
  const dashEl = document.getElementById('view-dashboard');
  if (dashEl) dashEl.style.display = 'none';   // старий Dashboard прихований
  document.getElementById('view-overview').style.display = state.view === 'overview' ? '' : 'none';
  document.getElementById('view-goals').style.display = state.view === 'goals' ? '' : 'none';
}

/* =========================================================
   DASHBOARD
   ========================================================= */
const DASH_PALETTE = ['#ffd60a', '#5fb8ff', '#a78bfa', '#5fd97f', '#ff9c3f', '#ec4899', '#06b6d4'];
// Реальні витрати тягнуться з DB_EXPENSES (бази Expense·Control).
// Структура: state.expensesFromNotion = [{ id, amount, currency, date, categoryId, note }]
// state.expenseCats = [{ id, name }]
const DASH_PERIOD_LABEL = { month: 'За місяць', quarter: 'За квартал', half: 'За півріччя', year: 'За рік' };

function dashPeriodBounds(p) {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0,0,0,0);
  if (p === 'month') { from.setDate(1); }
  else if (p === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    from.setMonth(q * 3, 1);
  }
  else if (p === 'half') {
    const h = now.getMonth() < 6 ? 0 : 6;
    from.setMonth(h, 1);
  }
  else if (p === 'year') {
    from.setMonth(0, 1);
  }
  return { from: from.getTime(), to: now.getTime() + MS_DAY };
}

function rentEarnedInPeriodUSD(p) {
  const { from, to } = dashPeriodBounds(p);
  let s = 0;
  for (const c of state.clients) {
    for (const pay of c.payments || []) {
      const t = parseDate(pay.date).getTime();
      if (t >= from && t < to) {
        const monthlyUSD = convert(c.rate, c.cur, 'USD');
        s += monthlyUSD * pay.months;
      }
    }
  }
  return s;
}

function setupEarnedInPeriodUSD(p) {
  const { from, to } = dashPeriodBounds(p);
  let s = 0;
  for (const c of state.clients) {
    if (!c.setupAmount || c.setupAmount <= 0) continue;
    // setup зараховується на дату старту клієнта
    const t = parseDate(c.start).getTime();
    if (t >= from && t < to) {
      s += convert(c.setupAmount, c.setupCur || c.cur, 'USD');
    }
  }
  return s;
}

function workEarnedInPeriodUSD(p) {
  const { from, to } = dashPeriodBounds(p);
  // режим "виплачене" — по даті виплати з monthlyPayouts (hourly) + fixed
  if (state.workEarnedMode === 'paid') {
    let s = 0;
    for (const po of (state.work.monthlyPayouts || [])) {
      const t = parseDate(po.date).getTime();
      if (t >= from && t < to) s += convert(po.amount, po.cur || 'USD', 'USD');
    }
    for (const e of state.work.entries) {
      if (e.kind !== 'fixed') continue;
      const t = parseDate(e.date).getTime();
      if (t >= from && t < to) s += workEntryUSD(e);
    }
    return s;
  }
  // режим "нараховане" (за замовч.)
  let s = 0;
  for (const e of state.work.entries) {
    const t = parseDate(e.date).getTime();
    if (t >= from && t < to) s += workEntryUSD(e);
  }
  return s;
}

function dashExpensesUSD(p) {
  const expenses = state.expensesFromNotion || [];
  const { from, to } = dashPeriodBounds(p);
  let s = 0;
  for (const e of expenses) {
    const t = parseDate(e.date).getTime();
    if (t >= from && t < to) {
      s += convert(e.amount, e.currency || 'USD', 'USD');
    }
  }
  return s;
}

function dashExpensesByCategory(p) {
  const expenses = state.expensesFromNotion || [];
  const cats = state.expenseCats || [];
  const { from, to } = dashPeriodBounds(p);
  const byCat = {};
  for (const e of expenses) {
    const t = parseDate(e.date).getTime();
    if (t < from || t >= to) continue;
    const usd = convert(e.amount, e.currency || 'USD', 'USD');
    const key = e.categoryId || 'none';
    if (!byCat[key]) byCat[key] = { name: '', usd: 0 };
    byCat[key].usd += usd;
  }
  // підставляємо назви категорій
  for (const id in byCat) {
    if (id === 'none') { byCat[id].name = 'без категорії'; continue; }
    const cat = cats.find(c => c.id === id);
    byCat[id].name = cat ? cat.name : 'невідома';
  }
  return Object.values(byCat).sort((a,b) => b.usd - a.usd);
}

/* =========================================================
   DRILL-IN екрани (тап на блок статистики → деталі)
   ========================================================= */
function openDrill(kind) {
  if (kind === 'rent') openDrillRent();
  else if (kind === 'work') openDrillWork();
  else if (kind === 'setup') openDrillSetup();
}

function openDrillRent() {
  const period = state.incomePeriod;
  document.getElementById('drill-title').textContent = '🏠 Оренда — деталі';
  const body = document.getElementById('drill-body');

  const totalUSD = rentEarnedUSD(period);
  const clientStats = state.clients.map(c => {
    const doneUSD = clientDoneInPeriodUSD(c, period);
    return { c, doneUSD };
  }).filter(x => x.doneUSD > 0 || x.c.payments.length > 0)
    .sort((a,b) => b.doneUSD - a.doneUSD);

  body.innerHTML = `
    <div class="drill-summary">
      <div style="font-family:'Geist Mono',monospace; font-size:11px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Загалом за ${incomePeriodLabel(period)}</div>
      <div style="font-family:'Geist Mono',monospace; font-weight:800; font-size:24px; margin-top:4px; color:var(--ok);">
        ${formatNum(convert(totalUSD, 'USD', state.display), state.display)}
      </div>
      <div style="font-size:11px; color:var(--muted); margin-top:6px;">${state.clients.length} орендар${state.clients.length === 1 ? '' : 'ів'}</div>
    </div>
    <div style="font-family:'Geist Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:1.5px; margin:14px 0 8px;">КЛІЄНТИ</div>
    ${clientStats.length === 0 ? '<div style="color:var(--muted); text-align:center; padding:20px;">Поки нема платежів</div>' :
      clientStats.map(x => `
        <div class="drill-row" data-client="${x.c.id}">
          <div class="dr-body">
            <div class="dr-title">${escapeHtml(x.c.name)} ${x.c.payMode === 'postpaid' ? '<span style="font-size:9px; background:rgba(255,214,10,0.1); color:var(--yellow); padding:1px 6px; border-radius:6px; margin-left:4px;">пост</span>' : ''}</div>
            <div class="dr-meta">${x.c.payments.length} оплат · ${totalMonths(x.c).toFixed(1)} міс</div>
          </div>
          <div class="dr-amt">${formatNum(convert(x.doneUSD, 'USD', state.display), state.display)}</div>
        </div>`).join('')
    }
  `;
  body.querySelectorAll('[data-client]').forEach(el =>
    el.addEventListener('click', () => {
      haptic('light');
      openDrillClient(el.dataset.client);
    }));
  document.getElementById('ov-drill').classList.add('open');
}

function openDrillClient(clientId) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  document.getElementById('drill-title').textContent = '🏠 ' + c.name;
  const body = document.getElementById('drill-body');

  const totalNative = c.payments.reduce((s,p) => s + p.amountNative, 0);
  const totalUSD = convert(totalNative, c.cur, 'USD');
  const months = totalMonths(c);
  const setupUSD = c.setupAmount > 0 ? convert(c.setupAmount, c.setupCur || c.cur, 'USD') : 0;
  const grossUSD = totalUSD + setupUSD;

  const payHistory = [...c.payments]
    .sort((a,b) => parseDate(b.date) - parseDate(a.date))
    .map(p => `
      <div class="drill-row" style="cursor:default;">
        <div class="dr-body">
          <div class="dr-title">${p.months.toFixed(2)} міс</div>
          <div class="dr-meta">${fmtDate(parseDate(p.date))}</div>
        </div>
        <div class="dr-amt">${formatNum(convert(p.amountNative, c.cur, state.display), state.display)}</div>
      </div>`).join('');

  body.innerHTML = `
    <button class="bd-edit-btn" id="drill-back" style="margin-bottom:14px; width:100%;">← Назад до списку</button>
    <div class="drill-summary">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Ставка/міс</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:15px; margin-top:2px;">${formatNum(rateInDisplay(c), state.display)}</div>
        </div>
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Оплачено міс</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:15px; margin-top:2px;">${months.toFixed(2)}</div>
        </div>
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Тип оплати</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:13px; margin-top:2px; color:${c.payMode === 'postpaid' ? 'var(--yellow)' : 'var(--ok)'};">${c.payMode === 'postpaid' ? 'постоплата' : 'передплата'}</div>
        </div>
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Старт</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:13px; margin-top:2px;">${fmtDate(parseDate(c.start))}</div>
        </div>
      </div>
      <div style="border-top:1px solid var(--line); margin-top:12px; padding-top:12px;">
        <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Заробіток з клієнта</div>
        <div style="font-family:'Geist Mono',monospace; font-weight:800; font-size:22px; color:var(--ok); margin-top:4px;">
          ${formatNum(convert(grossUSD, 'USD', state.display), state.display)}
        </div>
        ${setupUSD > 0 ? `<div style="font-size:10px; color:var(--muted); margin-top:2px;">з них setup: ${formatNum(convert(setupUSD, 'USD', state.display), state.display)}</div>` : ''}
      </div>
    </div>
    <div style="font-family:'Geist Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:1.5px; margin:14px 0 8px;">ІСТОРІЯ ОПЛАТ · ${c.payments.length}</div>
    ${payHistory || '<div style="color:var(--muted); text-align:center; padding:16px; font-size:12px;">Без оплат</div>'}
  `;
  document.getElementById('drill-back').addEventListener('click', () => {
    haptic('light');
    openDrillRent();
  });
}

let drillWorkPeriod = 'day'; // 'day' | 'week' | 'month' | 'year'

function openDrillWork() {
  document.getElementById('drill-title').textContent = '💼 Робота — деталі';
  renderDrillWork();
  document.getElementById('ov-drill').classList.add('open');
}

function renderDrillWork() {
  const body = document.getElementById('drill-body');
  const periods = [
    { key: 'day',   label: 'День' },
    { key: 'week',  label: 'Тиждень' },
    { key: 'month', label: 'Місяць' },
    { key: 'year',  label: 'Рік' }
  ];
  const switcher = `
    <div class="period-pick" id="drill-work-period">
      ${periods.map(p => `<button data-dp="${p.key}" ${drillWorkPeriod === p.key ? 'class="active"' : ''}>${p.label}</button>`).join('')}
    </div>`;

  let listHtml = '';
  const entries = state.work.entries;

  if (drillWorkPeriod === 'day') {
    // групуємо по даті
    const byDay = {};
    for (const e of entries) {
      const key = e.date;
      if (!byDay[key]) byDay[key] = { hours: 0, usd: 0, count: 0 };
      byDay[key].usd += workEntryUSD(e);
      byDay[key].hours += (e.kind === 'hourly' ? (e.hours || 0) : 0);
      byDay[key].count++;
    }
    const sorted = Object.entries(byDay).sort((a,b) => b[0].localeCompare(a[0]));
    listHtml = sorted.map(([date, d]) => `
      <div class="drill-row" data-day="${date}">
        <div class="dr-body">
          <div class="dr-title">${fmtDate(parseDate(date))}</div>
          <div class="dr-meta">${d.hours > 0 ? d.hours.toFixed(1) + ' год · ' : ''}${d.count} запис${d.count === 1 ? '' : (d.count < 5 ? 'и' : 'ів')}</div>
        </div>
        <div class="dr-amt">${formatNum(convert(d.usd, 'USD', state.display), state.display)}</div>
      </div>`).join('');
  }
  else if (drillWorkPeriod === 'week') {
    // групуємо по тижнях ISO (рік-тиждень)
    const byWeek = {};
    for (const e of entries) {
      const d = parseDate(e.date);
      const w = isoWeekInfo(d);
      const key = w.year + '-W' + String(w.week).padStart(2,'0');
      if (!byWeek[key]) byWeek[key] = { hours: 0, usd: 0, count: 0, start: w.start, end: w.end, week: w.week };
      byWeek[key].usd += workEntryUSD(e);
      byWeek[key].hours += (e.kind === 'hourly' ? (e.hours || 0) : 0);
      byWeek[key].count++;
    }
    const sorted = Object.entries(byWeek).sort((a,b) => b[0].localeCompare(a[0]));
    listHtml = sorted.map(([key, d]) => `
      <div class="drill-row" style="cursor:default;">
        <div class="dr-body">
          <div class="dr-title">Тиждень ${d.week}</div>
          <div class="dr-meta">${fmtDate(d.start)} — ${fmtDate(d.end)} · ${d.hours.toFixed(1)} год</div>
        </div>
        <div class="dr-amt">${formatNum(convert(d.usd, 'USD', state.display), state.display)}</div>
      </div>`).join('');
  }
  else if (drillWorkPeriod === 'month') {
    const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
    const byMonth = {};
    for (const e of entries) {
      const d = parseDate(e.date);
      const key = monthKeyOf(d);
      if (!byMonth[key]) byMonth[key] = { hours: 0, count: 0, year: d.getFullYear(), m: d.getMonth() };
      byMonth[key].hours += (e.kind === 'hourly' ? (e.hours || 0) : 0);
      byMonth[key].count++;
    }
    const sorted = Object.entries(byMonth).sort((a,b) => b[0].localeCompare(a[0]));
    listHtml = sorted.map(([key, d]) => {
      const accrued = accruedUSDForMonth(key);
      const paid = paidUSDForMonth(key);
      const status = monthPayoutStatus(key);
      const info = STATUS_INFO[status];
      let metaLine;
      if (status === 'paid') {
        metaLine = `${d.hours.toFixed(1)} год · нараховано ${formatNum(convert(accrued, 'USD', state.display), state.display)} → виплачено ${formatNum(convert(paid, 'USD', state.display), state.display)}`;
      } else if (status === 'partial') {
        metaLine = `${d.hours.toFixed(1)} год · нараховано ${formatNum(convert(accrued, 'USD', state.display), state.display)} · виплачено ${formatNum(convert(paid, 'USD', state.display), state.display)}`;
      } else {
        metaLine = `${d.hours.toFixed(1)} год · нараховано ${formatNum(convert(accrued, 'USD', state.display), state.display)}`;
      }
      return `<div class="drill-row" data-month="${key}">
        <div class="dr-body">
          <div class="dr-title">${MONTHS[d.m]} ${d.year} <span style="font-size:11px; margin-left:6px; color:${info.color};">${info.emoji} ${info.label}</span></div>
          <div class="dr-meta">${metaLine}</div>
        </div>
        <div class="dr-amt">${formatNum(convert(status === 'paid' ? paid : accrued, 'USD', state.display), state.display)}</div>
      </div>`;
    }).join('');
  }
  else if (drillWorkPeriod === 'year') {
    const byYear = {};
    for (const e of entries) {
      const y = parseDate(e.date).getFullYear();
      if (!byYear[y]) byYear[y] = { hours: 0, usd: 0, count: 0 };
      byYear[y].usd += workEntryUSD(e);
      byYear[y].hours += (e.kind === 'hourly' ? (e.hours || 0) : 0);
      byYear[y].count++;
    }
    const sorted = Object.entries(byYear).sort((a,b) => b[0].localeCompare(a[0]));
    listHtml = sorted.map(([year, d]) => `
      <div class="drill-row" style="cursor:default;">
        <div class="dr-body">
          <div class="dr-title">${year}</div>
          <div class="dr-meta">${d.hours.toFixed(1)} год · ${d.count} запис${d.count === 1 ? '' : (d.count < 5 ? 'и' : 'ів')}</div>
        </div>
        <div class="dr-amt">${formatNum(convert(d.usd, 'USD', state.display), state.display)}</div>
      </div>`).join('');
  }

  if (!listHtml) listHtml = '<div style="color:var(--muted); text-align:center; padding:24px; font-size:13px;">Немає записів</div>';

  body.innerHTML = switcher +
    `<div style="font-family:'Geist Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:1.5px; margin:14px 0 8px;">${drillWorkPeriod === 'day' ? 'ПО ДНЯХ' : drillWorkPeriod === 'week' ? 'ПО ТИЖНЯХ' : drillWorkPeriod === 'month' ? 'ПО МІСЯЦЯХ' : 'ПО РОКАХ'}</div>` +
    listHtml;

  document.getElementById('drill-work-period').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    haptic('light');
    drillWorkPeriod = b.dataset.dp;
    renderDrillWork();
  });

  // клік на місяць → деталь місяця
  body.querySelectorAll('[data-month]').forEach(el =>
    el.addEventListener('click', () => {
      haptic('light');
      openDrillMonth(el.dataset.month);
    }));

  // клік на день → редагування записів дня
  body.querySelectorAll('[data-day]').forEach(el =>
    el.addEventListener('click', () => {
      haptic('light');
      openDrillDay(el.dataset.day);
    }));
}

// ISO-тиждень з тижнем починаючи з понеділка
function isoWeekInfo(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  // нормалізуємо до четверга цього тижня (ISO-стандарт)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const week = Math.ceil((((d - jan1) / 86400000) + 1) / 7);
  // початок/кінець тижня (пн-нд)
  const dt = new Date(date);
  dt.setHours(0,0,0,0);
  const wd = (dt.getDay() + 6) % 7;
  const start = new Date(dt); start.setDate(dt.getDate() - wd);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { year, week, start, end };
}

/* =========================================================
   DRILL: МІСЯЦЬ З ВИПЛАТАМИ
   ========================================================= */
let drillMonthKey = null;
let editingPayoutId = null;

function openDrillMonth(monthKey) {
  drillMonthKey = monthKey;
  renderDrillMonth();
}

function renderDrillMonth() {
  const monthKey = drillMonthKey;
  const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
  const [y, m] = monthKey.split('-').map(Number);
  const monthName = MONTHS[m - 1] + ' ' + y;

  document.getElementById('drill-title').textContent = '💼 ' + monthName;
  const body = document.getElementById('drill-body');

  const accrued = accruedUSDForMonth(monthKey);
  const paid = paidUSDForMonth(monthKey);
  const status = monthPayoutStatus(monthKey);
  const info = STATUS_INFO[status];
  const remaining = Math.max(0, accrued - paid);
  const isFinalClosed = state.work.monthlyPayouts.some(p => p.month === monthKey && p.type === 'final');

  const payouts = state.work.monthlyPayouts
    .filter(p => p.month === monthKey)
    .sort((a,b) => parseDate(b.date) - parseDate(a.date));

  // підрахунок годин і записів
  let hours = 0, count = 0;
  for (const e of state.work.entries) {
    if (e.kind !== 'hourly') continue;
    if (monthKeyOf(e.date) !== monthKey) continue;
    hours += e.hours || 0;
    count++;
  }

  let statusBlock = '';
  if (status === 'paid') {
    const diff = paid - accrued;
    let diffLine = '';
    if (Math.abs(diff) > 0.01) {
      diffLine = `<div style="font-size:11px; color:${diff < 0 ? 'var(--danger)' : 'var(--ok)'}; margin-top:4px;">Різниця: ${diff > 0 ? '+' : ''}${formatNum(convert(diff, 'USD', state.display), state.display)}${diff < 0 ? ' (списано)' : ' (бонус)'}</div>`;
    }
    statusBlock = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Нараховано</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:17px; margin-top:2px;">${formatNum(convert(accrued, 'USD', state.display), state.display)}</div>
        </div>
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--ok); letter-spacing:1px; text-transform:uppercase;">Виплачено</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:17px; color:var(--ok); margin-top:2px;">${formatNum(convert(paid, 'USD', state.display), state.display)}</div>
        </div>
      </div>
      ${diffLine}`;
  } else {
    statusBlock = `
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Нараховано</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:15px; margin-top:2px;">${formatNum(convert(accrued, 'USD', state.display), state.display)}</div>
        </div>
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--yellow); letter-spacing:1px; text-transform:uppercase;">Виплачено</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:15px; color:var(--yellow); margin-top:2px;">${formatNum(convert(paid, 'USD', state.display), state.display)}</div>
        </div>
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--danger); letter-spacing:1px; text-transform:uppercase;">Залишок</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:15px; color:var(--danger); margin-top:2px;">${formatNum(convert(remaining, 'USD', state.display), state.display)}</div>
        </div>
      </div>`;
  }

  const payoutRows = payouts.map(p => {
    const typeLabel = p.type === 'final' ? '✅ фактична' : '🪙 аванс';
    const typeColor = p.type === 'final' ? 'var(--ok)' : 'var(--yellow)';
    return `<div class="drill-row" data-edit-payout="${p.id}">
      <div class="dr-body">
        <div class="dr-title"><span style="color:${typeColor}; font-size:11px;">${typeLabel}</span></div>
        <div class="dr-meta">${fmtDate(parseDate(p.date))}</div>
      </div>
      <div class="dr-amt">${formatNum(convert(p.amount, p.cur || 'USD', state.display), state.display)}</div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <button class="bd-edit-btn" id="drill-back" style="margin-bottom:14px; width:100%;">← Назад до місяців</button>
    <div class="drill-summary">
      <div style="margin-bottom:10px;"><span style="color:${info.color}; font-size:13px; font-weight:700;">${info.emoji} ${info.label}</span><span style="margin-left:8px; font-size:11px; color:var(--muted);">${hours.toFixed(1)} год · ${count} запис${count === 1 ? '' : (count < 5 ? 'и' : 'ів')}</span></div>
      ${statusBlock}
    </div>
    ${!isFinalClosed ? `<button class="btn-primary" id="add-payout-btn" style="margin-bottom:14px;">+ Додати виплату</button>` : ''}
    <div style="font-family:'Geist Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:1.5px; margin:14px 0 8px;">ВИПЛАТИ · ${payouts.length}</div>
    ${payoutRows || '<div style="color:var(--muted); text-align:center; padding:16px; font-size:12px;">Виплат не було</div>'}
  `;

  document.getElementById('drill-back').addEventListener('click', () => {
    haptic('light');
    drillWorkPeriod = 'month';
    document.getElementById('drill-title').textContent = '💼 Робота — деталі';
    renderDrillWork();
  });

  const addBtn = document.getElementById('add-payout-btn');
  if (addBtn) addBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    haptic('light');
    setTimeout(() => openPayoutModal(null), 0);
  });

  body.querySelectorAll('[data-edit-payout]').forEach(el =>
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      haptic('light');
      const id = el.dataset.editPayout;
      setTimeout(() => openPayoutModal(id), 0);
    }));
}

function openPayoutModal(payoutId) {
  editingPayoutId = payoutId;
  const p = payoutId ? state.work.monthlyPayouts.find(x => x.id === payoutId) : null;
  const accrued = accruedUSDForMonth(drillMonthKey);
  const paid = paidUSDForMonth(drillMonthKey);
  const remaining = Math.max(0, accrued - paid + (p ? convert(p.amount, p.cur || 'USD', 'USD') : 0));
  const remainingDisp = convert(remaining, 'USD', state.display);

  document.getElementById('payout-modal-title').textContent = p ? 'Редагувати виплату' : 'Нова виплата';

  const body = document.getElementById('payout-modal-body');
  body.innerHTML = `
    <div class="field-group">
      <label>Тип виплати</label>
      <div class="paymode-pick" id="payout-type-pick">
        <button data-type="advance" type="button" ${p?.type !== 'final' ? 'class="active"' : ''}>🪙 Аванс</button>
        <button data-type="final" type="button" ${p?.type === 'final' ? 'class="active"' : ''}>✅ Фактична</button>
      </div>
      <div class="hint" id="payout-type-hint">${p?.type === 'final' ? 'Закриє місяць навіть якщо сума менша за нараховане' : 'Часткова виплата, залишок очікує'}</div>
    </div>
    <div class="field-group">
      <label>Сума</label>
      <div class="two-col">
        <div><input class="fld" id="payout-amount" type="number" min="0" step="any" inputmode="decimal" placeholder="${remainingDisp.toFixed(0)}" value="${p ? p.amount : ''}"></div>
        <div>
          <select class="fld" id="payout-cur">
            <option value="USD" ${(p?.cur || state.display) === 'USD' ? 'selected' : ''}>$ USD</option>
            <option value="UAH" ${(p?.cur || state.display) === 'UAH' ? 'selected' : ''}>₴ UAH</option>
            <option value="PLN" ${(p?.cur || state.display) === 'PLN' ? 'selected' : ''}>zł PLN</option>
          </select>
        </div>
      </div>
      <div class="hint">Залишок: ${formatNum(remainingDisp, state.display)}</div>
    </div>
    <div class="field-group">
      <label>Дата отримання</label>
      <input class="fld" id="payout-date" type="date" value="${p ? p.date : toISO(today())}">
    </div>
    <button class="btn-primary" id="payout-save" style="width:100%; padding:16px; font-size:15px;">${p ? 'Зберегти' : 'Додати виплату'}</button>
    ${p ? '<button class="danger-link" id="payout-delete" style="margin-top:8px;">Видалити виплату</button>' : ''}
  `;
  document.getElementById('ov-payout').classList.add('open');

  // тип
  let payoutType = p?.type || 'advance';
  document.getElementById('payout-type-pick').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    haptic('light');
    payoutType = b.dataset.type;
    document.querySelectorAll('#payout-type-pick button').forEach(x =>
      x.classList.toggle('active', x === b));
    document.getElementById('payout-type-hint').textContent =
      payoutType === 'final'
        ? 'Закриє місяць навіть якщо сума менша за нараховане'
        : 'Часткова виплата, залишок очікує';
  });

  document.getElementById('payout-save').addEventListener('click', () => {
    const amount = parseFloat(document.getElementById('payout-amount').value);
    const cur = document.getElementById('payout-cur').value;
    const date = document.getElementById('payout-date').value;
    if (!amount || amount <= 0) { toast('Введи суму', 'error'); return; }
    if (!date) { toast('Вкажи дату', 'error'); return; }
    if (editingPayoutId) {
      const obj = state.work.monthlyPayouts.find(x => x.id === editingPayoutId);
      if (obj) {
        obj.amount = amount; obj.cur = cur; obj.date = date; obj.type = payoutType;
        updatePayoutInNotion(obj).then(() => saveState());
      }
    } else {
      const newPo = {
        id: 'p-' + Date.now().toString(36),
        month: drillMonthKey,
        date, amount, cur, type: payoutType
      };
      state.work.monthlyPayouts.push(newPo);
      createPayoutInNotion(newPo).then(() => saveState());
    }
    saveState();
    haptic('success');
    toast('Збережено', 'success');
    document.getElementById('ov-payout').classList.remove('open');
    renderDrillMonth();
    renderAll();
  });
  const delBtn = document.getElementById('payout-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      icon: '🗑',
      title: 'Видалити виплату?',
      okText: 'Видалити'
    });
    if (!ok) return;
    const poId = editingPayoutId;
    state.work.monthlyPayouts = state.work.monthlyPayouts.filter(x => x.id !== poId);
    saveState();
    deletePayoutInNotion(poId);
    haptic('warning');
    toast('Виплату видалено', 'warn');
    document.getElementById('ov-payout').classList.remove('open');
    renderDrillMonth();
    renderAll();
  });
}

// відновлення тіла модалки категорії після використання як payout
const CAT_MODAL_BODY_ORIG = null;
function restoreCatModalBody() {
  const body = document.querySelector('#ov-wrate .modal-body');
  if (!body) return;
  body.innerHTML = `
    <div class="field-group">
      <label>Назва</label>
      <input class="fld" id="wcat-name" type="text" placeholder="Будова">
    </div>
    <div class="field-group">
      <label>Ставка за годину</label>
      <div class="two-col">
        <div><input class="fld" id="wr-rate" type="number" min="0" step="any" inputmode="decimal" placeholder="15"></div>
        <div>
          <select class="fld" id="wr-cur">
            <option value="USD">$ USD</option>
            <option value="UAH">₴ UAH</option>
            <option value="PLN">zł PLN</option>
          </select>
        </div>
      </div>
      <div class="hint">Підставляється в нові записи. Старі записи не зміняться</div>
    </div>
    <div class="field-group">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="wcat-default" style="width:18px; height:18px;">
        <span>Категорія за замовчуванням</span>
      </label>
    </div>
    <button class="btn-primary" id="wr-save">Зберегти</button>
    <button class="danger-link" id="wcat-delete" style="margin-top:8px; display:none;">Видалити категорію</button>
  `;
  // перепідключаємо обробники
  document.getElementById('wr-save').addEventListener('click', saveWorkCat);
  document.getElementById('wcat-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({
      icon: '🗑',
      title: 'Видалити категорію?',
      text: 'Записи з цією категорією не видаляться, лише посилання стане недійсним',
      okText: 'Видалити'
    });
    if (ok) deleteWorkCat();
  });
}

/* =========================================================
   DRILL: ДЕНЬ → СПИСОК ЗАПИСІВ + РЕДАГУВАННЯ
   ========================================================= */
let drillDayDate = null;

function openDrillDay(dateStr) {
  drillDayDate = dateStr;
  const body = document.getElementById('drill-body');
  const dayEntries = state.work.entries.filter(e => e.date === dateStr);
  document.getElementById('drill-title').textContent = '💼 ' + fmtDate(parseDate(dateStr));

  let totalUSD = 0;
  let totalHours = 0;
  for (const e of dayEntries) {
    totalUSD += workEntryUSD(e);
    if (e.kind === 'hourly') totalHours += e.hours || 0;
  }

  const rows = dayEntries.map(e => {
    const isHourly = e.kind === 'hourly';
    const cat = isHourly && e.categoryId ? state.workCategories.find(c => c.id === e.categoryId) : null;
    const title = isHourly
      ? `${e.hours.toFixed(1)} год${cat ? ' · ' + escapeHtml(cat.name) : ''}`
      : escapeHtml(e.title || 'підробіток');
    const sub = isHourly
      ? `${e.rate || 0} ${e.rateCur || 'USD'}/год${e.note ? ' · ' + escapeHtml(e.note) : ''}`
      : (e.note ? escapeHtml(e.note) : '');
    return `<div class="drill-row" data-edit-entry="${e.id}">
      <div class="dr-body">
        <div class="dr-title">${title}</div>
        <div class="dr-meta">${sub}</div>
      </div>
      <div class="dr-amt">${formatNum(convert(workEntryUSD(e), 'USD', state.display), state.display)}</div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <button class="bd-edit-btn" id="drill-back-day" style="margin-bottom:14px; width:100%;">← Назад до днів</button>
    <div class="drill-summary">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Годин</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:15px; margin-top:2px;">${totalHours.toFixed(1)}</div>
        </div>
        <div>
          <div style="font-family:'Geist Mono',monospace; font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Заробіток</div>
          <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:15px; color:var(--ok); margin-top:2px;">${formatNum(convert(totalUSD, 'USD', state.display), state.display)}</div>
        </div>
      </div>
    </div>
    <div style="font-family:'Geist Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:1.5px; margin:14px 0 8px;">ЗАПИСИ · ${dayEntries.length}</div>
    ${rows || '<div style="color:var(--muted); text-align:center; padding:16px;">Немає записів</div>'}
  `;

  document.getElementById('drill-back-day').addEventListener('click', () => {
    haptic('light');
    drillWorkPeriod = 'day';
    document.getElementById('drill-title').textContent = '💼 Робота — деталі';
    renderDrillWork();
  });

  body.querySelectorAll('[data-edit-entry]').forEach(el =>
    el.addEventListener('click', () => {
      haptic('light');
      openEditWorkEntry(el.dataset.editEntry);
    }));
}

function openEditWorkEntry(entryId) {
  const e = state.work.entries.find(x => x.id === entryId);
  if (!e) return;

  // використовуємо існуючу модалку ov-work, але заповнюємо її
  document.getElementById('work-modal-title').textContent = 'Редагувати запис';
  document.getElementById('wk-date').value = e.date;
  document.getElementById('wk-note').value = e.note || '';

  const isHourly = e.kind === 'hourly';
  document.getElementById('wk-hourly-fields').style.display = isHourly ? '' : 'none';
  document.getElementById('wk-fixed-fields').style.display = isHourly ? 'none' : '';

  if (isHourly) {
    fillWorkCategorySelect(e.categoryId);
    document.getElementById('wk-hours').value = e.hours;
    document.getElementById('wk-rate').value = e.rate || state.work.hourlyRate;
    document.getElementById('wk-rate-cur').value = e.rateCur || state.work.hourlyCur;
  } else {
    document.getElementById('wk-title').value = e.title || '';
    document.getElementById('wk-amount').value = e.amountNative || '';
    document.getElementById('wk-cur').value = e.cur || state.display;
  }

  // підміна кнопки — зберегти зміни замість додати
  const saveBtn = document.getElementById('wk-save');
  saveBtn.textContent = 'Зберегти зміни';
  saveBtn._editId = entryId;

  // показуємо кнопку видалення
  const delBtn = document.getElementById('wk-delete');
  delBtn.style.display = '';
  delBtn.onclick = async () => {
    const ok = await confirmDialog({
      icon: '×', title: 'Видалити запис?',
      text: 'Цю операцію не можна скасувати', okText: 'Видалити'
    });
    if (!ok) return;
    state.work.entries = state.work.entries.filter(x => x.id !== entryId);
    saveState();
    deleteWorkEntryInNotion(entryId);
    toast('Запис видалено', 'warn');
    document.getElementById('ov-work').classList.remove('open');
    saveBtn._editId = null;
    saveBtn.textContent = 'Додати запис';
    delBtn.style.display = 'none';
    renderWork();
    // якщо відкритий drill-day — оновлюємо
    if (drillDayDate && document.getElementById('ov-drill').classList.contains('open')) {
      openDrillDay(drillDayDate);
    }
  };

  renderWorkPreview();
  document.getElementById('ov-work').classList.add('open');
}

function openDrillSetup() {
  document.getElementById('drill-title').textContent = '🛠 Розробка — деталі';
  const body = document.getElementById('drill-body');

  const setupClients = state.clients.filter(c => c.setupAmount > 0)
    .map(c => ({
      c,
      usd: convert(c.setupAmount, c.setupCur || c.cur, 'USD')
    }))
    .sort((a,b) => b.usd - a.usd);

  const totalUSD = setupClients.reduce((s, x) => s + x.usd, 0);

  body.innerHTML = `
    <div class="drill-summary">
      <div style="font-family:'Geist Mono',monospace; font-size:11px; color:var(--muted); letter-spacing:1px; text-transform:uppercase;">Всього з розробок</div>
      <div style="font-family:'Geist Mono',monospace; font-weight:800; font-size:24px; margin-top:4px; color:var(--dev);">
        ${formatNum(convert(totalUSD, 'USD', state.display), state.display)}
      </div>
      <div style="font-size:11px; color:var(--muted); margin-top:6px;">${setupClients.length} проєкт${setupClients.length === 1 ? '' : 'ів'}</div>
    </div>
    <div style="font-family:'Geist Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:1.5px; margin:14px 0 8px;">ПРОЄКТИ</div>
    ${setupClients.length === 0 ? '<div style="color:var(--muted); text-align:center; padding:20px;">Поки нема разових плат</div>' :
      setupClients.map(x => `
        <div class="drill-row" data-client="${x.c.id}">
          <div class="dr-body">
            <div class="dr-title">${escapeHtml(x.c.name)}</div>
            <div class="dr-meta">${fmtDate(parseDate(x.c.start))} · ставка ${formatNum(rateInDisplay(x.c), state.display)}/міс</div>
          </div>
          <div class="dr-amt" style="color:var(--dev);">${formatNum(convert(x.usd, 'USD', state.display), state.display)}</div>
        </div>`).join('')
    }
  `;
  body.querySelectorAll('[data-client]').forEach(el =>
    el.addEventListener('click', () => {
      haptic('light');
      openDrillClient(el.dataset.client);
    }));
  document.getElementById('ov-drill').classList.add('open');
}

// Допоміжна — дохід з клієнта за період (приблизно)
function clientDoneInPeriodUSD(c, period) {
  if (period === 'all') {
    const totalNative = c.payments.reduce((s,p) => s + p.amountNative, 0);
    return convert(totalNative, c.cur, 'USD');
  }
  const now = new Date();
  const from = startOf(period, now);
  let s = 0;
  for (const p of c.payments) {
    const t = parseDate(p.date).getTime();
    if (t >= from.getTime() && t <= now.getTime()) {
      s += convert(p.amountNative, c.cur, 'USD');
    }
  }
  return s;
}

function incomePeriodLabel(p) {
  return { day:'день', week:'тиждень', month:'місяць', year:'рік', all:'весь час' }[p] || p;
}

function renderDashboard() {
  // Стара Dashboard-вкладка прибрана з UI. Функцію лишаю для сумісності, але виходимо.
  if (!document.getElementById('dash-label')) return;
  const p = state.dashboardPeriod;
  document.querySelectorAll('#dash-period-pick button').forEach(b =>
    b.classList.toggle('active', b.dataset.p === p));
  document.querySelectorAll('#dash-mode-pick button').forEach(b =>
    b.classList.toggle('active', b.dataset.wm === (state.workEarnedMode || 'accrued')));

  const rentUSD = rentEarnedInPeriodUSD(p);
  const setupUSD = setupEarnedInPeriodUSD(p);
  const workUSD = workEarnedInPeriodUSD(p);
  const earnedUSD = rentUSD + setupUSD + workUSD;
  const spentUSD = dashExpensesUSD(p);
  const balanceUSD = earnedUSD - spentUSD;

  document.getElementById('dash-label').textContent = '// ' + DASH_PERIOD_LABEL[p];

  const balEl = document.getElementById('dash-balance');
  const sign = balanceUSD >= 0 ? '+' : '−';
  balEl.textContent = sign + formatNum(convert(Math.abs(balanceUSD), 'USD', state.display), state.display);
  balEl.className = 'dash-balance ' + (balanceUSD >= 0 ? 'positive' : 'negative');
  document.getElementById('dash-sub').textContent = 'залишок';

  document.getElementById('dash-earned').textContent = formatNum(convert(earnedUSD, 'USD', state.display), state.display);
  document.getElementById('dash-spent').textContent = formatNum(convert(spentUSD, 'USD', state.display), state.display);

  // income split
  const incSplit = document.getElementById('dash-income-split');
  const incomeSources = [
    { name: '🏠 Оренда', usd: rentUSD, color: '#5fb8ff' },
    { name: '💼 Робота', usd: workUSD, color: '#ffd60a' },
    { name: '🛠 Розробка', usd: setupUSD, color: '#a78bfa' }
  ];
  incSplit.innerHTML = incomeSources.map(s => {
    const pct = earnedUSD > 0 ? (s.usd / earnedUSD) * 100 : 0;
    return `<div class="dash-split-row">
      <div class="dsr-dot" style="background:${s.color};"></div>
      <div class="dsr-name">${s.name}</div>
      <div class="dsr-amt">${formatNum(convert(s.usd, 'USD', state.display), state.display)}</div>
      <div class="dsr-pct">${Math.round(pct)}%</div>
    </div>`;
  }).join('');

  // expense split (реальні витрати з Notion DB_EXPENSES)
  const expSplit = document.getElementById('dash-expense-split');
  const cats = dashExpensesByCategory(p);
  if (cats.length === 0) {
    expSplit.innerHTML = '<div style="color:var(--muted); text-align:center; padding:20px; font-size:12px;">За цей період витрат не було</div>';
  } else {
    expSplit.innerHTML = cats.map((x, i) => {
      const pct = spentUSD > 0 ? (x.usd / spentUSD) * 100 : 0;
      return `<div class="dash-split-row">
        <div class="dsr-dot" style="background:${DASH_PALETTE[i % DASH_PALETTE.length]};"></div>
        <div class="dsr-name">${escapeHtml(x.name)}</div>
        <div class="dsr-amt">${formatNum(convert(x.usd, 'USD', state.display), state.display)}</div>
        <div class="dsr-pct">${Math.round(pct)}%</div>
      </div>`;
    }).join('');
  }
}

// View toggle
document.getElementById('view-toggle').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  state.view = b.dataset.view;
  saveState();
  renderAll();
});

// Dashboard period picker (СТАРЕ — залишаю щоб не було помилок якщо елемент десь є)
const dashPickEl = document.getElementById('dash-period-pick');
if (dashPickEl) dashPickEl.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  state.dashboardPeriod = b.dataset.p;
  saveState();
  renderDashboard();
});
const dashModePickEl = document.getElementById('dash-mode-pick');
if (dashModePickEl) dashModePickEl.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  state.workEarnedMode = b.dataset.wm;
  saveState();
  renderDashboard();
});

/* =========================================================
   ОГЛЯД (обʼєднання Статистика + Dashboard)
   ========================================================= */

// Границі періоду залежно від kind + anchor
function overviewBounds() {
  const kind = state.overview.kind;
  const anchor = new Date(state.overview.anchor);
  anchor.setHours(0,0,0,0);

  if (kind === 'day') {
    const from = new Date(anchor);
    const to = new Date(anchor); to.setDate(to.getDate() + 1);
    return { from: from.getTime(), to: to.getTime() };
  }
  if (kind === 'week') {
    // тиждень з ПН по НД
    const wd = (anchor.getDay() + 6) % 7; // ПН=0, НД=6
    const from = new Date(anchor); from.setDate(from.getDate() - wd);
    const to = new Date(from); to.setDate(to.getDate() + 7);
    return { from: from.getTime(), to: to.getTime() };
  }
  if (kind === 'month') {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    return { from: from.getTime(), to: to.getTime() };
  }
  // year
  const from = new Date(anchor.getFullYear(), 0, 1);
  const to = new Date(anchor.getFullYear() + 1, 0, 1);
  return { from: from.getTime(), to: to.getTime() };
}

// Опис періоду для label
function overviewLabel() {
  const kind = state.overview.kind;
  const anchor = new Date(state.overview.anchor);
  const MONTHS = ['Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру'];
  const MONTHS_FULL = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
  if (kind === 'day') {
    return anchor.getDate() + ' ' + MONTHS[anchor.getMonth()] + ' ' + anchor.getFullYear();
  }
  if (kind === 'week') {
    const wd = (anchor.getDay() + 6) % 7;
    const from = new Date(anchor); from.setDate(from.getDate() - wd);
    const to = new Date(from); to.setDate(to.getDate() + 6);
    if (from.getMonth() === to.getMonth()) {
      return from.getDate() + '-' + to.getDate() + ' ' + MONTHS[from.getMonth()] + ' ' + from.getFullYear();
    }
    return from.getDate() + ' ' + MONTHS[from.getMonth()] + ' – ' + to.getDate() + ' ' + MONTHS[to.getMonth()] + ' ' + from.getFullYear();
  }
  if (kind === 'month') {
    return MONTHS_FULL[anchor.getMonth()] + ' ' + anchor.getFullYear();
  }
  return String(anchor.getFullYear());
}

// Стрілки — переміщення на попередній/наступний період
function overviewShift(delta) {
  const anchor = new Date(state.overview.anchor);
  const kind = state.overview.kind;
  if (kind === 'day') anchor.setDate(anchor.getDate() + delta);
  else if (kind === 'week') anchor.setDate(anchor.getDate() + delta * 7);
  else if (kind === 'month') anchor.setMonth(anchor.getMonth() + delta);
  else anchor.setFullYear(anchor.getFullYear() + delta);
  state.overview.anchor = toISOsafe(anchor);
  saveState();
  renderOverview();
}

// Обчислення сум у межах overviewBounds
function ovRentUSD() {
  const { from, to } = overviewBounds();
  let s = 0;
  for (const c of state.clients) {
    for (const pay of c.payments || []) {
      const t = parseDate(pay.date).getTime();
      if (t >= from && t < to) {
        s += convert(pay.amountNative, c.cur, 'USD');
      }
    }
  }
  return s;
}
function ovWorkUSD() {
  const { from, to } = overviewBounds();
  const mode = state.workEarnedMode || 'accrued';
  if (mode === 'paid') {
    let s = 0;
    for (const po of (state.work.monthlyPayouts || [])) {
      const t = parseDate(po.date).getTime();
      if (t >= from && t < to) s += convert(po.amount, po.cur || 'USD', 'USD');
    }
    for (const e of state.work.entries) {
      if (e.kind !== 'fixed') continue;
      const t = parseDate(e.date).getTime();
      if (t >= from && t < to) s += workEntryUSD(e);
    }
    return s;
  }
  let s = 0;
  for (const e of state.work.entries) {
    const t = parseDate(e.date).getTime();
    if (t >= from && t < to) s += workEntryUSD(e);
  }
  return s;
}
function ovWorkByCategory() {
  const { from, to } = overviewBounds();
  const mode = state.workEarnedMode || 'accrued';
  const byCat = {};
  const addCat = (catId, usd, hours) => {
    if (!byCat[catId]) byCat[catId] = { usd: 0, hours: 0 };
    byCat[catId].usd += usd;
    byCat[catId].hours += hours || 0;
  };
  if (mode === 'paid') {
    // виплати не мають розбивки по категоріях (крім тих що з catId)
    // тому показуємо розбивку тільки для нарахованого
    for (const po of (state.work.monthlyPayouts || [])) {
      const t = parseDate(po.date).getTime();
      if (t < from || t >= to) continue;
      const catId = po.categoryId || 'no-cat';
      addCat(catId, convert(po.amount, po.cur || 'USD', 'USD'), 0);
    }
    for (const e of state.work.entries) {
      if (e.kind !== 'fixed') continue;
      const t = parseDate(e.date).getTime();
      if (t < from || t >= to) continue;
      addCat('fixed', workEntryUSD(e), 0);
    }
  } else {
    for (const e of state.work.entries) {
      const t = parseDate(e.date).getTime();
      if (t < from || t >= to) continue;
      if (e.kind === 'hourly') {
        addCat(e.categoryId || 'no-cat', workEntryUSD(e), e.hours || 0);
      } else {
        addCat('fixed', workEntryUSD(e), 0);
      }
    }
  }
  // до масиву
  return Object.entries(byCat).map(([id, d]) => {
    let name;
    if (id === 'fixed') name = '⚡ Підробітки (fixed)';
    else if (id === 'no-cat') name = 'без категорії';
    else {
      const c = state.workCategories.find(x => x.id === id);
      name = c ? c.name : 'категорія';
    }
    return { id, name, usd: d.usd, hours: d.hours };
  }).sort((a, b) => b.usd - a.usd);
}
function ovExpensesUSD() {
  const { from, to } = overviewBounds();
  let s = 0;
  for (const e of (state.expensesFromNotion || [])) {
    const t = parseDate(e.date).getTime();
    if (t >= from && t < to) s += convert(e.amount, e.currency || 'USD', 'USD');
  }
  return s;
}
function ovExpensesByCategory() {
  const { from, to } = overviewBounds();
  const cats = state.expenseCats || [];
  const byCat = {};
  for (const e of (state.expensesFromNotion || [])) {
    const t = parseDate(e.date).getTime();
    if (t < from || t >= to) continue;
    const usd = convert(e.amount, e.currency || 'USD', 'USD');
    const key = e.categoryId || 'none';
    if (!byCat[key]) byCat[key] = { name: '', usd: 0 };
    byCat[key].usd += usd;
  }
  for (const id in byCat) {
    if (id === 'none') { byCat[id].name = 'без категорії'; continue; }
    const cat = cats.find(c => c.id === id);
    byCat[id].name = cat ? cat.name : 'категорія';
  }
  return Object.values(byCat).sort((a,b) => b.usd - a.usd);
}

// стан для розкриття розбивки роботи по категоріях
let ovWorkExpanded = false;

function renderOverview() {
  // якщо елементів немає в DOM (не той HTML) — тихо виходимо
  if (!document.getElementById('ov-picker-label')) return;
  // активний вибір типу
  document.querySelectorAll('#ov-kind-pick button').forEach(b =>
    b.classList.toggle('active', b.dataset.k === state.overview.kind));
  document.querySelectorAll('#ov-mode-pick button').forEach(b =>
    b.classList.toggle('active', b.dataset.wm === (state.workEarnedMode || 'accrued')));

  // label періоду
  document.getElementById('ov-picker-label').textContent = overviewLabel();

  // синхронізуємо date-input з anchor
  const dateInp = document.getElementById('ov-picker-date');
  if (dateInp) dateInp.value = state.overview.anchor;

  const rentUSD = ovRentUSD();
  const workUSD = ovWorkUSD();
  const earnedUSD = rentUSD + workUSD; // без setup
  const spentUSD = ovExpensesUSD();
  const balanceUSD = earnedUSD - spentUSD;

  document.getElementById('ov-label').textContent = '// ' + overviewLabel();
  const balEl = document.getElementById('ov-balance');
  const sign = balanceUSD >= 0 ? '+' : '−';
  balEl.textContent = sign + formatNum(convert(Math.abs(balanceUSD), 'USD', state.display), state.display);
  balEl.className = 'dash-balance ' + (balanceUSD >= 0 ? 'positive' : 'negative');
  document.getElementById('ov-sub').textContent = 'залишок';

  document.getElementById('ov-earned').textContent = formatNum(convert(earnedUSD, 'USD', state.display), state.display);
  document.getElementById('ov-spent').textContent = formatNum(convert(spentUSD, 'USD', state.display), state.display);

  // income split (без Розробки)
  const incSplit = document.getElementById('ov-income-split');
  const workCats = ovWorkByCategory();
  const rentPct = earnedUSD > 0 ? (rentUSD / earnedUSD) * 100 : 0;
  const workPct = earnedUSD > 0 ? (workUSD / earnedUSD) * 100 : 0;

  const workRow = `<div class="dash-split-row expandable" id="ov-work-toggle">
    <div class="dsr-dot" style="background:#ffd60a;"></div>
    <div class="dsr-name">💼 Робота ${workCats.length > 0 ? (ovWorkExpanded ? '▾' : '▸') : ''}</div>
    <div class="dsr-amt">${formatNum(convert(workUSD, 'USD', state.display), state.display)}</div>
    <div class="dsr-pct">${Math.round(workPct)}%</div>
  </div>` +
  (ovWorkExpanded && workCats.length > 0 ? workCats.map(c => `
    <div class="dash-split-sub">
      <span class="sub-name">↳ ${escapeHtml(c.name)}${c.hours > 0 ? ' · ' + c.hours.toFixed(1) + ' год' : ''}</span>
      <span class="sub-val">${formatNum(convert(c.usd, 'USD', state.display), state.display)}</span>
    </div>`).join('') : '');

  incSplit.innerHTML = `<div class="dash-split-row">
    <div class="dsr-dot" style="background:#5fb8ff;"></div>
    <div class="dsr-name">🏠 Оренда</div>
    <div class="dsr-amt">${formatNum(convert(rentUSD, 'USD', state.display), state.display)}</div>
    <div class="dsr-pct">${Math.round(rentPct)}%</div>
  </div>` + workRow;

  const workToggle = document.getElementById('ov-work-toggle');
  if (workToggle && workCats.length > 0) {
    workToggle.addEventListener('click', () => {
      haptic('light');
      ovWorkExpanded = !ovWorkExpanded;
      renderOverview();
    });
  }

  // expense split
  const expSplit = document.getElementById('ov-expense-split');
  const cats = ovExpensesByCategory();
  if (cats.length === 0) {
    expSplit.innerHTML = '<div style="color:var(--muted); text-align:center; padding:20px; font-size:12px;">За цей період витрат не було</div>';
  } else {
    expSplit.innerHTML = cats.map((x, i) => {
      const pct = spentUSD > 0 ? (x.usd / spentUSD) * 100 : 0;
      return `<div class="dash-split-row">
        <div class="dsr-dot" style="background:${DASH_PALETTE[i % DASH_PALETTE.length]};"></div>
        <div class="dsr-name">${escapeHtml(x.name)}</div>
        <div class="dsr-amt">${formatNum(convert(x.usd, 'USD', state.display), state.display)}</div>
        <div class="dsr-pct">${Math.round(pct)}%</div>
      </div>`;
    }).join('');
  }
}

// Обробники Огляду
document.getElementById('ov-kind-pick')?.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  state.overview.kind = b.dataset.k;
  ovWorkExpanded = false;
  saveState();
  renderOverview();
});
document.getElementById('ov-mode-pick')?.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  state.workEarnedMode = b.dataset.wm;
  saveState();
  renderOverview();
});
document.getElementById('ov-prev')?.addEventListener('click', () => { haptic('light'); overviewShift(-1); });
document.getElementById('ov-next')?.addEventListener('click', () => { haptic('light'); overviewShift(1); });

// Пікер дати — тапаєш кнопку → відкриваєш прихований input
document.getElementById('ov-picker-btn')?.addEventListener('click', () => {
  const inp = document.getElementById('ov-picker-date');
  if (!inp) return;
  // залежно від kind міняємо тип
  inp.style.pointerEvents = 'auto';
  inp.focus();
  inp.click();
  if (inp.showPicker) inp.showPicker();
  setTimeout(() => { inp.style.pointerEvents = 'none'; }, 500);
});
document.getElementById('ov-picker-date')?.addEventListener('change', e => {
  const v = e.target.value;
  if (!v) return;
  state.overview.anchor = v;
  haptic('light');
  saveState();
  renderOverview();
});

// Display picker
document.getElementById('disp-picker').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  state.display = b.dataset.cur;
  saveState();
  renderAll();
});

// ===== РОБОТА: обробники =====
document.getElementById('work-mode').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  state.work.mode = b.dataset.wmode;
  saveState();
  renderWork();
});
document.getElementById('work-period-pick').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  state.work.period = b.dataset.wp;
  saveState();
  renderWork();
});
document.getElementById('income-period-pick').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  state.incomePeriod = b.dataset.ip;
  saveState();
  renderIncomeSplit();
});

// перемикач Нараховане / Виплачене у статистиці
document.getElementById('work-mode-pick').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  state.workEarnedMode = b.dataset.wm;
  document.querySelectorAll('#work-mode-pick button').forEach(x =>
    x.classList.toggle('active', x === b));
  saveState();
  renderIncomeSplit();
});

// Drill-in на inc-cards (Оренда / Робота / Розробка)
document.querySelectorAll('[data-drill]').forEach(card =>
  card.addEventListener('click', () => {
    haptic('light');
    openDrill(card.dataset.drill);
  }));
document.getElementById('btn-add-work').addEventListener('click', () => {
  haptic('light');
  openWorkModal();
});
document.getElementById('wk-save').addEventListener('click', saveWorkEntry);

// нові обробники для категорій робіт
document.getElementById('btn-add-work-cat').addEventListener('click', () => {
  haptic('light');
  openWorkCatModal(null);
});
document.getElementById('wr-save').addEventListener('click', saveWorkCat);
document.getElementById('wcat-delete').addEventListener('click', async () => {
  const ok = await confirmDialog({
    icon: '🗑',
    title: 'Видалити категорію?',
    text: 'Записи з цією категорією не видаляться, лише посилання стане недійсним',
    okText: 'Видалити'
  });
  if (ok) deleteWorkCat();
});
// живий preview при вводі
['wk-hours','wk-amount','wk-cur','wk-rate','wk-rate-cur'].forEach(id => {
  document.addEventListener('input', e => {
    if (e.target && e.target.id === id) renderWorkPreview();
  });
});

// при зміні категорії — підставляємо її ставку
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'wk-category') {
    const cat = workCategoryById(e.target.value);
    if (cat) {
      document.getElementById('wk-rate').value = cat.rate;
      document.getElementById('wk-rate-cur').value = cat.cur;
      renderWorkPreview();
    }
  }
});

document.getElementById('btn-add-client').addEventListener('click', () => {
  haptic('light');
  resetAddMode();
  document.getElementById('ac-name').value = '';
  document.getElementById('ac-rate').value = '';
  document.getElementById('ac-start').value = toISO(today());
  resetAcForm();
  refreshReferrerOptions();
  document.getElementById('ov-add').classList.add('open');
});
document.getElementById('ac-save-edit').addEventListener('click', saveEditClient);
document.getElementById('bd-edit').addEventListener('click', () => {
  if (!openBoardId) return;
  haptic('light');
  refreshReferrerOptions();
  openEditClient(openBoardId);
});

// перемикач "Сам / Приведений"
document.getElementById('ac-source').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  acSource = b.dataset.src;
  document.querySelectorAll('#ac-source button').forEach(x =>
    x.classList.toggle('active', x === b));
  document.getElementById('ac-ref-block').style.display =
    acSource === 'ref' ? '' : 'none';
});

// перемикач "Передплата / Постоплата"
document.getElementById('ac-paymode').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  acPayMode = b.dataset.mode;
  document.querySelectorAll('#ac-paymode button').forEach(x =>
    x.classList.toggle('active', x === b));
  document.getElementById('ac-paymode-hint').textContent =
    acPayMode === 'prepaid'
      ? 'Передплата: спочатку платить → потім користується'
      : 'Постоплата: спочатку користується → платить наприкінці. Натиснеш «Оплачено» коли отримав гроші.';
});

// вибір бонусу 3/4.5/6
document.getElementById('ac-bonus-pick').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  haptic('light');
  acBonus = parseFloat(b.dataset.bonus);
  document.querySelectorAll('#ac-bonus-pick button').forEach(x =>
    x.classList.toggle('active', x === b));
});
document.getElementById('ac-save').addEventListener('click', () => addClient(false));
document.getElementById('ac-save-pay').addEventListener('click', () => addClient(true));

document.getElementById('fx-chip').addEventListener('click', openFxEdit);
document.getElementById('fx-refresh').addEventListener('click', async () => {
  const ok = await fetchRates();
  if (ok) {
    document.getElementById('fx-uah').value = state.rates.UAH;
    document.getElementById('fx-pln').value = state.rates.PLN;
    document.getElementById('fx-meta').textContent =
      'Оновлено з ' + (state.ratesSource || 'API') + ': ' + new Date().toLocaleString('uk-UA');
    toast('Курси оновлено', 'success');
  } else {
    document.getElementById('fx-meta').textContent =
      'Жодне джерело не відповіло — введи вручну';
    toast('Не вдалось оновити курси', 'error');
  }
});
document.getElementById('fx-save').addEventListener('click', () => {
  const uah = parseFloat(document.getElementById('fx-uah').value);
  const pln = parseFloat(document.getElementById('fx-pln').value);
  if (!uah || uah <= 0 || !pln || pln <= 0) {
    toast('Введи коректні курси', 'error');
    return;
  }
  state.rates.UAH = uah;
  state.rates.PLN = pln;
  state.ratesAuto = false;
  saveState();
  renderAll();
  document.getElementById('ov-fx').classList.remove('open');
  toast('Курси збережено', 'success');
});

document.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => {
    document.getElementById(b.dataset.close).classList.remove('open');
    if (b.dataset.close === 'ov-add') resetAddMode();
  }));
document.querySelectorAll('.overlay').forEach(ov =>
  ov.addEventListener('click', e => {
    if (e.target === ov) {
      ov.classList.remove('open');
      if (ov.id === 'ov-add') resetAddMode();
    }
  }));

/* =========================================================
   EXPORT / IMPORT / CLEAR
   ========================================================= */
function openMenu() {
  // оновити статистику
  const numClients = state.clients.length;
  const numPayments = state.clients.reduce((s,c) => s + (c.payments?.length || 0), 0);
  const numWork = state.work?.entries?.length || 0;
  const sizeKb = (JSON.stringify(state).length / 1024).toFixed(1);
  document.getElementById('menu-stats').innerHTML =
    `орендарів: <b>${numClients}</b><br>` +
    `оплат: <b>${numPayments}</b><br>` +
    `записів роботи: <b>${numWork}</b><br>` +
    `обʼєм даних: <b>${sizeKb} KB</b>`;
  document.getElementById('ov-menu').classList.add('open');
}

function exportData() {
  try {
    const data = {
      app: 'rent-control',
      version: 1,
      exportedAt: new Date().toISOString(),
      state: state
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0,10);
    a.download = `rent-control-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    haptic('success');
    toast('Бекап завантажено', 'success');
  } catch (e) {
    toast('Помилка експорту', 'error');
  }
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.state || parsed.app !== 'rent-control') {
        toast('Не той формат файлу', 'error');
        return;
      }
      const ok = await confirmDialog({
        icon: '📥',
        title: 'Замінити дані?',
        text: `Поточні дані будуть перезаписані бекапом від ${new Date(parsed.exportedAt).toLocaleString('uk-UA')}. Скасувати неможливо.`,
        okText: 'Замінити'
      });
      if (!ok) return;
      state = parsed.state;
      saveState();
      renderAll();
      document.getElementById('ov-menu').classList.remove('open');
      toast('Дані відновлено', 'success');
      haptic('success');
    } catch (e) {
      toast('Файл пошкоджено', 'error');
    }
  };
  reader.readAsText(file);
}

async function clearAllData() {
  const ok = await confirmDialog({
    icon: '🗑',
    title: 'Очистити ВСЕ?',
    text: 'Усі орендарі, оплати, робота — назавжди. Зроби спочатку експорт як страховку.',
    okText: 'Так, очистити'
  });
  if (!ok) return;
  try { localStorage.removeItem(STORE); } catch (e) {}
  try { window.name = ''; } catch (e) {}
  state = loadState();
  saveState();
  renderAll();
  document.getElementById('ov-menu').classList.remove('open');
  toast('Все очищено', 'warn');
  haptic('error');
}

document.getElementById('menu-btn').addEventListener('click', () => {
  haptic('light');
  openMenu();
});
document.getElementById('mi-export').addEventListener('click', exportData);
document.getElementById('mi-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});
document.getElementById('import-file').addEventListener('change', e => {
  if (e.target.files && e.target.files[0]) {
    importData(e.target.files[0]);
    e.target.value = ''; // дозволити повторний імпорт того ж файлу
  }
});
document.getElementById('mi-clear').addEventListener('click', clearAllData);

/* =========================================================
   ЦІЛІ (UI + логіка)
   ========================================================= */

// ==== Тумблер вмикання ====
const goalsToggle = document.getElementById('goals-enabled-toggle');
if (goalsToggle) {
  goalsToggle.checked = !!state.settings?.goalsEnabled;
  updateGoalsSub();
  goalsToggle.addEventListener('change', async () => {
    if (!state.settings) state.settings = {};
    state.settings.goalsEnabled = goalsToggle.checked;
    saveState();
    updateGoalsSub();
    haptic('light');
    renderAll();
    if (goalsToggle.checked) {
      toast('Завантажую цілі...', 'info');
      await loadGoalsFromNotion();
      renderAll();
    }
  });
}

// Тумблери інших вкладок
function bindTabToggle(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = state.settings?.[key] !== false;
  el.addEventListener('change', () => {
    if (!state.settings) state.settings = {};
    state.settings[key] = el.checked;
    saveState();
    haptic('light');
    renderAll();
  });
}
bindTabToggle('tab-clients-toggle', 'tabClients');
bindTabToggle('tab-work-toggle', 'tabWork');
bindTabToggle('tab-overview-toggle', 'tabOverview');
function updateGoalsSub() {
  const el = document.getElementById('mi-goals-sub');
  if (el) el.textContent = state.settings?.goalsEnabled ? 'Увімкнено' : 'Вимкнено';
}

// ==== Рендер списку цілей ====
function renderGoals() {
  const wrap = document.getElementById('view-goals');
  if (!wrap) return;
  const active = state.goals.filter(g => g.status === 'active');
  const done = state.goals.filter(g => g.status === 'completed' || g.status === 'closed');

  document.getElementById('goals-count').textContent = active.length;
  document.getElementById('goals-done-count').textContent = done.length;

  // сумарна сума розкладена по цілях у поточній валюті
  let totalInGoalsUSD = 0;
  for (const g of state.goals) {
    if (g.status === 'closed') continue; // закриті не рахуємо
    totalInGoalsUSD += convert(g.saved || 0, g.cur, 'USD');
  }
  document.getElementById('goals-total').textContent =
    formatNum(convert(totalInGoalsUSD, 'USD', state.display), state.display);

  document.getElementById('goals-list').innerHTML =
    active.length === 0
      ? '<div style="color:var(--muted); text-align:center; padding:20px; font-size:13px;">Ще немає активних цілей. Тапни «+ Нова ціль»</div>'
      : active.map(renderGoalCard).join('');

  document.getElementById('goals-done-list').innerHTML =
    done.length === 0 ? '' : done.map(renderGoalCard).join('');

  document.querySelectorAll('[data-goal-id]').forEach(el => {
    el.addEventListener('click', () => {
      haptic('light');
      openGoalDetail(el.dataset.goalId);
    });
  });
}

function renderGoalCard(g) {
  const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
  const isDone = g.status === 'completed';
  const isClosed = g.status === 'closed';
  const savedDisp = convert(g.saved, g.cur, state.display);
  const targetDisp = convert(g.target, g.cur, state.display);

  let levelsHtml = '';
  if (g.levels && g.levels.length > 0) {
    levelsHtml = '<div class="goal-levels">' +
      g.levels.map(lvl => `<span class="goal-level">🏆 ${formatNum(convert(lvl, g.cur, state.display), state.display)}</span>`).join('') +
      `<span class="goal-level current">🎯 ${formatNum(targetDisp, state.display)}</span>` +
      '</div>';
  }

  return `<div class="goal-card ${isDone ? 'completed' : ''}" data-goal-id="${g.id}">
    <div class="goal-head">
      <div class="goal-icon">${escapeHtml(g.icon || '🎯')}</div>
      <div class="goal-name">${escapeHtml(g.name)} ${isClosed ? '<span style="font-size:10px; color:var(--muted); font-weight:normal;">(закрита)</span>' : ''}</div>
      <div class="goal-amount">${formatNum(targetDisp, state.display)}</div>
    </div>
    <div class="goal-bar-wrap">
      <div class="goal-bar ${isDone ? 'completed' : ''}" style="width:${pct}%;"></div>
    </div>
    <div class="goal-meta">
      <span>${formatNum(savedDisp, state.display)} з ${formatNum(targetDisp, state.display)}</span>
      <span class="pct ${isDone ? 'done' : ''}">${Math.round(pct)}%${isDone ? ' ✓' : ''}</span>
    </div>
    ${levelsHtml}
  </div>`;
}

// ==== Модалка створення/редагування цілі ====
let editingGoalId = null;
function openGoalModal(goalId) {
  editingGoalId = goalId;
  const g = goalId ? state.goals.find(x => x.id === goalId) : null;
  document.getElementById('goal-modal-title').textContent = g ? 'Редагувати ціль' : 'Нова ціль';
  const body = document.getElementById('goal-modal-body');
  body.innerHTML = `
    <div class="field-group">
      <label>Іконка (емодзі)</label>
      <input class="fld" id="g-icon" type="text" value="${g ? escapeHtml(g.icon || '🎯') : '🎯'}" maxlength="4" style="text-align:center; font-size:22px;">
    </div>
    <div class="field-group">
      <label>Назва цілі</label>
      <input class="fld" id="g-name" type="text" placeholder="Новий iPhone" value="${g ? escapeHtml(g.name) : ''}">
    </div>
    <div class="field-group">
      <label>Потрібна сума</label>
      <div class="two-col">
        <div><input class="fld" id="g-target" type="number" min="0" step="any" inputmode="decimal" placeholder="1000" value="${g ? g.target : ''}"></div>
        <div>
          <select class="fld" id="g-cur">
            <option value="USD" ${(g?.cur || state.display) === 'USD' ? 'selected' : ''}>$ USD</option>
            <option value="UAH" ${(g?.cur || state.display) === 'UAH' ? 'selected' : ''}>₴ UAH</option>
            <option value="PLN" ${(g?.cur || state.display) === 'PLN' ? 'selected' : ''}>zł PLN</option>
          </select>
        </div>
      </div>
    </div>
    <div class="field-group">
      <label>Дата старту</label>
      <input class="fld" id="g-start" type="date" value="${g ? g.start : toISO(today())}">
    </div>
    <div class="field-group">
      <label>Дедлайн (опційно)</label>
      <input class="fld" id="g-deadline" type="date" value="${g?.deadline || ''}">
    </div>
    <button class="btn-primary" id="g-save" style="width:100%; padding:16px; font-size:15px;">${g ? 'Зберегти' : 'Створити ціль'}</button>
    ${g ? '<button class="danger-link" id="g-delete" style="margin-top:8px;">Видалити ціль</button>' : ''}
  `;
  document.getElementById('ov-goal').classList.add('open');

  document.getElementById('g-save').addEventListener('click', () => {
    const name = document.getElementById('g-name').value.trim();
    const target = parseFloat(document.getElementById('g-target').value);
    const cur = document.getElementById('g-cur').value;
    const start = document.getElementById('g-start').value;
    const deadline = document.getElementById('g-deadline').value || null;
    const icon = document.getElementById('g-icon').value.trim() || '🎯';
    if (!name) { toast('Введи назву', 'error'); return; }
    if (!target || target <= 0) { toast('Введи суму', 'error'); return; }
    if (editingGoalId) {
      const obj = state.goals.find(x => x.id === editingGoalId);
      if (obj) {
        obj.name = name; obj.target = target; obj.cur = cur;
        obj.start = start; obj.deadline = deadline; obj.icon = icon;
        updateGoalInNotion(obj).then(() => saveState());
      }
    } else {
      const newG = {
        id: 'g-' + Date.now().toString(36),
        name, target, cur, start, deadline, icon,
        levels: [], status: 'active',
        transactions: [], saved: 0
      };
      state.goals.push(newG);
      createGoalInNotion(newG).then(() => { saveState(); renderGoals(); });
    }
    saveState();
    haptic('success');
    toast('Збережено', 'success');
    document.getElementById('ov-goal').classList.remove('open');
    renderGoals();
  });

  const delBtn = document.getElementById('g-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      icon: '🗑', title: 'Видалити ціль?',
      text: 'Разом з усією історією додавань',
      okText: 'Видалити'
    });
    if (!ok) return;
    const gid = editingGoalId;
    state.goals = state.goals.filter(x => x.id !== gid);
    state.goalTransactions = state.goalTransactions.filter(t => t.goalId !== gid);
    saveState();
    deleteGoalInNotion(gid);
    haptic('warning');
    toast('Видалено', 'warn');
    document.getElementById('ov-goal').classList.remove('open');
    document.getElementById('ov-goal-detail').classList.remove('open');
    renderAll();
  });
}

// ==== Деталь цілі ====
let openGoalId = null;
function openGoalDetail(goalId) {
  openGoalId = goalId;
  const g = state.goals.find(x => x.id === goalId);
  if (!g) return;
  document.getElementById('goal-detail-title').textContent = `${g.icon || '🎯'} ${g.name}`;
  const body = document.getElementById('goal-detail-body');

  const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
  const remaining = Math.max(0, g.target - g.saved);
  const isDone = g.status === 'completed' || pct >= 100;
  const isClosed = g.status === 'closed';

  let daysLeft = '';
  if (g.deadline) {
    const dl = new Date(g.deadline);
    const now = new Date();
    const days = Math.round((dl - now) / (24*3600*1000));
    daysLeft = days > 0 ? `${days} дн до дедлайну` : days === 0 ? 'сьогодні дедлайн!' : `прострочено на ${-days} дн`;
  }

  const txHtml = g.transactions.length === 0
    ? '<div style="color:var(--muted); text-align:center; padding:16px; font-size:12px;">Історії поки немає</div>'
    : g.transactions.map(t => {
        const sign = t.type === 'add' ? '+' : '−';
        const color = t.type === 'add' ? 'var(--ok)' : 'var(--danger)';
        const typeLbl = t.type === 'add' ? 'додано' : t.type === 'take' ? 'забрано' : 'витрачено';
        return `<div class="drill-row" style="cursor:default;">
          <div class="dr-body">
            <div class="dr-title" style="color:${color};">${sign}${formatNum(convert(t.amount, t.cur, state.display), state.display)}</div>
            <div class="dr-meta">${fmtDate(parseDate(t.date))} · ${typeLbl}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
          </div>
        </div>`;
      }).join('');

  const levelsHtml = g.levels && g.levels.length > 0 ? `
    <div style="margin:12px 0; padding:12px; background:rgba(255,214,10,0.05); border-radius:12px;">
      <div style="font-family:'Geist Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:1.5px; margin-bottom:8px;">РІВНІ ПРОЙДЕНО</div>
      <div class="goal-levels">
        ${g.levels.map(l => `<span class="goal-level">🏆 ${formatNum(convert(l, g.cur, state.display), state.display)}</span>`).join('')}
        <span class="goal-level current">🎯 ${formatNum(convert(g.target, g.cur, state.display), state.display)}</span>
      </div>
    </div>` : '';

  body.innerHTML = `
    <div class="drill-summary">
      <div style="font-family:'Geist Mono',monospace; font-weight:800; font-size:26px; color:${isDone ? 'var(--ok)' : 'var(--yellow)'};">
        ${formatNum(convert(g.saved, g.cur, state.display), state.display)}
      </div>
      <div style="font-family:'Geist Mono',monospace; font-size:11px; color:var(--muted); margin-top:2px;">
        з ${formatNum(convert(g.target, g.cur, state.display), state.display)} · ${Math.round(pct)}%${isDone ? ' ✓ виконано' : ''}
      </div>
      <div class="goal-bar-wrap" style="margin-top:10px;">
        <div class="goal-bar ${isDone ? 'completed' : ''}" style="width:${pct}%;"></div>
      </div>
      ${daysLeft ? `<div style="font-family:'Geist Mono',monospace; font-size:11px; color:var(--muted); margin-top:8px;">${daysLeft}</div>` : ''}
      ${!isDone ? `<div style="font-family:'Geist Mono',monospace; font-size:11px; color:var(--muted); margin-top:4px;">залишилось: ${formatNum(convert(remaining, g.cur, state.display), state.display)}</div>` : ''}
    </div>

    ${levelsHtml}

    ${!isClosed ? `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:12px 0;">
        <button class="btn-primary" id="g-add-tx" style="background:var(--ok); color:#000;">+ Додати</button>
        ${g.saved > 0 ? '<button class="btn-primary" id="g-take-tx" style="background:transparent; color:var(--danger); border:1px solid var(--danger);">− Забрати</button>' : '<div></div>'}
      </div>
      ${isDone ? `
        <button class="btn-primary" id="g-level-up" style="width:100%; margin-bottom:8px;">🏆 Збільшити ціль</button>
        <button class="btn-primary" id="g-close" style="width:100%; background:transparent; border:1px solid var(--muted); color:var(--muted);">✓ Закрити ціль</button>
      ` : ''}
    ` : ''}

    <button class="bd-edit-btn" id="g-edit" style="width:100%; margin-top:10px;">✎ Редагувати</button>

    <div style="font-family:'Geist Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:1.5px; margin:16px 0 8px;">ІСТОРІЯ · ${g.transactions.length}</div>
    ${txHtml}
  `;

  document.getElementById('ov-goal-detail').classList.add('open');

  const addBtn = document.getElementById('g-add-tx');
  if (addBtn) addBtn.addEventListener('click', () => {
    haptic('light');
    setTimeout(() => openGoalTxModal(goalId, 'add'), 0);
  });
  const takeBtn = document.getElementById('g-take-tx');
  if (takeBtn) takeBtn.addEventListener('click', () => {
    haptic('light');
    setTimeout(() => openGoalTxModal(goalId, 'take'), 0);
  });
  const levelBtn = document.getElementById('g-level-up');
  if (levelBtn) levelBtn.addEventListener('click', () => {
    haptic('light');
    setTimeout(() => levelUpGoal(goalId), 0);
  });
  const closeBtn = document.getElementById('g-close');
  if (closeBtn) closeBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      icon: '✓', title: 'Закрити ціль?',
      text: 'Це означає що ти витратив ці гроші. Сума прибереться з "у цілях".',
      okText: 'Закрити'
    });
    if (!ok) return;
    g.status = 'closed';
    saveState();
    updateGoalInNotion(g).then(() => saveState());
    haptic('success');
    toast('Ціль закрита', 'success');
    document.getElementById('ov-goal-detail').classList.remove('open');
    renderAll();
  });
  document.getElementById('g-edit').addEventListener('click', () => {
    haptic('light');
    setTimeout(() => openGoalModal(goalId), 0);
  });
}

// ==== Модалка "Додати з балансу" / "Забрати" ====
function openGoalTxModal(goalId, type) {
  const g = state.goals.find(x => x.id === goalId);
  if (!g) return;
  document.getElementById('goal-tx-title').textContent =
    type === 'add' ? '+ Додати до цілі' : '− Забрати з цілі';
  const body = document.getElementById('goal-tx-body');
  const maxTake = g.saved;
  const remaining = Math.max(0, g.target - g.saved);
  body.innerHTML = `
    <div class="drill-summary">
      <div style="font-family:'Geist Mono',monospace; font-size:11px; color:var(--muted);">${g.icon} ${escapeHtml(g.name)}</div>
      <div style="font-family:'Geist Mono',monospace; font-weight:700; font-size:16px; margin-top:4px;">
        ${formatNum(convert(g.saved, g.cur, state.display), state.display)} з ${formatNum(convert(g.target, g.cur, state.display), state.display)}
      </div>
    </div>
    <div class="field-group">
      <label>${type === 'add' ? 'Скільки додати' : 'Скільки забрати'}</label>
      <div class="two-col">
        <div><input class="fld" id="gtx-amount" type="number" min="0" step="any" inputmode="decimal" placeholder="${type === 'add' ? formatNum(convert(remaining, g.cur, state.display), state.display).replace(/[^0-9.]/g,'') : formatNum(convert(maxTake, g.cur, state.display), state.display).replace(/[^0-9.]/g,'')}"></div>
        <div>
          <select class="fld" id="gtx-cur">
            <option value="USD" ${g.cur === 'USD' ? 'selected' : ''}>$ USD</option>
            <option value="UAH" ${g.cur === 'UAH' ? 'selected' : ''}>₴ UAH</option>
            <option value="PLN" ${g.cur === 'PLN' ? 'selected' : ''}>zł PLN</option>
          </select>
        </div>
      </div>
      ${type === 'add' ? `<div class="hint">Залишок до цілі: ${formatNum(convert(remaining, g.cur, state.display), state.display)}</div>` : `<div class="hint">Максимум: ${formatNum(convert(maxTake, g.cur, state.display), state.display)}</div>`}
    </div>
    <div class="field-group">
      <label>Дата</label>
      <input class="fld" id="gtx-date" type="date" value="${toISO(today())}">
    </div>
    <div class="field-group">
      <label>Опис (опційно)</label>
      <input class="fld" id="gtx-note" type="text" placeholder="напр. з зарплати за червень">
    </div>
    <button class="btn-primary" id="gtx-save" style="width:100%; padding:16px; font-size:15px;">${type === 'add' ? '+ Додати' : '− Забрати'}</button>
  `;
  document.getElementById('ov-goal-tx').classList.add('open');

  document.getElementById('gtx-save').addEventListener('click', () => {
    const amount = parseFloat(document.getElementById('gtx-amount').value);
    const cur = document.getElementById('gtx-cur').value;
    const date = document.getElementById('gtx-date').value;
    const note = document.getElementById('gtx-note').value.trim();
    if (!amount || amount <= 0) { toast('Введи суму', 'error'); return; }
    if (!date) { toast('Вкажи дату', 'error'); return; }
    const tx = {
      id: 'gt-' + Date.now().toString(36),
      goalId, date, amount, cur, type, note
    };
    state.goalTransactions.push(tx);
    // оновлюємо saved
    const usdDelta = convert(amount, cur, 'USD');
    const nativeDelta = convert(usdDelta, 'USD', g.cur);
    if (type === 'add') g.saved += nativeDelta;
    else g.saved = Math.max(0, g.saved - nativeDelta);
    if (!g.transactions) g.transactions = [];
    g.transactions.unshift(tx);
    // авто-виконання
    if (g.saved >= g.target && g.status === 'active') {
      g.status = 'completed';
      toast('🎉 Ціль виконана!', 'success');
    }
    saveState();
    createGoalTxInNotion(goalId, tx).then(() => saveState());
    updateGoalInNotion(g).then(() => saveState());
    haptic('success');
    document.getElementById('ov-goal-tx').classList.remove('open');
    openGoalDetail(goalId);
    renderAll();
  });
}

// ==== Збільшення цілі (level up) ====
async function levelUpGoal(goalId) {
  const g = state.goals.find(x => x.id === goalId);
  if (!g) return;
  const newTargetStr = prompt(`Нова ціль (поточна: ${formatNum(g.target, g.cur)} ${g.cur}):`, String(g.target * 2));
  if (!newTargetStr) return;
  const newTarget = parseFloat(newTargetStr);
  if (!newTarget || newTarget <= g.target) {
    toast('Нова ціль має бути більша', 'error');
    return;
  }
  if (!g.levels) g.levels = [];
  g.levels.push(g.target);
  g.target = newTarget;
  g.status = 'active';
  saveState();
  updateGoalInNotion(g).then(() => saveState());
  haptic('success');
  toast(`🏆 Новий рівень! Ціль ${formatNum(newTarget, g.cur)} ${g.cur}`, 'success');
  openGoalDetail(goalId);
  renderAll();
}

// ==== Кнопка "+ Нова ціль" ====
document.getElementById('btn-add-goal')?.addEventListener('click', () => {
  haptic('light');
  openGoalModal(null);
});

// ==== Навігація на вкладку Цілі ====
// (реалізується через існуючий #view-toggle обробник, треба перевірити чи він враховує 'goals')

// === BOOT з Telegram + Notion ===
(async function boot() {
  if (!initTelegram()) {
    showNoTgScreen();
    return;
  }
  // спершу — кешований стан вже відрендерили (renderAll нижче)
  renderAll();
  settleReferrals(true);
  renderAll();

  // тягнемо свіже з Notion у фоні
  const ok = await loadAllFromNotion();
  if (ok) {
    renderAll();
  } else {
    toast('Notion: не вдалось підключитись. Працюю локально', 'warn');
  }
})();

// автозавантаження курсів якщо застарілі
(function autoFx() {
  const need = !state.ratesUpdated ||
    (Date.now() - new Date(state.ratesUpdated).getTime()) > 6 * 3600 * 1000;
  if (state.ratesAuto && need) {
    fetchRates();
  } else {
    setFxDot('ok');
  }
})();
