// Вікна капіталу: ціль, форма цілі, внесок/зняття, новий рівень; монета, пошук монет, покупка/продаж.
import { useEffect, useRef, useState } from 'react'
import { useDerived, useStore } from '../state/store.js'
import { openSheet, closeSheet, closeAllSheets, replaceSheet, toast } from '../state/ui.js'
import { saveGoal, deleteGoal, addGoalTx, deleteGoalTx, levelUpGoal, setGoalStatus, addAssetWithTx, addAssetTx, deleteAssetTx, deleteAsset } from '../state/actions.js'
import { useMoney } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Sheet, burstConfetti } from '../ui/sheet.jsx'
import { Field, TextInput, AmountInput, DateInput, Segmented, Empty, Ring, KV, Bar, Chips } from '../ui/kit.jsx'
import { AreaChart } from '../ui/charts.jsx'
import { CoinIcon } from '../screens/Capital.jsx'
import { deadlineInfo, goalForecast, fmtQty, fmtPriceUSD } from '../lib/domain/capital.js'
import { cgHistory, cgSearch } from '../lib/notion/api.js'
import { fmtDate, today, toISO } from '../lib/dates.js'
import { parseAmount, formatMoney, convert } from '../lib/money.js'
import { haptic } from '../lib/telegram.js'

const num = v => String(v ?? '').replace('.', ',')

export function GoalSheet({ sheetId, closing, id }) {
  const d = useDerived()
  const m = useMoney()
  const g = d.goals.find(x => x.id === id)
  if (!g) return <Sheet sheetId={sheetId} closing={closing} title="Ціль"><Empty title="Ціль не знайдено" /></Sheet>
  const done = g.status === 'completed' || g.pct >= 1
  const closed = g.status === 'closed'
  const dl = deadlineInfo(g)
  const fc = goalForecast(g)
  return (
    <Sheet sheetId={sheetId} closing={closing} title={g.icon + ' ' + g.name}
      headerRight={<button className="icon-btn" onClick={() => openSheet('goalForm', { id: g.id })} aria-label="Редагувати"><Icon.edit /></button>}
      footer={closed ? (
        <button className="btn" onClick={() => setGoalStatus(g.id, done ? 'completed' : 'active')}>Відкрити ціль знову</button>
      ) : done ? (
        <div className="btn-row">
          <button className="btn" onClick={() => openSheet('confirm', { title: 'Закрити ціль?', text: 'Це означає, що гроші витрачено. Сума перестане рахуватися в «Відкладено».', confirmText: 'Закрити', onConfirm: () => setGoalStatus(g.id, 'closed') })}>Закрити ціль</button>
          <button className="btn primary" onClick={() => openSheet('levelUp', { id: g.id })}><Icon.trophy />Новий рівень</button>
        </div>
      ) : (
        <div className="btn-row">
          <button className="btn" disabled={g.saved <= 0} onClick={() => openSheet('goalTx', { id: g.id, type: 'take' })}><Icon.minus />Забрати</button>
          <button className="btn primary" onClick={() => openSheet('goalTx', { id: g.id, type: 'add' })}><Icon.plus />Додати</button>
        </div>
      )}>
      <div style={{ display: 'grid', placeItems: 'center', margin: '6px 0 16px' }}>
        <Ring value={g.pct} size={168} stroke={12} color={done ? 'var(--pos)' : 'var(--accent)'}>
          <div>
            <div style={{ fontSize: 30, lineHeight: 1 }}>{g.icon}</div>
            <div className="display num" style={{ fontSize: 32, marginTop: 6 }}>{Math.round(g.pct * 100)}%</div>
          </div>
        </Ring>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div className="display num" style={{ fontSize: 28 }}>{m.fmtFrom(g.saved, g.cur)}</div>
        <div className="muted" style={{ marginTop: 4 }}>з {m.fmtFrom(g.target, g.cur)}{!done ? ' · лишилось ' + m.fmtFrom(Math.max(0, g.target - g.saved), g.cur) : ''}</div>
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {closed && <span className="pill neutral">закрита</span>}
        {done && !closed && <span className="pill pos"><Icon.check style={{ width: 13 }} />виконана</span>}
        {dl && !done && <span className={'pill ' + (dl.days < 0 ? 'neg' : dl.days < 14 ? 'warn' : 'neutral')}>{dl.text}</span>}
      </div>
      {fc && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row">
            <div className="icon-tile" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}><Icon.sparkle /></div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
              У середньому відкладаєш <b className="num">{m.fmtFrom(fc.perMonth, g.cur)}</b> на місяць. Таким темпом досягнеш цілі <b>{fmtDate(fc.eta)}</b>.
            </div>
          </div>
        </div>
      )}
      {g.levels && g.levels.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="label" style={{ marginBottom: 10 }}>Пройдені рівні</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {g.levels.map((l, i) => <span key={i} className="pill acc"><Icon.trophy style={{ width: 13 }} />{m.fmtFrom(l, g.cur)}</span>)}
            <span className="pill neutral">зараз {m.fmtFrom(g.target, g.cur)}</span>
          </div>
        </div>
      )}
      <div className="section" style={{ marginTop: 20 }}>
        <div className="section-head"><h2>Історія</h2><span className="faint num">{g.transactions.length}</span></div>
        {g.transactions.length ? (
          <div className="list">
            {g.transactions.map(t => (
              <div key={t.id} className="list-row no-avatar">
                <div className="main">
                  <div className={'title num ' + (t.type === 'add' ? 'pos' : 'neg')}>{t.type === 'add' ? '+' : '−'}{m.fmtFrom(t.amount, t.cur)}</div>
                  <div className="meta">{fmtDate(t.date)} · {t.type === 'add' ? 'додано' : t.type === 'take' ? 'забрано' : 'витрачено'}{t.note ? ' · ' + t.note : ''}</div>
                </div>
                <button className="icon-btn" style={{ width: 36, height: 36, background: 'transparent', borderColor: 'transparent', color: 'var(--text-3)' }} onClick={() => deleteGoalTx(t.id)} aria-label="Видалити"><Icon.trash /></button>
              </div>
            ))}
          </div>
        ) : <div className="card muted" style={{ fontSize: 14 }}>Ще нічого не відкладено</div>}
      </div>
    </Sheet>
  )
}

