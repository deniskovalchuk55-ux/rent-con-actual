// Вікна оренди: картка орендаря, форма орендаря, зарахування оплати, вибір орендаря.
import { useMemo, useState } from 'react'
import { useDerived, useStore, getState } from '../state/store.js'
import { openSheet, closeSheet, replaceSheet, toast } from '../state/ui.js'
import { addClient, updateClient, deleteClient, addPayment, deletePayment } from '../state/actions.js'
import { useMoney } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Sheet, burstConfetti } from '../ui/sheet.jsx'
import { Avatar, Field, TextInput, AmountInput, DateInput, Segmented, Chips, KV, Empty, Ring, CurrencyPicker } from '../ui/kit.jsx'
import { LEVEL_COLOR } from '../screens/Home.jsx'
import { statusOf, nextPayDate, paidUntilDate, totalMonths, effectiveStart, nextPayText, clientPaidUSD, periodProgress, isReferralReady } from '../lib/domain/rent.js'
import { addMonthsDays, daysBetween, fmtDate, fmtMonthsDays, parseDate, today, toISO } from '../lib/dates.js'
import { parseAmount, formatMoney } from '../lib/money.js'
import { haptic, openLink, openTelegramLink } from '../lib/telegram.js'

const LEVEL_PILL = { due: 'neg', warn: 'warn', soon: 'acc', ok: 'pos' }

