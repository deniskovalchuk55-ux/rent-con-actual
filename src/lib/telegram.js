// Обгортка над Telegram WebApp: користувач, тема, хаптика, кнопка «Назад», CloudStorage, кольори шапки.
const tg = () => (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) || null

export function initTelegram() {
  const w = tg()
  let user = null
  if (w) {
    try {
      w.ready()
      w.expand()
      if (w.disableVerticalSwipes) w.disableVerticalSwipes() // не закривати апку свайпом, коли гортаєш список
      const u = w.initDataUnsafe && w.initDataUnsafe.user
      if (u && u.id) user = { id: u.id, firstName: u.first_name || '', lastName: u.last_name || '', username: u.username || '', photoUrl: u.photo_url || '' }
    } catch (e) { console.warn('TG init failed', e) }
  }
  if (!user) {
    const dev = new URLSearchParams(location.search).get('tg')
    if (dev) user = { id: parseInt(dev, 10), firstName: '', lastName: '', username: '', photoUrl: '' }
  }
  return { user, initData: (w && w.initData) || '', platform: (w && w.platform) || 'web', colorScheme: (w && w.colorScheme) || null, version: (w && w.version) || '' }
}

const supports = v => { const w = tg(); return !!(w && w.isVersionAtLeast && w.isVersionAtLeast(v)) }

export const haptic = {
  tap() { try { tg()?.HapticFeedback?.impactOccurred('light') } catch { /* */ } },
  soft() { try { tg()?.HapticFeedback?.impactOccurred('soft') } catch { /* */ } },
  medium() { try { tg()?.HapticFeedback?.impactOccurred('medium') } catch { /* */ } },
  select() { try { tg()?.HapticFeedback?.selectionChanged() } catch { /* */ } },
  success() { try { tg()?.HapticFeedback?.notificationOccurred('success') } catch { /* */ } },
  warning() { try { tg()?.HapticFeedback?.notificationOccurred('warning') } catch { /* */ } },
  error() { try { tg()?.HapticFeedback?.notificationOccurred('error') } catch { /* */ } },
}

export function setChromeColors(bg) {
  const w = tg()
  if (!w) return
  try {
    if (supports('6.1')) { w.setHeaderColor(bg); w.setBackgroundColor(bg) }
    if (supports('7.10') && w.setBottomBarColor) w.setBottomBarColor(bg)
  } catch { /* */ }
}

// Кнопка «Назад» Telegram: показуємо, поки відкрите вікно; натискання закриває верхнє
let backHandler = null
export function setBackButton(handler) {
  const w = tg()
  if (!w || !w.BackButton || !supports('6.1')) return
  if (backHandler) { try { w.BackButton.offClick(backHandler) } catch { /* */ } }
  backHandler = handler || null
  if (handler) { w.BackButton.onClick(handler); w.BackButton.show() } else w.BackButton.hide()
}

export function onThemeChanged(cb) {
  const w = tg()
  if (!w || !w.onEvent) return () => {}
  const h = () => cb(w.colorScheme)
  w.onEvent('themeChanged', h)
  return () => w.offEvent && w.offEvent('themeChanged', h)
}

export function openTelegramLink(url) {
  const w = tg()
  try { if (w && w.openTelegramLink) { w.openTelegramLink(url); return } } catch { /* */ }
  window.open(url, '_blank', 'noopener')
}

export function openLink(url) {
  const w = tg()
  try { if (w && w.openLink) { w.openLink(url); return } } catch { /* */ }
  window.open(url, '_blank', 'noopener')
}

// CloudStorage (Bot API 6.9+) — синхронізація налаштувань між пристроями
export const cloud = {
  available: () => supports('6.9') && !!tg()?.CloudStorage,
  get(key) {
    return new Promise(resolve => {
      if (!cloud.available()) return resolve(null)
      try { tg().CloudStorage.getItem(key, (err, v) => resolve(err ? null : v || null)) } catch { resolve(null) }
    })
  },
  set(key, value) {
    return new Promise(resolve => {
      if (!cloud.available()) return resolve(false)
      try { tg().CloudStorage.setItem(key, value, err => resolve(!err)) } catch { resolve(false) }
    })
  },
}

