# 🔍 BudgetLens

**See where your money goes.** Upload a bank CSV, get an instant categorized spending breakdown, find the subscriptions quietly draining your account, and get plain-language savings nudges.

## The problem

The average person leaks hundreds of dollars a year to subscriptions they forgot about — free trials that converted, services they stopped using, duplicate memberships. Bank statements are a wall of cryptic merchant names. Nobody has time to categorize 300 transactions by hand.

## The solution

BudgetLens runs **100% locally in your browser**. Drop in a CSV export from your bank and it:

1. **Categorizes every transaction** into 13 categories (Dining, Groceries, Transport, Utilities, Subscriptions, Entertainment, Shopping, Health, Housing, Travel, Fees, Income, Other) using local keyword rules — with a confidence flag when it's unsure, and one-click manual correction it remembers per merchant.
2. **Shows a dashboard** — money in/out/kept, spending-by-category bar charts, top merchants, month-over-month comparison.
3. **Detects subscriptions** — recurring charges across months are flagged with monthly and yearly cost, so you can see that "$14.99/mo" is really "$180/yr".
4. **Nudges you** — plain-language observations like "Cooking two more nights a week could save roughly $96/month."

Optional: set `OPENAI_API_KEY` for enhanced insights in a future version — everything works fully offline without it.

## Privacy

This is the selling point: **nothing leaves your device.** No account, no server, no analytics, no tracking. Your bank data stays in your browser's memory. Serve it locally and it works offline.

## Run it

No build step, no dependencies.

```bash
# any static server works:
npx serve .
# or
python3 -m http.server 8080
```

Then open http://localhost:8080 (or :3000 for `serve`). Click **"Try the sample data"** to explore with 3 months of realistic transactions.

> Note: opening `index.html` directly via `file://` works except the sample-data loader (browsers block `fetch` on `file://`). Use a local server for the full experience.

## CSV format

```
Date,Description,Amount
2026-07-01,ACME CORP PAYROLL,3200.00
2026-07-01,CITY APARTMENTS RENT,-1450.00
```

Header names are flexible (`date`, `description`/`memo`/`merchant`, `amount`). Amounts accept `$`, commas, and `(parentheses)` negatives.

## Pricing vision

- **Free** — unlimited local analysis, the core product, forever.
- **Plus ($8/mo)** — cloud sync across devices, receipt photo import, annual tax summary export.

## Tests

```bash
bash test/smoke.sh   # file/syntax/logic checks
bash test/e2e.sh      # end-to-end analysis flows on the sample CSV
```

## Files

- `index.html` — the app
- `css/style.css` — styling
- `js/categorize.js` — keyword categorization engine (browser + node)
- `js/analyze.js` — CSV parsing, subscription detection, nudges (browser + node)
- `js/app.js` — UI wiring
- `data/sample.csv` — 96 realistic transactions across 3 months
