// Банки й біржі: статус підключень, баланси, автоімпорт витрат Монобанку, імпорт виписки.
import { getState, setState } from './store.js'
import { toast } from './ui.js'
import { financeCall, cgCall } from '../lib/notion/api.js'
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

export async function setMonoWebhook(enable) {
  try {
    await financeCall('mono-webhook', { enable }, { retries: 0 })
    haptic.success()
    toast(enable ? 'Готово: кожна оплата карткою Монобанку сама потрапить у витрати' : 'Автоімпорт витрат з Монобанку вимкнено', { kind: 'success', duration: 4000 })
    setFin(f => ({ providers: (f.providers || []).map(p => (p.provider === 'mono' ? { ...p, webhook: enable ? 'on' : 'off' } : p)) }))
    return true
  } catch (e) {
    haptic.error()
    toast(e.message || 'Не вдалось', { kind: 'error', duration: 5000 })
    return false
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