// Біометрія (Bot API 7.2+): Face ID / Touch ID / відбиток. Telegram відхиляє запит, поки триває попередній,
// тож запити йдуть по черзі; якщо клієнт не відповів — повертаємо null, а не висимо.
const bm = () => { const w = tg(); return (w && supports('7.2') && w.BiometricManager) || null }
const bioRead = m => ({ available: !!m.isBiometricAvailable, type: m.biometricType || 'unknown', requested: !!m.isAccessRequested, granted: !!m.isAccessGranted, deviceId: m.deviceId || '' })
let bioQueue = Promise.resolve()
function bioCall(fn, timeout) {
  const run = () => new Promise(resolve => {
    let done = false
    const finish = v => { if (!done) { done = true; clearTimeout(t); resolve(v) } }
    const t = setTimeout(() => finish(null), timeout)
    try { fn(finish) } catch { finish(null) }
  })
  const p = bioQueue.then(run, run)
  bioQueue = p.catch(() => {})
  return p
}
export const bio = {
  supported: () => !!bm(),
  // { available, type: face|finger|unknown, requested, granted, deviceId } або null
  init: () => bioCall(done => {
    const m = bm()
    if (!m) return done(null)
    if (m.isInited) return done(bioRead(m))
    m.init(() => done(bioRead(m)))
  }, 5000),
  requestAccess: reason => bioCall(done => { const m = bm(); if (!m) return done(false); m.requestAccess({ reason }, ok => done(!!ok)) }, 120e3).then(Boolean),
  authenticate: reason => bioCall(done => { const m = bm(); if (!m) return done(false); m.authenticate({ reason }, ok => done(!!ok)) }, 120e3).then(Boolean),
  // лише у відповідь на натискання користувача
  openSettings() { try { bm()?.openSettings() } catch { /* */ } },
}

// Іконка застосунку на головному екрані телефона (Bot API 8.0+)
export const homeScreen = {
  supported: () => { const w = tg(); return !!(w && supports('8.0') && typeof w.addToHomeScreen === 'function') },
  // unsupported | unknown | added | missed
  status: () => new Promise(resolve => {
    const w = tg()
    if (!homeScreen.supported() || typeof w.checkHomeScreenStatus !== 'function') return resolve('unsupported')
    const t = setTimeout(() => resolve('unknown'), 3000)
    try { w.checkHomeScreenStatus(s => { clearTimeout(t); resolve(s || 'unknown') }) } catch { clearTimeout(t); resolve('unsupported') }
  }),
  add() { try { tg().addToHomeScreen(); return true } catch { return false } },
  onAdded(cb) {
    const w = tg()
    if (!w || !w.onEvent) return () => {}
    w.onEvent('homeScreenAdded', cb)
    return () => { try { w.offEvent('homeScreenAdded', cb) } catch { /* */ } }
  },
}

// Застосунок згорнули / знову відкрили: події Telegram 8.0+ (activated / deactivated) і видимість сторінки
export function onActivity(onHide, onShow) {
  const w = tg()
  const vis = () => (document.visibilityState === 'hidden' ? onHide() : onShow())
  document.addEventListener('visibilitychange', vis)
  const tgEvents = !!(w && w.onEvent && supports('8.0'))
  if (tgEvents) { w.onEvent('deactivated', onHide); w.onEvent('activated', onShow) }
  return () => {
    document.removeEventListener('visibilitychange', vis)
    if (tgEvents) { try { w.offEvent('deactivated', onHide); w.offEvent('activated', onShow) } catch { /* */ } }
  }
}

export function confirmClose(on) {
  const w = tg()
  if (!w || !supports('6.2')) return
  try { on ? w.enableClosingConfirmation() : w.disableClosingConfirmation() } catch { /* */ }
}
