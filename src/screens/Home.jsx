// «Пульс»: головна цифра місяця з графіком, найближчі оплати, робота, звіт за період, тренд, капітал.
import { useMemo, useState } from 'react'
import { useDerived, useStore } from '../state/store.js'
import { openSheet, setTab } from '../state/ui.js'
import { setOverview, setWorkMode } from '../state/actions.js'
import { useMoney, Money } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Avatar, Ring, Section, Segmented, Skeleton, Bar, Empty } from '../ui/kit.jsx'
import { AreaChart, MonthBars, ShareBars, PALETTE } from '../ui/charts.jsx'
import { TopBar } from './common.jsx'
import { monthlySeries, periodBounds, periodLabel, shiftAnchor, isCurrentPeriod, periodSummary, expensesByCategory } from '../lib/domain/overview.js'
import { statusOf, periodProgress, nextPayText } from '../lib/domain/rent.js'
import { accruedUSDForMonth, paidUSDForMonth, hoursForMonth, monthPayoutStatus, STATUS_LABEL, workByCategoryBetween } from '../lib/domain/work.js'
import { monthKeyOf, toISO, today, UA_MONTHS, plural } from '../lib/dates.js'
import { haptic } from '../lib/telegram.js'

export const STREAM = {
  rent: { label: 'Оренда', color: 'var(--blue)', soft: 'var(--blue-soft)' },
  work: { label: 'Робота', color: 'var(--accent)', soft: 'var(--accent-soft)' },
  setup: { label: 'Розробка', color: 'var(--violet)', soft: 'var(--violet-soft)' },
}

const STATUS_PILL = { paid: 'pos', partial: 'warn', pending: 'acc' }
export const LEVEL_COLOR = { due: 'var(--neg)', warn: 'var(--warn)', soon: 'var(--accent)', ok: 'var(--pos)' }

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Доброї ночі'
  if (h < 12) return 'Доброго ранку'
  if (h < 18) return 'Доброго дня'
  return 'Доброго вечора'
}

