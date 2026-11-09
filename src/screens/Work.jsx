// «Робота»: місяць з календарем-тепловою картою, нараховано / виплачено, категорії, підробітки, архів місяців.
import { useMemo, useState } from 'react'
import { useDerived, useStore, updateSettings } from '../state/store.js'
import { openSheet } from '../state/ui.js'
import { useMoney, Money } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Section, Segmented, Empty, Skeleton, Bar, IconTile } from '../ui/kit.jsx'
import { TopBar } from './common.jsx'
import { accruedUSDForMonth, paidUSDForMonth, hoursForMonth, monthPayoutStatus, STATUS_LABEL, workEntryUSD, workMonths, workEarnedBetweenUSD, workHoursBetween, hasAnyFinal } from '../lib/domain/work.js'
import { monthKeyOf, monthKeyLabel, shiftMonthKey, toISO, today, UA_WEEKDAYS_SHORT, parseDate, fmtRelDay, startOf, MS_DAY, plural } from '../lib/dates.js'
import { haptic } from '../lib/telegram.js'

const STATUS_PILL = { paid: 'pos', partial: 'warn', pending: 'acc' }
const fmtH = h => (Math.round(h * 10) / 10).toString().replace('.', ',')

export default function Work() {
  const d = useDerived()
  const loaded = useStore(s => s.loaded.core)
  const view = useStore(s => s.settings.workView)
  const m = useMoney()
  const [month, setMonth] = useState(monthKeyOf(today()))
  const rates = m.rates
  const isCurrent = month === monthKeyOf(today())

  const accrued = accruedUSDForMonth(d.workEntries, month, rates)
  const paid = paidUSDForMonth(d.payouts, month, rates)
  const hours = hoursForMonth(d.workEntries, month)
  const status = monthPayoutStatus(d.workEntries, d.payouts, month, rates)
  const monthEntries = d.workEntries.filter(e => monthKeyOf(e.date) === month)
  const fixed = monthEntries.filter(e => e.kind === 'fixed').sort((a, b) => (a.date < b.date ? 1 : -1))
  const fixedSum = fixed.reduce((s, e) => s + workEntryUSD(e, rates), 0)
  const closed = hasAnyFinal(d.payouts, month)

  const now = Date.now()
  const periodStats = [
    { label: 'Тиждень', from: startOf('week').getTime() },
    { label: 'Місяць', from: startOf('month').getTime() },
    { label: 'Рік', from: startOf('year').getTime() },
  ].map(p => ({ ...p, usd: workEarnedBetweenUSD(d.workEntries, d.payouts, p.from, now + MS_DAY, 'accrued', rates), h: workHoursBetween(d.workEntries, p.from, now + MS_DAY) }))

  return (
    <div className="screen">
      <TopBar title="Робота" sub="Години, підробітки, виплати"
        extra={<button className="icon-btn" onClick={() => { haptic.tap(); openSheet('workEntry', { date: isCurrent ? toISO(today()) : month + '-01' }) }} aria-label="Додати запис"><Icon.plus /></button>} />

      {!loaded ? <div className="stack"><Skeleton h={220} r={26} /><Skeleton h={300} r={20} /></div> : (
        <div className="stagger">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <button className="icon-btn" onClick={() => { haptic.select(); setMonth(shiftMonthKey(month, -1)) }} aria-label="Попередній місяць"><Icon.chevronLeft /></button>
            <button style={{ fontWeight: 700, fontSize: 18 }} onClick={() => { haptic.select(); setMonth(monthKeyOf(today())) }}>{monthKeyLabel(month)}</button>
            <button className="icon-btn" onClick={() => { haptic.select(); setMonth(shiftMonthKey(month, 1)) }} aria-label="Наступний місяць"><Icon.chevronRight /></button>
          </div>

          <div className="hero pressable" onClick={() => { haptic.tap(); openSheet('month', { month }) }}>
            <div className="hero-top">
              <span className="label" style={{ color: 'var(--text-2)' }}>Нараховано за годинами</span>
              <span className={'pill ' + STATUS_PILL[status]}>{STATUS_LABEL[status]}</span>
            </div>
            <div className="hero-amount sm"><Money usd={accrued} /></div>
            <div className="hero-sub"><b className="num" style={{ color: 'var(--text)' }}>{fmtH(hours)} год</b> · {(n => n + ' ' + plural(n, 'день', 'дні', 'днів'))(new Set(monthEntries.filter(e => e.kind === 'hourly').map(e => e.date)).size)}{fixedSum > 0 ? <> · підробітки <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(fixedSum)}</b></> : null}</div>
            <div style={{ marginTop: 16, position: 'relative', zIndex: 1 }}><Bar value={accrued > 0 ? Math.min(1, paid / accrued) : status === 'paid' ? 1 : 0} color="var(--pos)" /></div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, fontSize: 13.5, position: 'relative', zIndex: 1 }}>
              <span className="muted">Виплачено <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(paid)}</b></span>
              <span className="muted">{status === 'paid' ? 'Місяць закрито' : <>Залишок <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(Math.max(0, accrued - paid))}</b></>}</span>
            </div>
            {!closed && (accrued > 0 || paid > 0) && (
              <button className="btn primary" style={{ marginTop: 14, position: 'relative', zIndex: 1 }} onClick={e => { e.stopPropagation(); haptic.tap(); openSheet('payout', { month }) }}>
                <Icon.wallet />Додати виплату
              </button>
            )}
          </div>

          <div className="row" style={{ justifyContent: 'space-between', margin: '22px 2px 12px' }}>
            <h2 className="display" style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>Дні</h2>
            <Segmented small value={view} onChange={v => updateSettings({ workView: v })} options={[{ value: 'calendar', label: 'Календар' }, { value: 'list', label: 'Список' }]} />
          </div>
          {view === 'calendar' ? <Calendar month={month} entries={d.workEntries} /> : <DayList entries={monthEntries} categories={d.workCategories} />}

          <Categories cats={d.workCategories} />

          <Section title="Підробітки" action={<button className="link" onClick={() => openSheet('workEntry', { kind: 'fixed', date: isCurrent ? toISO(today()) : month + '-01' })}>Додати</button>}>
            {fixed.length ? (
              <div className="list">
                {fixed.map(e => (
                  <button key={e.id} className="list-row" onClick={() => openSheet('workEntry', { id: e.id })}>
                    <IconTile icon={Icon.bolt} color="var(--violet)" bg="var(--violet-soft)" />
                    <div className="main"><div className="title">{e.title || 'Підробіток'}</div><div className="meta">{fmtRelDay(e.date)}{e.note ? ' · ' + e.note : ''}</div></div>
                    <div className="end amount pos">+{m.fmt(workEntryUSD(e, rates))}</div>
                  </button>
                ))}
              </div>
            ) : <div className="card muted" style={{ fontSize: 14 }}>Цього місяця підробітків не було</div>}
          </Section>

          <Section title="Підсумки">
            <div className="grid-3">
              {periodStats.map(p => (
                <div className="kpi" key={p.label} style={{ padding: 12 }}>
                  <div className="k-label">{p.label}</div>
                  <div className="k-value num" style={{ fontSize: 17 }}>{m.compact(p.usd)}</div>
                  <div className="k-sub num">{fmtH(p.h)} год</div>
                </div>
              ))}
            </div>
          </Section>

          <MonthsArchive d={d} onPick={k => { setMonth(k); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
        </div>
      )}
    </div>
  )
}

