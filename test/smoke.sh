#!/bin/bash
# BudgetLens smoke tests — file presence, syntax, core logic sanity.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

# 1. expected files exist
for f in index.html css/style.css js/categorize.js js/analyze.js js/plan.js js/app.js data/sample.csv README.md REDESIGN-AUDIT.md; do
  [ -f "$f" ] && ok "file exists: $f" || bad "missing file: $f"
done

# 2. JS syntax valid
for f in js/categorize.js js/analyze.js js/plan.js js/app.js; do
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

// detectDuplicates: same merchant + amount within 7 days flags; income ignored
const dtx = [
  { date: new Date('2026-10-01T12:00:00Z'), description: 'GYM', merchant: 'GYM', amount: -29.99 },
  { date: new Date('2026-10-04T12:00:00Z'), description: 'GYM', merchant: 'GYM', amount: -29.99 },
  { date: new Date('2026-10-20T12:00:00Z'), description: 'GYM', merchant: 'GYM', amount: -29.99 },
  { date: new Date('2026-10-02T12:00:00Z'), description: 'GYM', merchant: 'GYM', amount: -49.99 },
  { date: new Date('2026-10-03T12:00:00Z'), description: 'PAY', merchant: 'PAY', amount: 100 }
];
const dups = A.detectDuplicates(dtx);
(dups.length === 1 && dups[0].merchant === 'GYM' && dups[0].txs.length === 2)
  ? ok('detectDuplicates: one 7-day pair flagged, lone + different-amount + income ignored') : bad('detectDuplicates: ' + JSON.stringify(dups.map(d => d.txs.length)));
(A.detectDuplicates([]).length === 0) ? ok('detectDuplicates: empty -> []') : bad('detectDuplicates empty');

// savingsGoalStatus: kept vs goal, onTrack flag, null without goal
const g1 = A.savingsGoalStatus(5000, 3200, 1500);
const g2 = A.savingsGoalStatus(5000, 4200, 1500);
(g1 && g1.kept === 1800 && g1.onTrack && g1.pct === 120 && g2 && !g2.onTrack && g2.pct === 53)
  ? ok('savingsGoalStatus: kept/onTrack/pct math') : bad('savingsGoalStatus: ' + JSON.stringify([g1, g2]));
(A.savingsGoalStatus(5000, 3200, '') === null && A.savingsGoalStatus(5000, 3200, 0) === null)
  ? ok('savingsGoalStatus: no goal -> null') : bad('savingsGoalStatus null');

// spendPace: per-day, projection, last-month comparison (fixed "now")
const ptx = [
  { date: new Date('2026-10-12T12:00:00Z'), month: '2026-10', description: 'A', merchant: 'A', amount: -120 },
  { date: new Date('2026-09-05T12:00:00Z'), month: '2026-09', description: 'B', merchant: 'B', amount: -900 }
];
const pc = A.spendPace(ptx, new Date('2026-10-12T12:00:00Z').getTime());
(pc.spent === 120 && pc.perDay === 10 && pc.projected === 310 && pc.lastMonth === 900 && pc.dayOfMonth === 12 && pc.daysInMonth === 31)
  ? ok('spendPace: $10/day, $310 projected, $900 last month') : bad('spendPace: ' + JSON.stringify(pc));

// detectRecurringIncome: consistent deposits across 2+ months; one-off ignored
const ia = A.analyze([
  { date: '2026-07-01', description: 'ACME CORP PAYROLL', amount: 3200 },
  { date: '2026-08-01', description: 'ACME CORP PAYROLL', amount: 3200 },
  { date: '2026-09-01', description: 'ACME CORP PAYROLL', amount: 3205 },
  { date: '2026-08-15', description: 'ONE TIME BONUS', amount: 500 }
], {});
const rinc = A.detectRecurringIncome(ia.byMerchant);
(rinc.length === 1 && rinc[0].monthly === 3200 && rinc[0].occurrences === 3 && Math.abs(rinc[0].yearly - 38400) < 1)
  ? ok('detectRecurringIncome: ACME $3200/mo x3 -> $38,400/yr; one-off ignored')
  : bad('detectRecurringIncome: ' + JSON.stringify(rinc.map(r => [r.merchant, r.monthly])));
