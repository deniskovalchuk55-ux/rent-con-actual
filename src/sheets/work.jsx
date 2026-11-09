// Вікна роботи: запис (години / підробіток), категорія, місяць з виплатами, виплата, день.
import { useState } from 'react'
import { useDerived, useStore } from '../state/store.js'
import { openSheet, closeSheet, toast } from '../state/ui.js'
import { addWorkEntry, updateWorkEntry, deleteWorkEntry, saveCategory, deleteCategory, addPayout, updatePayout, deletePayout } from '../state/actions.js'
import { useMoney } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Sheet } from '../ui/sheet.jsx'
import { Field, TextInput, AmountInput, DateInput, Segmented, Stepper, Switch, KV, Empty, Bar, IconTile } from '../ui/kit.jsx'
import { workEntryUSD, accruedUSDForMonth, paidUSDForMonth, hoursForMonth, monthPayoutStatus, categoriesInMonth, categoryStatus, STATUS_LABEL, hasAnyFinal, defaultCategory } from '../lib/domain/work.js'
import { fmtDate, monthKeyLabel, today, toISO, monthKeyOf } from '../lib/dates.js'
import { parseAmount, formatMoney } from '../lib/money.js'
import { haptic } from '../lib/telegram.js'

const STATUS_PILL = { paid: 'pos', partial: 'warn', pending: 'acc' }
const num = v => String(v ?? '').replace('.', ',')
const fmtH = h => (Math.round(h * 10) / 10).toString().replace('.', ',')