function Calendar({ month, entries }) {
  const m = useMoney()
  const [y, mo] = month.split('-').map(Number)
  const first = new Date(y, mo - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(y, mo, 0).getDate()
  const todayISO = toISO(today())
  const byDay = useMemo(() => {
    const map = {}
    for (const e of entries) {
      if (monthKeyOf(e.date) !== month) continue
      const k = e.date.slice(0, 10)
      ;(map[k] ||= { h: 0, usd: 0, n: 0 })
      if (e.kind === 'hourly') map[k].h += e.hours || 0
      map[k].usd += workEntryUSD(e, m.rates)
      map[k].n++
    }
    return map
  }, [entries, month, m.rates])
  const maxH = Math.max(8, ...Object.values(byDay).map(x => x.h))
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(<div key={'b' + i} className="cal-cell blank" />)
  for (let dd = 1; dd <= days; dd++) {
    const iso = `${month}-${String(dd).padStart(2, '0')}`
    const info = byDay[iso]
    const isToday = iso === todayISO
    const future = iso > todayISO
    const intensity = info ? (info.h > 0 ? 0.35 + 0.65 * Math.min(1, info.h / maxH) : 0.5) : 0
    cells.push(
      <button key={iso} className={'cal-cell' + (info ? ' has' : '') + (isToday ? ' today' : '') + (future ? ' future' : '')}
        style={info ? { background: `rgba(255, 214, 10, ${intensity.toFixed(2)})`, borderColor: 'transparent', color: intensity > 0.55 ? '#151200' : 'var(--text)' } : undefined}
        onClick={() => { haptic.tap(); openSheet('day', { date: iso }) }} aria-label={iso}>
        <span className="d">{dd}</span>
        {info && <span className="h num">{info.h > 0 ? fmtH(info.h) + 'г' : m.compact(info.usd)}</span>}
      </button>
    )
  }
  return (
    <div className="card tight">
      <div className="cal-head">{UA_WEEKDAYS_SHORT.map(w => <span key={w}>{w}</span>)}</div>
      <div className="cal-grid">{cells}</div>
    </div>
  )
}

function DayList({ entries, categories }) {
  const m = useMoney()
  const hourly = entries.filter(e => e.kind === 'hourly')
  if (!hourly.length) {
    return <div className="card"><Empty icon={Icon.clock} title="Цього місяця годин немає" text="Додай перший робочий день кнопкою «+»."
      action={<button className="btn primary sm" onClick={() => openSheet('workEntry', {})}><Icon.plus />Додати години</button>} /></div>
  }
  const byDay = {}
  for (const e of hourly) (byDay[e.date] ||= []).push(e)
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a))
  return (
    <div className="list">
      {days.map(day => {
        const list = byDay[day]
        const h = list.reduce((s, e) => s + (e.hours || 0), 0)
        const usd = list.reduce((s, e) => s + workEntryUSD(e, m.rates), 0)
        const cats = [...new Set(list.map(e => (categories.find(c => c.id === e.categoryId) || {}).name).filter(Boolean))]
        const dt = parseDate(day)
        return (
          <button key={day} className="list-row" onClick={() => openSheet('day', { date: day })}>
            <div className="icon-tile" style={{ background: 'var(--card-2)', flexDirection: 'column', gap: 0 }}>
              <span style={{ fontWeight: 800, fontSize: 15, lineHeight: 1 }}>{dt.getDate()}</span>
              <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontWeight: 700 }}>{UA_WEEKDAYS_SHORT[(dt.getDay() + 6) % 7]}</span>
            </div>
            <div className="main"><div className="title num">{fmtH(h)} год</div><div className="meta">{cats.join(', ') || 'без категорії'}{list.length > 1 ? ' · ' + list.length + ' ' + plural(list.length, 'запис', 'записи', 'записів') : ''}</div></div>
            <div className="end amount">{m.fmt(usd)}</div>
          </button>
        )
      })}
    </div>
  )
}

