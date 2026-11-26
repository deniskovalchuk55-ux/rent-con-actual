// «Капітал → Рахунки»: гроші на картках Монобанку, у банках і на біржах — разом і окремо.
import { useEffect, useState } from 'react'
import { useStore } from '../state/store.js'
import { openSheet } from '../state/ui.js'
import { refreshBalances, anyProvider, canSeeBanks, ledgerReady, enableHistory } from '../state/finance.js'
import { flowSummary, recurringPayments } from '../lib/domain/ledger.js'
import { fmtDateShort } from '../lib/dates.js'
import { useMoney, Money } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Empty, Skeleton, Section, IconTile } from '../ui/kit.jsx'
import { financeTotals, providerTotalUSD, exchangeCoins, holdingUSD, fmtAgo, PROVIDER_META, CG_IDS } from '../lib/domain/finance.js'
import { fmtQty } from '../lib/domain/capital.js'
import { plural } from '../lib/dates.js'
import { haptic } from '../lib/telegram.js'

export function ProviderBadge({ provider, size = 40 }) {
  const meta = PROVIDER_META[provider] || { letter: '?', color: 'var(--card-3)' }
  return (
    <div className="prov-badge" style={{ width: size, height: size, background: meta.color, fontSize: size * 0.36 }} aria-hidden>
      {meta.letter}
    </div>
  )
}

export function CoinBadge({ asset, size = 40 }) {
  const meta = useStore(s => s.finance.coinMeta[CG_IDS[asset]])
  const [err, setErr] = useState(false)
  if (meta && meta.image && !err) return <img src={meta.image} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', background: 'var(--card-2)', flexShrink: 0 }} onError={() => setErr(true)} />
  return <div className="avatar" style={{ width: size, height: size, borderRadius: '50%', background: 'var(--card-3)', color: 'var(--text)', fontSize: 12 }}>{String(asset).slice(0, 4)}</div>
}

export function Accounts() {
  const fin = useStore(s => s.finance)
  const rates = useStore(s => s.settings.rates)
  const m = useMoney()
  const [, tick] = useState(0)
  useEffect(() => { refreshBalances() }, [])
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t) }, [])

  const st = fin.status
  if (!st && !fin.statusError && !fin.providers.length) {
    return <div className="stack"><Skeleton h={170} r={26} /><Skeleton h={120} r={20} /><Skeleton h={120} r={20} /></div>
  }
  if (!fin.providers.length && (!st || !anyProvider(st) || !canSeeBanks(st))) return <SetupCard st={st} error={fin.statusError} />

  const totals = financeTotals(fin.providers, rates)
  const banks = fin.providers.filter(p => p.accounts || (PROVIDER_META[p.provider] || {}).kind === 'bank')
  const exchanges = fin.providers.filter(p => p.holdings || (PROVIDER_META[p.provider] || {}).kind === 'exchange')
  const share = totals.totalUSD > 0 ? totals.banksUSD / totals.totalUSD : 0
  const missing = st ? Object.entries(st.providers || {}).filter(([k, on]) => !on && k !== 'enablebanking').map(([k]) => k) : []

  return (
    <div className="stagger">
      <div className="hero">
        <div className="hero-top">
          <span className="label" style={{ color: 'var(--text-2)' }}>На рахунках і біржах</span>
          <button className="pill neutral" onClick={() => { haptic.tap(); refreshBalances({ force: true, silent: false }) }} aria-label="Оновити баланси">
            <Icon.refresh style={{ width: 13 }} className={fin.loading ? 'spin' : ''} />{fin.loading ? 'оновлюю…' : fmtAgo(fin.fetchedAt)}
          </button>
        </div>
        <div className="hero-amount"><Money usd={totals.totalUSD} fromZero /></div>
        <div className="hero-sub">Банки <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(totals.banksUSD)}</b> · Біржі <b className="num" style={{ color: 'var(--text)' }}>{m.fmt(totals.exchangesUSD)}</b></div>
        {totals.totalUSD > 0 && (
          <div className="split-bar" aria-hidden>
            <i style={{ width: (share * 100).toFixed(1) + '%', background: 'var(--blue)' }} />
            <i style={{ width: ((1 - share) * 100).toFixed(1) + '%', background: 'var(--accent)' }} />
          </div>
        )}
      </div>

      {banks.map(p => <BankSection key={p.provider} p={p} />)}
      {exchanges.map(p => <ExchangeSection key={p.provider} p={p} />)}

      <HistoryCard />

      {missing.length > 0 && (
        <Section title="Ще можна підключити">
          <button className="card pressable row" style={{ width: '100%', textAlign: 'left' }} onClick={() => openSheet('integrations')}>
            <div className="badge-stack">{missing.map(k => <ProviderBadge key={k} provider={k} size={32} />)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650 }}>{missing.map(k => PROVIDER_META[k].label).join(', ')}</div>
              <div className="muted" style={{ fontSize: 13 }}>Покроково: де взяти ключі й куди вставити</div>
            </div>
            <Icon.chevronRight style={{ width: 18, color: 'var(--text-3)' }} />
          </button>
        </Section>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn" style={{ width: '100%' }} onClick={() => openSheet('integrations')}><Icon.link />Підключення й автоімпорт витрат</button>
      </div>
    </div>
  )
}