export function ClientSheet({ sheetId, closing, id }) {
  const d = useDerived()
  const m = useMoney()
  const c = d.clients.find(x => x.id === id)
  if (!c) return <Sheet sheetId={sheetId} closing={closing} title="Орендар"><Empty title="Орендаря не знайдено" text="Можливо, його видалили." /></Sheet>
  const st = statusOf(c)
  const now = today()
  const referrer = c.referredBy ? d.clients.find(x => x.id === c.referredBy) : null
  const brought = d.clients.filter(x => x.referredBy === c.id)
  const paidM = totalMonths(c)
  const paidUntil = paidUntilDate(c)
  const until = nextPayDate(c)
  const postpaid = c.payMode === 'postpaid'
  const start = parseDate(c.start)
  // шкала: від старту до кінця оплаченого (з бонусом), мінімум до сьогодні + 7 днів
  const span = Math.max(until.getTime(), now.getTime() + 7 * 864e5) - start.getTime()
  const pos = t => Math.max(0, Math.min(100, ((t - start.getTime()) / span) * 100))
  const payments = [...(c.payments || [])].reverse()

  return (
    <Sheet sheetId={sheetId} closing={closing} title={c.name}
      headerRight={<button className="icon-btn" onClick={() => openSheet('clientForm', { id: c.id })} aria-label="Редагувати"><Icon.edit /></button>}
      footer={
        postpaid ? (
          <div className="btn-row">
            <button className="btn" onClick={() => openSheet('pay', { clientId: c.id })}>Інша сума</button>
            <button className="btn primary" onClick={() => { addPayment(c.id, { months: 1, amountNative: c.rate, cur: c.cur, date: toISO(today()) }); toast('Оплату за місяць зараховано', { kind: 'success' }) }}><Icon.check />Оплатив {formatMoney(c.rate, c.cur)}</button>
          </div>
        ) : <button className="btn primary" onClick={() => openSheet('pay', { clientId: c.id })}><Icon.plus />Зарахувати оплату</button>
      }>
      <div className="row" style={{ marginBottom: 16 }}>
        <Ring value={periodProgress(c)} size={64} stroke={4.5} color={LEVEL_COLOR[st.level]}><Avatar name={c.name} size="lg" /></Ring>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="display num" style={{ fontSize: 28 }}>{m.fmtFrom(c.rate, c.cur)}<span className="muted" style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--font)' }}> /міс</span></div>
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <span className={'pill ' + LEVEL_PILL[st.level]}>{st.days <= 0 ? (st.days === 0 ? 'оплата сьогодні' : 'прострочено ' + Math.abs(st.days) + ' дн') : 'оплата ' + nextPayText(st.days)}</span>
            <span className="pill neutral">{postpaid ? 'постоплата' : 'передплата'}</span>
            {referrer && <span className="pill violet">REF</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="label">{postpaid ? 'Наступна оплата очікується' : 'Оплачено до'}</span>
          <b className="num">{fmtDate(until)}</b>
        </div>
        {!postpaid && (
          <>
            <div className="timeline">
              <div className="seg-paid" style={{ left: 0, width: pos(paidUntil.getTime()) + '%' }} />
              {c.bonusMonths > 0 && <div className="seg-bonus" style={{ left: pos(paidUntil.getTime()) + '%', width: (pos(until.getTime()) - pos(paidUntil.getTime())) + '%' }} />}
              <div className="now" style={{ left: pos(now.getTime()) + '%' }} />
            </div>
            <div className="timeline-labels"><span>{fmtDate(start)}</span><span>сьогодні</span><span>{fmtDate(until)}</span></div>
          </>
        )}
        <div className="divider" style={{ margin: '12px 0 2px' }} />
        <KV k="Оплачено місяців" v={fmtMonthsDays(paidM)} />
        {!postpaid && <KV k="Платний період до" v={`${fmtDate(paidUntil)} (${Math.max(0, daysBetween(now, paidUntil))} дн)`} />}
        {c.bonusMonths > 0 && <KV k="Бонус за рефералів" v={'+' + fmtMonthsDays(c.bonusMonths)} vClass="accent" />}
        {c.bonusDays > 0 && <KV k="Бонусні дні" v={'+' + c.bonusDays + ' дн (зсув старту)'} vClass="accent" />}
        <KV k="Усього сплачено" v={m.fmt(clientPaidUSD(c, m.rates))} />
        {c.setupAmount > 0 && <KV k="Розробка (разово)" v={m.fmtFrom(c.setupAmount, c.setupCur)} vClass="num" />}
        <KV k="Старт" v={fmtDate(start, { year: true })} />
      </div>

      {(c.phone || c.tg) && (
        <div className="btn-row" style={{ marginTop: 10, gridTemplateColumns: c.phone && c.tg ? '1fr 1fr' : '1fr' }}>
          {c.phone && <button className="btn" onClick={() => copyOrCall(c.phone)}><Icon.phone />{c.phone}</button>}
          {c.tg && <button className="btn" onClick={() => openTelegramLink('https://t.me/' + c.tg)}><Icon.send />@{c.tg}</button>}
        </div>
      )}

      {st.days <= 7 && (
        <button className="remind" onClick={() => remind(c, st, until)}>
          <span className="icon-tile" style={{ background: st.days <= 0 ? 'var(--neg-soft)' : 'var(--accent-soft)', color: st.days <= 0 ? 'var(--neg)' : 'var(--accent-text)' }}><Icon.bell /></span>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <b>Нагадати про оплату</b>
            <span className="muted">{c.tg ? 'Відкриє чат з готовим текстом' : 'Скопіює готовий текст нагадування'}</span>
          </span>
          <Icon.chevronRight style={{ width: 18, color: 'var(--text-3)' }} />
        </button>
      )}

      {referrer && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row">
            <div className="icon-tile" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}><Icon.gift /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>Привів {referrer.name}</div>
              <div className="muted" style={{ fontSize: 13 }}>Бонус запрошувачу +{c.bonusAmount} міс · {c.referralGranted ? 'нараховано' : isReferralReady(c) ? 'нараховується' : 'після першого місяця з оплатою'}</div>
            </div>
          </div>
        </div>
      )}

      <div className="section" style={{ marginTop: 22 }}>
        <div className="section-head"><h2>Оплати</h2><span className="faint num">{payments.length}</span></div>
        {payments.length ? (
          <div className="list">
            {payments.map(p => (
              <div key={p.id} className="list-row no-avatar">
                <div className="main">
                  <div className="title num">+{m.fmtFrom(p.amountNative, p.cur || c.cur)}</div>
                  <div className="meta">{fmtDate(p.date)} · {fmtMonthsDays(p.months)}</div>
                </div>
                <button className="icon-btn" style={{ width: 36, height: 36, background: 'transparent', borderColor: 'transparent', color: 'var(--text-3)' }}
                  onClick={() => deletePayment(c.id, p.id)} aria-label="Видалити оплату"><Icon.trash /></button>
              </div>
            ))}
          </div>
        ) : <div className="card muted" style={{ fontSize: 14 }}>Оплат ще не було</div>}
      </div>

      {brought.length > 0 && (
        <div className="section" style={{ marginTop: 22 }}>
          <div className="section-head"><h2>Привів орендарів</h2><span className="faint num">{brought.length}</span></div>
          <div className="list">
            {brought.map(b => (
              <button key={b.id} className="list-row" onClick={() => replaceSheet('client', { id: b.id })}>
                <Avatar name={b.name} />
                <div className="main"><div className="title">{b.name}</div><div className="meta">+{b.bonusAmount} міс бонусу</div></div>
                <span className={'pill ' + (b.referralGranted ? 'pos' : 'neutral')}>{b.referralGranted ? 'нараховано' : 'очікує'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="btn danger" style={{ marginTop: 24 }} onClick={() => openSheet('confirm', {
        title: 'Видалити орендаря?', text: `«${c.name}» разом з історією оплат буде прибрано з Notion (в архів).`, confirmText: 'Видалити', danger: true,
        onConfirm: () => { deleteClient(c.id); closeSheet(sheetId) },
      })}><Icon.trash />Видалити орендаря</button>
    </Sheet>
  )
}

// Готовий текст нагадування: у валюті орендаря, з датою; Telegram підставляє його в поле вводу (t.me/<username>?text=…)
export function reminderText(c, st, until) {
  const sum = formatMoney(c.rate, c.cur).replace(/ /g, ' ')
  const date = fmtDate(until)
  if (st.days < 0) return `Привіт! Нагадую про оплату оренди — ${sum}/міс. Термін був ${date}. Дякую! 🙏`
  if (st.days === 0) return `Привіт! Сьогодні день оплати оренди — ${sum}/міс. Дякую! 🙏`
  return `Привіт! Нагадую, що ${date} — дата оплати оренди (${sum}/міс). Дякую! 🙏`
}

function remind(c, st, until) {
  haptic.tap()
  const text = reminderText(c, st, until)
  try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}) } catch { /* */ }
  if (c.tg) openTelegramLink('https://t.me/' + encodeURIComponent(c.tg) + '?text=' + encodeURIComponent(text))
  else toast('Текст нагадування скопійовано', { kind: 'success' })
}

function copyOrCall(phone) {
  haptic.tap()
  try {
    if (navigator.clipboard) navigator.clipboard.writeText(phone).then(() => toast('Номер скопійовано', { kind: 'success' }), () => {})
  } catch { /* */ }
  openLink('tel:' + phone.replace(/[^+\d]/g, ''))
}

function normalizeTg(raw) {
  if (!raw) return ''
  return raw.trim().replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/\/$/, '')
}

