// Рахунки й біржі: суми, групування монет, відповідність символів монетам CoinGecko.
import { convert } from '../money.js'

export const PROVIDER_META = {
  mono: { label: 'Монобанк', kind: 'bank', color: '#1a1a1a', letter: 'm' },
  bybit: { label: 'Bybit', kind: 'exchange', color: '#f7a600', letter: 'B' },
  bingx: { label: 'BingX', kind: 'exchange', color: '#2a54ff', letter: 'X' },
  mexc: { label: 'MEXC', kind: 'exchange', color: '#1972e2', letter: 'M' },
  enablebanking: { label: 'Польські банки', kind: 'bank', color: '#dc143c', letter: 'PL' },
}

// Популярні монети → id у CoinGecko (для іконок, зміни за 24 год і графіка)
export const CG_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', SOL: 'solana', XRP: 'ripple',
  DOGE: 'dogecoin', TON: 'the-open-network', ADA: 'cardano', TRX: 'tron', AVAX: 'avalanche-2', DOT: 'polkadot',
  LINK: 'chainlink', POL: 'polygon-ecosystem-token', MATIC: 'matic-network', LTC: 'litecoin', BCH: 'bitcoin-cash',
  SHIB: 'shiba-inu', NEAR: 'near', APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', SUI: 'sui', PEPE: 'pepe',
  ATOM: 'cosmos', XLM: 'stellar', XMR: 'monero', ETC: 'ethereum-classic', FIL: 'filecoin', ICP: 'internet-computer',
  HBAR: 'hedera-hashgraph', INJ: 'injective-protocol', UNI: 'uniswap', AAVE: 'aave', TIA: 'celestia', SEI: 'sei-network',
  WLD: 'worldcoin-wld', FET: 'fetch-ai', RENDER: 'render-token', MNT: 'mantle', KAS: 'kaspa', JUP: 'jupiter-exchange-solana',
  WIF: 'dogwifcoin', BONK: 'bonk', FLOKI: 'floki', NOT: 'notcoin', DOGS: 'dogs-2', ENA: 'ethena', ONDO: 'ondo-finance',
  DAI: 'dai', FDUSD: 'first-digital-usd', USDE: 'ethena-usde', MX: 'mx-token', TRUMP: 'official-trump', HYPE: 'hyperliquid',
  BGB: 'bitget-token', OKB: 'okb', CRO: 'crypto-com-chain', ALGO: 'algorand', VET: 'vechain', STX: 'blockstack',
  IMX: 'immutable-x', GRT: 'the-graph', RUNE: 'thorchain', LDO: 'lido-dao', CAKE: 'pancakeswap-token', EGLD: 'elrond-erd-2',
}

const sumBy = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0)

// Вартість однієї позиції біржі в USD (фіат на біржі рахуємо за курсами застосунку)
export function holdingUSD(h, rates) {
  if (h.usd != null) return h.usd
  if (h.fiat) return convert(h.qty, h.fiat, 'USD', rates)
  return 0
}

export function providerTotalUSD(p, rates) {
  if (!p || !p.ok) return 0
  if (p.accounts) return sumBy(p.accounts, a => convert(a.balance, a.currency, 'USD', rates))
  if (p.holdings) return sumBy(p.holdings, h => holdingUSD(h, rates))
  return 0
}

export function financeTotals(providers, rates) {
  const list = providers || []
  const banks = list.filter(p => p.accounts)
  const exchanges = list.filter(p => p.holdings)
  const banksUSD = sumBy(banks, p => providerTotalUSD(p, rates))
  const exchangesUSD = sumBy(exchanges, p => providerTotalUSD(p, rates))
  return { banksUSD, exchangesUSD, totalUSD: banksUSD + exchangesUSD, errors: list.filter(p => !p.ok) }
}

// Монети з усіх бірж разом: BTC з Bybit + BTC з MEXC = один рядок із розбивкою
export function exchangeCoins(providers, rates) {
  const map = new Map()
  for (const p of providers || []) {
    if (!p.ok || !p.holdings) continue
    for (const h of p.holdings) {
      if (h.fiat || h.approx) continue // фіат і підсумки рахунків у USDT — не монети
      const k = h.asset.toUpperCase()
      const row = map.get(k) || { asset: k, qty: 0, usd: 0, parts: [], cgId: CG_IDS[k] || null }
      row.qty += h.qty
      row.usd += holdingUSD(h, rates)
      row.parts.push({ provider: p.provider, label: p.label, account: h.account, qty: h.qty, usd: holdingUSD(h, rates) })
      map.set(k, row)
    }
  }
  return [...map.values()].sort((a, b) => b.usd - a.usd)
}

// Підсумкові рядки бірж, що не розкладаються на монети (ф'ючерси, Earn тощо, сума в USDT)
export function exchangeExtras(providers) {
  const out = []
  for (const p of providers || []) {
    if (!p.ok || !p.holdings) continue
    for (const h of p.holdings) if (h.approx || h.fiat) out.push({ provider: p.provider, label: p.label, account: h.account, asset: h.asset, qty: h.qty, usd: h.usd, fiat: h.fiat })
  }
  return out
}

export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return 'ще не оновлювалось'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'щойно'
  const m = Math.round(s / 60)
  if (m < 60) return m + ' хв тому'
  const h = Math.round(m / 60)
  if (h < 24) return h + ' год тому'
  return Math.round(h / 24) + ' дн тому'
}
