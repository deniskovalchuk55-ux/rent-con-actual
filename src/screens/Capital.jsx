// «Капітал»: цілі (накопичення з рівнями) і активи (криптопортфель з цінами CoinGecko).
import { useEffect, useMemo, useState } from 'react'
import { useDerived, useStore } from '../state/store.js'
import { openSheet } from '../state/ui.js'
import { refreshPrices } from '../state/actions.js'
import { useMoney, Money } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Segmented, Empty, Skeleton, Ring, Section } from '../ui/kit.jsx'
import { AreaChart } from '../ui/charts.jsx'
import { TopBar } from './common.jsx'
import { deadlineInfo, portfolioHistory, fmtQty, fmtPriceUSD } from '../lib/domain/capital.js'
import { cgHistory } from '../lib/notion/api.js'
import { haptic } from '../lib/telegram.js'

export default function Capital() {
  const modules = useStore(s => s.settings.modules)
  const opts = [modules.goals && { value: 'goals', label: 'Цілі' }, modules.assets && { value: 'assets', label: 'Активи' }].filter(Boolean)
  const [part, setPart] = useState(opts[0] ? opts[0].value : 'goals')
  const active = opts.some(o => o.value === part) ? part : opts[0] && opts[0].value
  return (
    <div className="screen">
      <TopBar title="Капітал" sub={active === 'assets' ? 'Портфель і монети' : 'Накопичення на цілі'}
        extra={<button className="icon-btn" onClick={() => { haptic.tap(); openSheet(active === 'assets' ? 'assetSearch' : 'goalForm', {}) }} aria-label="Додати"><Icon.plus /></button>} />
      {opts.length > 1 && <div style={{ marginBottom: 14 }}><Segmented options={opts} value={active} onChange={setPart} /></div>}
      {active === 'assets' ? <Assets /> : <Goals />}
    </div>
  )
}

function Goals() {
  const d = useDerived()
  const loaded = useStore(s => s.loaded.goals)
  const m = useMoney()
  if (loaded !== true && !d.goals.length) {
    if (loaded === 'error') return <div className="card"><Empty icon={Icon.alert} title="Цілі недоступні" text="Перевір у Vercel змінні DB_GOALS і DB_GOAL_TX." /></div>
    return <div className="stack"><Skeleton h={150} r={26} /><Skeleton h={110} r={20} /><Skeleton h={110} r={20} /></div>
  }
  const active = d.goals.filter(g => g.status === 'active')
  const done = d.goals.filter(g => g.status !== 'active')
  const total = d.goals.filter(g => g.status !== 'closed').reduce((s, g) => s + m.toUSD(g.saved, g.cur), 0)
  const targetTotal = active.reduce((s, g) => s + m.toUSD(g.target, g.cur), 0)
  const savedActive = active.reduce((s, g) => s + m.toUSD(g.saved, g.cur), 0)
  return (
    <div className="stagger">
      <div className="hero">
        <div className="hero-top"><span className="label" style={{ color: 'var(--text-2)' }}>Відкладено на цілі</span><span className="pill acc">{active.length} активних</span></div>
        <div className="hero-amount"><Money usd={total} fromZero /></div>
        {targetTotal > 0 && <div className="hero-sub">з <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(targetTotal)}</b> на активні цілі · {Math.round((savedActive / targetTotal) * 100)}%</div>}
      </div>
      {!d.goals.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <Empty icon={Icon.target} title="Постав першу ціль" text="Наприклад, «Новий ноутбук — $1500». Відкладай частинами й дивись, як росте прогрес."
            action={<button className="btn primary sm" onClick={() => openSheet('goalForm', {})}><Icon.plus />Нова ціль</button>} />
        </div>
      ) : (
        <>
          <Section title="Активні">
            {active.length ? <div className="stack">{active.map(g => <GoalCard key={g.id} g={g} />)}</div> : <div className="card muted" style={{ fontSize: 14 }}>Усі цілі виконані 🎉</div>}
          </Section>
          {done.length > 0 && <Section title="Виконані й закриті"><div className="stack">{done.map(g => <GoalCard key={g.id} g={g} />)}</div></Section>}
        </>
      )}
    </div>
  )
}

function GoalCard({ g }) {
  const m = useMoney()
  const dl = deadlineInfo(g)
  const done = g.status === 'completed' || g.pct >= 1
  const closed = g.status === 'closed'
  return (
    <button className="card pressable" style={{ textAlign: 'left', width: '100%', opacity: closed ? 0.6 : 1 }} onClick={() => { haptic.tap(); openSheet('goal', { id: g.id }) }}>
      <div className="row">
        <Ring value={g.pct} size={56} stroke={5} color={done ? 'var(--pos)' : 'var(--accent)'}>
          <span style={{ fontSize: 22 }}>{g.icon}</span>
        </Ring>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <span className="ellipsis" style={{ fontWeight: 650, fontSize: 16 }}>{g.name}</span>
            <span className="num" style={{ fontWeight: 700, color: done ? 'var(--pos)' : 'var(--accent-text)' }}>{Math.round(g.pct * 100)}%</span>
          </div>
          <div className="num muted" style={{ fontSize: 13.5, marginTop: 4 }}>{m.fmtFrom(g.saved, g.cur)} з {m.fmtFrom(g.target, g.cur)}</div>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {closed && <span className="pill neutral">закрита</span>}
            {done && !closed && <span className="pill pos"><Icon.check style={{ width: 13 }} />виконана</span>}
            {!done && dl && <span className={'pill ' + (dl.days < 0 ? 'neg' : dl.days < 14 ? 'warn' : 'neutral')}>{dl.text}</span>}
            {g.levels && g.levels.length > 0 && <span className="pill acc"><Icon.trophy style={{ width: 13 }} />рівень {g.levels.length + 1}</span>}
          </div>
        </div>
      </div>
    </button>
  )
}

