// Нижнє вікно: тягни вниз, щоб закрити; кнопка «Назад» Telegram теж закриває.
import { useEffect, useRef } from 'react'
import { closeSheet, dismissToast, useUI } from '../state/ui.js'
import { haptic } from '../lib/telegram.js'
import { Icon } from './icons.jsx'

export function Sheet({ sheetId, title, children, footer, onClose, headerRight, closing, noHeader }) {
  const sheetRef = useRef(null)
  const bodyRef = useRef(null)
  const drag = useRef(null)
  const close = () => { onClose ? onClose() : closeSheet(sheetId) }

  // тягнемо за шапку або тіло, коли воно прокручене до верху
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const onDown = e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const inBody = bodyRef.current && bodyRef.current.contains(e.target)
      if (inBody && bodyRef.current.scrollTop > 0) return
      if (e.target.closest('input, textarea, select, .no-drag')) return
      drag.current = { y0: e.clientY, dy: 0, t0: performance.now(), active: false, inBody }
    }
    const onMove = e => {
      const d = drag.current
      if (!d) return
      const dy = e.clientY - d.y0
      if (!d.active) {
        if (dy > 8) { d.active = true; el.classList.add('dragging') } else if (dy < -4) { drag.current = null; return } else return
      }
      d.dy = Math.max(0, dy)
      el.style.transform = `translateY(${d.dy}px)`
      if (e.cancelable) e.preventDefault()
    }
    const onUp = () => {
      const d = drag.current
      drag.current = null
      if (!d || !d.active) return
      el.classList.remove('dragging')
      const v = d.dy / Math.max(1, performance.now() - d.t0)
      if (d.dy > 120 || v > 0.6) {
        el.style.setProperty('--drag', d.dy + 'px')
        haptic.soft()
        close()
      } else {
        el.style.transition = 'transform .35s cubic-bezier(.2,.9,.25,1.05)'
        el.style.transform = ''
        setTimeout(() => { if (el) el.style.transition = '' }, 360)
      }
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <div className={'sheet-layer' + (closing ? ' closing' : '')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="sheet-scrim" onClick={close} />
      <div className="sheet" ref={sheetRef}>
        <div className="sheet-grab"><i /></div>
        {!noHeader && (
          <div className="sheet-head">
            <h3>{title}</h3>
            <div className="row" style={{ gap: 8 }}>
              {headerRight}
              <button className="icon-btn" onClick={close} aria-label="Закрити"><Icon.close /></button>
            </div>
          </div>
        )}
        <div className="sheet-body" ref={bodyRef}>{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  )
}

const ICONS = { success: Icon.check, error: Icon.alert, info: Icon.info }

export function Toasts() {
  const toasts = useUI(u => u.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => {
        const Ic = ICONS[t.kind] || Icon.info
        return (
          <div key={t.id} className={'toast ' + t.kind} onClick={() => !t.action && dismissToast(t.id)}>
            <span className="t-icon"><Ic /></span>
            <span className="t-msg">{t.message}</span>
            {t.action && <button className="t-action" onClick={() => { t.action.onClick(); dismissToast(t.id) }}>{t.action.label}</button>}
          </div>
        )
      })}
    </div>
  )
}

// Конфеті для приємних моментів (ціль виконана, перша оплата)
export function burstConfetti() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const canvas = document.createElement('canvas')
  canvas.className = 'confetti'
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = innerWidth * dpr
  canvas.height = innerHeight * dpr
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  const colors = ['#ffd60a', '#34d399', '#5ab8ff', '#a78bfa', '#ff8fa3', '#ffffff']
  const parts = Array.from({ length: 110 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * 0.38,
    vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 12 - 5,
    r: Math.random() * 6 + 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0], shape: Math.random() < 0.5,
  }))
  const t0 = performance.now()
  const frame = now => {
    const t = now - t0
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot)
      ctx.globalAlpha = Math.max(0, 1 - t / 1900)
      ctx.fillStyle = p.c
      if (p.shape) ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2)
      else { ctx.beginPath(); ctx.arc(0, 0, p.r / 3, 0, Math.PI * 2); ctx.fill() }
      ctx.restore()
    }
    if (t < 1900) requestAnimationFrame(frame)
    else canvas.remove()
  }
  requestAnimationFrame(frame)
}