function Categories({ cats }) {
  const m = useMoney()
  return (
    <Section title="Категорії" action={<button className="link" onClick={() => openSheet('category', {})}>Нова</button>}>
      {cats.length ? (
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', margin: 0, padding: 0 }}>
          {cats.map(c => (
            <button key={c.id} className="chip" onClick={() => { haptic.tap(); openSheet('category', { id: c.id }) }}>
              {c.isDefault && <span className="dot" style={{ background: 'var(--accent)' }} />}
              {c.name}<span className="faint num" style={{ fontWeight: 500 }}>{m.native(c.rate, c.cur)}/год</span>
            </button>
          ))}
        </div>
      ) : <div className="card muted" style={{ fontSize: 14 }}>Категорії задають ставку за годину, напр. «Будова — $15/год». Створи першу.</div>}
    </Section>
  )
}

function MonthsArchive({ d, onPick }) {
  const m = useMoney()
  const months = workMonths(d.workEntries, d.payouts).slice(0, 18)
  if (!months.length) return null
  return (
    <Section title="Усі місяці">
      <div className="list">
        {months.map(k => {
          const acc = accruedUSDForMonth(d.workEntries, k, m.rates)
          const pd = paidUSDForMonth(d.payouts, k, m.rates)
          const st = monthPayoutStatus(d.workEntries, d.payouts, k, m.rates)
          return (
            <button key={k} className="list-row" onClick={() => { haptic.tap(); openSheet('month', { month: k }) }}>
              <div className="main">
                <div className="title">{monthKeyLabel(k)}</div>
                <div className="meta num">{fmtH(hoursForMonth(d.workEntries, k))} год · нараховано {m.fmt(acc)}{pd > 0 ? ' · виплачено ' + m.fmt(pd) : ''}</div>
              </div>
              <span className={'pill ' + STATUS_PILL[st]}>{STATUS_LABEL[st]}</span>
              <Icon.chevronRight className="chev" />
            </button>
          )
        })}
      </div>
    </Section>
  )
}