(ia.recurringIncome && ia.recurringIncome.length === 1)
  ? ok('analyze() exposes recurringIncome in its result') : bad('analyze() missing recurringIncome');
const single = A.analyze([{ date: '2026-07-01', description: 'GIG PAYOUT', amount: 400 }], {});
(A.detectRecurringIncome(single.byMerchant).length === 0)
  ? ok('detectRecurringIncome: single deposit -> []') : bad('detectRecurringIncome single');

// detectOutliers: 3x+ median and $50+ flagged; sub-$50 ignored
const otx = [];
for (let i = 0; i < 5; i++) otx.push({ date: '2026-07-0' + (i + 1), description: 'STARBUCKS STORE #' + i, amount: -6 });
otx.push({ date: '2026-07-10', description: 'STARBUCKS CATERING', amount: -85 });
otx.push({ date: '2026-07-11', description: 'STARBUCKS GIFT CARD', amount: -49 });
const outs = A.detectOutliers(A.analyze(otx, {}).transactions);
(outs.length === 1 && outs[0].amount === -85 && outs[0].ratio >= 14 && outs[0].median === 6)
  ? ok('detectOutliers: $85 vs $6 median flagged at ' + outs[0].ratio + 'x; $49 under floor ignored')
  : bad('detectOutliers: ' + JSON.stringify(outs.map(o => [o.amount, o.ratio])));
(A.detectOutliers([]).length === 0) ? ok('detectOutliers: empty -> []') : bad('detectOutliers empty');

// categoryTrends: latest month vs prior-months average, needs >= 2 months
const ca = A.analyze([
  { date: '2026-07-05', description: 'STARBUCKS #1', amount: -100 },
  { date: '2026-08-05', description: 'STARBUCKS #2', amount: -100 },
  { date: '2026-09-05', description: 'STARBUCKS #3', amount: -200 }
], {});
const tr = A.categoryTrends(ca.byCatMonth);
(tr.length >= 1 && tr[0].id === 'dining' && tr[0].pct === 100 && tr[0].up === true && tr[0].last === 200 && tr[0].avg === 100)
  ? ok('categoryTrends: dining $200 vs $100 avg -> +100% up') : bad('categoryTrends: ' + JSON.stringify(tr));
const ca1 = A.analyze([{ date: '2026-07-05', description: 'STARBUCKS #1', amount: -100 }], {});
(A.categoryTrends(ca1.byCatMonth).length === 0)
  ? ok('categoryTrends: single month -> []') : bad('categoryTrends single month');
(ca.byCatMonth && ca.byCatMonth.dining && ca.byCatMonth.dining['2026-07'] === 100)
  ? ok('analyze() exposes byCatMonth aggregate') : bad('analyze() missing byCatMonth');

console.log('NEW_PASS=' + pass + ' NEW_FAIL=' + fail);
process.exit(fail ? 1 : 0);
NODEEOF
[ $? -eq 0 ] && ok "new-feature node checks green" || bad "new-feature node checks had failures"

# plan engine (js/plan.js): envelope math, suggestions, cover, reports
node << 'NODEEOF'
const BL = require('/home/hatch/workspace/budgetlens-ai/js/categorize.js');
const A  = require('/home/hatch/workspace/budgetlens-ai/js/analyze.js');
const P  = require('/home/hatch/workspace/budgetlens-ai/js/plan.js');
let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log('PASS: ' + n); };
const bad = (n) => { fail++; console.log('FAIL: ' + n); };

