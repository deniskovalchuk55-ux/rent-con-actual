// Вікна інтеграцій: підключення банків і бірж (інструкції + статус) та імпорт виписки Монобанку з переглядом.
import { useEffect, useMemo, useState } from 'react'
import { Sheet } from '../ui/sheet.jsx'
import { useStore } from '../state/store.js'
import { closeSheet, toast, openSheet } from '../state/ui.js'
import { refreshBalances, setMonoWebhook, monoPreview, importExpenses, canSeeBanks } from '../state/finance.js'
import { getAuthMode } from '../lib/notion/api.js'
import { useMoney } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Switch, Chips, Empty, IconTile } from '../ui/kit.jsx'
import { ProviderBadge } from '../screens/Accounts.jsx'
import { fmtDateShort, plural } from '../lib/dates.js'
import { haptic } from '../lib/telegram.js'

function copy(text, what = 'Скопійовано') {
  haptic.tap()
  try {
    navigator.clipboard.writeText(text).then(() => toast(what, { kind: 'success', duration: 1800 }), () => toast(text, { duration: 4000 }))
  } catch { toast(text, { duration: 4000 }) }
}

// Назва змінної середовища — натиснув, і скопіювалось
function Env({ name, value }) {
  return <button className="env-chip" onClick={() => copy(value != null ? value : name, value != null ? 'Значення скопійовано' : name + ' скопійовано')}>{name}{value != null ? ' = ' + value : ''}</button>
}

function Status({ ok, warn, text }) {
  const cls = ok ? 'pos' : warn ? 'warn' : 'neutral'
  return <span className={'pill ' + cls}>{ok && <Icon.check style={{ width: 12 }} />}{text}</span>
}

function Block({ badge, icon, title, status, children }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 12 }}>
        {badge ? <ProviderBadge provider={badge} size={36} /> : <IconTile icon={icon} />}
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 16 }}>{title}</div>
        {status}
      </div>
      {children}
    </div>
  )
}

