// Дії: оптимістично змінюємо стан, потім пишемо в Notion. При помилці — відкат і повідомлення.
import { getState, setState, updateData, updateSettings, syncBusy, loadCache, loadSettings, pullCloudSettings, emptyData, flushPersist } from './store.js'
import { toast, remapSheetIds } from './ui.js'
import { haptic, initTelegram } from '../lib/telegram.js'
import { setInitData, queryAll, createPage, updatePage, archivePage, cgPrices } from '../lib/notion/api.js'
import * as S from '../lib/notion/schema.js'
import { fetchRates } from '../lib/money.js'
import { today, toISO } from '../lib/dates.js'

const tgId = () => getState().user && getState().user.id
const mine = x => x.tgId === tgId()
const isTmp = id => typeof id === 'string' && id.startsWith('tmp-')
const tmp = prefix => 'tmp-' + prefix + '-' + Math.random().toString(36).slice(2, 9)
const byDateAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

/* ===== Тимчасові id → справжні id сторінок Notion =====
   Новий запис одразу зʼявляється на екрані з tmp-id. Коли Notion повертає справжній id, підміняємо його всюди:
   у даних, у відкритих вікнах (remapSheetIds) і в пізніх викликах дій (cur). */
const waiters = new Map() // tmp → Promise<realId>
const resolved = new Map() // tmp → realId
const cur = id => (isTmp(id) && resolved.has(id) ? resolved.get(id) : id)
async function real(id) {
  if (!isTmp(id)) return id
  if (resolved.has(id)) return resolved.get(id)
  const w = waiters.get(id)
  return w ? w.catch(() => null) : null
}
const REF_KEYS = ['id', 'clientId', 'categoryId', 'goalId', 'assetId', 'referredBy']
// копія запису з актуальними id — для відкатів, що спрацьовують уже після підміни
function withCurIds(x) {
  const o = { ...x }
  for (const k of REF_KEYS) if (o[k] != null) o[k] = cur(o[k])
  if (o.payments) o.payments = o.payments.map(withCurIds)
  return o
}

/* Позначки для злиття з Notion: запит синхронізації міг піти раніше, ніж наш запис туди потрапив.
   created — щойно створені (тримаємо, навіть якщо Notion їх ще не віддав), dirty — щойно змінені (локальна версія свіжіша),
   hidden — видалені (не повертаємо, навіть якщо Notion їх ще віддає). */
const HOLD = 120000
const marks = { created: new Map(), dirty: new Map(), hidden: new Map() } // id → діє до (мс)
function mark(kind, id, ms = HOLD) { if (id) marks[kind].set(id, ms === Infinity ? Infinity : Date.now() + ms) }
function unmark(kind, ...ids) { for (const id of ids) marks[kind].delete(id) }
function marked(kind, id) {
  const t = marks[kind].get(id)
  if (t == null) return false
  if (t < Date.now()) { marks[kind].delete(id); return false }
  return true
}

const uniqById = arr => { const seen = new Set(); return arr.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true))) }

function remapId(tmpId, realId) {
  resolved.set(tmpId, realId)
  mark('created', realId)
  for (const k of ['dirty', 'hidden']) if (marks[k].has(tmpId)) marks[k].set(realId, marks[k].get(tmpId))
  remapSheetIds(tmpId, realId)
  const fix = v => (v === tmpId ? realId : v)
  updateData(d => ({
    ...d,
    clients: uniqById(d.clients.map(c => ({ ...c, id: fix(c.id), referredBy: fix(c.referredBy), payments: uniqById((c.payments || []).map(p => ({ ...p, id: fix(p.id), clientId: fix(p.clientId) }))) }))),
    workEntries: uniqById(d.workEntries.map(e => ({ ...e, id: fix(e.id), categoryId: fix(e.categoryId) }))),
    workCategories: uniqById(d.workCategories.map(c => ({ ...c, id: fix(c.id) }))),
    payouts: uniqById(d.payouts.map(p => ({ ...p, id: fix(p.id), categoryId: fix(p.categoryId) }))),
    goals: uniqById(d.goals.map(g => ({ ...g, id: fix(g.id) }))),
    goalTx: uniqById(d.goalTx.map(t => ({ ...t, id: fix(t.id), goalId: fix(t.goalId) }))),
    assets: uniqById(d.assets.map(a => ({ ...a, id: fix(a.id) }))),
    assetTx: uniqById(d.assetTx.map(t => ({ ...t, id: fix(t.id), assetId: fix(t.assetId) }))),
  }))
}

