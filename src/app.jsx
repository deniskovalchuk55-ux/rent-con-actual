// Каркас: тема, вкладки, нижня навігація, вікна, тости, жест «потягни, щоб оновити».
import { useEffect, useRef, useState } from 'react'
import { useStore } from './state/store.js'
import { useUI, setTab, openSheet } from './state/ui.js'
import { syncAll, flushPendingDeletes } from './state/actions.js'
import { onThemeChanged, setChromeColors, haptic } from './lib/telegram.js'
import { Icon } from './ui/icons.jsx'
import { Toasts } from './ui/sheet.jsx'
import { SheetHost } from './sheets/registry.jsx'
import Home from './screens/Home.jsx'
import Rent from './screens/Rent.jsx'
import Work from './screens/Work.jsx'
import Capital from './screens/Capital.jsx'

function useTheme() {
  const pref = useStore(s => s.settings.theme)
  const tgScheme = useStore(s => s.tgColorScheme)
  const [scheme, setScheme] = useState(tgScheme || null)
  useEffect(() => onThemeChanged(setScheme), [])
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null
    const resolve = () => {
      const mode = pref === 'auto' ? (scheme || (mq && mq.matches ? 'light' : 'dark')) : pref
      document.documentElement.dataset.theme = mode
      const bg = mode === 'light' ? '#f2f2f5' : '#0b0b0c'
      setChromeColors(bg)
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', bg)
    }
    resolve()
    if (mq && mq.addEventListener) { mq.addEventListener('change', resolve); return () => mq.removeEventListener('change', resolve) }
  }, [pref, scheme])
}

const TABS = [
  { id: 'home', label: 'Пульс', icon: Icon.pulse },
  { id: 'rent', label: 'Оренда', icon: Icon.key, module: 'rent' },
  { id: 'fab' },
  { id: 'work', label: 'Робота', icon: Icon.briefcase, module: 'work' },
  { id: 'capital', label: 'Капітал', icon: Icon.gem, module: 'capital' },
]

function TabBar() {
  const tab = useUI(u => u.tab)
  const modules = useStore(s => s.settings.modules)
  const enabled = t => !t.module || (t.module === 'capital' ? modules.goals || modules.assets : modules[t.module])
  return (
    <div className="tabbar-wrap">
      <nav className="tabbar" aria-label="Розділи">
        {TABS.filter(enabled).map(t => t.id === 'fab'
          ? (
            <div key="fab" className="tab-fab">
              <button className="fab" aria-label="Додати" onClick={() => { haptic.medium(); openSheet('quickAdd') }}><Icon.plus /></button>
            </div>
          )
          : (
            <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              <t.icon />
              <span>{t.label}</span>
            </button>
          ))}
      </nav>
    </div>
  )
}

// потягни вниз на верху сторінки → синхронізація з Notion
function usePullToRefresh() {
  const [pull, setPull] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const st = useRef(null)
  useEffect(() => {
    const down = e => {
      if (window.scrollY > 0 || document.querySelector('.sheet-layer')) return
      st.current = { y: e.touches[0].clientY, d: 0 }
    }
    const move = e => {
      if (!st.current) return
      const d = e.touches[0].clientY - st.current.y
      if (d <= 0 || window.scrollY > 0) { st.current.d = 0; setPull(0); return }
      st.current.d = Math.min(110, d * 0.5)
      setPull(st.current.d)
    }
    const up = async () => {
      const d = st.current ? st.current.d : 0
      st.current = null
      if (d >= 64) {
        haptic.medium()
        setSpinning(true)
        setPull(56)
        await syncAll({ silent: false })
        setSpinning(false)
      }
      setPull(0)
    }
    window.addEventListener('touchstart', down, { passive: true })
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', up)
    return () => { window.removeEventListener('touchstart', down); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up) }
  }, [])
  return { pull, spinning }
}

export default function App() {
  useTheme()
  const tab = useUI(u => u.tab)
  const modules = useStore(s => s.settings.modules)
  const { pull, spinning } = usePullToRefresh()

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushPendingDeletes() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushPendingDeletes)
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flushPendingDeletes) }
  }, [])

  // вимкнений модуль — повертаємось на Пульс
  useEffect(() => {
    if ((tab === 'rent' && !modules.rent) || (tab === 'work' && !modules.work) || (tab === 'capital' && !modules.goals && !modules.assets)) setTab('home')
  }, [tab, modules])

  const Screen = { home: Home, rent: Rent, work: Work, capital: Capital }[tab] || Home
  return (
    <div className="app">
      {pull > 0 && (
        <div className="ptr" style={{ transform: `translateY(${pull}px)` }}>
          <div className="ptr-spinner" style={{ opacity: Math.min(1, pull / 60), transform: `translateY(-40px) rotate(${pull * 3}deg)` }}>
            <Icon.refresh className={spinning ? 'spin' : ''} />
          </div>
        </div>
      )}
      <div style={{ transform: pull ? `translateY(${pull * 0.6}px)` : undefined, transition: pull ? 'none' : 'transform .35s cubic-bezier(.2,.9,.25,1.05)' }}>
        <Screen key={tab} />
      </div>
      <TabBar />
      <SheetHost />
      <Toasts />
    </div>
  )
}
