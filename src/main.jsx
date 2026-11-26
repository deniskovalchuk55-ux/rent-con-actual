import { createRoot } from 'react-dom/client'
import './styles/app.css'
import App from './app.jsx'
import { boot } from './state/actions.js'
import { useStore } from './state/store.js'
import { Icon } from './ui/icons.jsx'
import { LockScreen } from './ui/lock.jsx'
import { useLock, initLock } from './state/lock.js'

function NoTelegram() {
  return (
    <div className="no-tg">
      <div>
        <div className="brand-mark"><Icon.key style={{ width: 30, height: 30 }} /></div>
        <h2 className="display" style={{ fontSize: 28, margin: '0 0 10px' }}>Rent·Control</h2>
        <p className="muted" style={{ maxWidth: 300, margin: '0 auto', fontSize: 15 }}>Відкрий застосунок через свого Telegram-бота. Поза Telegram дані недоступні.</p>
      </div>
    </div>
  )
}

function Root() {
  const phase = useStore(s => s.phase)
  const locked = useLock(s => s.locked)
  if (phase === 'no-telegram') return <NoTelegram />
  if (phase !== 'ready') return <LockScreen />
  // поки замкнено, застосунок під непрозорим шаром і недоступний для фокуса й читалок екрана
  return (
    <>
      <div inert={locked || undefined} aria-hidden={locked || undefined}><App /></div>
      <LockScreen />
    </>
  )
}

createRoot(document.getElementById('root')).render(<Root />)
boot()
initLock()