// злиття локального списку зі свіжим з Notion з урахуванням позначок
function merge(local, fresh) {
  const freshIds = new Set(fresh.map(x => x.id))
  const localById = new Map(local.map(x => [x.id, x]))
  const out = []
  for (const x of fresh) {
    if (marked('hidden', x.id)) continue
    out.push(marked('dirty', x.id) && localById.has(x.id) ? localById.get(x.id) : x)
  }
  for (const x of local) {
    if (freshIds.has(x.id) || marked('hidden', x.id)) continue
    if (isTmp(x.id) || marked('created', x.id)) out.push(x) // ще пишеться або Notion його ще не віддає
  }
  return out
}

// виконати запис у фоні: лічильник синхронізації, відкат і тост при помилці
async function run(promise, { rollback, error } = {}) {
  syncBusy(1)
  try {
    return await promise
  } catch (e) {
    console.error(e)
    if (rollback) rollback()
    toast((error || 'Не вдалось зберегти в Notion') + (e && e.message ? ': ' + e.message : ''), { kind: 'error', duration: 5000 })
    return null
  } finally {
    syncBusy(-1)
  }
}

function create(prefix, database, buildProps, localApply, localRollback, errorText) {
  const id = tmp(prefix)
  localApply(id)
  const p = (async () => {
    const res = await createPage(database, await buildProps(id))
    if (!res || !res.id) throw new Error('Notion не повернув id')
    remapId(id, res.id)
    return res.id
  })()
  waiters.set(id, p)
  run(p, { rollback: () => localRollback(id), error: errorText })
  p.catch(() => {}).finally(() => setTimeout(() => waiters.delete(id), 60000))
  return id
}

// зміна існуючого запису: локальна версія вважається свіжішою, поки запис іде в Notion
function patchRemote(id, write, { rollback, error }) {
  mark('dirty', id)
  run(write(), { rollback: () => { unmark('dirty', id, cur(id)); rollback() }, error })
}

// видалення одразу (без «Скасувати»): ховаємо, архівуємо, при помилці повертаємо
async function removeRemote(id, archiveAll, { rollback, error }) {
  mark('hidden', id, Infinity)
  const ok = await run(archiveAll().then(() => true), { rollback: () => { unmark('hidden', id, cur(id)); rollback() }, error })
  if (ok) { mark('hidden', id); mark('hidden', cur(id)) }
}

// Відкладене видалення з «Скасувати»: прибираємо з екрана одразу, архівуємо в Notion через 4,6 с
const pendingDeletes = new Map()
function deferredDelete({ key, id, message, apply, revert, commit }) {
  apply()
  mark('hidden', id, Infinity)
  haptic.warning()
  let undone = false
  const fire = async () => {
    if (!pendingDeletes.has(key)) return
    pendingDeletes.delete(key)
    const ok = await run(commit().then(() => true), {
      rollback: () => { unmark('hidden', id, cur(id)); revert() },
      error: 'Не вдалось видалити в Notion',
    })
    if (ok) { mark('hidden', id); mark('hidden', cur(id)) }
  }
  const timer = setTimeout(fire, 4600)
  pendingDeletes.set(key, { fire, timer })
  toast(message, {
    action: {
      label: 'Скасувати',
      onClick: () => {
        if (undone || !pendingDeletes.has(key)) return // уже пішло в Notion
        undone = true
        clearTimeout(timer)
        pendingDeletes.delete(key)
        unmark('hidden', id, cur(id))
        revert()
        haptic.soft()
      },
    },
  })
}

export function flushPendingDeletes() {
  for (const [, v] of pendingDeletes) { clearTimeout(v.timer); v.fire() }
  flushPersist()
}

/* ===== Запуск і синхронізація ===== */
export async function boot() {
  const t = initTelegram()
  if (!t.user) { setState(s => ({ ...s, phase: 'no-telegram' })); return }
  setInitData(t.initData)
  const settings = loadSettings()
  const cache = loadCache(t.user.id)
  setState(s => ({
    ...s,
    phase: 'ready',
    user: t.user,
    platform: t.platform,
    tgColorScheme: t.colorScheme,
    settings,
    data: cache ? cache.data : emptyData(),
    prices: cache ? cache.prices || {} : {},
    loaded: cache ? { core: true, expenses: !!cache.loaded?.expenses, goals: !!cache.loaded?.goals, assets: !!cache.loaded?.assets } : s.loaded,
    sync: { ...s.sync, fromCache: !!cache, lastSync: cache ? cache.savedAt : null },
  }))
  pullCloudSettings()
  syncAll({ initial: true })
  maybeRefreshRates()
}

