// Банки й біржі: статус підключень, баланси, автоімпорт витрат Монобанку, імпорт виписки.
import { getState, setState } from './store.js'
import { toast } from './ui.js'
import { financeCall, cgCall, queryAll } from '../lib/notion/api.js'
import * as S from '../lib/notion/schema.js'
import { monthKeyOf, UA_MONTHS } from '../lib/dates.js'
import { haptic } from '../lib/telegram.js'
import { loadExpenses } from './actions.js'
import { CG_IDS } from '../lib/domain/finance.js'

const setFin = patch => setState(s => ({ ...s, finance: { ...s.finance, ...(typeof patch === 'function' ? patch(s.finance) : patch) } }))

export const anyProvider = st => !!(st && st.providers && Object.values(st.providers).some(Boolean))
// банківські дані сервер віддає лише з увімкненим захистом і лише власнику ключів
export const canSeeBanks = st => !!(st && st.auth === 'on' && st.owner)

// статус із кешу (які ключі є у Vercel) звіряємо з сервером раз за сесію — ключі могли додати чи прибрати
let statusChecked = false

export async function loadFinanceStatus() {
  try {
    const st = await financeCall('status')
    statusChecked = true
    setFin({ status: st, statusError: null })
    return st
  } catch (e) {
    setFin({ statusError: e.message || 'Помилка' })
    return null
  }
}

const balancesFresh = f => !!(f.fetchedAt && Date.now() - f.fetchedAt < 90e3)

let inflight = null
export function refreshBalances({ force = false, silent = true } = {}) {
  if (!force && statusChecked && balancesFresh(getState().finance)) return Promise.resolve()
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const fresh = force || !statusChecked || !getState().finance.status ? await loadFinanceStatus() : null
      const f = getState().finance
      const st = fresh || f.status
      if (!st || !anyProvider(st) || !canSeeBanks(st)) {
        // ключі прибрали з Vercel (або це інший акаунт) — старі баланси з кешу не показуємо
        if (fresh && (f.providers || []).length) setFin({ providers: [], fetchedAt: null, error: null })
        if (!silent) {
          const why = !st ? (f.statusError || 'Сервер не відповідає')
            : !anyProvider(st) ? 'Банки й біржі ще не підключені'
              : st.auth !== 'on' ? 'Спершу увімкни захист даних (TG_BOT_TOKEN)' : 'Рахунки бачить лише власник ключів'
          toast(why, { kind: st ? undefined : 'error', duration: 3500 })
        }
        return
      }
      if (!force && balancesFresh(f)) return
      setFin({ loading: true })
      try {
        const r = await financeCall('balances')
        setFin({ providers: r.providers || [], fetchedAt: r.fetchedAt || Date.now(), error: null })
        loadCoinMeta()
        if (!silent) toast('Баланси оновлено', { kind: 'success' })
      } catch (e) {
        setFin({ error: e.message || 'Помилка' })
        if (!silent) toast(e.message || 'Не вдалось оновити баланси', { kind: 'error', duration: 5000 })
      } finally {
        setFin({ loading: false })
      }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

// Іконки й зміна за 24 год для монет з бірж — одним запитом до CoinGecko
async function loadCoinMeta() {
  const assets = new Set()
  for (const p of getState().finance.providers || []) for (const h of p.holdings || []) if (CG_IDS[h.asset]) assets.add(CG_IDS[h.asset])
  const ids = [...assets].filter(id => !getState().finance.coinMeta[id])
  if (!ids.length) return
  try {
    const rows = await cgCall('/coins/markets', { vs_currency: 'usd', ids: ids.join(','), price_change_percentage: '24h' })
    const meta = {}
    for (const r of Array.isArray(rows) ? rows : []) meta[r.id] = { image: r.image, name: r.name, price: r.current_price, change24h: r.price_change_percentage_24h || 0 }
    setFin(f => ({ coinMeta: { ...f.coinMeta, ...meta } }))
  } catch { /* без іконок теж працює */ }
}

/* ===== Вебхук Монобанку: історія (log), витрати (import), бот (notify) ===== */
export function monoHookFlags(p) {
  const on = !!p && p.webhook === 'on'
  return { log: on && !!p.hookLog, import: on && !!p.hookImport, notify: on && !!p.hookNotify }
}

const HOOK_MSG = {
  log: on => (on ? 'Кожна операція Монобанку тепер зберігається в історії' : 'Історію операцій Монобанку вимкнено'),
  import: on => (on ? 'Готово: кожна оплата карткою сама потрапить у витрати' : 'Автоімпорт витрат вимкнено'),
  notify: on => (on ? 'Готово: про кожну операцію напише бот' : 'Сповіщення в бот вимкнено'),
}

export async function setMonoHook(patch, { quiet = false } = {}) {
  const mono = (getState().finance.providers || []).find(p => p.provider === 'mono')
  const next = { ...monoHookFlags(mono), ...patch }
  try {
    const r = await financeCall('mono-webhook', next, { retries: 0 })
    haptic.success()
    if (!quiet) { const k = Object.keys(patch)[0]; toast(HOOK_MSG[k](!!patch[k]), { kind: 'success', duration: 4000 }) }
    setFin(f => ({ providers: (f.providers || []).map(p => (p.provider === 'mono' ? { ...p, webhook: r.webhook, hookImport: r.hookImport, hookNotify: r.hookNotify, hookLog: r.hookLog } : p)) }))
    return true
  } catch (e) {
    haptic.error()
    toast(e.message || 'Не вдалось', { kind: 'error', duration: 5000 })
    return false
  }
}

// сумісність: перемикач «Записувати витрати самі»
export const setMonoWebhook = enable => setMonoHook({ import: !!enable })

/* ===== Сповіщення в бот ===== */
export async function notifyTest() {
  try {
    await financeCall('notify-test', {}, { retries: 0 })
    haptic.success()
    toast('Надіслав тестове повідомлення — глянь у чат із ботом', { kind: 'success', duration: 4000 })
    return true
  } catch (e) {
    haptic.error()
    toast(e.message || 'Не вдалось надіслати', { kind: 'error', duration: 7000 })
    return false
  }
}

export const transfersCheck = () => financeCall('transfers-check', {}, { retries: 0 })

/* ===== «Рух коштів»: історія й аналітика по місяцях ===== */
export const ledgerReady = st => !!(st && st.ledger && st.ledger.ready)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* приватний режим */ } }
const LEDGER_MONTHS = 13