// Історія операцій і аналітика по місяцях (база «Рух коштів» у Notion)
function HistoryCard() {
  const fin = useStore(s => s.finance)
  const rows = useStore(s => s.data.ledger)
  const rates = useStore(s => s.settings.rates)
  const m = useMoney()
  const [busy, setBusy] = useState(false)
  if (!ledgerReady(fin.status)) {
    const mono = (fin.providers || []).find(p => p.provider === 'mono')
    return (
      <Section title="Історія">
        <div className="card">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <IconTile icon={Icon.chart} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650 }}>Історія й аналітика по місяцях</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>Усі операції з карток і бірж зберігатимуться в Notion: видно будь-який місяць, а в «Пульсі» — скільки прийшло й пішло.{mono && mono.webhook === 'other' ? ' Вебхук Монобанку зараз веде на інший сервіс — його буде замінено.' : ''}</div>
            </div>
          </div>
          <button className="btn primary" style={{ width: '100%', marginTop: 14 }} disabled={busy} onClick={async () => { setBusy(true); await enableHistory(); setBusy(false) }}>
            <Icon.check />{busy ? 'Вмикаю…' : 'Увімкнути історію'}
          </button>
        </div>
      </Section>
    )
  }
  const now = new Date()
  const s = flowSummary(rows, new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Date.now() + 1, rates)
  const bf = fin.backfill
  const rec = recurringPayments(rows, rates)
  const recTotal = rec.reduce((acc, x) => acc + x.usd, 0)
  const nextRec = rec.filter(x => x.nextDate >= Date.now() - 864e5).sort((a, b) => a.nextDate - b.nextDate)[0]
  const rise = rec.filter(x => x.change && x.change.pct > 0).sort((a, b) => b.change.since - a.change.since)[0]
  return (
    <Section title="Історія">
      <button className="card pressable row" style={{ width: '100%', textAlign: 'left', gap: 12 }} onClick={() => { haptic.tap(); openSheet('history', {}) }}>
        <IconTile icon={Icon.chart} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650 }}>Усі операції по місяцях</div>
          <div className="muted num" style={{ fontSize: 13, marginTop: 2 }}>
            {bf && bf.running ? <>Підтягую {bf.label}…{bf.mins > 1 ? <> ще ~{bf.mins} хв</> : null}</> : <>Цього місяця: <span className="pos">+{m.fmt(s.in)}</span> · −{m.fmt(s.out)}</>}
          </div>
        </div>
        <Icon.chevronRight style={{ width: 18, color: 'var(--text-3)' }} />
      </button>
      {rec.length > 0 && (
        <button className="card pressable row" style={{ width: '100%', textAlign: 'left', gap: 12, marginTop: 10 }} onClick={() => { haptic.tap(); openSheet('recurring', {}) }}>
          <IconTile icon={Icon.repeat} color="var(--blue)" bg="var(--blue-soft)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650 }}>Регулярні платежі · <span className="num">{m.fmt(recTotal)}</span>/міс</div>
            {rise
              ? <div className="ellipsis" style={{ fontSize: 13, marginTop: 2, color: 'var(--warn)' }}>{rise.title} подорожчав на {Math.round(rise.change.pct * 100)}%</div>
              : <div className="muted ellipsis" style={{ fontSize: 13, marginTop: 2 }}>{nextRec ? <>Наступне: {nextRec.title}, {fmtDateShort(new Date(nextRec.nextDate))}</> : <>{rec.length} підписок і платежів</>}</div>}
          </div>
          <Icon.chevronRight style={{ width: 18, color: 'var(--text-3)' }} />
        </button>
      )}
    </Section>
  )
}

