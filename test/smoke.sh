#!/bin/bash
# BudgetLens smoke tests — file presence, syntax, core logic sanity.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

# 1. expected files exist
for f in index.html css/style.css js/categorize.js js/analyze.js js/app.js data/sample.csv README.md; do
  [ -f "$f" ] && ok "file exists: $f" || bad "missing file: $f"
done

# 2. JS syntax valid
for f in js/categorize.js js/analyze.js js/app.js; do
  node --check "$f" 2>/dev/null && ok "syntax ok: $f" || bad "syntax error: $f"
done

# 3. sample CSV has header + 90+ rows
ROWS=$(($(wc -l < data/sample.csv) - 1))
[ "$ROWS" -ge 90 ] && ok "sample CSV has $ROWS data rows" || bad "sample CSV too small: $ROWS rows"

# 4-9. logic checks via node
node << 'NODEEOF'
const BL = require('/home/hatch/workspace/budgetlens-ai/js/categorize.js');
const A  = require('/home/hatch/workspace/budgetlens-ai/js/analyze.js');
const fs = require('fs');
let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log('PASS: ' + n); };
const bad = (n) => { fail++; console.log('FAIL: ' + n); };

// 12+ categories
BL.CATEGORIES.length >= 12 ? ok(BL.CATEGORIES.length + ' categories defined') : bad('only ' + BL.CATEGORIES.length + ' categories');

// known descriptions
const cases = [
  ['STARBUCKS STORE #123', 'dining'],
  ['CON EDISON ELECTRIC', 'utilities'],
  ['ACME CORP PAYROLL', 'income'],
  ['TRADER JOE\'S #542', 'groceries'],
  ['CITY APARTMENTS RENT', 'housing'],
  ['SPOTIFY USA', 'subscriptions'],
  ['OVERDRAFT FEE', 'fees'],
];
cases.forEach(([d, want]) => {
  const got = BL.categorize(d).category;
  got === want ? ok(`categorize "${d}" -> ${want}`) : bad(`categorize "${d}" -> ${got}, want ${want}`);
});

// unknown -> other with low confidence
const u = BL.categorize('XYZ RANDOM VENDOR QWERTY');
(u.category === 'other' && u.confidence === 'low') ? ok('unknown vendor -> other/low') : bad('unknown vendor -> ' + u.category + '/' + u.confidence);

// normalizeMerchant strips numbers
const nm = BL.normalizeMerchant('STREAMFLIX.COM 866-579-7172');
/\d{3,}/.test(nm) ? bad('normalizeMerchant kept numbers: ' + nm) : ok('normalizeMerchant strips numbers -> "' + nm + '"');

// parseAmount variants
const amts = [['$1,234.56', 1234.56], ['(45.00)', -45], ['-12.5', -12.5], ['3200.00', 3200]];
const amok = amts.every(([s, want]) => A.parseAmount(s) === want);
amok ? ok('parseAmount handles $, commas, parens, negatives') : bad('parseAmount mismatch');

// CSV parses and converts
const text = fs.readFileSync('/home/hatch/workspace/budgetlens-ai/data/sample.csv', 'utf8');
const txs = A.rowsToTransactions(A.parseCSV(text));
txs.length >= 90 ? ok('sample CSV -> ' + txs.length + ' transactions') : bad('only ' + txs.length + ' transactions parsed');

console.log('NODE_PASS=' + pass + ' NODE_FAIL=' + fail);
process.exit(fail ? 1 : 0);
NODEEOF
[ $? -eq 0 ] && ok "node logic checks green" || bad "node logic checks had failures"

# new features: budgets, month filter, CSV export, subscription dismissal (node)
node << 'NODEEOF'
const BL = require('/home/hatch/workspace/budgetlens-ai/js/categorize.js');
const A  = require('/home/hatch/workspace/budgetlens-ai/js/analyze.js');
let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log('PASS: ' + n); };
const bad = (n) => { fail++; console.log('FAIL: ' + n); };

// budgetStatus: pct math, over flag, invalid limits skipped, sorted desc
const bs = A.budgetStatus({ dining: 250, groceries: 100 }, { dining: 200, groceries: 400, travel: 0, fees: -5 }, 1);
const dining = bs.find(r => r.id === 'dining'), groc = bs.find(r => r.id === 'groceries');
(bs.length === 2 && dining.over === true && dining.pct === 125 && groc.over === false && groc.pct === 25 && bs[0].id === 'dining')
  ? ok('budgetStatus: over-flag, pct math, skips zero/negative limits, sorted desc')
  : bad('budgetStatus: ' + JSON.stringify(bs));
const bsm = A.budgetStatus({ dining: 300 }, { dining: 200 }, 3);
(bsm[0].spent === 100 && bsm[0].over === false)
  ? ok('budgetStatus: 3-month average normalizes to $100/mo spend') : bad('budgetStatus months: ' + JSON.stringify(bsm));

// filterTransactionsByMonth
const txs = [{ month: '2026-07' }, { month: '2026-08' }, { month: '2026-07' }];
(A.filterTransactionsByMonth(txs, '2026-07').length === 2 && A.filterTransactionsByMonth(txs, '').length === 3)
  ? ok('filterTransactionsByMonth: filters + empty returns all') : bad('filterTransactionsByMonth');

// transactionsToCSV: header, row order by date, amount 2dp
const csv = A.transactionsToCSV({ transactions: [
  { date: new Date('2026-08-02T12:00:00Z'), description: 'B', merchant: 'B', amount: -5, categoryName: 'Other', confidence: 'low' },
  { date: new Date('2026-07-01T12:00:00Z'), description: 'A', merchant: 'A', amount: 10, categoryName: 'Income', confidence: 'manual' }
]});
const L = csv.split('\r\n');
(L[0] === 'Date,Description,Merchant,Amount,Category,Confidence' && L[1].indexOf('2026-07-01') === 0 && /10\.00/.test(L[1]) && /-5\.00/.test(L[2]))
  ? ok('transactionsToCSV: header, date-sorted, 2dp amounts') : bad('transactionsToCSV: ' + csv.slice(0, 100));

// visibleSubscriptions
const subs = [{ merchant: 'A' }, { merchant: 'B' }];
const v = A.visibleSubscriptions(subs, { A: true });
(v.length === 1 && v[0].merchant === 'B') ? ok('visibleSubscriptions: dismissed hidden') : bad('visibleSubscriptions');

console.log('NEW_PASS=' + pass + ' NEW_FAIL=' + fail);
process.exit(fail ? 1 : 0);
NODEEOF
[ $? -eq 0 ] && ok "new-feature node checks green" || bad "new-feature node checks had failures"

# new DOM ids present
for id in monthPick budgetForm budgetList txSearch txCatFilter txExport txPrint txCount pane-budgets; do
  grep -q "id=\"$id\"" index.html && ok "index.html has #$id" || bad "index.html missing #$id"
done

echo "---"
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