export async function syncAll({ initial = false, silent = false } = {}) {
  const st = getState()
  if (!st.user) return false
  syncBusy(1)
  try {
    const [cl, pay, we, wc, po] = await Promise.all([
      queryAll(S.DB.CLIENTS), queryAll(S.DB.PAYMENTS), queryAll(S.DB.WORK_ENTRIES), queryAll(S.DB.WORK_CATEGORIES), queryAll(S.DB.PAYOUTS),
    ])
    const freshPays = pay.map(S.parsePayment).filter(mine)
    const freshClients = cl.map(S.parseClient).filter(mine)
    setState(s => {
      // оплати зливаємо окремо від орендарів: нові й щойно видалені не губляться і не «воскресають»
      const localPays = s.data.clients.flatMap(c => (c.payments || []).map(p => ({ ...p, clientId: c.id })))
      const pays = merge(localPays, freshPays)
      const clients = merge(s.data.clients, freshClients).map(c => ({ ...c, payments: pays.filter(p => p.clientId === c.id).sort(byDateAsc) }))
      return {
        ...s,
        data: {
          ...s.data,
          clients,
          workEntries: merge(s.data.workEntries, we.map(S.parseWorkEntry).filter(mine)),
          workCategories: merge(s.data.workCategories, wc.map(S.parseWorkCategory).filter(mine)),
          payouts: merge(s.data.payouts, po.map(S.parsePayout).filter(mine)),
        },
        loaded: { ...s.loaded, core: true },
        sync: { ...s.sync, error: null, lastSync: Date.now(), fromCache: false },
      }
    })
    const mods = getState().settings.modules
    await Promise.all([
      loadExpenses(),
      mods.goals ? loadGoals() : null,
      mods.assets ? loadAssets() : null,
    ])
    if (!initial && !silent) toast('Синхронізовано з Notion', { kind: 'success' })
    return true
  } catch (e) {
    console.error(e)
    setState(s => ({ ...s, sync: { ...s.sync, error: e.message || 'Помилка' } }))
    toast(getState().sync.fromCache ? 'Notion недоступний — показую збережене' : 'Не вдалось завантажити з Notion: ' + (e.message || ''), { kind: 'error', duration: 5000 })
    return false
  } finally {
    syncBusy(-1)
  }
}

async function loadExpenses() {
  try {
    const [exp, cats] = await Promise.all([queryAll(S.DB.EXPENSES), queryAll(S.DB.CAT_EXPENSES)])
    setState(s => ({
      ...s,
      data: { ...s.data, expenses: exp.map(S.parseExpense).filter(mine), expenseCats: cats.map(S.parseExpenseCat).filter(c => c.shared || mine(c)) },
      loaded: { ...s.loaded, expenses: true },
    }))
  } catch (e) {
    console.warn('Витрати (Expense·Control) недоступні', e)
    setState(s => ({ ...s, loaded: { ...s.loaded, expenses: 'error' } }))
  }
}

export async function loadGoals() {
  syncBusy(1)
  try {
    const [g, gt] = await Promise.all([queryAll(S.DB.GOALS), queryAll(S.DB.GOAL_TX)])
    setState(s => ({
      ...s,
      data: { ...s.data, goals: merge(s.data.goals, g.map(S.parseGoal).filter(mine)), goalTx: merge(s.data.goalTx, gt.map(S.parseGoalTx).filter(mine)) },
      loaded: { ...s.loaded, goals: true },
    }))
  } catch (e) {
    console.warn('Цілі недоступні', e)
    setState(s => ({ ...s, loaded: { ...s.loaded, goals: 'error' } }))
  } finally { syncBusy(-1) }
}

export async function loadAssets() {
  syncBusy(1)
  try {
    const [a, at] = await Promise.all([queryAll(S.DB.ASSETS), queryAll(S.DB.ASSET_TX)])
    setState(s => ({
      ...s,
      data: { ...s.data, assets: merge(s.data.assets, a.map(S.parseAsset).filter(mine)), assetTx: merge(s.data.assetTx, at.map(S.parseAssetTx).filter(mine)) },
      loaded: { ...s.loaded, assets: true },
    }))
    await refreshPrices()
  } catch (e) {
    console.warn('Активи недоступні', e)
    setState(s => ({ ...s, loaded: { ...s.loaded, assets: 'error' } }))
  } finally { syncBusy(-1) }
}