let ledgerInflight = null
// Перше завантаження — 13 місяців; далі лише змінене з минулої синхронізації
export function loadLedger({ full = false } = {}) {
  if (ledgerInflight) return ledgerInflight
  ledgerInflight = (async () => {
    const st = getState()
    if (!ledgerReady(st.finance.status)) return
    const now = new Date()
    const since = new Date(now.getFullYear(), now.getMonth() - (LEDGER_MONTHS - 1), 1).toISOString().slice(0, 10)
    const prev = st.finance.ledgerSyncedAt || 0
    const incremental = !full && prev > 0 && st.data.ledger.length > 0 && Date.now() - prev < 12 * 3600e3
    const startedAt = Date.now()
    const filter = incremental
      ? { timestamp: 'last_edited_time', last_edited_time: { on_or_after: new Date(prev - 10 * 60e3).toISOString() } }
      : { property: 'Дата', date: { on_or_after: since } }
    try {
      const pages = await queryAll(S.DB.LEDGER, { filter })
      const uid = st.user && st.user.id
      const rows = pages.map(S.parseLedger).filter(r => r.tgId === uid)
      setState(s => {
        let list = rows
        if (incremental) { const m = new Map(s.data.ledger.map(r => [r.id, r])); for (const r of rows) m.set(r.id, r); list = [...m.values()] }
        list = list.filter(r => String(r.date).slice(0, 10) >= since).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        return { ...s, data: { ...s.data, ledger: list }, loaded: { ...s.loaded, ledger: true }, finance: { ...s.finance, ledgerSyncedAt: startedAt } }
      })
    } catch (e) {
      console.warn('Рух коштів недоступний', e)
      setState(s => ({ ...s, loaded: { ...s.loaded, ledger: s.data.ledger.length ? true : 'error' } }))
    } finally {
      ledgerInflight = null
    }
  })()
  return ledgerInflight
}

