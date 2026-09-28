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

echo "---"
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