export function WorkEntrySheet({ sheetId, closing, id, kind: kind0, date: date0 }) {
  const d = useDerived()
  const m = useMoney()
  const display = useStore(s => s.settings.display)
  const editing = id ? d.workEntries.find(e => e.id === id) : null
  const cats = d.workCategories
  const defCat = defaultCategory(cats)
  const [kind, setKind] = useState(editing ? editing.kind : kind0 || 'hourly')
  const [date, setDate] = useState(editing ? editing.date : date0 || toISO(today()))
  const [catId, setCatId] = useState(editing ? editing.categoryId || '' : defCat ? defCat.id : '')
  const [hours, setHours] = useState(editing && editing.kind === 'hourly' ? num(editing.hours) : '8')
  const [rate, setRate] = useState(editing && editing.kind === 'hourly' ? num(editing.rate) : defCat ? num(defCat.rate) : '')
  const [rateCur, setRateCur] = useState(editing && editing.kind === 'hourly' ? editing.rateCur : defCat ? defCat.cur : display)
  const [title, setTitle] = useState(editing ? editing.title || '' : '')
  const [amount, setAmount] = useState(editing && editing.kind === 'fixed' ? num(editing.amountNative) : '')
  const [cur, setCur] = useState(editing && editing.kind === 'fixed' ? editing.cur : display)
  const [note, setNote] = useState(editing ? editing.note || '' : '')
  const [err, setErr] = useState('')

  const pickCat = c => { haptic.select(); setCatId(c.id); setRate(num(c.rate)); setRateCur(c.cur) }
  const h = parseAmount(hours) || 0
  const r = parseAmount(rate) || 0
  const a = parseAmount(amount) || 0
  const usd = kind === 'hourly' ? m.toUSD(r, rateCur) * h : m.toUSD(a, cur)

  const save = () => {
    if (!date) return setErr('Вкажи дату')
    let entry
    if (kind === 'hourly') {
      if (!(h > 0)) return setErr('Вкажи кількість годин')
      if (!(r > 0)) return setErr('Вкажи ставку')
      entry = { date, kind, hours: h, rate: r, rateCur, categoryId: catId || null, note: note.trim(), title: '', amountNative: null, cur: null }
    } else {
      if (!title.trim()) return setErr('Вкажи назву підробітку')
      if (!(a > 0)) return setErr('Вкажи суму')
      entry = { date, kind, title: title.trim(), amountNative: a, cur, note: note.trim(), hours: null, rate: null, rateCur: null, categoryId: null }
    }
    if (editing) { updateWorkEntry(editing.id, entry); toast('Запис оновлено', { kind: 'success' }) }
    else { addWorkEntry(entry); toast(kind === 'hourly' ? `+${fmtH(h)} год записано` : 'Підробіток додано', { kind: 'success' }) }
    closeSheet(sheetId)
  }

  return (
    <Sheet sheetId={sheetId} closing={closing} title={editing ? 'Редагувати запис' : kind === 'hourly' ? 'Робочий день' : 'Підробіток'}
      footer={<button className="btn primary" onClick={save}><Icon.check />{editing ? 'Зберегти' : 'Додати · ' + m.fmt(usd)}</button>}>
      {!editing && <Segmented value={kind} onChange={setKind} options={[{ value: 'hourly', label: 'Години' }, { value: 'fixed', label: 'Підробіток' }]} />}
      <div style={{ height: editing ? 0 : 14 }} />
      <Field label="Дата"><DateInput value={date} onChange={setDate} /></Field>
      {kind === 'hourly' ? (
        <>
          {cats.length > 0 && (
            <Field label="Категорія">
              <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', margin: 0, padding: 0 }}>
                {cats.map(c => <button key={c.id} type="button" className={'chip accent-on' + (catId === c.id ? ' on' : '')} onClick={() => pickCat(c)}>{c.name}</button>)}
              </div>
            </Field>
          )}
          <Field label="Годин"><Stepper value={hours} onChange={setHours} step={0.5} /></Field>
          <div className="chips" style={{ marginTop: 10 }}>
            {[4, 6, 8, 9, 10, 12].map(q => <button key={q} type="button" className={'chip' + (h === q ? ' on' : '')} onClick={() => { haptic.select(); setHours(String(q)) }}>{q} год</button>)}
          </div>
          <Field label="Ставка за годину" hint="Зберігається в записі: зміна ставки категорії старі записи не чіпає"><AmountInput value={rate} onChange={setRate} cur={rateCur} onCur={setRateCur} /></Field>
        </>
      ) : (
        <>
          <Field label="Назва"><TextInput value={title} onChange={setTitle} placeholder="Лендінг для клієнта" /></Field>
          <Field label="Сума"><AmountInput value={amount} onChange={setAmount} cur={cur} onCur={setCur} /></Field>
        </>
      )}
      <Field label="Нотатка"><TextInput value={note} onChange={setNote} placeholder="що робив (необовʼязково)" /></Field>
      <div className="preview">
        {kind === 'hourly'
          ? (h > 0 && r > 0 ? <>{fmtH(h)} год × {formatMoney(r, rateCur)}<span className="big num">{m.fmt(usd)}</span></> : 'Вкажи години й ставку')
          : (a > 0 ? <>Заробіток<span className="big num">{m.fmt(usd)}</span></> : 'Вкажи суму')}
      </div>
      {err && <div className="pill neg" style={{ marginTop: 12, height: 'auto', padding: '8px 12px' }}>{err}</div>}
      {editing && <button className="btn danger" style={{ marginTop: 18 }} onClick={() => { deleteWorkEntry(editing.id); closeSheet(sheetId) }}><Icon.trash />Видалити запис</button>}
    </Sheet>
  )
}

