// Відповідність типів вікон компонентам + рендер стосу.
import { useEffect } from 'react'
import { useUI } from '../state/ui.js'
import { ClientSheet, ClientFormSheet, PaySheet, PickClientSheet } from './rent.jsx'
import { WorkEntrySheet, CategorySheet, MonthSheet, PayoutSheet, DaySheet } from './work.jsx'
import { GoalSheet, GoalFormSheet, GoalTxSheet, LevelUpSheet, PickGoalSheet, AssetSheet, AssetSearchSheet, AssetTxSheet } from './capital.jsx'
import { QuickAddSheet, ConfirmSheet, SettingsSheet, RatesSheet } from './misc.jsx'

const MAP = {
  client: ClientSheet, clientForm: ClientFormSheet, pay: PaySheet, pickClient: PickClientSheet,
  workEntry: WorkEntrySheet, category: CategorySheet, month: MonthSheet, payout: PayoutSheet, day: DaySheet,
  goal: GoalSheet, goalForm: GoalFormSheet, goalTx: GoalTxSheet, levelUp: LevelUpSheet, pickGoal: PickGoalSheet,
  asset: AssetSheet, assetSearch: AssetSearchSheet, assetTx: AssetTxSheet,
  quickAdd: QuickAddSheet, confirm: ConfirmSheet, settings: SettingsSheet, rates: RatesSheet,
}

export function SheetHost() {
  const sheets = useUI(u => u.sheets)
  const open = sheets.length > 0
  // фон не прокручується, поки відкрите вікно
  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : ''
    document.body.style.overflow = open ? 'hidden' : ''
  }, [open])
  return sheets.map(s => {
    const C = MAP[s.type]
    if (!C) return null
    return <C key={s.id} sheetId={s.id} closing={s.closing} {...s.props} />
  })
}
