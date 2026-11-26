// Ліміти витрат на місяць по категоріях Expense·Control: скільки вже витрачено, скільки в середньому, межа.
import { useMemo, useState } from 'react'
import { Sheet } from '../ui/sheet.jsx'
import { useDerived, useStore } from '../state/store.js'
import { setBudget } from '../state/actions.js'
import { useMoney } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Empty, Bar } from '../ui/kit.jsx'
import { expensesByCategory } from '../lib/domain/overview.js'
import { parseAmount, formatMoney } from '../lib/money.js'
import { haptic } from '../lib/telegram.js'

// Витрачено цього місяця і в середньому за три попередні — по категоріях (у USD)
export function useCategorySpend() {
  const d = useDerived()
  const rates = useStore(s => s.settings.rates)
  return useMemo(() => {
    const now = new Date()
    const month = (i) => [new Date(now.getFullYear(), now.getMonth() - i, 1).getTime(), new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime()]
    const [from, to] = month(0)
    const cur = Object.fromEntries(expensesByCategory(d.expenses, d.expenseCats, from, to, rates).map(x => [x.id, x.usd]))
    const avg = {}
    for (let i = 1; i <= 3; i++) {
      const [f, t] = month(i)
      for (const x of expensesByCategory(d.expenses, d.expenseCats, f, t, rates)) avg[x.id] = (avg[x.id] || 0) + x.usd / 3
    }
    return { cur, avg }
  }, [d.expenses, d.expenseCats, rates])
}

// Частка ліміту → колір: до 80% спокійно, 80–100% увага, понад — червоний
export const budgetColor = p => (p > 1 ? 'var(--neg)' : p >= 0.8 ? 'var(--warn)' : 'var(--pos)')

function Row({ cat, spentUSD, avgUSD, budget }) {
  const m = useMoney()
  const limitUSD = budget ? m.toUSD(budget.amount, budget.cur) : 0
  const shown = budget ? String(Math.round(m.convert(budget.amount, budget.cur, m.display))) : ''
  const [val, setVal] = useState(shown)
  const save = () => {
    const n = parseAmount(val)
    const next = Number.isFinite(n) && n > 0 ? n : 0
    if (Math.round(next) === Math.round(parseAmount(shown) || 0)) return
    haptic.select()
    setBudget(cat.id, next, m.display)
  }
  const p = limitUSD > 0 ? spentUSD / limitUSD : 0
  return (
    <div className="budget-row">
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="ellipsis" style={{ fontWeight: 650 }}>{cat.name}</div>
          <div className="muted num" style={{ fontSize: 12.5, marginTop: 2 }}>
            цього місяця {m.fmt(spentUSD)}{avgUSD > 0.5 ? <> · в середньому {m.fmt(avgUSD)}</> : null}
          </div>
        </div>
        <div className="budget-input">
          <input className="input num" inputMode="decimal" placeholder="без ліміту" value={val}
            onChange={e => setVal(e.target.value.replace(/[^0-9.,\s]/g, ''))} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            aria-label={'Ліміт: ' + cat.name} />
          <span className="faint">{formatMoney(0, m.display).replace(/[\d\s., ]/g, '') || m.display}</span>
        </div>
      </div>
      {limitUSD > 0 && <div style={{ marginTop: 10 }}><Bar thin value={p} color={budgetColor(p)} /></div>}
      {!budget && avgUSD > 0.5 && (
        <button className="link" style={{ fontSize: 13, marginTop: 8 }} onClick={() => { const v = Math.ceil(m.toDisplay(avgUSD) / 10) * 10; setVal(String(v)); haptic.select(); setBudget(cat.id, v, m.display) }}>
          Поставити як у середньому · {formatMoney(Math.ceil(m.toDisplay(avgUSD) / 10) * 10, m.display)}
        </button>
      )}
    </div>
  )
}

export function BudgetsSheet({ sheetId, closing }) {
  const d = useDerived()
  const budgets = useStore(s => s.settings.budgets) || {}
  const { cur, avg } = useCategorySpend()
  const cats = [...d.expenseCats].sort((a, b) => (cur[b.id] || 0) - (cur[a.id] || 0) || (avg[b.id] || 0) - (avg[a.id] || 0) || a.name.localeCompare(b.name, 'uk'))
  return (
    <Sheet sheetId={sheetId} closing={closing} title="Ліміти витрат">
      <div className="muted" style={{ fontSize: 13.5, margin: '0 2px 14px', lineHeight: 1.45 }}>
        Межа на місяць для категорії. У «Пульсі» видно, скільки з неї вже витрачено; від 80% смужка жовтіє, понад ліміт — червоніє.
      </div>
      {cats.length ? (
        <div className="list">{cats.map(c => <Row key={c.id} cat={c} spentUSD={cur[c.id] || 0} avgUSD={avg[c.id] || 0} budget={budgets[c.id]} />)}</div>
      ) : <div className="card"><Empty icon={Icon.list} title="Категорій немає" text="Категорії беруться з Expense·Control." /></div>}
    </Sheet>
  )
}
