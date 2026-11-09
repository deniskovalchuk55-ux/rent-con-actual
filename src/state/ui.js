// UI-стан: стос нижніх вікон (sheets), тости, вкладка. Окремо від даних, щоб не перемальовувати все.
import { useSyncExternalStore } from 'react'
import { haptic, setBackButton } from '../lib/telegram.js'

let ui = { tab: 'home', sheets: [], toasts: [] }
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }
const set = patch => { ui = { ...ui, ...patch }; emit() }
export const getUI = () => ui
export function useUI(selector) {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => selector(ui), () => selector(ui))
}

export function setTab(tab) {
  if (ui.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
  haptic.select()
  set({ tab })
  window.scrollTo(0, 0)
  syncBack()
}

let seq = 0
export function openSheet(type, props = {}) {
  const id = ++seq
  set({ sheets: [...ui.sheets, { id, type, props, closing: false }] })
  syncBack()
  return id
}

// закриття з анімацією: позначаємо closing, прибираємо після переходу
export function closeSheet(id) {
  const target = id == null ? ui.sheets[ui.sheets.length - 1] : ui.sheets.find(s => s.id === id)
  if (!target || target.closing) return
  set({ sheets: ui.sheets.map(s => (s === target ? { ...s, closing: true } : s)) })
  setTimeout(() => { set({ sheets: ui.sheets.filter(s => s.id !== target.id) }); syncBack() }, 260)
}

export function replaceSheet(type, props = {}) {
  const top = ui.sheets[ui.sheets.length - 1]
  if (top) set({ sheets: ui.sheets.filter(s => s !== top) })
  return openSheet(type, props)
}

// новий запис отримав справжній id з Notion — підміняємо його у відкритих вікнах, щоб вони не «загубили» запис
export function remapSheetIds(tmpId, realId) {
  let changed = false
  const sheets = ui.sheets.map(s => {
    if (!s.props || !Object.values(s.props).includes(tmpId)) return s
    changed = true
    const props = {}
    for (const [k, v] of Object.entries(s.props)) props[k] = v === tmpId ? realId : v
    return { ...s, props }
  })
  if (changed) set({ sheets })
}

export function closeAllSheets() {
  set({ sheets: ui.sheets.map(s => ({ ...s, closing: true })) })
  setTimeout(() => { set({ sheets: [] }); syncBack() }, 260)
}

function syncBack() {
  const open = ui.sheets.filter(s => !s.closing).length
  if (open > 0) setBackButton(() => closeSheet())
  else if (ui.tab !== 'home') setBackButton(() => setTab('home'))
  else setBackButton(null)
}

let tseq = 0
// toast('Збережено', { kind: 'success' | 'error' | 'info', action: { label, onClick }, duration })
export function toast(message, opts = {}) {
  const id = ++tseq
  const t = { id, message, kind: opts.kind || 'info', action: opts.action || null }
  set({ toasts: [...ui.toasts.slice(-2), t] })
  if (opts.kind === 'error') haptic.error()
  setTimeout(() => dismissToast(id), opts.duration || (opts.action ? 4500 : 2600))
  return id
}

export function dismissToast(id) {
  if (!ui.toasts.some(t => t.id === id)) return
  set({ toasts: ui.toasts.filter(t => t.id !== id) })
}
