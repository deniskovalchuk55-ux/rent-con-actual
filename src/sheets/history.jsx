// Історія операцій банків і бірж (база «Рух коштів» у Notion): по місяцях, з підсумками й графіком за рік.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Sheet } from '../ui/sheet.jsx'
import { useStore } from '../state/store.js'
import { useMoney } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Chips, Empty, IconTile } from '../ui/kit.jsx'
import { MonthBars } from '../ui/charts.jsx'
import { haptic } from '../lib/telegram.js'
import { ledgerReady, enableHistory, runBackfill } from '../state/finance.js'
import { monthlyFlows, flowSummary, groupByDay, ledgerAccounts, rowUSD, timeOf, searchLedger, recurringPayments } from '../lib/domain/ledger.js'
import { CG_IDS } from '../lib/domain/finance.js'
import { fmtQty } from '../lib/domain/capital.js'
import { fmtRelDay, fmtDateShort, monthKeyOf, monthKeyLabel, shiftMonthKey, parseDate } from '../lib/dates.js'

const FIAT = new Set(['USD', 'UAH', 'PLN', 'EUR', 'GBP', 'CHF', 'CZK'])
const KIND_ICON = {
  income: [Icon.arrowDown, 'var(--pos)', 'var(--pos-soft)'],
  expense: [Icon.wallet, 'var(--text)', 'var(--card-3)'],
  transfer: [Icon.repeat, 'var(--blue)', 'var(--blue-soft)'],
  cash: [Icon.coins, 'var(--warn)', 'var(--warn-soft)'],
  deposit: [Icon.download, 'var(--pos)', 'var(--pos-soft)'],
  withdrawal: [Icon.upload, 'var(--neg)', 'var(--neg-soft)'],
}