const EMOJI = ['🎯', '💻', '📱', '🚗', '🏠', '✈️', '🏝️', '🎓', '💍', '🛡️', '🏋️', '🎸', '📷', '🐶', '👶', '🛋️', '⌚', '🎮', '🚲', '💰']

export function GoalFormSheet({ sheetId, closing, id }) {
  const d = useDerived()
  const display = useStore(s => s.settings.display)
  const editing = id ? d.goals.find(g => g.id === id) : null
  const [icon, setIcon] = useState(editing ? editing.icon : '🎯')
  const [name, setName] = useState(editing ? editing.name : '')
  const [target, setTarget] = useState(editing ? num(editing.target) : '')
  const [cur, setCur] = useState(editing ? editing.cur : display)
  const [start, setStart] = useState(editing ? editing.start : toISO(today()))
  const [deadline, setDeadline] = useState(editing ? editing.deadline || '' : '')
  const [err, setErr] = useState('')
  const save = () => {
    const t = parseAmount(target)
    if (!name.trim()) return setErr('Вкажи назву')
    if (!(t > 0)) return setErr('Вкажи суму цілі')
    saveGoal({ ...(editing ? { id: editing.id } : {}), icon: icon || '🎯', name: name.trim(), target: t, cur, start, deadline: deadline || null })
    toast(editing ? 'Ціль оновлено' : 'Ціль створено', { kind: 'success' })
    closeSheet(sheetId)
  }
  return (
    <Sheet sheetId={sheetId} closing={closing} title={editing ? 'Редагувати ціль' : 'Нова ціль'} footer={<button className="btn primary" onClick={save}>{editing ? 'Зберегти' : 'Створити ціль'}</button>}>
      <Field label="Іконка">
        <div className="no-drag" style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
          {EMOJI.map(e => (
            <button key={e} type="button" onClick={() => { haptic.select(); setIcon(e) }}
              style={{ aspectRatio: '1', borderRadius: 12, fontSize: 20, background: icon === e ? 'var(--accent-soft)' : 'var(--card)', border: '1px solid ' + (icon === e ? 'var(--accent)' : 'var(--line)') }}>{e}</button>
          ))}
        </div>
      </Field>
      <Field label="Назва"><TextInput value={name} onChange={setName} placeholder="Новий ноутбук" autoFocus={!editing} /></Field>
      <Field label="Потрібна сума"><AmountInput value={target} onChange={setTarget} cur={cur} onCur={setCur} placeholder="1500" /></Field>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <Field label="Старт"><DateInput value={start} onChange={setStart} /></Field>
        <Field label="Дедлайн"><DateInput value={deadline} onChange={setDeadline} /></Field>
      </div>
      {err && <div className="pill neg" style={{ marginTop: 12, height: 'auto', padding: '8px 12px' }}>{err}</div>}
      {editing && <button className="btn danger" style={{ marginTop: 18 }} onClick={() => openSheet('confirm', {
        title: 'Видалити ціль?', text: 'Разом з історією внесків.', confirmText: 'Видалити', danger: true,
        onConfirm: () => { deleteGoal(editing.id); closeAllSheets() },
      })}><Icon.trash />Видалити ціль</button>}
    </Sheet>
  )
}

