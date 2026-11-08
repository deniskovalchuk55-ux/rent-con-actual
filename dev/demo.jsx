// Демо-збірка: той самий застосунок, але з фейковим Notion і демо-даними (для перегляду поза Telegram і тестів).
import { createFake, installFakeBackend } from './fake-api.js'
import { seed } from './seed.js'

const params = new URLSearchParams(location.search)
const fake = createFake({ latency: Number(params.get('lat') || 140) })
if (params.get('empty') !== '1') seed(fake, 111)
if (params.get('theme')) window.__demoScheme = params.get('theme')
installFakeBackend(fake)

try {
  // демо стартує з увімкненими цілями й активами (якщо в демо ще не було збережених налаштувань)
  if (!localStorage.getItem('rc5:settings') && params.get('fresh') !== '0') {
    localStorage.setItem('rc5:settings', JSON.stringify({ modules: { rent: true, work: true, goals: true, assets: true }, updatedAt: 1 }))
  }
  if (params.get('nocache') === '1') Object.keys(localStorage).filter(k => k.startsWith('rc5:cache')).forEach(k => localStorage.removeItem(k))
} catch { /* приватний режим */ }

import('../src/main.jsx')
