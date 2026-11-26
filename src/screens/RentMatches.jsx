// «Схоже на оплату»: надходження з банку, які відповідають орендарям, — зарахувати одним натиском.
import { useMemo } from 'react'
import { useDerived, useStore } from '../state/store.js'
import { openSheet } from '../state/ui.js'
import { skipRentMatch } from '../state/actions.js'
import { useMoney } from '../ui/money.jsx'
import { Icon } from '../ui/icons.jsx'
import { Section, IconTile } from '../ui/kit.jsx'
import { rentMatches } from '../lib/domain/rentmatch.js'
import { fmtDateShort, toISO } from '../lib/dates.js'
import { haptic } from '../lib/telegram.js'

export function useRentMatches() {
  const d = useDerived()
  const rows = useStore(s => s.data.ledger)
  const skip = useStore(s => s.settings.rentMatchSkip)
  const rates = useStore(s => s.settings.rates)
  return useMemo(() => (rows.length ? rentMatches(d.clients, rows, rates, { skip: skip || [] }) : []), [d.clients, rows, rates, skip])
}

export function RentMatches({ title = 'Схоже на оплату' }) {
  const list = useRentMatches()
  const m = useMoney()
  if (!list.length) return null
  return (
    <Section title={title}>
      <div className="list">
        {list.map(x => (
          <div key={x.id} className="list-row static" style={{ alignItems: 'flex-start' }}>
            <IconTile icon={Icon.arrowDown} color="var(--pos)" bg="var(--pos-soft)" />
            <div className="main">
              <div className="title ellipsis">{x.client.name}</div>
              <div className="meta ellipsis">{x.row.title} · <span className="pos num">+{m.native(x.row.amount, x.row.currency)}</span> · {fmtDateShort(new Date(x.row.date))}</div>
              <div className="meta">{x.months} міс · {x.strong ? 'збігаються імʼя й сума' : 'збігається сума'}</div>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button className="btn sm primary" onClick={() => { haptic.tap(); openSheet('pay', { clientId: x.client.id, initialMonths: x.months, initialDate: toISO(new Date(x.row.date)), matchId: x.id }) }}>
                  <Icon.check />Зарахувати
                </button>
                <button className="btn sm" onClick={() => { haptic.select(); skipRentMatch(x.id) }}>Не те</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
