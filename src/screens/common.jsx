// Спільні елементи екранів: верхня панель з валютою та налаштуваннями.
import { useStore } from '../state/store.js'
import { openSheet } from '../state/ui.js'
import { setDisplay } from '../state/actions.js'
import { CURRENCIES, SYM } from '../lib/money.js'
import { Icon } from '../ui/icons.jsx'

export function CurrencyPill() {
  const display = useStore(s => s.settings.display)
  const next = CURRENCIES[(CURRENCIES.indexOf(display) + 1) % CURRENCIES.length]
  return (
    <button className="cur-pill" onClick={() => setDisplay(next)} aria-label={'Валюта перегляду: ' + display + '. Натисни, щоб змінити'}>
      <span className="sym">{SYM[display]}</span>{display}
    </button>
  )
}

export function SettingsButton() {
  const busy = useStore(s => s.sync.busy)
  const err = useStore(s => s.sync.error)
  return (
    <button className="icon-btn" onClick={() => openSheet('settings')} aria-label="Налаштування">
      <Icon.settings />
      <span className={'sync-dot' + (busy ? ' busy' : err ? ' err' : '')} />
    </button>
  )
}

export function TopBar({ title, sub, avatar, extra }) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        {avatar}
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && <div className="sub ellipsis">{sub}</div>}
        </div>
      </div>
      <div className="topbar-actions">
        {extra}
        <CurrencyPill />
        <SettingsButton />
      </div>
    </header>
  )
}
