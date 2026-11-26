// Вхід через Face ID / Touch ID / відбиток. Вмикається для конкретного пристрою: прапорець у localStorage
// і запасна копія в CloudStorage під ідентифікатором пристрою від Telegram. Тому на комп'ютері без біометрії
// застосунок не замкнеться. Перевірка — під час відкриття й після кількох хвилин у фоні.
import { useSyncExternalStore } from 'react'
import { bio, cloud, onActivity, haptic } from '../lib/telegram.js'
import { toast } from './ui.js'

const KEY = 'rc5:lock'
const AWAY_MS = () => (typeof window !== 'undefined' && window.__rcLockAfter != null ? window.__rcLockAfter : 3 * 60e3)
const saved = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
const save = on => { try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY) } catch { /* приватний режим */ } }
const cloudKey = id => 'rc5_lock_' + String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)

let st = { enabled: saved(), locked: saved(), busy: false, error: null, info: null }
const listeners = new Set()
const set = patch => { st = { ...st, ...patch }; for (const l of listeners) l() }
export const getLock = () => st
export function useLock(selector) {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => selector(st), () => selector(st))
}

const REASON_ACCESS = 'Щоб Rent·Control відкривався лише після перевірки'
const REASON_UNLOCK = 'Підтверди, що це ти, щоб відкрити Rent·Control'
const REASON_ENABLE = 'Підтверди, щоб увімкнути вхід через біометрію'

let started = false
let hiddenAt = 0
export async function initLock() {
  if (started) return
  started = true
  if (!bio.supported()) { if (st.locked) set({ locked: false }); return } // старий Telegram — блокувати нічим
  onActivity(
    () => { if (!hiddenAt) hiddenAt = Date.now() },
    () => {
      const away = hiddenAt ? Date.now() - hiddenAt : 0
      hiddenAt = 0
      if (st.enabled && !st.locked && away >= AWAY_MS()) set({ locked: true, error: null })
    },
  )
  const info = await bio.init()
  if (info) set({ info })
  // localStorage могли очистити — відновлюємо прапорець із хмари Telegram для цього пристрою
  if (!st.enabled && info && info.available && info.deviceId) {
    const v = await cloud.get(cloudKey(info.deviceId))
    if (v === '1' && !st.enabled) { save(true); set({ enabled: true, locked: true }) }
  }
}

function remember(on) {
  save(on)
  const id = st.info && st.info.deviceId
  if (id) cloud.set(cloudKey(id), on ? '1' : '0')
}

export async function unlock() {
  if (st.busy || !st.locked) return
  set({ busy: true, error: null })
  if (!bio.supported()) { set({ locked: false, busy: false }); return }
  let info = await bio.init()
  if (info) set({ info })
  if (!info) { set({ busy: false, error: 'silent' }); return }
  if (!info.available) {
    // біометрію на пристрої вимкнули: не замикаємо назавжди, але кажемо про це
    set({ locked: false, busy: false })
    toast('Біометрія на пристрої недоступна — відкрито без перевірки', { kind: 'error', duration: 4000 })
    return
  }
  if (!info.granted) {
    const ok = await bio.requestAccess(REASON_ACCESS)
    info = await bio.init()
    if (info) set({ info })
    if (!ok) { set({ busy: false, error: 'denied' }); return }
  }
  const ok = await bio.authenticate(REASON_UNLOCK)
  if (ok) { haptic.success(); set({ locked: false, busy: false, error: null }) } else set({ busy: false, error: 'failed' })
}

export async function enableLock() {
  let info = await bio.init()
  if (info) set({ info })
  if (!info || !info.available) { toast('На цьому пристрої біометрія недоступна', { kind: 'error' }); return false }
  if (!info.granted) {
    const ok = await bio.requestAccess(REASON_ACCESS)
    info = await bio.init()
    if (info) set({ info })
    if (!ok) {
      toast('Telegram не дав доступу до біометрії', { kind: 'error', action: { label: 'Налаштування', onClick: () => bio.openSettings() } })
      return false
    }
  }
  // перевіряємо одразу: краще дізнатись зараз, ніж побачити замок, який не відмикається
  const ok = await bio.authenticate(REASON_ENABLE)
  if (!ok) { toast('Перевірку не пройдено — вхід лишається без біометрії', { kind: 'error' }); return false }
  remember(true)
  set({ enabled: true })
  haptic.success()
  toast('Готово: застосунок відкриватиметься після перевірки', { kind: 'success' })
  return true
}

export function disableLock() {
  remember(false)
  set({ enabled: false, locked: false, error: null })
  toast('Вхід через біометрію вимкнено', { kind: 'success' })
}