// Записати операції в «Рух коштів» пачками (сервер відсіює дублікати)
async function writeLedger(entries) {
  let created = 0
  let queue = entries.slice()
  while (queue.length) {
    const chunk = queue.splice(0, 25)
    const r = await financeCall('ledger-write', { items: chunk }, { retries: 2 })
    created += r.created || 0
    if (r.remaining && r.remaining.length) queue = r.remaining.concat(queue)
  }
  return created
}

// Поповнення й виведення на біржах за 30 днів → в історію (не частіше, ніж раз на пів години)
const EX_SYNC_KEY = 'rc5:ledger-ex-sync'
export async function syncExchangesToLedger({ force = false } = {}) {
  const st = getState().finance.status
  if (!ledgerReady(st) || !st.providers || !['bybit', 'bingx', 'mexc'].some(n => st.providers[n])) return
  if (!force && Date.now() - (lsGet(EX_SYNC_KEY) || 0) < 30 * 60e3) return
  lsSet(EX_SYNC_KEY, Date.now())
  try {
    const r = await financeCall('ledger-sync', {}, { retries: 0 })
    let created = r.created || 0
    if (r.remaining && r.remaining.length) created += await writeLedger(r.remaining)
    if (created) loadLedger()
  } catch { /* спробуємо наступного разу */ }
}

export async function setupLedger() {
  try {
    const r = await financeCall('ledger-setup', {}, { retries: 0 })
    setFin(f => ({ status: f.status ? { ...f.status, ledger: { ready: true } } : f.status }))
    return r
  } catch (e) {
    haptic.error()
    toast(e.message || 'Не вдалось створити базу в Notion', { kind: 'error', duration: 10000 })
    return null
  }
}

// Увімкнути історію: база в Notion → запис кожної операції Монобанку → минулі місяці у фоні
export async function enableHistory() {
  const r = await setupLedger()
  if (!r) return false
  const mono = (getState().finance.providers || []).find(p => p.provider === 'mono')
  if (mono && mono.ok) await setMonoHook({ log: true }, { quiet: true })
  haptic.success()
  toast(r.created ? 'Створив у Notion базу «Рух коштів». Минулі місяці підтягуються у фоні' : 'Історію ввімкнено. Минулі місяці підтягуються у фоні', { kind: 'success', duration: 5000 })
  await loadLedger({ full: true })
  syncExchangesToLedger({ force: true })
  runBackfill()
  return true
}

// Після оновлення балансів: свіжа історія з Notion, біржі в історію, докачування минулих місяців
export function ledgerTick() {
  const fin = getState().finance
  if (!ledgerReady(fin.status) || !canSeeBanks(fin.status)) return
  loadLedger()
  syncExchangesToLedger()
  runBackfill()
}

/* ----- Минулі місяці: Монобанк дає 1 виписку на хвилину, тож тягнемо поступово, поки застосунок відкритий ----- */
const BF_KEY = 'rc5:backfill'
const BF_MONTHS = 12
const MONO_GAP = () => (typeof window !== 'undefined' && window.__rcMonoGap) || 61e3 // у демо пауза коротша
let lastMonoCall = 0