export function IntegrationsSheet({ sheetId, closing }) {
  const fin = useStore(s => s.finance)
  const user = useStore(s => s.user)
  const st = fin.status
  const [busy, setBusy] = useState(false)
  useEffect(() => { refreshBalances({ force: true }) }, [])
  const prov = name => (fin.providers || []).find(p => p.provider === name)
  const auth = st ? st.auth : getAuthMode()
  const configured = name => !!(st && st.providers && st.providers[name])
  const live = name => { const p = prov(name); return p ? (p.ok ? 'ok' : 'error') : null }
  const statusOf = name => {
    if (!configured(name)) return <Status text="не підключено" />
    if (!canSeeBanks(st)) return <Status warn text="потрібен захист" />
    const l = live(name)
    return l === 'ok' ? <Status ok text="працює" /> : l === 'error' ? <Status warn text="помилка" /> : <Status text="перевіряю…" />
  }
  const mono = prov('mono')
  const ownerId = user ? String(user.id) : 'твій ID'

  return (
    <Sheet sheetId={sheetId} closing={closing} title="Підключення">
      <div className="muted" style={{ fontSize: 13.5, margin: '0 2px 14px', lineHeight: 1.45 }}>
        Ключі додаються лише у Vercel → проєкт → Settings → Environment Variables. Застосунок їх не бачить: усе читає сервер. Після зміни змінних натисни у Vercel <b>Redeploy</b>.
      </div>

      <div className="stack">
        <Block icon={Icon.shield} title="Захист даних" status={auth === 'on' ? <Status ok text="увімкнено" /> : <Status warn text="вимкнено" />}>
          {auth === 'on' && st && st.setup && st.setup.owner ? (
            <div className="muted" style={{ fontSize: 13.5, marginTop: 10 }}>Сервер перевіряє підпис Telegram і віддає тільки твої записи. Банки й біржі бачить лише власник.</div>
          ) : (
            <ol className="howto">
              <li>У @BotFather: /mybots → твій бот → <b>API Token</b>. Додай як <Env name="TG_BOT_TOKEN" />.</li>
              <li>Додай <Env name="OWNER_TG_ID" value={ownerId} /> — це твій Telegram ID.</li>
              <li>Redeploy у Vercel. Після цього дані не віддаються нікому, крім тебе.</li>
            </ol>
          )}
        </Block>

        {st && st.auth === 'on' && st.setup && st.setup.owner && !st.owner ? (
          <div className="card"><Empty icon={Icon.bank} title="Рахунки бачить лише власник" text="Ключі банків і бірж належать іншому Telegram-акаунту." /></div>
        ) : <>
        <Block badge="mono" title="Монобанк" status={statusOf('mono')}>
          {!configured('mono') ? (
            <ol className="howto">
              <li>Відкрий <b>api.monobank.ua</b> і проскануй QR у застосунку Монобанку.</li>
              <li>Скопіюй токен і додай як <Env name="MONO_TOKEN" />.</li>
              <li>Токен дає лише перегляд балансів і виписки — переказати гроші ним не можна.</li>
            </ol>
          ) : mono && mono.ok ? (
            <div className="stack" style={{ marginTop: 12 }}>
              <Switch on={mono.webhook === 'on'} onChange={async v => { setBusy(true); await setMonoWebhook(v); setBusy(false) }}
                label="Записувати витрати самі" sub={mono.webhook === 'other' ? 'Зараз вебхук Монобанку веде на інший сервіс — увімкнення його замінить' : 'Кожна оплата карткою одразу потрапляє у витрати Expense·Control'} />
              <button className="btn sm" style={{ width: '100%' }} disabled={busy} onClick={() => openSheet('monoImport')}><Icon.download />Імпортувати виписку за 31 день</button>
            </div>
          ) : mono && !mono.ok ? <div className="muted" style={{ fontSize: 13.5, marginTop: 10 }}>{mono.error}</div> : null}
        </Block>

        {[
          { name: 'bybit', title: 'Bybit', vars: ['BYBIT_API_KEY', 'BYBIT_API_SECRET'], where: 'Профіль → API → Create New Key → System-generated, права лише Read-Only' },
          { name: 'bingx', title: 'BingX', vars: ['BINGX_API_KEY', 'BINGX_API_SECRET'], where: 'Профіль → API Management → Create API, лише Read' },
          { name: 'mexc', title: 'MEXC', vars: ['MEXC_API_KEY', 'MEXC_API_SECRET'], where: 'Профіль → API Management → Create, лише View/Read' },
        ].map(x => {
          const p = prov(x.name)
          return (
            <Block key={x.name} badge={x.name} title={x.title} status={statusOf(x.name)}>
              {configured(x.name) && p && !p.ok && <div style={{ fontSize: 13.5, marginTop: 10, color: 'var(--neg)' }}>{p.error}</div>}
              {(!configured(x.name) || (p && !p.ok)) && (
                <ol className="howto">
                  <li>{x.where}. <b>Без</b> дозволів на торгівлю й виведення.</li>
                  <li>Не привʼязуй ключ до IP: у сервера немає сталої адреси.</li>
                  <li>Додай <Env name={x.vars[0]} /> і <Env name={x.vars[1]} />.</li>
                  {x.name === 'bybit' && <li>Bybit EU (bybit.eu) визначиться сам.</li>}
                </ol>
              )}
              {configured(x.name) && p && p.ok && <div className="muted" style={{ fontSize: 13.5, marginTop: 10 }}>{(p.holdings || []).length} {plural((p.holdings || []).length, 'позиція', 'позиції', 'позицій')} · монети також у «Активах»</div>}
            </Block>
          )
        })}

        <Block badge="enablebanking" title="Польські банки" status={<Status text="наступний етап" />}>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 10 }}>PKO, mBank, Pekao, Santander, Revolut та інші — через Enable Banking (офіційний PSD2, безкоштовно для власних рахунків). Підключаю наступним кроком.</div>
        </Block>
        </>}
      </div>

      <button className="btn primary" style={{ width: '100%', marginTop: 16 }} disabled={fin.loading} onClick={() => refreshBalances({ force: true, silent: false })}>
        <Icon.refresh className={fin.loading ? 'spin' : ''} />Перевірити підключення
      </button>
    </Sheet>
  )
}