export async function refreshPrices() {
  const ids = [...new Set(getState().data.assets.map(a => a.cgId).filter(Boolean))]
  if (!ids.length) return
  try {
    const prices = await cgPrices(ids)
    setState(s => ({ ...s, prices: { ...s.prices, ...prices } }))
  } catch (e) { console.warn('ціни не оновились', e) }
}

/* ===== Налаштування ===== */
export function setDisplay(c) { haptic.select(); updateSettings({ display: c }) }
export function setTheme(theme) { haptic.select(); updateSettings({ theme }) }
export function setWorkMode(mode) { haptic.select(); updateSettings({ workEarnedMode: mode }) }
export function setOverview(patch) { updateSettings(s => ({ overview: { ...s.overview, ...patch } })) }

export function setModule(name, on) {
  haptic.select()
  updateSettings(s => ({ modules: { ...s.modules, [name]: on } }))
  if (on && name === 'goals' && getState().loaded.goals !== true) loadGoals()
  if (on && name === 'assets' && getState().loaded.assets !== true) loadAssets()
}

export async function refreshRatesNow() {
  syncBusy(1)
  try {
    const r = await fetchRates()
    if (!r) { toast('Жодне джерело курсів не відповіло. Можна ввести вручну', { kind: 'error' }); return false }
    updateSettings(s => ({ rates: { ...s.rates, UAH: r.UAH, PLN: r.PLN || s.rates.PLN, auto: true, source: r.source, updated: new Date().toISOString() } }))
    return true
  } finally { syncBusy(-1) }
}

export function setRatesManual(UAH, PLN) {
  updateSettings(s => ({ rates: { ...s.rates, UAH, PLN, auto: false, source: null, updated: new Date().toISOString() } }))
  haptic.success()
  toast('Курси збережено', { kind: 'success' })
}

function maybeRefreshRates() {
  const r = getState().settings.rates
  const stale = !r.updated || Date.now() - new Date(r.updated).getTime() > 6 * 3600 * 1000
  if (r.auto && stale) refreshRatesNow()
}

/* ===== Орендарі ===== */
const findClient = id => getState().data.clients.find(c => c.id === id)

export function addClient(form) {
  const uid = tgId()
  const data = { ...form, referredBy: form.referredBy ? cur(form.referredBy) : form.referredBy }
  const id = create('cl', S.DB.CLIENTS,
    async tid => { const c = findClient(cur(tid)) || data; return S.buildClientProps({ ...c, referredBy: await real(c.referredBy) }, uid) },
    tid => updateData(d => ({ ...d, clients: [...d.clients, { ...data, id: tid, tgId: uid, bonusGranted: false, payments: [] }] })),
    tid => updateData(d => ({ ...d, clients: d.clients.filter(c => c.id !== tid) })),
    'Не вдалось зберегти орендаря')
  haptic.success()
  return id
}

export function updateClient(clientId, patch) {
  const id = cur(clientId)
  const before = findClient(id)
  if (!before) return
  const after = { ...before, ...patch }
  updateData(d => ({ ...d, clients: d.clients.map(c => (c.id === id ? after : c)) }))
  haptic.success()
  patchRemote(id, async () => {
    const rid = await real(id)
    const c = findClient(rid) || after
    await updatePage(rid, S.buildClientProps({ ...c, referredBy: await real(c.referredBy) }, tgId()))
  }, {
    rollback: () => updateData(d => ({ ...d, clients: d.clients.map(c => (c.id === cur(id) ? { ...withCurIds(before), payments: c.payments } : c)) })),
    error: 'Не вдалось оновити орендаря',
  })
}

export function deleteClient(clientId) {
  const id = cur(clientId)
  const before = findClient(id)
  if (!before) return
  const idx = getState().data.clients.findIndex(c => c.id === id)
  updateData(d => ({ ...d, clients: d.clients.filter(c => c.id !== id) }))
  haptic.warning()
  toast('Орендаря «' + before.name + '» видалено', { kind: 'info' })
  removeRemote(id, async () => {
    const rid = await real(id)
    // спершу оплати (і ті, що ще пишуться), потім сам орендар
    for (const p of before.payments || []) { const pid = await real(p.id); if (pid) await archivePage(pid) }
    if (rid) await archivePage(rid)
  }, {
    rollback: () => updateData(d => { const arr = [...d.clients]; arr.splice(Math.min(idx, arr.length), 0, withCurIds(before)); return { ...d, clients: arr } }),
    error: 'Не вдалось видалити орендаря',
  })
}

