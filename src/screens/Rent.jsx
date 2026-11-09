// «Оренда»: щомісячний дохід з «живим» лічильником, список орендарів зі статусами, аналітика оренди.
import { useEffect, useMemo, useState } from 'react'
import { useDerived, useStore, updateSettings } from '../state/store.js'
import { openSheet } from '../state/ui.js'
import { useMoney } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Avatar, Ring, Section, Chips, Empty, Skeleton, Segmented } from '../ui/kit.jsx'
import { TopBar } from './common.jsx'
import { LEVEL_COLOR } from './Home.jsx'
import { statusOf, periodProgress, nextPayText, portfolioMonthlyUSD, clientDoneUSD, clientInProgressUSD, rentDoneUSD, referralTotals, referralBonusUSD, isReferralReady } from '../lib/domain/rent.js'
import { AVG_MONTH_DAYS, startOf, plural } from '../lib/dates.js'
import { formatMoney } from '../lib/money.js'
import { haptic } from '../lib/telegram.js'

const LEVEL_PILL = { due: 'neg', warn: 'warn', soon: 'acc', ok: 'pos' }

export default function Rent() {
  const d = useDerived()
  const loaded = useStore(s => s.loaded.core)
  const sort = useStore(s => s.settings.clientSort)
  const m = useMoney()
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const clients = d.clients
  const mrr = portfolioMonthlyUSD(clients, m.rates)

  const rows = useMemo(() => {
    let list = clients.map(c => ({ c, st: statusOf(c), p: periodProgress(c) }))
    if (filter === 'due') list = list.filter(x => x.st.days <= 0)
    if (filter === 'soon') list = list.filter(x => x.st.days > 0 && x.st.days <= 7)
    if (filter === 'post') list = list.filter(x => x.c.payMode === 'postpaid')
    if (filter === 'ref') list = list.filter(x => x.c.referredBy || x.c.bonusMonths > 0)
    if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter(x => x.c.name.toLowerCase().includes(s)) }
    if (sort === 'name') list.sort((a, b) => a.c.name.localeCompare(b.c.name, 'uk'))
    else if (sort === 'rate') list.sort((a, b) => m.toUSD(b.c.rate, b.c.cur) - m.toUSD(a.c.rate, a.c.cur))
    else list.sort((a, b) => a.st.days - b.st.days)
    return list
  }, [clients, filter, q, sort, m.rates])

  const counts = useMemo(() => {
    const st = clients.map(c => statusOf(c).days)
    return { due: st.filter(x => x <= 0).length, soon: st.filter(x => x > 0 && x <= 7).length, post: clients.filter(c => c.payMode === 'postpaid').length }
  }, [clients])

  return (
    <div className="screen">
      <TopBar title="Оренда" sub={clients.length ? `${clients.length} ${plural(clients.length, 'орендар', 'орендарі', 'орендарів')}` : 'Орендарі та оплати'}
        extra={<button className="icon-btn" onClick={() => { haptic.tap(); openSheet('clientForm') }} aria-label="Додати орендаря"><Icon.userPlus /></button>} />

      {!loaded ? <div className="stack"><Skeleton h={190} r={26} /><Skeleton h={64} r={18} /><Skeleton h={64} r={18} /><Skeleton h={64} r={18} /></div> : (
        <div className="stagger">
          <MrrHero mrr={mrr} />

          {clients.length === 0 ? (
            <div className="card" style={{ marginTop: 16 }}>
              <Empty icon={Icon.key} title="Ще немає орендарів" text="Додай орендаря — застосунок рахуватиме дати оплат, статуси й дохід."
                action={<button className="btn primary sm" onClick={() => openSheet('clientForm')}><Icon.plus />Додати орендаря</button>} />
            </div>
          ) : (
            <>
              <div style={{ marginTop: 18 }}>
                <Chips value={filter} onChange={setFilter} items={[
                  { value: 'all', label: 'Усі · ' + clients.length },
                  ...(counts.due ? [{ value: 'due', label: 'Чекають · ' + counts.due }] : []),
                  ...(counts.soon ? [{ value: 'soon', label: 'Цього тижня · ' + counts.soon }] : []),
                  ...(counts.post ? [{ value: 'post', label: 'Постоплата · ' + counts.post }] : []),
                  { value: 'ref', label: 'Рефералка' },
                ]} />
              </div>
              {clients.length > 6 && (
                <div style={{ position: 'relative', marginTop: 10 }}>
                  <Icon.search style={{ position: 'absolute', left: 14, top: 15, width: 20, color: 'var(--text-3)' }} />
                  <input className="input" style={{ paddingLeft: 44, height: 48 }} placeholder="Пошук орендаря" value={q} onChange={e => setQ(e.target.value)} />
                </div>
              )}
              <div className="row" style={{ justifyContent: 'space-between', margin: '16px 2px 10px' }}>
                <span className="label">{rows.length} у списку</span>
                <Segmented small value={sort} onChange={v => updateSettings({ clientSort: v })} options={[{ value: 'urgency', label: 'Терміни' }, { value: 'rate', label: 'Ставка' }, { value: 'name', label: 'А–Я' }]} />
              </div>
              <div className="list">
                {rows.length === 0 && <div className="empty" style={{ padding: 22 }}>Нікого за цим фільтром</div>}
                {rows.map(({ c, st, p }) => (
                  <button key={c.id} className="list-row" onClick={() => { haptic.tap(); openSheet('client', { id: c.id }) }}>
                    <Ring value={p} size={44} stroke={3.5} color={LEVEL_COLOR[st.level]}>
                      <Avatar name={c.name} />
                    </Ring>
                    <div className="main">
                      <div className="title">{c.name}{c.referredBy && <span className="pill violet" style={{ marginLeft: 6, height: 18, fontSize: 10.5 }}>REF</span>}</div>
                      <div className="meta num">{m.fmtFrom(c.rate, c.cur)}/міс{c.payMode === 'postpaid' ? ' · постоплата' : ''}{c.bonusMonths > 0 ? ' · +' + c.bonusMonths + ' міс бонус' : ''}</div>
                    </div>
                    <div className="end">
                      <span className={'pill ' + LEVEL_PILL[st.level]}>{nextPayText(st.days)}</span>
                    </div>
                  </button>
                ))}
              </div>
              <RentAnalytics clients={clients} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// MRR + лічильник, що «капає» щосекунди: скільки оренда приносить з початку дня
function MrrHero({ mrr }) {
  const m = useMoney()
  const perSec = mrr / AVG_MONTH_DAYS / 86400
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const sinceMidnight = (now - startOf('day').getTime()) / 1000
  const today = perSec * sinceMidnight
  const cells = [
    { p: 'година', v: mrr / AVG_MONTH_DAYS / 24 },
    { p: 'день', v: mrr / AVG_MONTH_DAYS },
    { p: 'місяць', v: mrr },
    { p: 'рік', v: mrr * 12 },
  ]
  return (
    <div className="hero">
      <div className="hero-top">
        <span className="label" style={{ color: 'var(--text-2)' }}>Щомісячний дохід</span>
        <span className="pill pos"><span className="live-dot" />наживо</span>
      </div>
      <div className="hero-amount num">{m.fmt(mrr)}</div>
      <div className="hero-sub">
        Сьогодні вже <b className="ticker" style={{ color: 'var(--pos)' }}>{formatMoney(m.toDisplay(today), m.display, { decimals: 2 })}</b>
      </div>
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16, position: 'relative', zIndex: 1 }}>
        {cells.map(c => (
          <div key={c.p} style={{ background: 'var(--card-2)', borderRadius: 14, padding: '10px 8px', textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 600 }}>{c.p}</div>
            <div className="num" style={{ fontWeight: 700, fontSize: 14.5, marginTop: 4, whiteSpace: 'nowrap' }}>{m.compact(c.v)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RentAnalytics({ clients }) {
  const m = useMoney()
  const nowMs = Date.now()
  const done = clients.reduce((s, c) => s + clientDoneUSD(c, nowMs, m.rates), 0)
  const prog = clients.reduce((s, c) => s + clientInProgressUSD(c, nowMs, m.rates), 0)
  const total = done + prog
  const periods = [
    { label: 'Сьогодні', from: startOf('day') },
    { label: 'Тиждень', from: startOf('week') },
    { label: 'Місяць', from: startOf('month') },
    { label: 'Рік', from: startOf('year') },
  ].map(p => ({ ...p, v: rentDoneUSD(clients, p.from.getTime(), nowMs, m.rates) }))
  const leaders = clients.map(c => ({ c, v: clientDoneUSD(c, nowMs, m.rates) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 5)
  const refs = clients.filter(c => c.referredBy && c.bonusAmount)
  const rt = referralTotals(clients, m.rates)

  return (
    <>
      <Section title="Виконано та попереду">
        <div className="card">
          <div className="grid-2">
            <div><div className="label">Виконано</div><div className="display num" style={{ fontSize: 24, marginTop: 6, color: 'var(--pos)' }}>{m.fmt(done)}</div></div>
            <div><div className="label">Попереду</div><div className="display num" style={{ fontSize: 24, marginTop: 6 }}>{m.fmt(prog)}</div></div>
          </div>
          <div className="stack-bar" style={{ marginTop: 14 }}>
            <i style={{ width: (total ? (done / total) * 100 : 0) + '%', background: 'var(--pos)' }} />
            <i style={{ width: (total ? (prog / total) * 100 : 0) + '%', background: 'var(--card-3)', backgroundImage: 'repeating-linear-gradient(135deg, var(--line-2) 0 5px, transparent 5px 10px)' }} />
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Оплачений час, що вже минув, і той, що ще попереду</div>
          <div className="divider" />
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {periods.map(p => (
              <div key={p.label} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>{p.label}</div>
                <div className="num" style={{ fontWeight: 700, marginTop: 4, fontSize: 14.5, whiteSpace: 'nowrap' }}>{m.compact(p.v)}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {leaders.length > 0 && (
        <Section title="Топ орендарів">
          <div className="list">
            {leaders.map((x, i) => (
              <button key={x.c.id} className="list-row" onClick={() => openSheet('client', { id: x.c.id })}>
                <div className="icon-tile" style={{ background: i === 0 ? 'var(--accent)' : 'var(--card-2)', color: i === 0 ? 'var(--accent-ink)' : 'var(--text-2)', fontWeight: 800 }}>{i + 1}</div>
                <div className="main"><div className="title">{x.c.name}</div><div className="meta">виконано за весь час</div></div>
                <div className="end amount">{m.fmt(x.v)}</div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {refs.length > 0 && (
        <Section title="Рефералка">
          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div className="kpi"><div className="k-label"><Icon.gift style={{ width: 15 }} />Нараховано</div><div className="k-value num accent">{m.fmt(rt.granted)}</div><div className="k-sub">бонусами запрошувачам</div></div>
            <div className="kpi"><div className="k-label"><Icon.hourglass style={{ width: 15 }} />Очікує</div><div className="k-value num">{m.fmt(rt.pending)}</div><div className="k-sub">ще не нараховано</div></div>
          </div>
          <div className="list">
            {refs.map(c => {
              const referrer = clients.find(x => x.id === c.referredBy)
              if (!referrer) return null
              return (
                <button key={c.id} className="list-row" onClick={() => openSheet('client', { id: c.id })}>
                  <div className="icon-tile" style={{ background: c.referralGranted ? 'var(--pos-soft)' : 'var(--card-2)', color: c.referralGranted ? 'var(--pos)' : 'var(--text-3)' }}><Icon.gift /></div>
                  <div className="main">
                    <div className="title">{referrer.name} → {c.name}</div>
                    <div className="meta">+{c.bonusAmount} міс · {m.fmt(referralBonusUSD(c, clients, m.rates))}</div>
                  </div>
                  <span className={'pill ' + (c.referralGranted ? 'pos' : isReferralReady(c) ? 'acc' : 'neutral')}>{c.referralGranted ? 'нараховано' : 'очікує'}</span>
                </button>
              )
            })}
          </div>
        </Section>
      )}
    </>
  )
}
