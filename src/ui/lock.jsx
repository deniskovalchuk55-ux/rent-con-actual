// Екран блокування: непрозорий шар над усім застосунком, поки біометрія не підтвердить власника.
import { useEffect } from 'react'
import { useLock, unlock } from '../state/lock.js'
import { useStore } from '../state/store.js'
import { bio } from '../lib/telegram.js'
import { Icon } from './icons.jsx'

// як назвати біометрію людською мовою (знахідний відмінок: «вхід через …»)
export function bioName(type, platform) {
  const apple = /^(ios|macos)$/.test(platform || '')
  if (type === 'face') return apple ? 'Face ID' : 'розпізнавання обличчя'
  if (type === 'finger') return apple ? 'Touch ID' : 'відбиток пальця'
  return 'біометрію'
}

export function LockScreen() {
  const locked = useLock(s => s.locked)
  const busy = useLock(s => s.busy)
  const error = useLock(s => s.error)
  const info = useLock(s => s.info)
  const platform = useStore(s => s.platform)

  // щойно замкнулись — одразу просимо перевірку, без зайвого натискання
  useEffect(() => { if (locked) unlock() }, [locked])
  useEffect(() => {
    if (!locked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [locked])

  if (!locked) return null
  const name = bioName(info && info.type, platform)
  const text = error === 'denied' ? `Дозволь боту використовувати ${name}: Налаштування Telegram → біометрія для ботів.`
    : error === 'failed' ? 'Не вдалося підтвердити. Спробуй ще раз.'
    : error === 'silent' ? 'Telegram не відповів. Спробуй ще раз.'
    : 'Фінанси під захистом. Підтверди, що це ти.'
  const Mark = info && info.type === 'face' ? Icon.scanFace : Icon.lock
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Rent·Control заблоковано">
      <div className="lock-body">
        <div className={'lock-mark' + (busy ? ' busy' : '')}><Mark /></div>
        <div className="display lock-title">Rent·Control</div>
        <p className="muted lock-text">{text}</p>
      </div>
      <div className="lock-actions">
        {error === 'denied' && <button className="btn primary" onClick={() => bio.openSettings()}><Icon.settings />Відкрити налаштування</button>}
        <button className={'btn' + (error === 'denied' ? '' : ' primary')} disabled={busy} onClick={() => unlock()}>
          {busy ? <Icon.refresh className="spin" /> : <Mark />}{busy ? 'Перевіряю…' : error === 'denied' ? 'Спробувати ще раз' : 'Розблокувати'}
        </button>
      </div>
    </div>
  )
}