export function CategorySheet({ sheetId, closing, id }) {
  const d = useDerived()
  const display = useStore(s => s.settings.display)
  const editing = id ? d.workCategories.find(c => c.id === id) : null
  const [name, setName] = useState(editing ? editing.name : '')
  const [rate, setRate] = useState(editing ? num(editing.rate) : '')
  const [cur, setCur] = useState(editing ? editing.cur : display)
  const [isDefault, setIsDefault] = useState(editing ? editing.isDefault : d.workCategories.length === 0)
  const [err, setErr] = useState('')
  const save = () => {
    const r = parseAmount(rate)
    if (!name.trim()) return setErr('Вкажи назву')
    if (!(r > 0)) return setErr('Вкажи ставку')
    saveCategory({ id: editing ? editing.id : undefined, name: name.trim(), rate: r, cur, isDefault })
    toast('Категорію збережено', { kind: 'success' })
    closeSheet(sheetId)
  }
  return (
    <Sheet sheetId={sheetId} closing={closing} title={editing ? 'Категорія' : 'Нова категорія'} footer={<button className="btn primary" onClick={save}>Зберегти</button>}>
      <Field label="Назва"><TextInput value={name} onChange={setName} placeholder="Будова" autoFocus={!editing} /></Field>
      <Field label="Ставка за годину" hint="Підставляється в нові записи"><AmountInput value={rate} onChange={setRate} cur={cur} onCur={setCur} placeholder="15" /></Field>
      <div style={{ marginTop: 14 }}><Switch on={isDefault} onChange={setIsDefault} label="За замовчуванням" sub="Обирається першою в новому записі" /></div>
      {err && <div className="pill neg" style={{ marginTop: 12, height: 'auto', padding: '8px 12px' }}>{err}</div>}
      {editing && d.workCategories.length > 1 && (
        <button className="btn danger" style={{ marginTop: 18 }} onClick={() => openSheet('confirm', {
          title: 'Видалити категорію?', text: 'Записи з цією категорією залишаться, просто без категорії.', confirmText: 'Видалити', danger: true,
          onConfirm: () => { deleteCategory(editing.id); closeSheet(sheetId) },
        })}><Icon.trash />Видалити категорію</button>
      )}
    </Sheet>
  )
}

export function MonthSheet({ sheetId, closing, month }) {
  const d = useDerived()
  const m = useMoney()
  const rates = m.rates
  const accrued = accruedUSDForMonth(d.workEntries, month, rates)
  const paid = paidUSDForMonth(d.payouts, month, rates)
  const status = monthPayoutStatus(d.workEntries, d.payouts, month, rates)
  const hours = hoursForMonth(d.workEntries, month)
  const payouts = d.payouts.filter(p => p.month === month).sort((a, b) => (a.date < b.date ? 1 : -1))
  const cats = categoriesInMonth(d.workEntries, month)
  const closed = hasAnyFinal(d.payouts, month)
  const diff = paid - accrued
  return (
    <Sheet sheetId={sheetId} closing={closing} title={monthKeyLabel(month)}
      footer={!closed ? <button className="btn primary" onClick={() => openSheet('payout', { month })}><Icon.wallet />Додати виплату</button> : null}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className={'pill ' + STATUS_PILL[status]}>{STATUS_LABEL[status]}</span>
          <span className="muted num" style={{ fontSize: 13.5 }}>{fmtH(hours)} год</span>
        </div>
        <div className="grid-3" style={{ marginTop: 14 }}>
          <div><div className="label">Нараховано</div><div className="num" style={{ fontWeight: 750, fontSize: 17, marginTop: 6 }}>{m.fmt(accrued)}</div></div>
          <div><div className="label">Виплачено</div><div className="num pos" style={{ fontWeight: 750, fontSize: 17, marginTop: 6 }}>{m.fmt(paid)}</div></div>
          <div><div className="label">{status === 'paid' ? 'Різниця' : 'Залишок'}</div><div className={'num ' + (status === 'paid' ? (diff < -0.01 ? 'neg' : 'pos') : '')} style={{ fontWeight: 750, fontSize: 17, marginTop: 6 }}>{status === 'paid' ? m.fmt(diff, { sign: 'always' }) : m.fmt(Math.max(0, accrued - paid))}</div></div>
        </div>
        <div style={{ marginTop: 14 }}><Bar value={accrued > 0 ? Math.min(1, paid / accrued) : status === 'paid' ? 1 : 0} color="var(--pos)" /></div>
      </div>

      {cats.length > 1 && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="label" style={{ marginBottom: 6 }}>За категоріями</div>
          {cats.map(cid => {
            const real = cid === 'no-cat' ? null : cid
            const name = real ? (d.workCategories.find(c => c.id === real) || {}).name || 'Категорія' : 'Без категорії'
            const st = categoryStatus(d.workEntries, d.payouts, month, real, rates)
            return <KV key={cid} k={name} v={<span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>{m.fmt(accruedUSDForMonth(d.workEntries, month, rates, real))}<span className={'pill ' + STATUS_PILL[st]}>{STATUS_LABEL[st]}</span></span>} />
          })}
        </div>
      )}

      <div className="section" style={{ marginTop: 20 }}>
        <div className="section-head"><h2>Виплати</h2><span className="faint num">{payouts.length}</span></div>
        {payouts.length ? (
          <div className="list">
            {payouts.map(p => (
              <button key={p.id} className="list-row" onClick={() => openSheet('payout', { month, id: p.id })}>
                <IconTile icon={p.type === 'final' ? Icon.check : Icon.coins} color={p.type === 'final' ? 'var(--pos)' : 'var(--accent-text)'} bg={p.type === 'final' ? 'var(--pos-soft)' : 'var(--accent-soft)'} />
                <div className="main">
                  <div className="title">{p.type === 'final' ? 'Фактична виплата' : 'Аванс'}</div>
                  <div className="meta">{fmtDate(p.date)}{p.categoryId ? ' · ' + ((d.workCategories.find(c => c.id === p.categoryId) || {}).name || 'категорія') : ''}</div>
                </div>
                <div className="end amount">{m.fmtFrom(p.amount, p.cur)}</div>
              </button>
            ))}
          </div>
        ) : <div className="card muted" style={{ fontSize: 14 }}>Виплат за цей місяць ще не було</div>}
      </div>
    </Sheet>
  )
}