const a = A.analyze([
  { date: '2026-08-01', description: 'ACME CORP PAYROLL', amount: 3200 },
  { date: '2026-08-02', description: 'CITY APARTMENTS RENT', amount: -1450 },
  { date: '2026-08-03', description: 'STARBUCKS #1', amount: -12 },
  { date: '2026-07-01', description: 'ACME CORP PAYROLL', amount: 3200 },
  { date: '2026-07-02', description: 'STARBUCKS #2', amount: -20 }
], {});

// planForMonth: income/assigned/ready math, over flags
const plan = P.planForMonth(a, '2026-08', { housing: 1450, dining: 10 });
const dining = plan.groups[1].rows.find(r => r.id === 'dining');
(plan.income === 3200 && plan.assigned === 1460 && plan.ready === 1740)
  ? ok('planForMonth: income 3200, assigned 1460, ready 1740') : bad('planForMonth math: ' + JSON.stringify([plan.income, plan.assigned, plan.ready]));
(dining.activity === 12 && dining.available === -2 && dining.over === true)
  ? ok('planForMonth: dining $12 activity vs $10 budgeted -> over, -$2 available') : bad('dining row: ' + JSON.stringify(dining));
(plan.groups.length === 3 && plan.groups.every(g => g.rows.length === 4))
  ? ok('planForMonth: 3 groups x 4 categories, names: ' + plan.groups.map(g => g.name).join('/')) : bad('plan groups');
(plan.groups[0].rows[0].id === 'housing' && plan.groups[0].budgeted === 1450)
  ? ok('planForMonth: group totals roll up') : bad('group rollup');
const noAssign = P.planForMonth(a, '2026-08', {});
(noAssign.assigned === 0 && noAssign.ready === 3200)
  ? ok('planForMonth: no assignments -> ready equals full income') : bad('no-assign');

// suggestAssignments: previous month's spend (dining $20 from July)
const sug = P.suggestAssignments(a, '2026-08');
(sug.dining === 20 && sug.housing === 0)
  ? ok('suggestAssignments: uses prior month spend (dining $20)') : bad('suggest: ' + JSON.stringify(sug));

// coverFromPool: moves from ready into category
const covered = P.coverFromPool(plan, { housing: 1450, dining: 10 }, 'dining', 2);
(covered && covered.dining === 12)
  ? ok('coverFromPool: dining 10 -> 12 when pool covers $2') : bad('cover: ' + JSON.stringify(covered));
(P.coverFromPool(plan, { housing: 1450, dining: 10 }, 'dining', 2000) === null)
  ? ok('coverFromPool: null when pool cannot cover') : bad('cover should be null');

// incomeVsExpense + categoryShare
const ive = P.incomeVsExpense(a.byMonth);
(ive.length === 2 && ive[0].month === '2026-07' && ive[1].kept === 1738 && ive[1].savingsRate === 54)
  ? ok('incomeVsExpense: 2 months, kept/savingsRate math (1738, 54%)') : bad('ive: ' + JSON.stringify(ive));
const share = P.categoryShare(a.byCat);
(share.length > 0 && share[0].id === 'housing' && share.reduce((s, x) => s + x.pct, 0) <= 101)
  ? ok('categoryShare: housing top, shares sane') : bad('share: ' + JSON.stringify(share));
(P.categoryShare({}).length === 0) ? ok('categoryShare: empty -> []') : bad('share empty');

console.log('PLAN_PASS=' + pass + ' PLAN_FAIL=' + fail);
process.exit(fail ? 1 : 0);
NODEEOF
[ $? -eq 0 ] && ok "plan-engine node checks green" || bad "plan-engine node checks had failures"

# new DOM ids present
for id in monthPick budgetForm budgetList txSearch txCatFilter txExport txPrint txCount pane-budgets incomeList outlierBox trendBox pane-plan pane-reports planBanner planMonthLabel planPrev planNext planAuto planClear planTable reportIve reportRate reportShare; do
  grep -q "id=\"$id\"" index.html && ok "index.html has #$id" || bad "index.html missing #$id"
done

echo "---"
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
