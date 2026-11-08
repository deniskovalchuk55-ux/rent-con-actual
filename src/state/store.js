// Глобальний стан застосунку: дані з Notion, налаштування, синхронізація. Кеш у localStorage для миттєвого старту.
import { useMemo, useSyncExternalStore } from 'react'
import { today, toISO } from '../lib/dates.js'
import { applyReferrals } from '../lib/domain/rent.js'
import { assetWithTx, goalWithTx } from '../lib/domain/capital.js'
import { cloud } from '../lib/telegram.js'

const SETTINGS_KEY = 'rc5:settings'
const CACHE_PREFIX = 'rc5:cache:'
const LEGACY_KEY = 'rent-control-v3'
const CLOUD_KEY = 'rc5_settings'

export const emptyData = () => ({
  clients: [], workEntries: [], workCategories: [], payouts: [],
  expenses: [], expenseCats: [], goals: [], goalTx: [], assets: [], assetTx: [],
})

export const defaultSettings = () => ({
  display: 'USD',
  theme: 'auto',
  modules: { rent: true, work: true, goals: false, assets: false },
  workEarnedMode: 'accrued',
  overview: { kind: 'month', anchor: toISO(today()) },
  workView: 'calendar',
  clientSort: 'urgency',
  rates: { UAH: 41, PLN: 4, auto: true, source: null, updated: null },
  updatedAt: 0,
})

let state = {
  phase: 'boot', // boot | ready | no-telegram
  user: null,
  platform: 'web',
  settings: defaultSettings(),
  data: emptyData(),
  loaded: { core: false, expenses: false, goals: false, assets: false },
  prices: {},
  sync: { busy: 0, error: null, lastSync: null, fromCache: false },
}

const listeners = new Set()
export const getState = () => state
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }

export function setState(updater) {
  const next = typeof updater === 'function' ? updater(state) : { ...state, ...updater }
  if (next === state) return
  const prev = state
  state = next
  for (const l of listeners) l()
  if (prev.settings !== next.settings) scheduleSettingsSave()
  if (prev.data !== next.data || prev.prices !== next.prices) scheduleCacheSave()
}

export function useStore(selector) {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

export const updateData = fn => setState(s => ({ ...s, data: fn(s.data) }))
export const updateSettings = patch => setState(s => ({
  ...s,
  settings: { ...s.settings, ...(typeof patch === 'function' ? patch(s.settings) : patch), updatedAt: Date.now() },
}))

export function syncBusy(delta) {
  setState(s => ({ ...s, sync: { ...s.sync, busy: Math.max(0, s.sync.busy + delta) } }))
}

/* ===== Похідні дані (рефералка, цілі, активи) ===== */
export function useDerived() {
  const data = useStore(s => s.data)
  const rates = useStore(s => s.settings.rates)
  const prices = useStore(s => s.prices)
  return useMemo(() => derive(data, rates, prices), [data, rates, prices])
}

export function derive(data, rates, prices) {
  const clients = applyReferrals(data.clients)
  const goals = data.goals.map(g => goalWithTx(g, data.goalTx, rates))
  const assets = data.assets.map(a => assetWithTx(a, data.assetTx, prices, rates))
  return { ...data, clients, goals, assets }
}

/* ===== Збереження ===== */
const ls = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false } },
  del(k) { try { localStorage.removeItem(k) } catch { /* */ } },
}

let settingsTimer = null
function scheduleSettingsSave() {
  clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    ls.set(SETTINGS_KEY, state.settings)
    cloud.set(CLOUD_KEY, JSON.stringify(state.settings)).catch(() => {})
  }, 700)
}

let cacheTimer = null
function scheduleCacheSave() {
  if (!state.user) return
  clearTimeout(cacheTimer)
  cacheTimer = setTimeout(() => {
    if (!state.loaded.core) return // не перезаписуємо кеш недовантаженими даними
    const data = { ...state.data }
    // тимчасові (ще не збережені) записи в кеш не пишемо
    const clean = arr => arr.filter(x => !String(x.id).startsWith('tmp-'))
    for (const k of Object.keys(data)) data[k] = clean(data[k])
    data.clients = data.clients.map(c => ({ ...c, payments: clean(c.payments || []) }))
    ls.set(CACHE_PREFIX + state.user.id, { v: 5, savedAt: Date.now(), data, prices: state.prices, loaded: state.loaded })
  }, 900)
}

export function loadCache(userId) {
  const c = ls.get(CACHE_PREFIX + userId)
  if (!c || c.v !== 5 || !c.data) return null
  return { ...c, data: { ...emptyData(), ...c.data } }
}

export function clearCache() {
  if (state.user) ls.del(CACHE_PREFIX + state.user.id)
}

// Налаштування: rc5 → або перенесення з v3
export function loadSettings() {
  const saved = ls.get(SETTINGS_KEY)
  const base = defaultSettings()
  if (saved) return mergeSettings(base, saved)
  const legacy = ls.get(LEGACY_KEY)
  if (!legacy) return base
  const st = legacy.settings || {}
  return mergeSettings(base, {
    display: ['USD', 'UAH', 'PLN'].includes(legacy.display) ? legacy.display : 'USD',
    modules: { rent: st.tabClients !== false, work: st.tabWork !== false, goals: !!st.goalsEnabled, assets: !!st.assetsEnabled },
    workEarnedMode: legacy.workEarnedMode === 'paid' ? 'paid' : 'accrued',
    overview: legacy.overview && legacy.overview.kind ? { kind: legacy.overview.kind, anchor: toISO(today()) } : base.overview,
    workView: legacy.work && legacy.work.viewStyle === 'list' ? 'list' : 'calendar',
    rates: legacy.rates && legacy.rates.UAH ? {
      UAH: legacy.rates.UAH, PLN: legacy.rates.PLN || 4,
      auto: legacy.ratesAuto !== false, source: legacy.ratesSource || null, updated: legacy.ratesUpdated || null,
    } : base.rates,
  })
}

export function mergeSettings(base, s) {
  return {
    ...base,
    ...s,
    modules: { ...base.modules, ...(s.modules || {}) },
    overview: { ...base.overview, ...(s.overview || {}) },
    rates: { ...base.rates, ...(s.rates || {}) },
  }
}

export async function pullCloudSettings() {
  const raw = await cloud.get(CLOUD_KEY)
  if (!raw) return
  try {
    const remote = JSON.parse(raw)
    if (remote && (remote.updatedAt || 0) > (state.settings.updatedAt || 0)) {
      setState(s => ({ ...s, settings: mergeSettings(defaultSettings(), { ...remote, rates: { ...remote.rates, ...(s.settings.rates.auto ? s.settings.rates : {}) } }) }))
    }
  } catch { /* */ }
}

// скидаємо все, що не встигло записатись, при згортанні апки
export function flushPersist() {
  if (settingsTimer) { clearTimeout(settingsTimer); settingsTimer = null; ls.set(SETTINGS_KEY, state.settings) }
}