export function PayoutSheet({ sheetId, closing, month: month0, id }) {
  const d = useDerived()
  const m = useMoney()
  const display = useStore(s => s.settings.display)
  const editing = id ? d.payouts.find(p => p.id === id) : null
  const month = editing ? editing.month : month0 || monthKeyOf(today())
  const accrued = accruedUSDForMonth(d.workEntries, month, m.rates)
  const paid = paidUSDForMonth(d.payouts, month, m.rates)
  const remainingUSD = Math.max(0, accrued - paid + (editing ? m.toUSD(editing.amount, editing.cur) : 0))
  const [type, setType] = useState(editing ? editing.type : 'advance')
  const [amount, setAmount] = useState(editing ? num(editing.amount) : '')
  const [cur, setCur] = useState(editing ? editing.cur : display)
  const [date, setDate] = useState(editing ? editing.date : toISO(today()))
  const [catId, setCatId] = useState(editing ? editing.categoryId || '' : '')
  const [err, setErr] = useState('')
  const remainingInCur = m.convert(remainingUSD, 'USD', cur)
  const save = () => {
    const a = parseAmount(amount)
    if (!(a > 0)) return setErr('Вкажи суму')
    if (!date) return setErr('Вкажи дату')
    const po = { month, date, amount: a, cur, type, categoryId: catId || null }
    if (editing) updatePayout(editing.id, po)
    else addPayout(po)
    toast(type === 'final' ? 'Місяць закрито виплатою' : 'Аванс записано', { kind: 'success' })
    closeSheet(sheetId)
  }
  return (
    <Sheet sheetId={sheetId} closing={closing} title={(editing ? 'Виплата · ' : 'Нова виплата · ') + monthKeyLabel(month, { short: true })}
      footer={<button className="btn primary" onClick={save}><Icon.check />Зберегти</button>}>
      <Segmented value={type} onChange={setType} options={[{ value: 'advance', label: 'Аванс' }, { value: 'final', label: 'Фактична' }]} />
      <div className="hint" style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '8px 2px 0' }}>{type === 'final' ? 'Закриває місяць, навіть якщо сума менша за нараховане' : 'Часткова виплата: залишок і далі очікує'}</div>
      <Field label="Сума" hint={'Залишок до виплати: ' + formatMoney(remainingInCur, cur)}>
        <AmountInput value={amount} onChange={setAmount} cur={cur} onCur={setCur} placeholder={String(Math.round(remainingInCur))} autoFocus={!editing} />
      </Field>
      {remainingInCur > 0 && !amount && <button className="chip" style={{ marginTop: 8 }} onClick={() => { haptic.select(); setAmount(String(Math.round(remainingInCur * 100) / 100).replace('.', ',')) }}>Увесь залишок · {formatMoney(remainingInCur, cur)}</button>}
      <Field label="Дата отримання"><DateInput value={date} onChange={setDate} /></Field>
      {d.workCategories.length > 1 && (
        <Field label="Категорія" hint="«Загальна» стосується всього місяця">
          <select className="input" value={catId} onChange={e => setCatId(e.target.value)}>
            <option value="">Загальна (весь місяць)</option>
            {d.workCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {err && <div className="pill neg" style={{ marginTop: 12, height: 'auto', padding: '8px 12px' }}>{err}</div>}
      {editing && <button className="btn danger" style={{ marginTop: 18 }} onClick={() => { deletePayout(editing.id); closeSheet(sheetId) }}><Icon.trash />Видалити виплату</button>}
    </Sheet>
  )
}

export function DaySheet({ sheetId, closing, date }) {
  const d = useDerived()
  const m = useMoney()
  const entries = d.workEntries.filter(e => e.date === date)
  const usd = entries.reduce((s, e) => s + workEntryUSD(e, m.rates), 0)
  const h = entries.reduce((s, e) => s + (e.kind === 'hourly' ? e.hours || 0 : 0), 0)
  return (
    <Sheet sheetId={sheetId} closing={closing} title={fmtDate(date, { year: true })}
      footer={<button className="btn primary" onClick={() => openSheet('workEntry', { date })}><Icon.plus />Додати запис на цей день</button>}>
      {entries.length ? (
        <>
          <div className="grid-2">
            <div className="kpi"><div className="k-label">Годин</div><div className="k-value num">{fmtH(h)}</div></div>
            <div className="kpi"><div className="k-label">Заробіток</div><div className="k-value num pos">{m.fmt(usd)}</div></div>
          </div>
          <div className="list" style={{ marginTop: 12 }}>
            {entries.map(e => {
              const cat = e.categoryId ? d.workCategories.find(c => c.id === e.categoryId) : null
              return (
                <button key={e.id} className="list-row" onClick={() => openSheet('workEntry', { id: e.id })}>
                  <IconTile icon={e.kind === 'hourly' ? Icon.clock : Icon.bolt} color={e.kind === 'hourly' ? 'var(--accent-text)' : 'var(--violet)'} bg={e.kind === 'hourly' ? 'var(--accent-soft)' : 'var(--violet-soft)'} />
                  <div className="main">
                    <div className="title">{e.kind === 'hourly' ? `${fmtH(e.hours)} год${cat ? ' · ' + cat.name : ''}` : e.title || 'Підробіток'}</div>
                    <div className="meta">{e.kind === 'hourly' ? formatMoney(e.rate, e.rateCur) + '/год' : ''}{e.note ? (e.kind === 'hourly' ? ' · ' : '') + e.note : ''}</div>
                  </div>
                  <div className="end amount">{m.fmt(workEntryUSD(e, m.rates))}</div>
                </button>
              )
            })}
          </div>
        </>
      ) : <Empty icon={Icon.calendar} title="Цього дня записів немає" text="Додай години чи підробіток на цю дату." />}
    </Sheet>
  )
}