const RANGES = [{ value: 7, label: '7д' }, { value: 30, label: '30д' }, { value: 90, label: '90д' }, { value: 365, label: '1р' }]

function Assets() {
  const d = useDerived()
  const loaded = useStore(s => s.loaded.assets)
  const m = useMoney()
  const [days, setDays] = useState(30)
  const [hist, setHist] = useState(null)
  const [scrub, setScrub] = useState(null)
  const assets = d.assets
  const ids = assets.map(a => a.cgId).filter(Boolean).join(',')
  useEffect(() => { refreshPrices() }, [])
  useEffect(() => {
    let off = false
    if (!assets.length) { setHist([]); return }
    setHist(null)
    Promise.all(assets.filter(a => a.cgId).map(a => cgHistory(a.cgId, days).then(h => [a.cgId, h]).catch(() => [a.cgId, []])))
      .then(entries => { if (!off) setHist(Object.fromEntries(entries)) })
    return () => { off = true }
  }, [ids, days])
  const points = useMemo(() => (hist ? portfolioHistory(assets, hist, m.rates) : []), [hist, assets, m.rates])

  if (loaded !== true && !assets.length) {
    if (loaded === 'error') return <div className="card"><Empty icon={Icon.alert} title="Активи недоступні" text="Перевір у Vercel змінні DB_ASSETS і DB_ASSET_TX." /></div>
    return <div className="stack"><Skeleton h={240} r={26} /><Skeleton h={64} r={18} /><Skeleton h={64} r={18} /></div>
  }
  const value = assets.reduce((s, a) => s + a.valueUSD, 0)
  const invested = assets.reduce((s, a) => s + a.investedUSD, 0)
  const pnl = value - invested
  const ch24 = assets.reduce((s, a) => s + a.valueUSD * (a.change24h / 100) / (1 + a.change24h / 100), 0)
  const shownV = scrub != null && points[scrub] ? points[scrub].v : value
  const shownDate = scrub != null && points[scrub] ? new Date(points[scrub].t) : null

  return (
    <div className="stagger">
      <div className="hero">
        <div className="hero-top">
          <span className="label" style={{ color: 'var(--text-2)' }}>{shownDate ? shownDate.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }) : 'Портфель'}</span>
          <span className={'pill ' + (ch24 >= 0 ? 'pos' : 'neg')}>{m.fmt(ch24, { sign: 'always' })} за 24 год</span>
        </div>
        <div className="hero-amount num">{m.fmt(shownV)}</div>
        <div className="hero-sub">P&L <b className={'num ' + (pnl >= 0 ? 'pos' : 'neg')}>{m.fmt(pnl, { sign: 'always' })} ({invested > 0 ? (pnl >= 0 ? '+' : '') + ((pnl / invested) * 100).toFixed(1).replace('.', ',') : '0'}%)</b> · вкладено {m.fmt(invested)}</div>
        <div className="hero-chart" style={{ minHeight: 110 }}>
          {hist === null ? <div style={{ height: 110, display: 'grid', placeItems: 'center' }}><div className="sk" style={{ width: '80%', height: 60 }} /></div>
            : points.length > 1 ? <AreaChart values={points.map(p => p.v)} height={110} color={points[points.length - 1].v >= points[0].v ? 'var(--pos)' : 'var(--neg)'} onScrub={setScrub} />
              : <div className="muted" style={{ height: 80, display: 'grid', placeItems: 'center', fontSize: 13 }}>Графік зʼявиться після першої покупки</div>}
        </div>
      </div>
      <div style={{ marginTop: 12 }}><Segmented options={RANGES} value={days} onChange={setDays} /></div>

      <Section title="Мої монети" action={<button className="link" onClick={() => openSheet('assetSearch', {})}>Додати</button>}>
        {assets.length ? (
          <div className="list">
            {[...assets].sort((a, b) => b.valueUSD - a.valueUSD).map(a => (
              <button key={a.id} className="list-row" onClick={() => { haptic.tap(); openSheet('asset', { id: a.id }) }}>
                <CoinIcon a={a} />
                <div className="main">
                  <div className="title">{a.name || a.symbol} <span className="faint" style={{ fontWeight: 500, fontSize: 13 }}>{a.symbol}</span></div>
                  <div className="meta num">{fmtQty(a.qty)} · {fmtPriceUSD(a.priceUSD)} <span className={a.change24h >= 0 ? 'pos' : 'neg'}>{a.change24h >= 0 ? '+' : ''}{a.change24h.toFixed(1).replace('.', ',')}%</span></div>
                </div>
                <div className="end">
                  <div className="amount">{m.fmt(a.valueUSD)}</div>
                  <div className={'meta num ' + (a.pnlUSD >= 0 ? 'pos' : 'neg')}>{a.pnlUSD >= 0 ? '+' : ''}{a.pnlPct.toFixed(1).replace('.', ',')}%</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="card"><Empty icon={Icon.coins} title="Портфель порожній" text="Знайди монету через CoinGecko і додай першу покупку."
            action={<button className="btn primary sm" onClick={() => openSheet('assetSearch', {})}><Icon.search />Знайти монету</button>} /></div>
        )}
      </Section>
    </div>
  )
}

export function CoinIcon({ a, size = 40 }) {
  const [err, setErr] = useState(false)
  if (a.icon && !err) return <img src={a.icon} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', background: 'var(--card-2)', flexShrink: 0 }} onError={() => setErr(true)} />
  return <div className="avatar" style={{ width: size, height: size, borderRadius: '50%', background: 'var(--card-3)', color: 'var(--text)', fontSize: 12 }}>{(a.symbol || '?').slice(0, 3).toUpperCase()}</div>
}