export default function Home() {
  const d = useDerived()
  const user = useStore(s => s.user)
  const settings = useStore(s => s.settings)
  const loaded = useStore(s => s.loaded)
  const m = useMoney()
  const { rates, workEarnedMode: mode, modules } = settings
  const series = useMemo(() => monthlySeries(d, 6, mode, rates), [d, mode, rates])
  const [scrub, setScrub] = useState(null)
  const idx = scrub != null ? scrub : series.length - 1
  const cur = series[idx]
  const prev = idx > 0 ? series[idx - 1] : null
  const curMonthIdx = new Date().getMonth() - (series.length - 1 - idx)
  const monthName = UA_MONTHS[(curMonthIdx + 12) % 12]
  const isCurMonth = idx === series.length - 1
  const delta = !isCurMonth && prev && prev.earned > 0 ? (cur.earned - prev.earned) / prev.earned : null
  const nowD = new Date()
  const elapsed = Math.max(0.12, (nowD.getDate() - 1 + nowD.getHours() / 24) / new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate())
  const lastEarned = series.length ? series[series.length - 1].earned : 0
  const livePace = lastEarned > 0 && elapsed < 0.97 ? lastEarned / elapsed : null
  const pace = isCurMonth ? livePace : null
  const hasExp = d.expenses.length > 0 || loaded.expenses === true
  const firstLoad = !loaded.core

  return (
    <div className="screen">
      <TopBar
        title="Пульс"
        sub={greeting() + (user && user.firstName ? ', ' + user.firstName : '')}
        avatar={user && user.photoUrl ? <Avatar name={user.firstName || 'R'} photo={user.photoUrl} /> : null}
      />

      {firstLoad ? <HomeSkeleton /> : (
        <div className="stagger">
          <div className="hero">
            <div className="hero-top">
              <span className="label" style={{ color: 'var(--text-2)' }}>Зароблено · {monthName}</span>
              {pace != null && <span className="pill acc"><Icon.sparkle style={{ width: 13 }} />темп ≈ {m.compact(pace)}/міс</span>}
              {delta != null && Math.abs(delta) >= 0.005 && (
                <span className={'pill ' + (delta >= 0 ? 'pos' : 'neg')}>{delta >= 0 ? <Icon.arrowUp style={{ width: 13 }} /> : <Icon.arrowDown style={{ width: 13 }} />}{Math.abs(Math.round(delta * 100))}% до {UA_MONTHS[(curMonthIdx + 11) % 12].toLowerCase().slice(0, 3)}</span>
              )}
            </div>
            <div className="hero-amount"><Money usd={cur.earned} fromZero /></div>
            <div className="hero-sub">
              {hasExp ? <>Витрати <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(cur.spent)}</b> · залишок <b className={'num ' + (cur.net >= 0 ? 'pos' : 'neg')}>{m.fmt(cur.net, { sign: 'always' })}</b></> : <>Оренда, робота й розробка разом</>}
            </div>
            <div className="hero-chart">
              {/* поточний місяць ще не закінчився: остання точка — прогноз за темпом, пунктиром */}
              <AreaChart values={series.map((s, i) => (i === series.length - 1 && livePace != null ? Math.max(s.earned, livePace) : s.earned))} dashedLast={livePace != null} height={96} onScrub={setScrub} />
              <div className="row" style={{ justifyContent: 'space-between', padding: '0 14px 10px', fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>
                {series.map((s, i) => <span key={s.key} style={{ color: i === idx ? 'var(--text)' : undefined }}>{s.label}</span>)}
              </div>
            </div>
          </div>

          <div className="grid-3" style={{ marginTop: 10 }}>
            {['rent', 'work', 'setup'].filter(k => k !== 'rent' || modules.rent).filter(k => k !== 'work' || modules.work).map(k => (
              <div className="kpi" key={k} style={{ padding: 12 }}>
                <div className="k-label"><span className="dot" style={{ background: STREAM[k].color }} />{STREAM[k].label}</div>
                <div className="k-value num" style={{ fontSize: 18 }}>{m.fmt(cur[k])}</div>
              </div>
            ))}
          </div>

          {modules.rent && <DueSection clients={d.clients} />}
          {modules.work && <WorkCard d={d} />}
          <ReportSection d={d} settings={settings} />
          <TrendSection d={d} mode={mode} rates={rates} />
          {(modules.goals || modules.assets) && <CapitalMini d={d} modules={modules} />}
        </div>
      )}
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="stack">
      <Skeleton h={210} r={26} />
      <div className="grid-3"><Skeleton h={70} r={18} /><Skeleton h={70} r={18} /><Skeleton h={70} r={18} /></div>
      <Skeleton h={22} w={160} style={{ marginTop: 18 }} />
      <div className="row"><Skeleton h={150} w={172} r={20} /><Skeleton h={150} w={172} r={20} /></div>
      <Skeleton h={120} r={20} style={{ marginTop: 10 }} />
    </div>
  )
}

function DueSection({ clients }) {
  const m = useMoney()
  const list = useMemo(() => clients
    .map(c => ({ c, st: statusOf(c), p: periodProgress(c) }))
    .sort((a, b) => a.st.days - b.st.days)
    .slice(0, 10), [clients])
  if (!clients.length) {
    return (
      <Section title="Найближчі оплати">
        <div className="card"><Empty icon={Icon.key} title="Ще немає орендарів" text="Додай першого — і тут зʼявляться дати оплат."
          action={<button className="btn primary sm" onClick={() => openSheet('clientForm')}><Icon.plus />Додати орендаря</button>} /></div>
      </Section>
    )
  }
  const dueCount = list.filter(x => x.st.days <= 0).length
  // прогноз надходжень: по місяцю від кожного, у кого дата оплати в найближчі 30 днів (або вже минула)
  const soon = clients.filter(c => statusOf(c).days <= 30)
  const expected = soon.reduce((s, c) => s + m.toUSD(c.rate, c.cur), 0)
  return (
    <Section title="Найближчі оплати" action={<button className="link" onClick={() => setTab('rent')}>Усі</button>}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        {dueCount > 0
          ? <span className="pill neg"><Icon.alert style={{ width: 13 }} />{dueCount} {plural(dueCount, 'оплата чекає', 'оплати чекають', 'оплат чекають')}</span>
          : <span className="pill pos"><Icon.check style={{ width: 13 }} />Прострочених немає</span>}
        {soon.length > 0 && <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>за 30 днів ≈ <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(expected)}</b></span>}
      </div>
      <div className="scroll-x">
        {list.map(({ c, st, p }) => (
          <div key={c.id} className="due-card pressable" onClick={() => { haptic.tap(); openSheet('client', { id: c.id }) }}>
            <div className="dc-top">
              <Ring value={p} size={38} stroke={4} color={LEVEL_COLOR[st.level]}>
                <span style={{ fontSize: 11, fontWeight: 800 }}>{st.days > 0 ? st.days : '!'}</span>
              </Ring>
              {c.payMode === 'postpaid' && <span className="pill neutral">пост</span>}
            </div>
            <div>
              <div className="dc-name">{c.name}</div>
              <div className="dc-amt num">{m.fmtFrom(c.rate, c.cur)}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: LEVEL_COLOR[st.level], marginTop: 2 }}>{nextPayText(st.days)}</div>
            </div>
            <button className={'btn ' + (st.days <= 3 ? 'primary' : '')} onClick={e => { e.stopPropagation(); haptic.tap(); openSheet('pay', { clientId: c.id }) }}>
              <Icon.check />Оплатив
            </button>
          </div>
        ))}
      </div>
    </Section>
  )
}