/* ===== Імпорт виписки Монобанку ===== */
const KIND_LABEL = { transfer: 'переказ', cash: 'готівка', income: 'надходження' }

export function MonoImportSheet({ sheetId, closing }) {
  const fin = useStore(s => s.finance)
  const m = useMoney()
  const mono = (fin.providers || []).find(p => p.provider === 'mono')
  const cards = mono && mono.ok ? mono.accounts.filter(a => a.kind === 'card') : []
  const [acc, setAcc] = useState(cards[0] ? cards[0].ref : null)
  const [state, setStateL] = useState({ phase: 'idle' }) // idle | loading | ready | error | importing | done
  const [sel, setSel] = useState({})
  const [cats, setCats] = useState({})
  const [showOther, setShowOther] = useState(false)
  const [wait, setWait] = useState(0)

  const load = async () => {
    if (!acc) return
    setStateL({ phase: 'loading' })
    try {
      const r = await monoPreview(acc, 31)
      const s = {}, c = {}
      for (const it of r.items) if (it.expense && !it.exists) { s[it.bankId] = true; c[it.bankId] = it.expense.categoryId || '' }
      setSel(s); setCats(c)
      setStateL({ phase: 'ready', data: r })
    } catch (e) {
      if (e.status === 429) setWait(60)
      setStateL({ phase: 'error', error: e.message })
    }
  }
  useEffect(() => { load() }, [acc])
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(w => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const data = state.data
  const expenses = data ? data.items.filter(i => i.expense) : []
  const other = data ? data.items.filter(i => !i.expense) : []
  const chosen = expenses.filter(i => sel[i.bankId] && !i.exists)
  const totalUSD = chosen.reduce((s, i) => s + m.toUSD(i.expense.amount, i.expense.currency), 0)
  const catOptions = data ? data.categories : []

  const run = async () => {
    const items = chosen.map(i => ({ ...i.expense, categoryId: cats[i.bankId] || null }))
    setStateL(s => ({ ...s, phase: 'importing', done: 0, total: items.length }))
    try {
      const r = await importExpenses(items, (done, total) => setStateL(s => ({ ...s, done, total })))
      haptic.success()
      toast(`Записано ${r.created} ${plural(r.created, 'витрату', 'витрати', 'витрат')} у Expense·Control` + (r.duplicates ? ` · ${r.duplicates} вже були` : ''), { kind: 'success', duration: 4000 })
      closeSheet(sheetId)
    } catch (e) {
      haptic.error()
      toast(e.message || 'Не вдалось записати', { kind: 'error', duration: 5000 })
      setStateL(s => ({ ...s, phase: 'ready' }))
    }
  }

  const footer = state.phase === 'ready' || state.phase === 'importing' ? (
    <button className="btn primary" style={{ width: '100%' }} disabled={!chosen.length || state.phase === 'importing'} onClick={run}>
      {state.phase === 'importing' ? <>Записую {state.done || 0} з {state.total}…</> : chosen.length ? <>Записати {chosen.length} · {m.fmt(totalUSD)}</> : 'Нічого не вибрано'}
    </button>
  ) : null

  return (
    <Sheet sheetId={sheetId} closing={closing} title="Виписка Монобанку" footer={footer}>
      {!cards.length ? (
        <Empty icon={Icon.bank} title="Немає карток" text="Підключи Монобанк у розділі «Підключення»." />
      ) : (
        <>
          {cards.length > 1 && <div style={{ marginBottom: 12 }}><Chips items={cards.map(c => ({ value: c.ref, label: `${c.name} ${c.mask}` }))} value={acc} onChange={setAcc} /></div>}
          <div className="muted" style={{ fontSize: 13, margin: '0 2px 12px' }}>Останній 31 день. Перекази між своїми рахунками, готівка й надходження не рахуються витратами. Те, що вже є в Expense·Control, не задублюється.</div>

          {state.phase === 'loading' && <div className="stack">{[0, 1, 2, 3].map(i => <div key={i} className="sk" style={{ height: 54, borderRadius: 14 }} />)}</div>}

          {state.phase === 'error' && (
            <div className="card">
              <Empty icon={Icon.alert} title="Не вдалось отримати виписку" text={state.error}
                action={<button className="btn sm" disabled={wait > 0} onClick={load}><Icon.refresh />{wait > 0 ? `Ще раз через ${wait} с` : 'Спробувати ще'}</button>} />
            </div>
          )}

          {data && state.phase !== 'loading' && state.phase !== 'error' && (
            <>
              {expenses.length ? (
                <>
                  <div className="row" style={{ justifyContent: 'space-between', margin: '0 2px 8px' }}>
                    <span className="label">Витрати · {expenses.length}</span>
                    <button className="link" onClick={() => {
                      const all = expenses.filter(i => !i.exists).every(i => sel[i.bankId])
                      const s = {}
                      for (const i of expenses) if (!i.exists) s[i.bankId] = !all
                      setSel(s)
                    }}>{expenses.filter(i => !i.exists).every(i => sel[i.bankId]) ? 'Зняти всі' : 'Вибрати всі'}</button>
                  </div>
                  <div className="list">
                    {expenses.map(i => {
                      const on = !!sel[i.bankId] && !i.exists
                      return (
                        <div key={i.bankId} className={'imp-row' + (i.exists ? ' off' : '')}>
                          <button className={'imp-check' + (on ? ' on' : '')} disabled={i.exists} aria-label={on ? 'Не записувати' : 'Записати'}
                            onClick={() => { haptic.select(); setSel(s => ({ ...s, [i.bankId]: !s[i.bankId] })) }}>{on && <Icon.check style={{ width: 14 }} />}</button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{i.title}</div>
                            <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'nowrap' }}>
                              <span className="faint num" style={{ fontSize: 12.5, flexShrink: 0 }}>{fmtDateShort(i.date)}</span>
                              {i.exists ? <span className="faint" style={{ fontSize: 12.5 }}>вже записано</span> : (
                                <select className="cat-select" value={cats[i.bankId] || ''} onChange={e => setCats(c => ({ ...c, [i.bankId]: e.target.value }))} aria-label="Категорія">
                                  <option value="">Без категорії</option>
                                  {catOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              )}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div className="num" style={{ fontWeight: 650 }}>{m.native(i.expense.amount, i.expense.currency)}</div>
                            {i.opCurrency !== i.accountCurrency && <div className="faint num" style={{ fontSize: 12 }}>{m.native(i.amountOp, i.opCurrency)}</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : <div className="card"><Empty icon={Icon.check} title="Витрат немає" text="За цей період оплат карткою не знайдено." /></div>}

              {other.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <button className="link" onClick={() => setShowOther(v => !v)}>{showOther ? 'Сховати' : 'Показати'} інші операції · {other.length}</button>
                  {showOther && (
                    <div className="list" style={{ marginTop: 8 }}>
                      {other.map(i => (
                        <div key={i.bankId} className="imp-row off">
                          <span className="imp-check" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{i.title}</div>
                            <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>{fmtDateShort(i.date)} · {KIND_LABEL[i.kind] || i.kind}</div>
                          </div>
                          <div className="num" style={{ fontWeight: 650, color: i.kind === 'income' ? 'var(--pos)' : 'var(--text-2)' }}>{i.kind === 'income' ? '+' : ''}{m.native(i.amountAccount, i.accountCurrency)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  )
}
