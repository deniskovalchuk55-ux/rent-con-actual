// Швидке додавання, налаштування, курси, підтвердження.
import { useState } from 'react'
import { useStore, getState, clearCache } from '../state/store.js'
import { openSheet, closeSheet, replaceSheet, toast } from '../state/ui.js'
import { setDisplay, setTheme, setModule, refreshRatesNow, setRatesManual, syncAll, setWorkMode } from '../state/actions.js'
import { Icon } from '../ui/icons.jsx'
import { Sheet } from '../ui/sheet.jsx'
import { Avatar, Field, Segmented, Switch, TextInput, KV, IconTile } from '../ui/kit.jsx'
import { CURRENCIES, SYM, CUR_NAME, parseAmount } from '../lib/money.js'
import { monthKeyOf, today, toISO } from '../lib/dates.js'
import { haptic } from '../lib/telegram.js'

export function QuickAddSheet({ sheetId, closing }) {
  const modules = useStore(s => s.settings.modules)
  const tiles = [
    modules.rent && { icon: Icon.wallet, label: 'Оплата від орендаря', color: 'var(--blue)', bg: 'var(--blue-soft)', go: () => replaceSheet('pickClient') },
    modules.work && { icon: Icon.clock, label: 'Робочі години', color: 'var(--accent-text)', bg: 'var(--accent-soft)', go: () => replaceSheet('workEntry', { kind: 'hourly', date: toISO(today()) }) },
    modules.work && { icon: Icon.bolt, label: 'Підробіток', color: 'var(--violet)', bg: 'var(--violet-soft)', go: () => replaceSheet('workEntry', { kind: 'fixed', date: toISO(today()) }) },
    modules.work && { icon: Icon.coins, label: 'Виплата за роботу', color: 'var(--pos)', bg: 'var(--pos-soft)', go: () => replaceSheet('payout', { month: monthKeyOf(today()) }) },
    modules.rent && { icon: Icon.userPlus, label: 'Новий орендар', color: 'var(--text)', bg: 'var(--card-2)', go: () => replaceSheet('clientForm', {}) },
    modules.goals && { icon: Icon.target, label: 'Відкласти на ціль', color: 'var(--accent-text)', bg: 'var(--accent-soft)', go: () => replaceSheet('pickGoal') },
    modules.assets && { icon: Icon.coins, label: 'Покупка монети', color: 'var(--warn)', bg: 'var(--warn-soft)', go: () => replaceSheet('assetSearch', {}) },
  ].filter(Boolean)
  return (
    <Sheet sheetId={sheetId} closing={closing} title="Що додаємо?">
      <div className="quick-tiles">
        {tiles.map(t => (
          <button key={t.label} className="quick-tile" onClick={() => { haptic.tap(); t.go() }}>
            <IconTile icon={t.icon} color={t.color} bg={t.bg} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function ConfirmSheet({ sheetId, closing, title, text, confirmText = 'Так', danger = false, onConfirm }) {
  return (
    <Sheet sheetId={sheetId} closing={closing} title={title}
      footer={<div className="btn-row"><button className="btn" onClick={() => closeSheet(sheetId)}>Скасувати</button>
        <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { closeSheet(sheetId); onConfirm && onConfirm() }}>{confirmText}</button></div>}>
      {text && <p className="muted" style={{ margin: '0 0 6px', fontSize: 15 }}>{text}</p>}
    </Sheet>
  )
}

export function SettingsSheet({ sheetId, closing }) {
  const s = useStore(st => st.settings)
  const user = useStore(st => st.user)
  const sync = useStore(st => st.sync)
  const data = useStore(st => st.data)
  const platform = useStore(st => st.platform)
  const counts = { c: data.clients.length, w: data.workEntries.length, g: data.goals.length, a: data.assets.length }
  const r = s.rates
  const [busy, setBusy] = useState(false)
  const updated = r.updated ? new Date(r.updated).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
  const lastSync = sync.lastSync ? new Date(sync.lastSync).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : '—'
  return (
    <Sheet sheetId={sheetId} closing={closing} title="Налаштування">
      <div className="card row">
        <Avatar name={(user && (user.firstName || user.username)) || 'Я'} photo={user && user.photoUrl} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }} className="ellipsis">{user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Користувач' : '—'}</div>
          <div className="muted num" style={{ fontSize: 13 }}>{user && user.username ? '@' + user.username + ' · ' : ''}ID {user ? user.id : '—'}</div>
        </div>
      </div>

      <div className="label" style={{ margin: '22px 2px 10px' }}>Валюта перегляду</div>
      <div className="grid-3">
        {CURRENCIES.map(c => (
          <button key={c} className="card pressable" onClick={() => setDisplay(c)} style={{ textAlign: 'left', padding: 12, borderColor: s.display === c ? 'var(--accent)' : 'var(--line)', boxShadow: s.display === c ? '0 0 0 3px var(--accent-soft)' : 'none' }}>
            <div className="display" style={{ fontSize: 22 }}>{SYM[c]}</div>
            <div style={{ fontWeight: 650, marginTop: 6 }}>{c}</div>
            <div className="faint" style={{ fontSize: 12 }}>{CUR_NAME[c]}</div>
          </button>
        ))}
      </div>

      <div className="label" style={{ margin: '22px 2px 10px' }}>Курси</div>
      <div className="card">
        <KV k="$1" v={r.UAH.toFixed(2).replace('.', ',') + ' ₴'} />
        <KV k="$1" v={(r.PLN || 0).toFixed(3).replace('.', ',') + ' zł'} />
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{r.auto ? `Автоматично: ${r.source || 'джерело'} · ${updated}` : `Введено вручну · ${updated}`}</div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn sm" style={{ width: '100%' }} disabled={busy} onClick={async () => { setBusy(true); const ok = await refreshRatesNow(); setBusy(false); if (ok) toast('Курси оновлено', { kind: 'success' }) }}>
            <Icon.refresh className={busy ? 'spin' : ''} />Оновити
          </button>
          <button className="btn sm" style={{ width: '100%' }} onClick={() => openSheet('rates')}><Icon.edit />Вручну</button>
        </div>
      </div>

      <div className="label" style={{ margin: '22px 2px 10px' }}>Тема</div>
      <Segmented value={s.theme} onChange={setTheme} options={[{ value: 'auto', label: 'Як у Telegram' }, { value: 'dark', label: 'Темна' }, { value: 'light', label: 'Світла' }]} />

      <div className="label" style={{ margin: '22px 2px 10px' }}>Розділи</div>
      <div className="stack">
        <Switch on={s.modules.rent} onChange={v => setModule('rent', v)} label="Оренда" sub="Орендарі, оплати, рефералка" icon={<IconTile icon={Icon.key} color="var(--blue)" bg="var(--blue-soft)" />} />
        <Switch on={s.modules.work} onChange={v => setModule('work', v)} label="Робота" sub="Години, підробітки, виплати" icon={<IconTile icon={Icon.briefcase} />} />
        <Switch on={s.modules.goals} onChange={v => setModule('goals', v)} label="Цілі" sub="Накопичення з рівнями" icon={<IconTile icon={Icon.target} color="var(--pos)" bg="var(--pos-soft)" />} />
        <Switch on={s.modules.assets} onChange={v => setModule('assets', v)} label="Активи" sub="Криптопортфель, ціни CoinGecko" icon={<IconTile icon={Icon.coins} color="var(--warn)" bg="var(--warn-soft)" />} />
      </div>

      {s.modules.work && (
        <>
          <div className="label" style={{ margin: '22px 2px 10px' }}>Дохід від роботи у звітах</div>
          <Segmented value={s.workEarnedMode} onChange={setWorkMode} options={[{ value: 'accrued', label: 'Нараховане' }, { value: 'paid', label: 'Виплачене' }]} />
          <div className="faint" style={{ fontSize: 12.5, margin: '8px 2px 0' }}>{s.workEarnedMode === 'paid' ? 'Рахуємо за датою виплати (аванси й фактичні), підробітки одразу' : 'Рахуємо за датою роботи, незалежно від виплат'}</div>
        </>
      )}

      <div className="label" style={{ margin: '22px 2px 10px' }}>Дані</div>
      <div className="card">
        <KV k="Сховище" v="Твій Notion" />
        <KV k="Остання синхронізація" v={lastSync} />
        <KV k="Записів" v={`${counts.c} орендарів · ${counts.w} робіт${s.modules.goals ? ' · ' + counts.g + ' цілей' : ''}${s.modules.assets ? ' · ' + counts.a + ' монет' : ''}`} />
        <div className="stack" style={{ marginTop: 12 }}>
          <button className="btn sm" style={{ width: '100%' }} onClick={() => syncAll()}><Icon.refresh className={sync.busy ? 'spin' : ''} />Синхронізувати зараз</button>
          <button className="btn sm" style={{ width: '100%' }} onClick={exportJSON}>{CAN_DOWNLOAD.test(platform || '') ? <><Icon.download />Експорт у JSON</> : <><Icon.copy />Скопіювати дані (JSON)</>}</button>
          <button className="btn sm ghost" style={{ width: '100%' }} onClick={() => openSheet('confirm', {
            title: 'Очистити кеш на пристрої?', text: 'Дані в Notion не зміняться. Застосунок просто завантажить усе заново.', confirmText: 'Очистити',
            onConfirm: () => { clearCache(); syncAll(); toast('Кеш очищено', { kind: 'success' }) },
          })}><Icon.trash />Очистити кеш</button>
        </div>
      </div>

      <div className="faint" style={{ textAlign: 'center', fontSize: 12.5, margin: '22px 0 4px' }}>
        Rent·Control {typeof __VERSION__ !== 'undefined' ? __VERSION__ : ''} · {typeof __BUILT_AT__ !== 'undefined' ? new Date(__BUILT_AT__).toLocaleDateString('uk-UA') : ''}
      </div>
    </Sheet>
  )
}

// Завантаження файлів працює в Telegram Desktop / macOS / Web; у мобільних вебвʼю воно мовчки не спрацьовує,
// тож там копіюємо JSON у буфер (його можна вставити, наприклад, у «Збережені»)
const CAN_DOWNLOAD = /^(tdesktop|macos|weba|webk|web|unigram)$/

function copyJSON(text) {
  try {
    navigator.clipboard.writeText(text).then(
      () => { haptic.success(); toast('JSON скопійовано — встав у «Збережені» чи нотатки', { kind: 'success', duration: 3500 }) },
      () => toast('Не вдалось скопіювати JSON', { kind: 'error' }))
  } catch { toast('Не вдалось скопіювати JSON', { kind: 'error' }) }
}

function exportJSON() {
  const st = getState()
  const payload = { app: 'rent-control', version: 5, exportedAt: new Date().toISOString(), settings: st.settings, data: st.data }
  const text = JSON.stringify(payload, null, 2)
  if (!CAN_DOWNLOAD.test(st.platform || '')) return copyJSON(text)
  try {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rent-control-backup-${toISO(today())}.json`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 200)
    haptic.success()
    toast('Бекап сформовано', { kind: 'success' })
  } catch {
    copyJSON(text) // завантаження заблоковане — копіюємо в буфер
  }
}

export function RatesSheet({ sheetId, closing }) {
  const r = useStore(s => s.settings.rates)
  const [uah, setUah] = useState(String(r.UAH).replace('.', ','))
  const [pln, setPln] = useState(String(r.PLN).replace('.', ','))
  const save = () => {
    const u = parseAmount(uah), p = parseAmount(pln)
    if (!(u > 0) || !(p > 0)) { toast('Введи коректні курси', { kind: 'error' }); return }
    setRatesManual(u, p)
    closeSheet(sheetId)
  }
  return (
    <Sheet sheetId={sheetId} closing={closing} title="Курси вручну" footer={<button className="btn primary" onClick={save}>Зберегти</button>}>
      <Field label="$1 = ? гривень"><TextInput value={uah} onChange={v => setUah(v.replace(/[^0-9.,]/g, ''))} inputMode="decimal" autoFocus /></Field>
      <Field label="$1 = ? злотих" hint="Автооновлення вимкнеться, доки не натиснеш «Оновити»"><TextInput value={pln} onChange={v => setPln(v.replace(/[^0-9.,]/g, ''))} inputMode="decimal" /></Field>
    </Sheet>
  )
}
