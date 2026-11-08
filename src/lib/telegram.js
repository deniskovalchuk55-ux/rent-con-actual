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

export function confirmClose(on) {
  const w = tg()
  if (!w || !supports('6.2')) return
  try { on ? w.enableClosingConfirmation() : w.disableClosingConfirmation() } catch { /* */ }
}