function SetupCard({ st, error }) {
  const user = useStore(s => s.user)
  const steps = [
    { ok: st && st.setup && st.setup.bot, label: 'Захист даних', sub: 'TG_BOT_TOKEN — токен твого бота' },
    { ok: st && st.setup && st.setup.owner, label: 'Власник', sub: 'OWNER_TG_ID = ' + (user ? user.id : 'твій ID') },
    { ok: st && st.providers && (st.providers.mono || st.providers.bybit || st.providers.bingx || st.providers.mexc), label: 'Банк або біржа', sub: 'MONO_TOKEN, ключі Bybit / BingX / MEXC' },
  ]
  const notOwner = st && st.auth === 'on' && st.setup && st.setup.owner && !st.owner
  return (
    <div className="stagger">
      <div className="card">
        <Empty icon={Icon.bank} title={notOwner ? 'Рахунки бачить лише власник' : 'Усі гроші в одному місці'}
          text={notOwner ? 'Ключі банків і бірж належать іншому Telegram-акаунту.' : 'Картки Монобанку, польські банки й біржі — з балансами в реальному часі, а витрати з карток самі потрапляють у звіти.'} />
        {!notOwner && (
          <div className="stack" style={{ marginTop: 4 }}>
            {steps.map(s => (
              <div key={s.label} className="row" style={{ gap: 12 }}>
                <span className={'step-dot ' + (s.ok ? 'ok' : '')}>{s.ok ? <Icon.check style={{ width: 14 }} /> : null}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, fontSize: 15 }}>{s.label}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Сервер: {error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 16 }} onClick={() => openSheet('integrations')}><Icon.link />Як підключити</button>
      </div>
    </div>
  )
}

function ProviderError({ p }) {
  const hint = p.code === 'region' ? 'Сервер у Франкфурті; якщо біржа не працює з Німеччиною — напиши, перенесемо.'
    : p.code === 'ip' ? 'У налаштуваннях ключа на біржі прибери привʼязку до IP.'
      : p.code === 'rate' ? 'Почекай хвилину й онови.'
        : p.code === 'expired' ? 'Створи новий ключ і заміни його у Vercel.' : ''
  return (
    <div className="card" style={{ borderColor: 'var(--neg-soft)' }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon.alert style={{ width: 18, color: 'var(--neg)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{p.error || 'Не вдалось отримати дані'}</div>
          {hint && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{hint}</div>}
        </div>
      </div>
    </div>
  )
}

// Історія рахунку (якщо історія ще не ввімкнена — вікно запропонує її ввімкнути)
const openHistory = source => { haptic.tap(); openSheet('history', { source }) }

function BankSection({ p }) {
  const m = useMoney()
  const rates = useStore(s => s.settings.rates)
  const total = providerTotalUSD(p, rates)
  const cards = (p.accounts || []).filter(a => a.kind !== 'jar')
  const jars = (p.accounts || []).filter(a => a.kind === 'jar')
  return (
    <Section title={p.label} action={p.ok ? <span className="num muted" style={{ fontSize: 14, fontWeight: 650 }}>{m.fmt(total)}</span> : null}>
      {!p.ok ? <ProviderError p={p} /> : (
        <div className="stack">
          <div className="list">
            {cards.map(a => (
              <button key={a.id} className="list-row" onClick={() => openHistory(a.name + (a.mask ? ' ' + a.mask : ''))}>
                <IconTile icon={Icon.wallet} color="var(--text)" bg="var(--card-3)" />
                <div className="main">
                  <div className="title">{a.name} <span className="faint" style={{ fontWeight: 500, fontSize: 13 }}>{a.mask}</span></div>
                  <div className="meta">{a.creditLimit > 0 ? `кредитний ліміт ${m.native(a.creditLimit, a.currency)}` : a.currency}</div>
                </div>
                <div className="end">
                  <div className={'amount ' + (a.balance < 0 ? 'neg' : '')}>{m.native(a.balance, a.currency)}</div>
                  {a.currency !== m.display && <div className="meta num">{m.fmtFrom(a.balance, a.currency)}</div>}
                </div>
              </button>
            ))}
            {jars.map(a => (
              <button key={a.id} className="list-row" onClick={() => openHistory('Банка «' + a.name + '»')}>
                <IconTile icon={Icon.target} color="var(--pos)" bg="var(--pos-soft)" />
                <div className="main">
                  <div className="title">{a.name}</div>
                  {a.goal ? (
                    <div className="meta">
                      <div className="mini-bar"><i style={{ width: Math.min(100, (a.balance / a.goal) * 100).toFixed(1) + '%' }} /></div>
                      <span className="num">з {m.native(a.goal, a.currency)}</span>
                    </div>
                  ) : <div className="meta">банка</div>}
                </div>
                <div className="end"><div className="amount">{m.native(a.balance, a.currency)}</div></div>
              </button>
            ))}
          </div>
          {p.provider === 'mono' && (() => {
            const imp = p.webhook === 'on' && p.hookImport
            return (
            <button className="remind" onClick={() => openSheet(imp ? 'monoImport' : 'integrations')}>
              <span className="icon-tile" style={{ background: imp ? 'var(--pos-soft)' : 'var(--accent-soft)', color: imp ? 'var(--pos)' : 'var(--accent-text)' }}><Icon.bolt /></span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <b>{imp ? 'Витрати записуються самі' : 'Автоімпорт витрат вимкнено'}</b>
                <span className="muted">{imp ? 'Імпортувати ще й минулий місяць' : 'Увімкни — кожна оплата карткою потрапить у витрати'}</span>
              </span>
              <Icon.chevronRight style={{ width: 18, color: 'var(--text-3)' }} />
            </button>
            )
          })()}
        </div>
      )}
    </Section>
  )
}

function ExchangeSection({ p }) {
  const m = useMoney()
  const rates = useStore(s => s.settings.rates)
  const total = providerTotalUSD(p, rates)
  const coins = p.ok ? exchangeCoins([p], rates) : []
  const extras = (p.holdings || []).filter(h => h.approx || h.fiat)
  const [all, setAll] = useState(false)
  const shown = all ? coins : coins.slice(0, 5)
  return (
    <Section title={p.label} action={p.ok ? <span className="num muted" style={{ fontSize: 14, fontWeight: 650 }}>{m.fmt(total)}</span> : null}>
      {!p.ok ? <ProviderError p={p} /> : !coins.length && !extras.length ? (
        <div className="card muted" style={{ fontSize: 14 }}>На біржі порожньо</div>
      ) : (
        <div className="list">
          {shown.map(c => (
            <div key={c.asset} className="list-row static">
              <CoinBadge asset={c.asset} />
              <div className="main">
                <div className="title">{c.asset}</div>
                <div className="meta num">{fmtQty(c.qty)} · {[...new Set(c.parts.map(x => x.account))].join(', ')}</div>
              </div>
              <div className="end"><div className="amount">{m.fmt(c.usd)}</div></div>
            </div>
          ))}
          {extras.map((h, i) => (
            <div key={'x' + i} className="list-row static">
              <IconTile icon={h.fiat ? Icon.wallet : Icon.chart} color="var(--text-2)" bg="var(--card-3)" />
              <div className="main">
                <div className="title">{h.account}</div>
                <div className="meta">{h.fiat ? m.native(h.qty, h.fiat) : 'загалом у USDT'}</div>
              </div>
              <div className="end"><div className="amount">{m.fmt(holdingUSD(h, rates))}</div></div>
            </div>
          ))}
          {coins.length > 5 && (
            <button className="list-row" onClick={() => setAll(v => !v)} style={{ justifyContent: 'center' }}>
              <span className="link">{all ? 'Згорнути' : `Ще ${coins.length - 5} ${plural(coins.length - 5, 'монета', 'монети', 'монет')}`}</span>
            </button>
          )}
          <button className="list-row" onClick={() => openHistory(p.label)} style={{ justifyContent: 'center' }}>
            <span className="link">Історія поповнень і виведень</span>
          </button>
        </div>
      )}
    </Section>
  )
}