export function GoalTxSheet({ sheetId, closing, id, type = 'add' }) {
  const d = useDerived()
  const m = useMoney()
  const g = d.goals.find(x => x.id === id)
  const [amount, setAmount] = useState('')
  const [cur, setCur] = useState(g ? g.cur : 'USD')
  const [date, setDate] = useState(toISO(today()))
  const [note, setNote] = useState('')
  if (!g) return <Sheet sheetId={sheetId} closing={closing} title="Ціль"><Empty title="Ціль не знайдено" /></Sheet>
  const a = parseAmount(amount) || 0
  const deltaNative = m.convert(a, cur, g.cur)
  const remaining = Math.max(0, g.target - g.saved)
  const after = type === 'add' ? g.saved + deltaNative : Math.max(0, g.saved - deltaNative)
  const hintMax = type === 'add' ? remaining : g.saved
  const save = () => {
    if (!(a > 0)) return
    if (type === 'take' && deltaNative > g.saved + 0.005) { toast('Не можна забрати більше, ніж відкладено', { kind: 'error' }); return }
    const res = addGoalTx(g.id, { amount: a, cur, date, type, note: note.trim() }, { savedAfterNative: after, target: g.target })
    if (res === 'completed') { burstConfetti(); toast('🎉 Ціль виконана!', { kind: 'success', duration: 3500 }) }
    else toast(type === 'add' ? 'Відкладено ' + formatMoney(a, cur) : 'Забрано ' + formatMoney(a, cur), { kind: 'success' })
    closeSheet(sheetId)
  }
  return (
    <Sheet sheetId={sheetId} closing={closing} title={(type === 'add' ? 'Додати · ' : 'Забрати · ') + g.name}
      footer={<button className={'btn ' + (type === 'add' ? 'primary' : 'danger')} disabled={!(a > 0)} onClick={save}>{type === 'add' ? <><Icon.plus />Відкласти</> : <><Icon.minus />Забрати</>}</button>}>
      <Field label="Сума" hint={(type === 'add' ? 'До цілі лишилось ' : 'Максимум ') + m.fmtFrom(hintMax, g.cur)}><AmountInput value={amount} onChange={setAmount} cur={cur} onCur={setCur} autoFocus /></Field>
      {type === 'add' && remaining > 0 && <div className="chips" style={{ marginTop: 10 }}>
        {[0.1, 0.25, 0.5, 1].map(f => { const v = Math.round(m.convert(remaining * f, g.cur, cur) * 100) / 100; return <button key={f} className="chip" onClick={() => { haptic.select(); setAmount(num(v)) }}>{f === 1 ? 'Увесь залишок' : Math.round(f * 100) + '%'}</button> })}
      </div>}
      <Field label="Дата"><DateInput value={date} onChange={setDate} /></Field>
      <Field label="Опис"><TextInput value={note} onChange={setNote} placeholder="напр. із зарплати за червень" /></Field>
      <div className="preview">
        Буде на цілі<span className="big num">{formatMoney(after, g.cur)}</span>
        <div style={{ marginTop: 10 }}><Bar value={g.target > 0 ? after / g.target : 0} color={after >= g.target ? 'var(--pos)' : 'var(--accent)'} /></div>
      </div>
    </Sheet>
  )
}