const hhmm = iso => {
  if (!/T\d/.test(String(iso))) return ''
  const d = new Date(iso)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function Amount({ r }) {
  const m = useMoney()
  const sign = r.amount > 0 ? '+' : '−'
  const abs = Math.abs(r.amount)
  const text = FIAT.has(r.currency) ? m.native(abs, r.currency) : fmtQty(abs) + ' ' + r.currency
  return <div className={'amount ' + (r.amount > 0 ? 'pos' : '')}>{sign}{text}</div>
}

export function HistorySheet({ sheetId, closing, source: initialSource }) {
  const rows = useStore(s => s.data.ledger)
  const loaded = useStore(s => s.loaded.ledger)
  const fin = useStore(s => s.finance)
  const rates = useStore(s => s.settings.rates)
  const m = useMoney()
  const nowKey = monthKeyOf(new Date())
  const [source, setSource] = useState(initialSource || 'all')
  const [month, setMonth] = useState(nowKey)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const ready = ledgerReady(fin.status)

  const coinPrice = c => { const meta = fin.coinMeta[CG_IDS[c]]; return meta && meta.price ? meta.price : null }
  const accounts = useMemo(() => ledgerAccounts(rows), [rows])
  const series = useMemo(() => monthlyFlows(rows, 12, rates, coinPrice, { source }), [rows, rates, source, fin.coinMeta])
  const [y, mo] = month.split('-').map(Number)
  const from = new Date(y, mo - 1, 1).getTime()
  const to = new Date(y, mo, 1).getTime()
  const sum = flowSummary(rows, from, to, rates, coinPrice, { source })
  const found = useMemo(() => (q.trim() ? searchLedger(rows, q, source) : null), [rows, q, source])
  const days = found ? groupByDay(found, 0, Infinity, 'all') : groupByDay(rows, from, to, source)
  const foundSum = found ? found.reduce((acc, r) => { const v = rowUSD(r, rates, coinPrice); if (v >= 0) acc.in += v; else acc.out -= v; return acc }, { in: 0, out: 0 }) : null
  const selIdx = series.findIndex(x => x.key === month)
  const bf = fin.backfill
  const go = delta => { haptic.select(); setMonth(k => { const n = shiftMonthKey(k, delta); return n > nowKey ? k : n }) }
  // вибраний рахунок може бути далеко праворуч у стрічці — показуємо його
  const chipsRef = useRef(null)
  useEffect(() => {
    const el = chipsRef.current && chipsRef.current.querySelector('.chip.on')
    if (el && el.scrollIntoView) el.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [source, accounts.length])

  if (!ready) {
    return (
      <Sheet sheetId={sheetId} closing={closing} title="Історія">
        <div className="card">
          <Empty icon={Icon.chart} title="Історія й аналітика по місяцях"
            text="Кожна операція Монобанку й кожне поповнення чи виведення на біржах зберігатиметься в Notion, у новій базі «Рух коштів». Минулі місяці підтягнуться у фоні."
            action={<button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await enableHistory(); setBusy(false) }}><Icon.check />{busy ? 'Вмикаю…' : 'Увімкнути'}</button>} />
        </div>
      </Sheet>
    )
  }

  const breakdown = [
    { label: 'Покупки карткою', v: sum.expense, sign: '−' },
    { label: 'Перекази', v: sum.transferOut, sign: '−' },
    { label: 'Перекази на рахунок', v: sum.transferIn, sign: '+' },
    { label: 'Готівка', v: sum.cash, sign: '−' },
    { label: 'Поповнення бірж', v: sum.deposit, sign: '+' },
    { label: 'Виведення з бірж', v: sum.withdrawal, sign: '−' },
  ].filter(x => x.v > 0.005)

  return (
    <Sheet sheetId={sheetId} closing={closing} title="Історія">
      {accounts.length > 1 && (
        <div style={{ marginBottom: 12 }} ref={chipsRef}>
          <Chips items={[{ value: 'all', label: 'Усе' }, ...accounts.map(a => ({ value: a, label: a }))]} value={source} onChange={setSource} />
        </div>
      )}

      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Icon.search style={{ position: 'absolute', left: 14, top: 14, width: 20, color: 'var(--text-3)' }} />
        <input className="input" style={{ paddingLeft: 44, paddingRight: q ? 44 : 14, height: 48 }} placeholder="Пошук: назва, сума, коментар" value={q} onChange={e => setQ(e.target.value)} aria-label="Пошук в історії" />
        {q && <button className="icon-btn" style={{ position: 'absolute', right: 6, top: 6, width: 36, height: 36 }} onClick={() => setQ('')} aria-label="Очистити пошук"><Icon.close /></button>}
      </div>

      {found && (
        <div className="card row" style={{ justifyContent: 'space-between', padding: '12px 14px', marginBottom: 4 }}>
          <span className="muted" style={{ fontSize: 14 }}>Знайдено {found.length} за {rows.length ? 'рік' : 'період'}</span>
          <span className="num" style={{ fontSize: 14, fontWeight: 650 }}>{foundSum.in > 0.005 && <span className="pos">+{m.fmt(foundSum.in)} </span>}{foundSum.out > 0.005 && <>−{m.fmt(foundSum.out)}</>}</span>
        </div>
      )}

      {!found && bf && (bf.running || bf.error) && (
        <div className="card row" style={{ gap: 10, marginBottom: 12, padding: '12px 14px' }}>
          <Icon.refresh className={bf.running ? 'spin' : ''} style={{ width: 16, color: 'var(--text-2)', flexShrink: 0 }} />
          <div className="muted" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>
            {bf.running
              ? <>Підтягую минулі місяці: <b>{bf.label}</b>{bf.mins > 1 ? <> · ще ~{bf.mins} хв. Монобанк віддає одну виписку на хвилину, тож тримай застосунок відкритим або зайди пізніше — продовжу з того ж місця.</> : null}</>
              : <span style={{ color: 'var(--text)' }}>Минулі місяці не підтягнулись: {bf.error}</span>}
          </div>
          {!bf.running && <button className="link" onClick={() => enableHistory()}>Ще раз</button>}
        </div>
      )}

      {!found && <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <button className="icon-btn" onClick={() => go(-1)} aria-label="Попередній місяць"><Icon.chevronLeft /></button>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{monthKeyLabel(month)}</div>
          <button className="icon-btn" onClick={() => go(1)} disabled={month >= nowKey} aria-label="Наступний місяць"><Icon.chevronRight /></button>
        </div>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <div className="kpi" style={{ background: 'var(--pos-soft)', borderColor: 'transparent' }}>
            <div className="k-label" style={{ color: 'var(--pos)' }}><Icon.arrowDown style={{ width: 14 }} />Надійшло</div>
            <div className="k-value num">{m.fmt(sum.in)}</div>
          </div>
          <div className="kpi" style={{ background: 'var(--neg-soft)', borderColor: 'transparent' }}>
            <div className="k-label" style={{ color: 'var(--neg)' }}><Icon.arrowUp style={{ width: 14 }} />Пішло</div>
            <div className="k-value num">{m.fmt(sum.out)}</div>
          </div>
        </div>
        {breakdown.length > 0 && (
          <div className="stack" style={{ gap: 0, marginTop: 10 }}>
            {breakdown.map(x => <div className="kv" key={x.label}><span className="k">{x.label}</span><span className="v num">{x.sign}{m.fmt(x.v)}</span></div>)}
          </div>
        )}
        <div className="divider" />
        <div className="label" style={{ marginBottom: 10 }}>По місяцях</div>
        <MonthBars data={series} series={[{ key: 'in', color: 'var(--pos)' }]} expenseKey="out" selected={selIdx >= 0 ? selIdx : null}
          onSelect={i => { if (i != null) setMonth(series[i].key) }} />
        <div className="legend">
          <span><i className="dot" style={{ background: 'var(--pos)' }} />Надійшло</span>
          <span><i style={{ width: 12, height: 2.5, borderRadius: 2, background: 'var(--neg)', display: 'inline-block' }} />Пішло</span>
        </div>
      </div>}

      {loaded !== true && !rows.length ? (
        <div className="stack" style={{ marginTop: 14 }}>{[0, 1, 2].map(i => <div key={i} className="sk" style={{ height: 58, borderRadius: 16 }} />)}</div>
      ) : days.length ? days.map(g => (
        <div key={g.day} style={{ marginTop: 16 }}>
          <div className="label" style={{ margin: '0 4px 8px' }}>{fmtRelDay(parseDate(g.day))}</div>
          <div className="list">
            {g.items.map(r => {
              const [Ic, color, bg] = KIND_ICON[r.kind] || KIND_ICON.expense
              const usd = rowUSD(r, rates, coinPrice)
              const meta = [hhmm(r.date), source === 'all' ? r.account : '', r.note].filter(Boolean).join(' · ')
              return (
                <div key={r.id} className="list-row static">
                  <IconTile icon={Ic} color={color} bg={bg} />
                  <div className="main">
                    <div className="title ellipsis">{r.title}</div>
                    {meta && <div className="meta ellipsis">{meta}</div>}
                  </div>
                  <div className="end">
                    <Amount r={r} />
                    {r.currency !== m.display && usd !== 0 && <div className="meta num">{m.fmt(Math.abs(usd))}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )) : (
        <div className="card" style={{ marginTop: 14 }}>
          {found ? <Empty icon={Icon.search} title="Нічого не знайдено" text="Спробуй іншу назву або суму." />
            : <Empty icon={Icon.list} title="Операцій немає" text={bf && bf.running && month < nowKey ? 'Цей місяць ще підтягується з банку.' : 'За цей місяць тут нічого не записано.'} />}
        </div>
      )}
      <div style={{ height: 6 }} />
    </Sheet>
  )
}

/* ===== Регулярні платежі: підписки, звʼязок, щомісячні перекази ===== */
export function RecurringSheet({ sheetId, closing }) {
  const rows = useStore(s => s.data.ledger)
  const rates = useStore(s => s.settings.rates)
  const m = useMoney()
  const list = useMemo(() => recurringPayments(rows, rates), [rows, rates])
  const total = list.reduce((acc, x) => acc + x.usd, 0)
  const upcoming = [...list].sort((a, b) => a.nextDate - b.nextDate)
  const manyAccounts = new Set(list.map(x => x.account)).size > 1
  const changed = list.filter(x => x.change)
  const amt = (a, cur) => (FIAT.has(cur) ? m.native(a, cur) : fmtQty(a) + ' ' + cur)
  return (
    <Sheet sheetId={sheetId} closing={closing} title="Регулярні платежі">
      {list.length ? (
        <>
          <div className="card">
            <div className="label">Щомісяця приблизно</div>
            <div className="display num" style={{ fontSize: 34, marginTop: 6 }}>{m.fmt(total)}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{list.length} {list.length === 1 ? 'платіж' : list.length < 5 ? 'платежі' : 'платежів'} · за рік ≈ {m.fmt(total * 12)}</div>
            {changed.map(x => (
              <div key={'c' + x.key} className="price-change">
                {x.change.pct > 0 ? <Icon.arrowUp /> : <Icon.arrowDown />}
                <span><b>{x.title}</b> {x.change.pct > 0 ? 'подорожчав' : 'подешевшав'}: {amt(x.change.from, x.currency)} → {amt(x.change.to, x.currency)} <span className="num">({x.change.pct > 0 ? '+' : '−'}{Math.round(Math.abs(x.change.pct) * 100)}%)</span></span>
              </div>
            ))}
          </div>
          <div className="label" style={{ margin: '18px 4px 8px' }}>Найближчі списання</div>
          <div className="list">
            {upcoming.map(x => {
              const Ic = x.kind === 'transfer' ? Icon.repeat : Icon.wallet
              return (
                <div key={x.key + x.currency} className="list-row static">
                  <IconTile icon={Ic} color={x.kind === 'transfer' ? 'var(--blue)' : 'var(--text)'} bg={x.kind === 'transfer' ? 'var(--blue-soft)' : 'var(--card-3)'} />
                  <div className="main">
                    <div className="title ellipsis">{x.title}</div>
                    <div className="meta ellipsis">наступне {fmtDateShort(new Date(x.nextDate))}{x.nextDate < Date.now() ? ' (мало бути)' : ''} · ~{x.day}-го{manyAccounts ? ' · ' + x.account : ''}</div>
                  </div>
                  <div className="end">
                    <div className="amount">−{amt(x.amount, x.currency)}</div>
                    {x.change
                      ? <div className="meta num" style={{ color: x.change.pct > 0 ? 'var(--warn)' : 'var(--pos)' }}>було {amt(x.change.from, x.currency)}</div>
                      : x.currency !== m.display && <div className="meta num">{m.fmt(x.usd)}</div>}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="muted" style={{ fontSize: 12.5, margin: '12px 4px 6px', lineHeight: 1.45 }}>Знаходжу в історії те, що списувалось щонайменше три місяці приблизно на ту саму суму. Покупки, які трапляються кілька разів на місяць, сюди не потрапляють.</div>
        </>
      ) : (
        <div className="card"><Empty icon={Icon.repeat} title="Поки не видно" text="Потрібна історія щонайменше за три місяці — тоді тут зʼявляться підписки, звʼязок і щомісячні перекази." /></div>
      )}
    </Sheet>
  )
}