function WorkCard({ d }) {
  const m = useMoney()
  const rates = useStore(s => s.settings.rates)
  const key = monthKeyOf(today())
  const accrued = accruedUSDForMonth(d.workEntries, key, rates)
  const paid = paidUSDForMonth(d.payouts, key, rates)
  const hours = hoursForMonth(d.workEntries, key)
  const status = monthPayoutStatus(d.workEntries, d.payouts, key, rates)
  return (
    <Section title={'Робота · ' + UA_MONTHS[new Date().getMonth()]} action={<button className="link" onClick={() => setTab('work')}>Детально</button>}>
      <div className="card pressable" onClick={() => setTab('work')}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="label">Нараховано</div>
            <div className="display num" style={{ fontSize: 30, marginTop: 6 }}>{m.fmt(accrued)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={'pill ' + STATUS_PILL[status]}>{STATUS_LABEL[status]}</span>
            <div className="num" style={{ marginTop: 8, fontWeight: 650 }}>{Math.round(hours * 10) / 10} год</div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}><Bar value={accrued > 0 ? paid / accrued : 0} color="var(--pos)" /></div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, fontSize: 13 }}>
          <span className="muted">Виплачено <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(paid)}</b></span>
          <span className="muted">Залишок <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(Math.max(0, accrued - paid))}</b></span>
        </div>
      </div>
    </Section>
  )
}

const KIND_OPTS = [{ value: 'day', label: 'День' }, { value: 'week', label: 'Тиждень' }, { value: 'month', label: 'Місяць' }, { value: 'year', label: 'Рік' }]