export function LevelUpSheet({ sheetId, closing, id }) {
  const d = useDerived()
  const g = d.goals.find(x => x.id === id)
  const [val, setVal] = useState(g ? num(Math.round(g.target * 2)) : '')
  if (!g) return <Sheet sheetId={sheetId} closing={closing} title="Новий рівень"><Empty title="Ціль не знайдено" /></Sheet>
  const v = parseAmount(val) || 0
  const save = () => {
    if (!(v > g.target)) { toast('Нова ціль має бути більшою за поточну', { kind: 'error' }); return }
    levelUpGoal(g.id, v)
    burstConfetti()
    toast('🏆 Новий рівень: ' + formatMoney(v, g.cur), { kind: 'success' })
    closeSheet(sheetId)
  }
  return (
    <Sheet sheetId={sheetId} closing={closing} title="Новий рівень цілі" footer={<button className="btn primary" disabled={!(v > g.target)} onClick={save}><Icon.trophy />Підняти ціль</button>}>
      <div className="muted" style={{ textAlign: 'center' }}>Поточна ціль {formatMoney(g.target, g.cur)} досягнута. Ставимо нову планку?</div>
      <input className="big-input num" inputMode="decimal" value={val} onChange={e => setVal(e.target.value.replace(/[^0-9.,]/g, ''))} aria-label="Нова сума цілі" style={{ marginTop: 12 }} />
      <div style={{ textAlign: 'center', color: 'var(--text-2)', fontWeight: 600 }}>{g.cur}</div>
      <div className="chips" style={{ justifyContent: 'center', marginTop: 14 }}>
        {[1.5, 2, 3, 5].map(k => <button key={k} className="chip" onClick={() => { haptic.select(); setVal(num(Math.round(g.target * k))) }}>×{num(k)}</button>)}
      </div>
    </Sheet>
  )
}

export function PickGoalSheet({ sheetId, closing }) {
  const d = useDerived()
  const m = useMoney()
  const goals = d.goals.filter(g => g.status === 'active')
  return (
    <Sheet sheetId={sheetId} closing={closing} title="На яку ціль?">
      {goals.length ? (
        <div className="list">
          {goals.map(g => (
            <button key={g.id} className="list-row" onClick={() => replaceSheet('goalTx', { id: g.id, type: 'add' })}>
              <Ring value={g.pct} size={44} stroke={4}><span style={{ fontSize: 18 }}>{g.icon}</span></Ring>
              <div className="main"><div className="title">{g.name}</div><div className="meta num">{m.fmtFrom(g.saved, g.cur)} з {m.fmtFrom(g.target, g.cur)}</div></div>
              <Icon.chevronRight className="chev" />
            </button>
          ))}
        </div>
      ) : <Empty icon={Icon.target} title="Активних цілей немає" action={<button className="btn primary sm" onClick={() => replaceSheet('goalForm', {})}><Icon.plus />Нова ціль</button>} />}
    </Sheet>
  )
}

/* ===== Активи ===== */
const RANGES = [{ value: 7, label: '7д' }, { value: 30, label: '30д' }, { value: 90, label: '90д' }, { value: 365, label: '1р' }]

