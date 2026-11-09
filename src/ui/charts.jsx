// Графіки на SVG: площа з «прокруткою пальцем», стовпчики за місяцями, кільцева діаграма.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { haptic } from '../lib/telegram.js'

function useWidth(ref, fallback = 320) {
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth || fallback)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(80, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return w
}

// згладжена лінія (monotone cubic), щоб не «перестрибувала» через точки; сегменти окремо — щоб останній можна було пунктиром
function smoothSegments(pts) {
  const n = pts.length
  if (n < 2) return []
  const dx = [], dy = [], m = [], t = []
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / (dx[i] || 1) }
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  const segs = []
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    segs.push(` C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + h * t[i]).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - h * t[i + 1]).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`)
  }
  return segs
}
const moveTo = p => `M${p[0].toFixed(1)},${p[1].toFixed(1)}`
function smoothPath(pts) {
  return pts.length < 2 ? '' : moveTo(pts[0]) + smoothSegments(pts).join('')
}

// dashedLast — останній відрізок пунктиром (прогноз поточного місяця), точка в кінці порожниста
export function AreaChart({ values, height = 120, color = 'var(--accent)', onScrub, padTop = 12, padBottom = 6, padX = 8, baseline = false, interactive = true, dashedLast = false }) {
  const ref = useRef(null)
  const w = useWidth(ref)
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState(null)
  const { pts, path, dash, area, zeroY } = useMemo(() => {
    const vals = values.length === 1 ? [values[0], values[0]] : values
    if (!vals.length) return { pts: [], path: '', dash: '', area: '', zeroY: null }
    let min = Math.min(...vals), max = Math.max(...vals)
    if (baseline) { min = Math.min(min, 0); max = Math.max(max, 0) }
    const range = max - min || 1
    const h = height - padTop - padBottom
    const pts = vals.map((v, i) => [padX + (i / (vals.length - 1)) * (w - padX * 2), padTop + h - ((v - min) / range) * h])
    const segs = smoothSegments(pts)
    const full = moveTo(pts[0]) + segs.join('')
    const split = dashedLast && pts.length > 2
    const path = split ? moveTo(pts[0]) + segs.slice(0, -1).join('') : full
    const dash = split ? moveTo(pts[pts.length - 2]) + segs[segs.length - 1] : ''
    const area = full + ` L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`
    const zeroY = baseline && min < 0 ? padTop + h - ((0 - min) / range) * h : null
    return { pts, path, dash, area, zeroY }
  }, [values, w, height, baseline, dashedLast])

  const pick = clientX => {
    if (!interactive || !pts.length) return
    const rect = ref.current.getBoundingClientRect()
    const x = Math.max(padX, Math.min(w - padX, clientX - rect.left))
    const i = Math.round(((x - padX) / Math.max(1, w - padX * 2)) * (pts.length - 1))
    if (i !== hover) { setHover(i); haptic.select(); onScrub && onScrub(i) }
  }
  const end = () => { setHover(null); onScrub && onScrub(null) }

  return (
    <div ref={ref} style={{ position: 'relative', touchAction: interactive ? 'pan-y' : 'auto' }}
      onPointerDown={e => pick(e.clientX)} onPointerMove={e => (e.buttons || e.pointerType === 'touch') && pick(e.clientX)}
      onPointerUp={end} onPointerLeave={end} onPointerCancel={end}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={'g' + gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {zeroY != null && <line x1="0" x2={w} y1={zeroY} y2={zeroY} stroke="var(--line-2)" strokeDasharray="3 4" />}
        <path d={area} fill={`url(#g${gid})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="draw-line" />
        {dash && <path d={dash} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="1 6" opacity="0.9" className="fade-in-late" />}
        {hover != null && pts[hover] && (
          <g>
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={0} y2={height} stroke="var(--line-2)" strokeWidth="1" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="5.5" fill="var(--bg)" stroke={color} strokeWidth="2.5" />
          </g>
        )}
        {hover == null && pts.length > 0 && (dash
          ? <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4.5" fill="var(--bg)" stroke={color} strokeWidth="2.2" className="fade-in-late" />
          : <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill={color} />)}
      </svg>
    </div>
  )
}

// Стовпчики за місяцями: стос із кількох рядів + позначка витрат
export function MonthBars({ data, series, height = 150, selected, onSelect, formatValue, expenseKey }) {
  const ref = useRef(null)
  const w = useWidth(ref)
  const n = data.length
  const gap = n > 8 ? 6 : 10
  const bw = Math.max(6, (w - gap * (n - 1)) / n)
  const totals = data.map(d => series.reduce((s, k) => s + Math.max(0, d[k.key] || 0), 0))
  const maxV = Math.max(1, ...totals, ...(expenseKey ? data.map(d => d[expenseKey] || 0) : [0]))
  const chartH = height - 22
  return (
    <div ref={ref}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ display: 'block' }}>
        {[0.25, 0.5, 0.75].map(f => <line key={f} x1="0" x2={w} y1={chartH - chartH * f} y2={chartH - chartH * f} stroke="var(--line)" strokeDasharray="2 5" />)}
        {data.map((d, i) => {
          const x = i * (bw + gap)
          let y = chartH
          const isSel = selected === i
          const dim = selected != null && !isSel
          return (
            <g key={d.key || i} onClick={() => { haptic.select(); onSelect && onSelect(isSel ? null : i) }} style={{ cursor: 'pointer' }} opacity={dim ? 0.4 : 1}>
              <rect x={x} y={0} width={bw} height={height} fill="transparent" />
              {series.map((s, si) => {
                const v = Math.max(0, d[s.key] || 0)
                const h = (v / maxV) * (chartH - 4)
                if (h <= 0) return null
                y -= h
                const isTop = series.slice(si + 1).every(s2 => !(d[s2.key] > 0))
                return <rect key={s.key} x={x} y={y} width={bw} height={Math.max(h - (isTop ? 0 : 1.5), 1)} rx={isTop ? Math.min(6, bw / 2) : 1.5} fill={s.color} className="bar-grow" style={{ transformOrigin: `${x}px ${chartH}px`, animationDelay: i * 25 + 'ms' }} />
              })}
              {expenseKey && d[expenseKey] > 0 && (
                <line x1={x - 2} x2={x + bw + 2} y1={chartH - (d[expenseKey] / maxV) * (chartH - 4)} y2={chartH - (d[expenseKey] / maxV) * (chartH - 4)} stroke="var(--neg)" strokeWidth="2.2" strokeLinecap="round" />
              )}
              <text x={x + bw / 2} y={height - 5} textAnchor="middle" fontSize="11" fontWeight={isSel ? 700 : 500} fill={isSel ? 'var(--text)' : 'var(--text-3)'}>{d.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function Donut({ parts, size = 132, stroke = 16, children }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(t) }, [])
  let acc = 0
  const gapLen = parts.filter(p => p.value > 0).length > 1 ? 3 : 0
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card-3)" strokeWidth={stroke} />
        {total > 0 && parts.map((p, i) => {
          const frac = Math.max(0, p.value) / total
          const len = Math.max(0, frac * c - gapLen)
          const off = acc
          acc += frac * c
          if (len <= 0) return null
          return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke}
            strokeDasharray={`${ready ? len : 0} ${c}`} strokeDashoffset={-off} style={{ transition: 'stroke-dasharray 1s cubic-bezier(.25,.8,.25,1)' }} />
        })}
      </svg>
      {children && <div className="ring-center">{children}</div>}
    </div>
  )
}

// Горизонтальні смуги-частки (категорії)
export function ShareBars({ items, total, format, colors }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {items.map((it, i) => {
        const frac = total > 0 ? it.value / total : 0
        const color = it.color || (colors && colors[i % colors.length]) || 'var(--accent)'
        return (
          <div key={it.id || i}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <span className="row" style={{ gap: 8, minWidth: 0 }}><span className="dot" style={{ background: color }} /><span className="ellipsis" style={{ fontWeight: 550, fontSize: 14.5 }}>{it.label}</span>{it.sub && <span className="faint" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{it.sub}</span>}</span>
              <span className="num" style={{ fontWeight: 650, fontSize: 14.5, whiteSpace: 'nowrap' }}>{format(it.value)} <span className="faint" style={{ fontWeight: 500, fontSize: 12.5 }}>{Math.round(frac * 100)}%</span></span>
            </div>
            <div className="bar thin"><i style={{ width: frac * 100 + '%', background: color }} /></div>
          </div>
        )
      })}
    </div>
  )
}

export const PALETTE = ['#ffd60a', '#5ab8ff', '#a78bfa', '#34d399', '#ffa53d', '#f472b6', '#22d3ee', '#fb7185', '#a3e635']