function ReportSection({ d, settings }) {
  const m = useMoney()
  const { overview, workEarnedMode: mode, rates, modules } = settings
  const [openWork, setOpenWork] = useState(false)
  const { from, to } = periodBounds(overview.kind, overview.anchor)
  const s = periodSummary(d, from, to, mode, rates)
  const workCats = workByCategoryBetween(d.workEntries, d.payouts, d.workCategories, from, to, mode, rates)
  const exp = expensesByCategory(d.expenses, d.expenseCats, from, to, rates)
  const expLoaded = useStore(st => st.loaded.expenses)
  const isNow = isCurrentPeriod(overview.kind, overview.anchor)
  const streams = [
    modules.rent && { id: 'rent', label: 'Оренда', value: s.rent, color: STREAM.rent.color },
    modules.work && { id: 'work', label: 'Робота', value: s.work, color: STREAM.work.color },
    { id: 'setup', label: 'Розробка', value: s.setup, color: STREAM.setup.color },
  ].filter(Boolean)
  return (
    <Section title="Звіт" action={!isNow && <button className="link" onClick={() => setOverview({ anchor: toISO(today()) })}>Сьогодні</button>}>
      <Segmented options={KIND_OPTS} value={overview.kind} onChange={kind => setOverview({ kind })} />
      <div className="row" style={{ justifyContent: 'space-between', margin: '12px 0' }}>
        <button className="icon-btn" onClick={() => { haptic.select(); setOverview({ anchor: shiftAnchor(overview.kind, overview.anchor, -1) }) }} aria-label="Попередній період"><Icon.chevronLeft /></button>
        <label style={{ position: 'relative', fontWeight: 700, fontSize: 17 }}>
          {periodLabel(overview.kind, overview.anchor)}
          <input type="date" value={overview.anchor} onChange={e => e.target.value && setOverview({ anchor: e.target.value })}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%' }} aria-label="Обрати дату" />
        </label>
        <button className="icon-btn" onClick={() => { haptic.select(); setOverview({ anchor: shiftAnchor(overview.kind, overview.anchor, 1) }) }} aria-label="Наступний період"><Icon.chevronRight /></button>
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="label">Залишок</div>
            <div className={'display num ' + (s.net >= 0 ? '' : 'neg')} style={{ fontSize: 34, marginTop: 6 }}><Money usd={s.net} sign="always" /></div>
          </div>
          {modules.work && (
            <Segmented small value={mode} onChange={setWorkMode} options={[{ value: 'accrued', label: 'Нараховане' }, { value: 'paid', label: 'Виплачене' }]} />
          )}
        </div>
        <div className="grid-2" style={{ marginTop: 14 }}>
          <div className="kpi" style={{ background: 'var(--pos-soft)', borderColor: 'transparent' }}>
            <div className="k-label" style={{ color: 'var(--pos)' }}><Icon.arrowUp style={{ width: 14 }} />Зароблено</div>
            <div className="k-value num">{m.fmt(s.earned)}</div>
          </div>
          <div className="kpi" style={{ background: 'var(--neg-soft)', borderColor: 'transparent' }}>
            <div className="k-label" style={{ color: 'var(--neg)' }}><Icon.arrowDown style={{ width: 14 }} />Витрачено</div>
            <div className="k-value num">{m.fmt(s.spent)}</div>
          </div>
        </div>
        <div className="divider" />
        <div className="label" style={{ marginBottom: 12 }}>Доходи</div>
        {s.earned > 0 ? (
          <>
            <ShareBars items={streams} total={s.earned} format={v => m.fmt(v)} />
            {modules.work && workCats.length > 0 && (
              <button className="text-btn" style={{ marginTop: 6 }} onClick={() => { haptic.select(); setOpenWork(v => !v) }}>
                {openWork ? 'Сховати категорії роботи' : 'Робота за категоріями'}
              </button>
            )}
            {openWork && (
              <div className="stack" style={{ gap: 0, marginTop: 4 }}>
                {workCats.map(c => (
                  <div className="kv" key={c.id}><span className="k">{c.name}{c.hours > 0 ? ` · ${Math.round(c.hours * 10) / 10} год` : ''}</span><span className="v">{m.fmt(c.usd)}</span></div>
                ))}
              </div>
            )}
          </>
        ) : <div className="muted" style={{ fontSize: 14 }}>За цей період надходжень не було</div>}
        <div className="divider" />
        <div className="label" style={{ marginBottom: 12 }}>Витрати за категоріями</div>
        {expLoaded === 'error' ? <div className="muted" style={{ fontSize: 14 }}>База витрат (Expense·Control) недоступна</div>
          : exp.length ? <ShareBars items={exp.slice(0, 8).map((e, i) => ({ id: e.id, label: e.name, value: e.usd, color: PALETTE[(i + 3) % PALETTE.length] }))} total={s.spent} format={v => m.fmt(v)} />
            : <div className="muted" style={{ fontSize: 14 }}>За цей період витрат не було</div>}
      </div>
    </Section>
  )
}