export function AssetSheet({ sheetId, closing, id }) {
  const d = useDerived()
  const m = useMoney()
  const a = d.assets.find(x => x.id === id)
  const [days, setDays] = useState(30)
  const [hist, setHist] = useState(null)
  const [scrub, setScrub] = useState(null)
  useEffect(() => {
    if (!a || !a.cgId) return
    let off = false
    setHist(null)
    cgHistory(a.cgId, days).then(h => !off && setHist(h)).catch(() => !off && setHist([]))
    return () => { off = true }
  }, [a && a.cgId, days])
  if (!a) return <Sheet sheetId={sheetId} closing={closing} title="Актив"><Empty title="Актив не знайдено" /></Sheet>
  const prices = hist ? hist.map(p => p[1]) : []
  const shown = scrub != null && hist && hist[scrub] ? hist[scrub] : null
  const up = prices.length > 1 ? prices[prices.length - 1] >= prices[0] : a.change24h >= 0
  return (
    <Sheet sheetId={sheetId} closing={closing} title={a.name || a.symbol}
      footer={<div className="btn-row" style={{ gridTemplateColumns: a.qty > 0 ? '1fr 1fr' : '1fr' }}>
        {a.qty > 0 && <button className="btn" onClick={() => openSheet('assetTx', { assetId: a.id, type: 'sell' })}><Icon.minus />Продати</button>}
        <button className="btn primary" onClick={() => openSheet('assetTx', { assetId: a.id, type: 'buy' })}><Icon.plus />Купити</button>
      </div>}>
      <div className="row">
        <CoinIcon a={a} size={46} />
        <div>
          <div className="display num" style={{ fontSize: 28 }}>{fmtPriceUSD(shown ? shown[1] : a.priceUSD)}</div>
          <div className="muted" style={{ fontSize: 13.5 }}>{shown ? new Date(shown[0]).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }) : <span className={a.change24h >= 0 ? 'pos' : 'neg'}>{a.change24h >= 0 ? '+' : ''}{a.change24h.toFixed(2).replace('.', ',')}% за 24 год</span>}</div>
        </div>
      </div>
      <div style={{ margin: '14px -18px 0' }}>
        {hist === null ? <div style={{ height: 130, display: 'grid', placeItems: 'center' }}><div className="sk" style={{ width: '85%', height: 80 }} /></div>
          : prices.length > 1 ? <AreaChart values={prices} height={130} color={up ? 'var(--pos)' : 'var(--neg)'} onScrub={setScrub} />
            : <div className="muted" style={{ height: 80, display: 'grid', placeItems: 'center', fontSize: 13 }}>Немає даних графіка</div>}
      </div>
      <div style={{ marginTop: 10 }}><Segmented small options={RANGES} value={days} onChange={setDays} /></div>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="kpi"><div className="k-label">Кількість</div><div className="k-value num">{fmtQty(a.qty)}</div><div className="k-sub">{a.symbol}</div></div>
        <div className="kpi"><div className="k-label">Вартість</div><div className="k-value num">{m.fmt(a.valueUSD)}</div><div className="k-sub">за поточною ціною</div></div>
        <div className="kpi"><div className="k-label">Середня ціна</div><div className="k-value num">{fmtPriceUSD(a.avgBuyUSD)}</div></div>
        <div className="kpi"><div className="k-label">Вкладено</div><div className="k-value num">{m.fmt(a.investedUSD)}</div></div>
      </div>
      <div className="card" style={{ marginTop: 10, background: a.pnlUSD >= 0 ? 'var(--pos-soft)' : 'var(--neg-soft)', borderColor: 'transparent' }}>
        <div className="label">Прибуток / збиток</div>
        <div className={'display num ' + (a.pnlUSD >= 0 ? 'pos' : 'neg')} style={{ fontSize: 26, marginTop: 6 }}>{m.fmt(a.pnlUSD, { sign: 'always' })} <span style={{ fontSize: 16 }}>({a.pnlPct >= 0 ? '+' : ''}{a.pnlPct.toFixed(2).replace('.', ',')}%)</span></div>
      </div>
      <div className="section" style={{ marginTop: 20 }}>
        <div className="section-head"><h2>Операції</h2><span className="faint num">{a.transactions.length}</span></div>
        <div className="list">
          {a.transactions.map(t => (
            <div key={t.id} className="list-row no-avatar">
              <div className="main">
                <div className={'title num ' + (t.txType === 'buy' ? 'pos' : 'neg')}>{t.txType === 'buy' ? '+' : '−'}{fmtQty(t.qty)} {a.symbol}</div>
                <div className="meta">{fmtDate(t.date)} · {formatMoney(t.price, t.cur)} за 1 · разом {formatMoney(t.qty * t.price + (t.fee || 0), t.cur)}{t.note ? ' · ' + t.note : ''}</div>
              </div>
              <button className="icon-btn" style={{ width: 36, height: 36, background: 'transparent', borderColor: 'transparent', color: 'var(--text-3)' }} onClick={() => deleteAssetTx(t.id)} aria-label="Видалити"><Icon.trash /></button>
            </div>
          ))}
        </div>
      </div>
      <button className="btn danger" style={{ marginTop: 22 }} onClick={() => openSheet('confirm', {
        title: 'Видалити ' + a.symbol + '?', text: 'Разом з усією історією операцій.', confirmText: 'Видалити', danger: true,
        onConfirm: () => { deleteAsset(a.id); closeSheet(sheetId) },
      })}><Icon.trash />Видалити монету</button>
    </Sheet>
  )
}

