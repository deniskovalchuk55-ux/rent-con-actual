// Гроші на екрані: конвертація в обрану валюту, анімований підрахунок.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { convert, formatMoney, formatCompact } from '../lib/money.js'

export function useMoney() {
  const display = useStore(s => s.settings.display)
  const rates = useStore(s => s.settings.rates)
  const fromUSD = usd => convert(usd, 'USD', display, rates)
  return {
    display, rates,
    // сума в доларах → рядок у валюті перегляду
    fmt: (usd, opts) => formatMoney(fromUSD(usd), display, opts),
    compact: usd => formatCompact(fromUSD(usd), display),
    // сума в будь-якій валюті → рядок у валюті перегляду
    fmtFrom: (amount, cur, opts) => formatMoney(convert(amount, cur, display, rates), display, opts),
    native: (amount, cur, opts) => formatMoney(amount, cur, opts),
    toDisplay: fromUSD,
    toUSD: (amount, cur) => convert(amount, cur, 'USD', rates),
    convert: (amount, from, to) => convert(amount, from, to, rates),
  }
}

// плавний підрахунок числа (easeOutExpo), без стрибків при першому рендері
export function useCountUp(value, duration = 900, { fromZero = false } = {}) {
  const [v, setV] = useState(fromZero ? 0 : value)
  const from = useRef(fromZero ? 0 : value)
  const raf = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    const b = value
    if (a === b) return
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !duration) { from.current = b; setV(b); return }
    cancelAnimationFrame(raf.current)
    const step = now => {
      const t = Math.min(1, (now - start) / duration)
      const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      const cur = a + (b - a) * e
      setV(cur)
      if (t < 1) raf.current = requestAnimationFrame(step)
      else from.current = b
    }
    raf.current = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf.current); from.current = b }
  }, [value, duration])
  return v
}

// <Money usd={123} /> — анімована сума у валюті перегляду
export function Money({ usd, sign, animate = true, fromZero = false, className = '', decimals }) {
  const m = useMoney()
  const target = m.toDisplay(usd || 0)
  const v = useCountUp(target, animate ? 900 : 0, { fromZero })
  return <span className={'num ' + className}>{formatMoney(animate ? v : target, m.display, { sign, decimals })}</span>
}