export function addPayment(clientRef, { months, amountNative, cur: currency, date }) {
  const uid = tgId()
  const clientId = cur(clientRef)
  const pay = { months, amountNative, cur: currency, date: date || toISO(today()), clientId }
  const id = create('pay', S.DB.PAYMENTS,
    async () => {
      const cid = await real(clientId)
      if (!cid) throw new Error('орендар ще не створений')
      return S.buildPaymentProps(cid, pay, uid)
    },
    tid => updateData(d => ({ ...d, clients: d.clients.map(c => (c.id === clientId ? { ...c, payments: [...(c.payments || []), { ...pay, id: tid }].sort(byDateAsc) } : c)) })),
    tid => updateData(d => ({ ...d, clients: d.clients.map(c => ({ ...c, payments: (c.payments || []).filter(p => p.id !== tid) })) })),
    'Не вдалось зберегти оплату')
  haptic.success()
  return id
}

export function deletePayment(clientRef, paymentRef) {
  const clientId = cur(clientRef)
  const paymentId = cur(paymentRef)
  const c = findClient(clientId)
  const p = c && (c.payments || []).find(x => x.id === paymentId)
  if (!p) return
  deferredDelete({
    key: 'pay:' + paymentId,
    id: paymentId,
    message: 'Оплату видалено',
    apply: () => updateData(d => ({ ...d, clients: d.clients.map(x => (x.id === clientId ? { ...x, payments: x.payments.filter(y => y.id !== paymentId) } : x)) })),
    revert: () => {
      const cid = cur(clientId)
      const back = withCurIds(p)
      updateData(d => ({ ...d, clients: d.clients.map(x => (x.id === cid ? { ...x, payments: uniqById([...x.payments, back]).sort(byDateAsc) } : x)) }))
    },
    commit: async () => { const rid = await real(paymentId); if (rid) await archivePage(rid) },
  })
}

/* ===== Робота ===== */
const findEntry = id => getState().data.workEntries.find(e => e.id === id)

export function addWorkEntry(entry) {
  const uid = tgId()
  const data = { ...entry, categoryId: entry.categoryId ? cur(entry.categoryId) : entry.categoryId }
  const id = create('we', S.DB.WORK_ENTRIES,
    async tid => { const e = findEntry(cur(tid)) || data; return S.buildWorkEntryProps({ ...e, categoryId: await real(e.categoryId) }, uid) },
    tid => updateData(d => ({ ...d, workEntries: [...d.workEntries, { ...data, id: tid, tgId: uid }] })),
    tid => updateData(d => ({ ...d, workEntries: d.workEntries.filter(e => e.id !== tid) })),
    'Не вдалось зберегти запис роботи')
  haptic.success()
  return id
}

export function updateWorkEntry(entryId, patch) {
  const id = cur(entryId)
  const before = findEntry(id)
  if (!before) return
  const after = { ...before, ...patch, categoryId: patch.categoryId !== undefined ? cur(patch.categoryId) : before.categoryId }
  updateData(d => ({ ...d, workEntries: d.workEntries.map(e => (e.id === id ? after : e)) }))
  haptic.success()
  patchRemote(id, async () => {
    const rid = await real(id)
    await updatePage(rid, S.buildWorkEntryProps({ ...after, categoryId: await real(after.categoryId) }, tgId()))
  }, { rollback: () => updateData(d => ({ ...d, workEntries: d.workEntries.map(e => (e.id === cur(id) ? withCurIds(before) : e)) })), error: 'Не вдалось оновити запис' })
}

export function deleteWorkEntry(entryId) {
  const id = cur(entryId)
  const before = findEntry(id)
  if (!before) return
  deferredDelete({
    key: 'we:' + id,
    id,
    message: 'Запис видалено',
    apply: () => updateData(d => ({ ...d, workEntries: d.workEntries.filter(e => e.id !== id) })),
    revert: () => updateData(d => ({ ...d, workEntries: uniqById([...d.workEntries, withCurIds(before)]) })),
    commit: async () => { const rid = await real(id); if (rid) await archivePage(rid) },
  })
}

