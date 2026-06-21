# Rent·Control

Notion-backed додаток для обліку оренди, роботи, виплат.

## ENV-змінні у Vercel (10 штук)

```
NOTION_TOKEN          = ntn_... (твоя Integration)
DB_CLIENTS            = (ID бази Клієнти)
DB_PAYMENTS           = (ID бази Оплати)
DB_WORK_ENTRIES       = (ID бази Робота — записи)
DB_WORK_CATEGORIES    = (ID бази Категорії робіт)
DB_PAYOUTS            = (ID бази Виплати по місяцях)
DB_EXPENSES           = (з Expense·Control — для Dashboard)
DB_CAT_EXPENSES       = (з Expense·Control — для Dashboard)
DB_INCOMES            = (можна пропустити — Rent не використовує)
DB_CAT_INCOMES        = (можна пропустити)
DB_REGULARS           = (можна пропустити)
```

## Deploy

1. GitHub → новий репозиторій → залий вміст `rent-app/` (5 файлів, без обгортки).
2. Vercel → Import → обери репо.
3. Framework Preset: **Other**.
4. Root Directory: `./` (або порожнє — якщо файли в корені).
5. Environment Variables: додай усі змінні з таблиці вище.
6. Deploy.

## Telegram Mini App

Після деплою:
1. @BotFather → `/newbot` → отримай токен.
2. `/setmenubutton` → URL: `https://rent-ck.vercel.app`.
3. Відкривай через бот — Telegram ID підтянеться автоматично.