const BONUS_OPTS = [{ value: 3, label: '3 міс' }, { value: 4.5, label: '4,5 міс' }, { value: 6, label: '6 міс' }]

export function ClientFormSheet({ sheetId, closing, id }) {
  const d = useDerived()
  const display = useStore(s => s.settings.display)
  const editing = id ? d.clients.find(c => c.id === id) : null
  const [f, setF] = useState(() => editing ? {
    name: editing.name, rate: String(editing.rate).replace('.', ','), cur: editing.cur, start: editing.start, payMode: editing.payMode,
    bonusDays: editing.bonusDays ? String(editing.bonusDays) : '', setup: editing.setupAmount ? String(editing.setupAmount).replace('.', ',') : '', setupCur: editing.setupCur || editing.cur,
    phone: editing.phone || '', tg: editing.tg ? '@' + editing.tg : '', source: editing.referredBy ? 'ref' : 'self', referredBy: editing.referredBy || '', bonus: editing.bonusAmount || 3,
  } : { name: '', rate: '', cur: display, start: toISO(today()), payMode: 'prepaid', bonusDays: '', setup: '', setupCur: display, phone: '', tg: '', source: 'self', referredBy: '', bonus: 3 })
  const set = patch => setF(x => ({ ...x, ...patch }))
  const [err, setErr] = useState('')

  const submit = thenPay => {
    const rate = parseAmount(f.rate)
    if (!f.name.trim()) return setErr('Вкажи імʼя або назву')
    if (!(rate > 0)) return setErr('Вкажи місячну ставку')
    if (!f.start) return setErr('Вкажи дату старту')
    if (!editing && f.source === 'ref' && !f.referredBy) return setErr('Обери, хто привів')
    const data = {
      name: f.name.trim(), rate, cur: f.cur, start: f.start, payMode: f.payMode, bonusDays: parseInt(f.bonusDays, 10) || 0,
      setupAmount: parseAmount(f.setup) || 0, setupCur: f.setupCur, phone: f.phone.trim(), tg: normalizeTg(f.tg),
    }
    if (editing) {
      updateClient(editing.id, data)
      toast('Зміни збережено', { kind: 'success' })
      closeSheet(sheetId)
      return
    }
    const newId = addClient({ ...data, referredBy: f.source === 'ref' ? f.referredBy : null, bonusAmount: f.source === 'ref' ? f.bonus : 0 })
    toast('Орендаря додано', { kind: 'success' })
    if (thenPay) replaceSheet('pay', { clientId: newId })
    else closeSheet(sheetId)
  }

  return (
    <Sheet sheetId={sheetId} closing={closing} title={editing ? 'Редагувати' : 'Новий орендар'}
      footer={editing ? <button className="btn primary" onClick={() => submit(false)}>Зберегти</button> : (
        <div className="btn-row">
          <button className="btn" onClick={() => submit(false)}>Додати</button>
          <button className="btn primary" onClick={() => submit(true)}>Додати + оплата</button>
        </div>
      )}>
      <Field label="Імʼя або назва"><TextInput id="cf-name" value={f.name} onChange={v => set({ name: v })} placeholder="Сайт Олега" autoFocus={!editing} /></Field>
      <Field label="Місячна ставка" hint="У якій валюті отримуєш оплату"><AmountInput id="cf-rate" value={f.rate} onChange={v => set({ rate: v })} cur={f.cur} onCur={c => set({ cur: c })} placeholder="45" /></Field>
      <Field label="Старт відліку" hint="З цієї дати рахується наступна оплата"><DateInput id="cf-start" value={f.start} onChange={v => set({ start: v })} /></Field>
      <Field label="Тип оплати" hint={f.payMode === 'prepaid' ? 'Спочатку платить, потім користується' : 'Спочатку користується, платить наприкінці місяця'}>
        <Segmented value={f.payMode} onChange={v => set({ payMode: v })} options={[{ value: 'prepaid', label: 'Передплата' }, { value: 'postpaid', label: 'Постоплата' }]} />
      </Field>
      <Field label="Бонусні дні" hint="Безкоштовні дні на старті: зсувають початок відліку"><TextInput id="cf-bonusdays" value={f.bonusDays} onChange={v => set({ bonusDays: v.replace(/\D/g, '') })} inputMode="numeric" placeholder="0" /></Field>
      <Field label="Разова плата (розробка)" hint="Не впливає на дати оренди"><AmountInput id="cf-setup" value={f.setup} onChange={v => set({ setup: v })} cur={f.setupCur} onCur={c => set({ setupCur: c })} placeholder="0" /></Field>
      <Field label="Телефон"><TextInput id="cf-phone" value={f.phone} onChange={v => set({ phone: v })} type="tel" inputMode="tel" placeholder="+380…" /></Field>
      <Field label="Telegram"><TextInput id="cf-tg" value={f.tg} onChange={v => set({ tg: v })} placeholder="@username" /></Field>
      {!editing && (
        <Field label="Як прийшов">
          <Segmented value={f.source} onChange={v => set({ source: v })} options={[{ value: 'self', label: 'Сам' }, { value: 'ref', label: 'Приведений' }]} />
          {f.source === 'ref' && (
            <div className="stack" style={{ marginTop: 10 }}>
              <select className="input" value={f.referredBy} onChange={e => set({ referredBy: e.target.value })}>
                <option value="">Хто привів?</option>
                {d.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="field-label">Бонус запрошувачу</div>
              <Chips accent value={f.bonus} onChange={v => set({ bonus: v })} items={BONUS_OPTS} />
              <div className="hint" style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Нарахується сам, коли новий орендар пробуде з оплатою щонайменше місяць</div>
            </div>
          )}
        </Field>
      )}
      {err && <div className="pill neg" style={{ marginTop: 14, height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>{err}</div>}
    </Sheet>
  )
}

const QUICK = [1, 3, 6, 12]

export function PaySheet({ sheetId, closing, clientId }) {
  const d = useDerived()
  const m = useMoney()
  const c = d.clients.find(x => x.id === clientId)
  const [mode, setMode] = useState('months')
  const [months, setMonths] = useState('1')
  const [amount, setAmount] = useState('')
  const [cur, setCur] = useState(c ? c.cur : 'USD')
  const [date, setDate] = useState(toISO(today()))
  if (!c) return <Sheet sheetId={sheetId} closing={closing} title="Оплата"><Empty title="Орендаря не знайдено" /></Sheet>

  const mNum = mode === 'months' ? (parseAmount(months) || 0) : (c.rate > 0 ? m.convert(parseAmount(amount) || 0, cur, c.cur) / c.rate : 0)
  const amountNative = mNum * c.rate
  const before = nextPayDate(c)
  const after = c.payMode === 'postpaid' ? addMonthsDays(parseDate(date), 1) : addMonthsDays(effectiveStart(c), totalMonths(c) + mNum + (c.bonusMonths || 0))
  const ok = mNum > 0

  const confirm = () => {
    if (!ok) return
    const first = !(c.payments || []).length
    addPayment(c.id, { months: Math.round(mNum * 10000) / 10000, amountNative: Math.round(amountNative * 100) / 100, cur: c.cur, date })
    toast(`Зараховано ${formatMoney(amountNative, c.cur)} · ${fmtMonthsDays(mNum)}`, { kind: 'success' })
    if (first || mNum >= 6) burstConfetti()
    closeSheet(sheetId)
  }

  return (
    <Sheet sheetId={sheetId} closing={closing} title={'Оплата · ' + c.name}
      footer={<button className="btn primary" disabled={!ok} onClick={confirm}><Icon.check />Зарахувати {ok ? formatMoney(amountNative, c.cur) : ''}</button>}>
      <Segmented value={mode} onChange={setMode} options={[{ value: 'months', label: 'За періодом' }, { value: 'money', label: 'За сумою' }]} />
      {mode === 'months' ? (
        <div style={{ marginTop: 18 }}>
          <input className="big-input num" inputMode="decimal" value={months} onChange={e => setMonths(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0" aria-label="Кількість місяців" />
          <div style={{ textAlign: 'center', color: 'var(--text-2)', fontWeight: 600, marginTop: -2 }}>{mNum > 0 ? fmtMonthsDays(mNum) : 'місяців'}</div>
          <div className="chips" style={{ justifyContent: 'center', marginTop: 14 }}>
            {QUICK.map(q => <button key={q} className={'chip' + (parseAmount(months) === q ? ' on' : '')} onClick={() => { haptic.select(); setMonths(String(q)) }}>{q} міс</button>)}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <Field label="Сума, яку отримав" hint="Період порахується за ставкою орендаря"><AmountInput value={amount} onChange={setAmount} cur={cur} onCur={setCur} autoFocus /></Field>
        </div>
      )}
      <Field label="Дата оплати"><DateInput value={date} onChange={setDate} /></Field>
      <div className="preview">
        {ok ? (
          <>
            <span>Сума</span>
            <span className="big num">{formatMoney(amountNative, c.cur)}{c.cur !== m.display ? <span className="muted" style={{ fontSize: 15, fontWeight: 600 }}> ≈ {m.fmtFrom(amountNative, c.cur)}</span> : null}</span>
            <div style={{ marginTop: 8 }}>{c.payMode === 'postpaid' ? 'Наступна оплата' : 'Оплачено до'}: <b>{fmtDate(after)}</b> <span className="faint">(було {fmtDate(before)})</span></div>
          </>
        ) : 'Вкажи період або суму — тут зʼявиться розрахунок'}
      </div>
    </Sheet>
  )
}

export function PickClientSheet({ sheetId, closing }) {
  const d = useDerived()
  const m = useMoney()
  const list = useMemo(() => d.clients.map(c => ({ c, st: statusOf(c) })).sort((a, b) => a.st.days - b.st.days), [d.clients])
  return (
    <Sheet sheetId={sheetId} closing={closing} title="Від кого оплата?">
      {list.length ? (
        <div className="list">
          {list.map(({ c, st }) => (
            <button key={c.id} className="list-row" onClick={() => replaceSheet('pay', { clientId: c.id })}>
              <Avatar name={c.name} />
              <div className="main"><div className="title">{c.name}</div><div className="meta num">{m.fmtFrom(c.rate, c.cur)}/міс</div></div>
              <span className={'pill ' + LEVEL_PILL[st.level]}>{nextPayText(st.days)}</span>
            </button>
          ))}
        </div>
      ) : <Empty icon={Icon.key} title="Ще немає орендарів" action={<button className="btn primary sm" onClick={() => replaceSheet('clientForm', {})}><Icon.plus />Додати орендаря</button>} />}
    </Sheet>
  )
}