export function saveCategory({ id: catRef, name, rate, cur: currency, isDefault }) {
  const uid = tgId()
  const id = catRef ? cur(catRef) : catRef
  const cats = getState().data.workCategories
  const prevDefaults = isDefault ? cats.filter(c => c.isDefault && c.id !== id) : []
  // одна категорія за замовчуванням: знімаємо прапорець з інших (і в Notion теж)
  if (prevDefaults.length) {
    updateData(d => ({ ...d, workCategories: d.workCategories.map(c => (prevDefaults.some(p => p.id === c.id) ? { ...c, isDefault: false } : c)) }))
    for (const c of prevDefaults) {
      patchRemote(c.id, async () => updatePage(await real(c.id), S.buildWorkCategoryProps({ ...c, isDefault: false }, uid)), {
        rollback: () => updateData(d => ({ ...d, workCategories: d.workCategories.map(x => (x.id === cur(c.id) ? { ...x, isDefault: true } : x)) })),
        error: 'Не вдалось оновити категорію',
      })
    }
  }
  let resultId = id
  if (id) {
    const before = cats.find(c => c.id === id)
    if (!before) return id
    const after = { ...before, name, rate, cur: currency, isDefault: !!isDefault }
    updateData(d => ({ ...d, workCategories: d.workCategories.map(c => (c.id === id ? after : c)) }))
    patchRemote(id, async () => updatePage(await real(id), S.buildWorkCategoryProps(after, uid)), {
      rollback: () => updateData(d => ({ ...d, workCategories: d.workCategories.map(c => (c.id === cur(id) ? withCurIds(before) : c)) })),
      error: 'Не вдалось оновити категорію',
    })
  } else {
    const isFirst = cats.length === 0
    const cat = { name, rate, cur: currency, isDefault: !!isDefault || isFirst }
    resultId = create('wc', S.DB.WORK_CATEGORIES,
      async tid => S.buildWorkCategoryProps(getState().data.workCategories.find(c => c.id === cur(tid)) || cat, uid),
      tid => updateData(d => ({ ...d, workCategories: [...d.workCategories, { ...cat, id: tid, tgId: uid }] })),
      tid => updateData(d => ({ ...d, workCategories: d.workCategories.filter(c => c.id !== tid) })),
      'Не вдалось зберегти категорію')
  }
  ensureDefaultCategory()
  haptic.success()
  return resultId
}

// має лишатися хоча б одна категорія за замовчуванням
function ensureDefaultCategory() {
  const cats = getState().data.workCategories
  if (!cats.length || cats.some(c => c.isDefault)) return
  const first = { ...cats[0], isDefault: true }
  updateData(d => ({ ...d, workCategories: d.workCategories.map(c => (c.id === first.id ? first : c)) }))
  patchRemote(first.id, async () => updatePage(await real(first.id), S.buildWorkCategoryProps(first, tgId())), {
    rollback: () => {},
    error: 'Не вдалось оновити категорію',
  })
}

export function deleteCategory(catRef) {
  const id = cur(catRef)
  const before = getState().data.workCategories.find(c => c.id === id)
  if (!before) return
  updateData(d => ({ ...d, workCategories: d.workCategories.filter(c => c.id !== id) }))
  haptic.warning()
  toast('Категорію «' + before.name + '» видалено')
  removeRemote(id, async () => { const rid = await real(id); if (rid) await archivePage(rid) }, {
    rollback: () => updateData(d => ({ ...d, workCategories: uniqById([...d.workCategories, withCurIds(before)]) })),
    error: 'Не вдалось видалити категорію',
  })
  // якщо видалили категорію за замовчуванням — призначаємо першу з решти
  ensureDefaultCategory()
}

const findPayout = id => getState().data.payouts.find(p => p.id === id)

export function addPayout(po) {
  const uid = tgId()
  const data = { ...po, categoryId: po.categoryId ? cur(po.categoryId) : po.categoryId }
  create('po', S.DB.PAYOUTS,
    async tid => { const p = findPayout(cur(tid)) || data; return S.buildPayoutProps({ ...p, categoryId: await real(p.categoryId) }, uid) },
    tid => updateData(d => ({ ...d, payouts: [...d.payouts, { ...data, id: tid, tgId: uid }] })),
    tid => updateData(d => ({ ...d, payouts: d.payouts.filter(p => p.id !== tid) })),
    'Не вдалось зберегти виплату')
  haptic.success()
}

export function updatePayout(payoutId, patch) {
  const id = cur(payoutId)
  const before = findPayout(id)
  if (!before) return
  const after = { ...before, ...patch, categoryId: patch.categoryId !== undefined ? (patch.categoryId ? cur(patch.categoryId) : patch.categoryId) : before.categoryId }
  updateData(d => ({ ...d, payouts: d.payouts.map(p => (p.id === id ? after : p)) }))
  haptic.success()
  patchRemote(id, async () => updatePage(await real(id), S.buildPayoutProps({ ...after, categoryId: await real(after.categoryId) }, tgId())), {
    rollback: () => updateData(d => ({ ...d, payouts: d.payouts.map(p => (p.id === cur(id) ? withCurIds(before) : p)) })),
    error: 'Не вдалось оновити виплату',
  })
}

