// Базові компоненти інтерфейсу.
import { useLayoutEffect, useRef, useState } from 'react'
import { haptic } from '../lib/telegram.js'
import { Icon } from './icons.jsx'
import { CURRENCIES, SYM } from '../lib/money.js'

// Сегментований перемикач з повзунком, що перетікає між пунктами
export function Segmented({ options, value, onChange, small = false, className = '' }) {
  const ref = useRef(null)
  const [thumb, setThumb] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const i = options.findIndex(o => o.value === value)
    const btn = el.querySelectorAll('button')[i]
    if (btn) setThumb({ x: btn.offsetLeft, w: btn.offsetWidth })
  }, [value, options.length])
  return (
    <div ref={ref} className={'seg ' + (small ? 'small ' : '') + className} role="tablist">
      {thumb && <div className="seg-thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x - 3}px)`, left: 3 }} />}
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''}
          onClick={() => { if (o.value !== value) { haptic.select(); onChange(o.value) } }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ on, onChange, label, sub, icon }) {
  return (
    <button type="button" className="switch-row pressable" onClick={() => { haptic.select(); onChange(!on) }} style={{ width: '100%', textAlign: 'left' }}>
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{sub}</div>}
      </div>
      <span className={'switch' + (on ? ' on' : '')} role="switch" aria-checked={on} />
    </button>
  )
}

const HUES = [45, 200, 265, 150, 15, 330, 180, 95, 230, 290]
export function hueFor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

// «Барбершоп «Борода»» → «ББ»: лапки, дужки й тире не потрапляють в ініціали
export function initials(name = '') {
  const parts = String(name).replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function Avatar({ name, size, photo }) {
  const h = hueFor(name)
  const style = { background: `linear-gradient(135deg, hsl(${h} 70% 56%), hsl(${(h + 35) % 360} 72% 42%))` }
  return (
    <div className={'avatar' + (size === 'lg' ? ' lg' : '')} style={style}>
      {photo ? <img src={photo} alt="" /> : initials(name)}
    </div>
  )
}

export function IconTile({ icon: Ic, color = 'var(--accent-text)', bg = 'var(--accent-soft)', size }) {
  return <div className="icon-tile" style={{ color, background: bg, ...(size ? { width: size, height: size } : {}) }}><Ic /></div>
}

export function Empty({ icon: Ic = Icon.sparkle, title, text, action }) {
  return (
    <div className="empty">
      <div className="e-icon"><Ic /></div>
      {title && <h3>{title}</h3>}
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ h = 16, w = '100%', r = 10, style }) {
  return <div className="sk" style={{ height: h, width: w, borderRadius: r, ...style }} />
}

export function Section({ title, action, children, style }) {
  return (
    <section className="section" style={style}>
      {(title || action) && (
        <div className="section-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Ring({ value = 0, size = 44, stroke = 4.5, color = 'var(--accent)', children, track = true }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        {track && <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />}
        <circle className="ring-progress" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      </svg>
      {children && <div className="ring-center">{children}</div>}
    </div>
  )
}

export function Bar({ value = 0, color, thin }) {
  return <div className={'bar' + (thin ? ' thin' : '')}><i style={{ width: Math.max(0, Math.min(100, value * 100)) + '%', background: color }} /></div>
}

/* ===== Поля ===== */
export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function TextInput({ value, onChange, placeholder, type = 'text', inputMode, autoFocus, id, maxLength }) {
  return <input id={id} className="input" type={type} inputMode={inputMode} value={value ?? ''} placeholder={placeholder} autoFocus={autoFocus} maxLength={maxLength}
    onChange={e => onChange(e.target.value)} />
}

export function CurrencyPicker({ value, onChange }) {
  return (
    <div className="cur-select" role="radiogroup">
      {CURRENCIES.map(c => (
        <button key={c} type="button" className={value === c ? 'on' : ''} onClick={() => { if (value !== c) { haptic.select(); onChange(c) } }} aria-label={c}>
          {SYM[c]}
        </button>
      ))}
    </div>
  )
}

export function AmountInput({ value, onChange, cur, onCur, placeholder = '0', autoFocus, id }) {
  return (
    <div className="amount-field">
      <input id={id} className="input num" inputMode="decimal" value={value ?? ''} placeholder={placeholder} autoFocus={autoFocus}
        onChange={e => onChange(e.target.value.replace(/[^0-9.,]/g, ''))} />
      {onCur && <CurrencyPicker value={cur} onChange={onCur} />}
    </div>
  )
}

export function DateInput({ value, onChange, id }) {
  return <input id={id} className="input" type="date" value={value || ''} onChange={e => onChange(e.target.value)} />
}

export function Stepper({ value, onChange, step = 0.5, min = 0, id }) {
  const n = parseFloat(String(value).replace(',', '.')) || 0
  const set = v => { haptic.select(); onChange(String(Math.max(min, Math.round(v * 100) / 100)).replace('.', ',')) }
  return (
    <div className="stepper">
      <button type="button" onClick={() => set(n - step)} aria-label="менше">−</button>
      <input id={id} className="input num" inputMode="decimal" value={value ?? ''} placeholder="0" onChange={e => onChange(e.target.value.replace(/[^0-9.,]/g, ''))} />
      <button type="button" onClick={() => set(n + step)} aria-label="більше">+</button>
    </div>
  )
}

export function Chips({ items, value, onChange, accent }) {
  return (
    <div className="chips">
      {items.map(it => (
        <button key={it.value} type="button" className={'chip' + (accent ? ' accent-on' : '') + (it.value === value ? ' on' : '')}
          onClick={() => { haptic.select(); onChange(it.value) }}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function KV({ k, v, vClass }) {
  return <div className="kv"><span className="k">{k}</span><span className={'v ' + (vClass || '')}>{v}</span></div>
}