export function AssetSearchSheet({ sheetId, closing }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef(null)
  const POPULAR = [
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', thumb: 'https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png' },
    { id: 'ethereum', symbol: 'eth', name: 'Ethereum', thumb: 'https://assets.coingecko.com/coins/images/279/thumb/ethereum.png' },
    { id: 'solana', symbol: 'sol', name: 'Solana', thumb: 'https://assets.coingecko.com/coins/images/4128/thumb/solana.png' },
    { id: 'the-open-network', symbol: 'ton', name: 'Toncoin', thumb: 'https://assets.coingecko.com/coins/images/17980/thumb/ton_symbol.png' },
    { id: 'tether', symbol: 'usdt', name: 'Tether', thumb: 'https://assets.coingecko.com/coins/images/325/thumb/Tether.png' },
  ]
  const onChange = v => {
    setQ(v)
    clearTimeout(timer.current)
    if (v.trim().length < 2) { setRes(null); setBusy(false); return }
    setBusy(true)
    timer.current = setTimeout(async () => {
      try { setRes(await cgSearch(v.trim())) } catch { setRes([]) }
      setBusy(false)
    }, 350)
  }
  const pick = c => replaceSheet('assetTx', { meta: { cgId: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name, icon: c.thumb } , type: 'buy' })
  const list = res || POPULAR
  return (
    <Sheet sheetId={sheetId} closing={closing} title="Знайти монету">
      <div style={{ position: 'relative' }}>
        <Icon.search style={{ position: 'absolute', left: 14, top: 16, width: 20, color: 'var(--text-3)' }} />
        <input className="input" style={{ paddingLeft: 44 }} autoFocus placeholder="Bitcoin, ETH, Solana…" value={q} onChange={e => onChange(e.target.value)} spellCheck="false" autoComplete="off" />
      </div>
      <div className="label" style={{ margin: '16px 2px 10px' }}>{res ? (busy ? 'Шукаю…' : res.length ? 'Результати' : 'Нічого не знайдено') : busy ? 'Шукаю…' : 'Популярні'}</div>
      <div className="list">
        {list.map(c => (
          <button key={c.id} className="list-row" onClick={() => { haptic.tap(); pick(c) }}>
            <CoinIcon a={{ icon: c.thumb, symbol: c.symbol }} size={36} />
            <div className="main"><div className="title">{c.name}</div><div className="meta">{(c.symbol || '').toUpperCase()}</div></div>
            <Icon.chevronRight className="chev" />
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function AssetTxSheet({ sheetId, closing, assetId, meta: meta0, type = 'buy' }) {
  const d = useDerived()
  const m = useMoney()
  const prices = useStore(s => s.prices)
  const asset = assetId ? d.assets.find(a => a.id === assetId) : null
  const meta = meta0 || (asset ? { cgId: asset.cgId, symbol: asset.symbol, name: asset.name, icon: asset.icon } : null)
  const cur0 = meta && prices[meta.cgId] ? prices[meta.cgId].price : null
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState(cur0 ? num(Math.round(cur0 * 100) / 100) : '')
  const [cur, setCur] = useState('USD')
  const [date, setDate] = useState(toISO(today()))
  const [fee, setFee] = useState('')
  const [note, setNote] = useState('')
  if (!meta) return <Sheet sheetId={sheetId} closing={closing} title="Операція"><Empty title="Немає даних про монету" /></Sheet>
  const q = parseAmount(qty) || 0
  const p = parseAmount(price) || 0
  const f = parseAmount(fee) || 0
  const total = q * p + f
  const ok = q > 0 && p > 0 && !!date
  const save = () => {
    if (!ok) return
    if (type === 'sell' && asset && q > asset.qty + 1e-9) { toast('Продаєш більше, ніж маєш (' + fmtQty(asset.qty) + ')', { kind: 'error' }); return }
    const tx = { date, txType: type, qty: q, price: p, cur, fee: f, note: note.trim() }
    if (asset) addAssetTx(asset.id, tx)
    else addAssetWithTx(meta, tx)
    toast(type === 'buy' ? `Покупку ${fmtQty(q)} ${meta.symbol} додано` : `Продаж ${fmtQty(q)} ${meta.symbol} додано`, { kind: 'success' })
    closeSheet(sheetId)
  }
  return (
    <Sheet sheetId={sheetId} closing={closing} title={(type === 'buy' ? 'Купівля ' : 'Продаж ') + meta.symbol}
      footer={<button className={'btn ' + (type === 'buy' ? 'primary' : 'danger')} disabled={!ok} onClick={save}>{type === 'buy' ? 'Додати покупку' : 'Додати продаж'}{ok ? ' · ' + formatMoney(total, cur) : ''}</button>}>
      <div className="row" style={{ marginBottom: 6 }}>
        <CoinIcon a={{ icon: meta.icon, symbol: meta.symbol }} size={38} />
        <div><div style={{ fontWeight: 650 }}>{meta.name}</div><div className="muted" style={{ fontSize: 13 }}>{cur0 ? 'зараз ' + fmtPriceUSD(cur0) : meta.symbol}{asset ? ' · у тебе ' + fmtQty(asset.qty) : ''}</div></div>
      </div>
      <Field label="Кількість"><TextInput value={qty} onChange={v => setQty(v.replace(/[^0-9.,]/g, ''))} inputMode="decimal" placeholder="0,05" autoFocus /></Field>
      {type === 'sell' && asset && asset.qty > 0 && <button className="chip" style={{ marginTop: 8 }} onClick={() => setQty(num(asset.qty))}>Усе · {fmtQty(asset.qty)}</button>}
      <Field label={'Ціна за 1 ' + meta.symbol}><AmountInput value={price} onChange={setPrice} cur={cur} onCur={setCur} /></Field>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <Field label="Дата"><DateInput value={date} onChange={setDate} /></Field>
        <Field label="Комісія"><TextInput value={fee} onChange={v => setFee(v.replace(/[^0-9.,]/g, ''))} inputMode="decimal" placeholder="0" /></Field>
      </div>
      <Field label="Опис"><TextInput value={note} onChange={setNote} placeholder="напр. з Binance" /></Field>
      <div className="preview">Разом<span className="big num">{ok ? formatMoney(total, cur) : '—'}</span>{ok && cur !== m.display ? <div style={{ marginTop: 4 }}>≈ {m.fmtFrom(total, cur)}</div> : null}</div>
    </Sheet>
  )
}