export function deletePayout(payoutId) {
  const id = cur(payoutId)
  const before = findPayout(id)
  if (!before) return
  deferredDelete({
    key: 'po:' + id,
    id,
    message: 'Виплату видалено',
    apply: () => updateData(d => ({ ...d, payouts: d.payouts.filter(p => p.id !== id) })),
    revert: () => updateData(d => ({ ...d, payouts: uniqById([...d.payouts, withCurIds(before)]) })),
    commit: async () => { const rid = await real(id); if (rid) await archivePage(rid) },
  })
}

/* ===== Цілі ===== */
const findGoal = id => getState().data.goals.find(g => g.id === id)

export function saveGoal(form) {
  const uid = tgId()
  if (form.id) {
    const id = cur(form.id)
    const before = findGoal(id)
    if (!before) return id
    const after = { ...before, ...form, id }
    updateData(d => ({ ...d, goals: d.goals.map(g => (g.id === id ? after : g)) }))
    haptic.success()
    patchRemote(id, async () => updatePage(await real(id), S.buildGoalProps(after, uid)), {
      rollback: () => updateData(d => ({ ...d, goals: d.goals.map(g => (g.id === cur(id) ? withCurIds(before) : g)) })),
      error: 'Не вдалось оновити ціль',
    })
    return id
  }
  const goal = { ...form, levels: [], status: 'active' }
  const id = create('g', S.DB.GOALS,
    async tid => S.buildGoalProps(findGoal(cur(tid)) || goal, uid),
    tid => updateData(d => ({ ...d, goals: [...d.goals, { ...goal, id: tid, tgId: uid }] })),
    tid => updateData(d => ({ ...d, goals: d.goals.filter(g => g.id !== tid) })),
    'Не вдалось зберегти ціль')
  haptic.success()
  return id
}

function patchGoal(goalId, patch, errorText) {
  const id = cur(goalId)
  const before = findGoal(id)
  if (!before) return
  const after = { ...before, ...patch }
  updateData(d => ({ ...d, goals: d.goals.map(g => (g.id === id ? after : g)) }))
  patchRemote(id, async () => updatePage(await real(id), S.buildGoalProps(after, tgId())), {
    rollback: () => updateData(d => ({ ...d, goals: d.goals.map(g => (g.id === cur(id) ? withCurIds(before) : g)) })),
    error: errorText,
  })
}

export function deleteGoal(goalId) {
  const id = cur(goalId)
  const before = findGoal(id)
  if (!before) return
  const txs = getState().data.goalTx.filter(t => t.goalId === id)
  updateData(d => ({ ...d, goals: d.goals.filter(g => g.id !== id), goalTx: d.goalTx.filter(t => t.goalId !== id) }))
  haptic.warning()
  toast('Ціль видалено')
  for (const t of txs) mark('hidden', t.id, Infinity)
  removeRemote(id, async () => {
    for (const t of txs) { const tid = await real(t.id); if (tid) await archivePage(tid) }
    const rid = await real(id)
    if (rid) await archivePage(rid)
  }, {
    rollback: () => {
      for (const t of txs) unmark('hidden', t.id, cur(t.id))
      updateData(d => ({ ...d, goals: uniqById([...d.goals, withCurIds(before)]), goalTx: uniqById([...d.goalTx, ...txs.map(withCurIds)]) }))
    },
    error: 'Не вдалось видалити ціль',
  })
}

// внесок / забрати; якщо назбирано ≥ цілі — статус «виконана»
export function addGoalTx(goalRef, tx, { savedAfterNative, target } = {}) {
  const uid = tgId()
  const goalId = cur(goalRef)
  create('gt', S.DB.GOAL_TX,
    async () => { const gid = await real(goalId); if (!gid) throw new Error('ціль ще не створена'); return S.buildGoalTxProps(gid, tx, uid) },
    tid => updateData(d => ({ ...d, goalTx: [...d.goalTx, { ...tx, id: tid, goalId, tgId: uid }] })),
    tid => updateData(d => ({ ...d, goalTx: d.goalTx.filter(t => t.id !== tid) })),
    'Не вдалось зберегти внесок')
  haptic.success()
  const g = findGoal(goalId)
  if (g && g.status === 'active' && savedAfterNative != null && savedAfterNative >= target) {
    patchGoal(goalId, { status: 'completed' }, 'Не вдалось оновити статус цілі')
    return 'completed'
  }
  return null
}