function backfillTasks(fin) {
  const mono = (fin.providers || []).find(p => p.provider === 'mono')
  const cards = mono && mono.ok ? (mono.accounts || []).filter(a => a.kind === 'card' && a.ref) : []
  const exch = fin.status && fin.status.providers ? ['bybit', 'bingx', 'mexc'].filter(n => fin.status.providers[n]) : []
  const now = new Date()
  const tasks = []
  for (let i = 0; i < BF_MONTHS; i++) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const key = monthKeyOf(from)
    const label = UA_MONTHS[from.getMonth()].toLowerCase() + ' ' + from.getFullYear()
    const recent = i <= 1 // поточний і минулий місяць перевіряємо раз на тиждень — раптом історію вимикали
    for (const c of cards) tasks.push({ id: `mono:${c.ref}:${key}`, type: 'mono', account: c.ref, from: from.getTime(), to: Math.min(to.getTime(), Date.now()), label, recent })
    // біржі — половинками місяця (Bybit віддає не більше 30 днів за запит)
    const mid = new Date(now.getFullYear(), now.getMonth() - i, 16)
    for (const n of exch) {
      tasks.push({ id: `${n}:${key}:a`, type: 'ex', provider: n, from: from.getTime(), to: Math.min(mid.getTime(), Date.now()), label, recent })
      if (mid.getTime() < Date.now()) tasks.push({ id: `${n}:${key}:b`, type: 'ex', provider: n, from: mid.getTime(), to: Math.min(to.getTime(), Date.now()), label, recent })
    }
  }
  return tasks
}

const isDone = (done, t) => {
  const at = done[t.id]
  return !!at && (!t.recent || Date.now() - at < 7 * 864e5)
}

let bfRunning = false
export async function runBackfill() {
  if (bfRunning) return
  bfRunning = true
  try {
    for (;;) {
      const fin = getState().finance
      if (!ledgerReady(fin.status)) break
      const done = lsGet(BF_KEY) || {}
      const tasks = backfillTasks(fin)
      const pending = tasks.filter(t => !isDone(done, t))
      const months = new Set(tasks.map(t => t.label)).size
      const left = new Set(pending.map(t => t.label)).size
      if (!pending.length) { setFin({ backfill: { running: false, total: months, left: 0 } }); break }
      // біржі швидкі — спершу їх; Монобанк — від свіжих місяців до старших
      const t = pending.find(x => x.type === 'ex') || pending[0]
      setFin({ backfill: { running: true, total: months, left, label: t.label } })
      try {
        let entries = []
        if (t.type === 'mono') {
          let to = t.to
          for (let page = 0; page < 6; page++) {
            const wait = lastMonoCall + MONO_GAP() - Date.now()
            if (wait > 0) await sleep(wait)
            lastMonoCall = Date.now()
            const r = await financeCall('mono-statement', { account: t.account, from: t.from, to }, { retries: 0 })
            entries = entries.concat(r.entries || [])
            if (!r.more) break
            to = r.more.to
          }
        } else {
          const r = await financeCall('exchange-history', { provider: t.provider, from: t.from, to: t.to }, { retries: 1 })
          entries = r.entries || []
        }
        const created = entries.length ? await writeLedger(entries) : 0
        lsSet(BF_KEY, { ...(lsGet(BF_KEY) || {}), [t.id]: Date.now() })
        if (created) loadLedger()
      } catch (e) {
        const code = e && e.status
        if (code === 429) { lastMonoCall = Date.now(); continue } // Монобанк просить зачекати хвилину
        // старі періоди біржа може не віддавати, закритого рахунку вже немає — такий шматок пропускаємо
        if (t.type === 'ex' || code === 400 || code === 404) { lsSet(BF_KEY, { ...(lsGet(BF_KEY) || {}), [t.id]: Date.now() }); continue }
        // збій мережі чи ключа — зупиняємось і продовжимо наступного разу
        setFin({ backfill: { running: false, total: months, left, error: e.message || 'Помилка' } })
        break
      }
    }
  } finally {
    bfRunning = false
  }
}

export const monoPreview = (account, days = 31) => financeCall('mono-preview', { account, days }, { retries: 0 })

// Записує обрані витрати пачками по 20 і перечитує витрати, щоб звіти одразу їх врахували
export async function importExpenses(items, onProgress) {
  let created = 0, duplicates = 0
  for (let i = 0; i < items.length; i += 20) {
    const r = await financeCall('expenses-import', { items: items.slice(i, i + 20) }, { retries: 2 })
    created += (r.created || []).length
    duplicates += (r.duplicates || []).length
    if (onProgress) onProgress(Math.min(items.length, i + 20), items.length)
  }
  await loadExpenses()
  return { created, duplicates }
}