function TrendSection({ d, mode, rates }) {
  const m = useMoney()
  const modules = useStore(s => s.settings.modules)
  const data = useMemo(() => monthlySeries(d, 12, mode, rates), [d, mode, rates])
  const [sel, setSel] = useState(null)
  const has = data.some(x => x.earned > 0 || x.spent > 0)
  const shown = sel != null ? data[sel] : null
  const series = [
    modules.rent && { key: 'rent', color: STREAM.rent.color },
    modules.work && { key: 'work', color: STREAM.work.color },
    { key: 'setup', color: STREAM.setup.color },
  ].filter(Boolean)
  const avg = data.reduce((s, x) => s + x.earned, 0) / data.length
  return (
    <Section title="Тренд за рік">
      <div className="card">
        {has ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
              <div>
                <div className="label">{shown ? shown.label + ' · зароблено' : 'В середньому за місяць'}</div>
                <div className="display num" style={{ fontSize: 26, marginTop: 6 }}>{m.fmt(shown ? shown.earned : avg)}</div>
              </div>
              {shown && <div style={{ textAlign: 'right', fontSize: 13 }} className="muted">витрати <b className="num neg">{m.fmt(shown.spent)}</b></div>}
            </div>
            <MonthBars data={data} series={series} selected={sel} onSelect={setSel} expenseKey="spent" />
            <div className="legend">
              {series.map(s => <span key={s.key}><i className="dot" style={{ background: s.color }} />{STREAM[s.key].label}</span>)}
              <span><i style={{ width: 12, height: 2.5, borderRadius: 2, background: 'var(--neg)', display: 'inline-block' }} />Витрати</span>
            </div>
          </>
        ) : <div className="muted" style={{ fontSize: 14, padding: '6px 0' }}>Щойно зʼявляться оплати чи робота — тут буде графік по місяцях.</div>}
      </div>
    </Section>
  )
}

function CapitalMini({ d, modules }) {
  const m = useMoney()
  const goalsSaved = d.goals.filter(g => g.status !== 'closed').reduce((s, g) => s + m.toUSD(g.saved, g.cur), 0)
  const active = d.goals.filter(g => g.status === 'active').sort((a, b) => b.pct - a.pct)[0]
  const value = d.assets.reduce((s, a) => s + a.valueUSD, 0)
  const pnl = d.assets.reduce((s, a) => s + a.pnlUSD, 0)
  return (
    <Section title="Капітал" action={<button className="link" onClick={() => setTab('capital')}>Відкрити</button>}>
      <div className="grid-2">
        {modules.goals && (
          <div className="kpi pressable" onClick={() => setTab('capital')}>
            <div className="k-label"><Icon.target style={{ width: 15 }} />На цілях</div>
            <div className="k-value num">{m.fmt(goalsSaved)}</div>
            {active ? <div style={{ marginTop: 10 }}><Bar thin value={active.pct} /><div className="k-sub ellipsis">{active.icon} {active.name} · {Math.round(active.pct * 100)}%</div></div> : <div className="k-sub">Цілей ще немає</div>}
          </div>
        )}
        {modules.assets && (
          <div className="kpi pressable" onClick={() => setTab('capital')}>
            <div className="k-label"><Icon.coins style={{ width: 15 }} />Портфель</div>
            <div className="k-value num">{m.fmt(value)}</div>
            <div className={'k-sub num ' + (pnl >= 0 ? 'pos' : 'neg')} style={{ fontWeight: 600 }}>{m.fmt(pnl, { sign: 'always' })}</div>
          </div>
        )}
      </div>
    </Section>
  )
}