export function deleteGoalTx(txRef) {
  const txId = cur(txRef)
  const before = getState().data.goalTx.find(t => t.id === txId)
  if (!before) return
  deferredDelete({
    key: 'gt:' + txId,
    id: txId,
    message: 'Операцію видалено',
    apply: () => updateData(d => ({ ...d, goalTx: d.goalTx.filter(t => t.id !== txId) })),
    revert: () => updateData(d => ({ ...d, goalTx: uniqById([...d.goalTx, withCurIds(before)]) })),
    commit: async () => { const rid = await real(txId); if (rid) await archivePage(rid) },
  })
}

export function levelUpGoal(goalRef, newTarget) {
  const g = findGoal(cur(goalRef))
  if (!g) return
  patchGoal(g.id, { levels: [...(g.levels || []), g.target], target: newTarget, status: 'active' }, 'Не вдалось підняти рівень цілі')
  haptic.success()
}

export function setGoalStatus(goalRef, status) {
  patchGoal(goalRef, { status }, 'Не вдалось оновити ціль')
  haptic.success()
}

/* ===== Активи ===== */
export function addAssetWithTx(meta, tx) {
  const uid = tgId()
  const existing = getState().data.assets.find(a => a.cgId && a.cgId === meta.cgId)
  const assetId = existing ? existing.id : create('as', S.DB.ASSETS,
    async () => S.buildAssetProps({ ...meta, type: 'crypto' }, uid),
    tid => updateData(d => ({ ...d, assets: [...d.assets, { ...meta, type: 'crypto', id: tid, tgId: uid }] })),
    tid => updateData(d => ({ ...d, assets: d.assets.filter(a => a.id !== tid), assetTx: d.assetTx.filter(t => t.assetId !== tid) })),
    'Не вдалось зберегти актив')
  addAssetTx(assetId, tx)
  if (!getState().prices[meta.cgId]) refreshPrices()
  return assetId
}

export function addAssetTx(assetRef, tx) {
  const uid = tgId()
  const assetId = cur(assetRef)
  create('at', S.DB.ASSET_TX,
    async () => { const aid = await real(assetId); if (!aid) throw new Error('актив ще не створений'); return S.buildAssetTxProps(aid, tx, uid) },
    tid => updateData(d => ({ ...d, assetTx: [...d.assetTx, { ...tx, id: tid, assetId, tgId: uid }] })),
    tid => updateData(d => ({ ...d, assetTx: d.assetTx.filter(t => t.id !== tid) })),
    'Не вдалось зберегти операцію')
  haptic.success()
}

export function deleteAssetTx(txRef) {
  const txId = cur(txRef)
  const before = getState().data.assetTx.find(t => t.id === txId)
  if (!before) return
  deferredDelete({
    key: 'at:' + txId,
    id: txId,
    message: 'Операцію видалено',
    apply: () => updateData(d => ({ ...d, assetTx: d.assetTx.filter(t => t.id !== txId) })),
    revert: () => updateData(d => ({ ...d, assetTx: uniqById([...d.assetTx, withCurIds(before)]) })),
    commit: async () => { const rid = await real(txId); if (rid) await archivePage(rid) },
  })
}

export function deleteAsset(assetRef) {
  const assetId = cur(assetRef)
  const before = getState().data.assets.find(a => a.id === assetId)
  if (!before) return
  const txs = getState().data.assetTx.filter(t => t.assetId === assetId)
  updateData(d => ({ ...d, assets: d.assets.filter(a => a.id !== assetId), assetTx: d.assetTx.filter(t => t.assetId !== assetId) }))
  haptic.warning()
  toast(before.symbol + ' видалено')
  for (const t of txs) mark('hidden', t.id, Infinity)
  removeRemote(assetId, async () => {
    for (const t of txs) { const tid = await real(t.id); if (tid) await archivePage(tid) }
    const rid = await real(assetId)
    if (rid) await archivePage(rid)
  }, {
    rollback: () => {
      for (const t of txs) unmark('hidden', t.id, cur(t.id))
      updateData(d => ({ ...d, assets: uniqById([...d.assets, withCurIds(before)]), assetTx: uniqById([...d.assetTx, ...txs.map(withCurIds)]) }))
    },
    error: 'Не вдалось видалити актив',
  })
}
