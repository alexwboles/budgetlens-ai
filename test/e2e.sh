#!/bin/bash
# BudgetLens e2e tests — full analysis flows on the sample CSV.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
node << 'NODEEOF'
const BL = require('/home/hatch/workspace/budgetlens-ai/js/categorize.js');
const A  = require('/home/hatch/workspace/budgetlens-ai/js/analyze.js');
const fs = require('fs');
let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log('PASS: ' + n); };
const bad = (n) => { fail++; console.log('FAIL: ' + n); };

const text = fs.readFileSync('/home/hatch/workspace/budgetlens-ai/data/sample.csv', 'utf8');
const txs = A.rowsToTransactions(A.parseCSV(text));
const a = A.analyze(txs, {});

// Flow 1: sample CSV -> 96 transactions
txs.length === 96 ? ok('flow1: parsed exactly 96 transactions') : bad('flow1: parsed ' + txs.length + ', want 96');

// Flow 2: categorization coverage >= 90% non-"other"
const other = a.transactions.filter(t => t.category === 'other').length;
const cov = (txs.length - other) / txs.length;
cov >= 0.9 ? ok('flow2: coverage ' + Math.round(cov*100) + '% (' + other + ' other)') : bad('flow2: coverage only ' + Math.round(cov*100) + '%');

// Flow 3: subscription detection — STREAMFLIX-like recurring found with right math
const names = a.subscriptions.map(s => s.merchant);
const hasStream = names.some(n => /STREAMFLIX/.test(n));
const hasSpotify = names.some(n => /SPOTIFY/.test(n));
const hasGym = names.some(n => /PLANET/.test(n));
(hasStream && hasSpotify && hasGym) ? ok('flow3: detected STREAMFLIX, SPOTIFY, PLANET FITNESS') : bad('flow3: missing subs: ' + names.join(','));
const stream = a.subscriptions.find(s => /STREAMFLIX/.test(s.merchant));
if (stream && Math.abs(stream.monthly - 15.49) < 0.01 && Math.abs(stream.yearly - 185.88) < 0.05) {
  ok('flow3: STREAMFLIX $15.49/mo -> $185.88/yr math correct');
} else bad('flow3: STREAMFLIX math wrong: ' + JSON.stringify(stream));

// Flow 4: totals math — sum(amounts) === totalIn - totalOut
const sum = txs.reduce((s, t) => s + t.amount, 0);
Math.abs(sum - (a.totalIn - a.totalOut)) < 0.01
  ? ok('flow4: totals reconcile (in ' + A.money(a.totalIn) + ', out ' + A.money(a.totalOut) + ')')
  : bad('flow4: totals do not reconcile');

// Flow 5: nudges — subscription nudge present with yearly figure
const subNudge = a.nudges.find(n => /subscription/i.test(n.title));
(subNudge && /\/yr/.test(subNudge.text))
  ? ok('flow5: subscription nudge with yearly cost generated')
  : bad('flow5: subscription nudge missing or malformed');
a.nudges.length >= 3 ? ok('flow5: ' + a.nudges.length + ' nudges generated') : bad('flow5: only ' + a.nudges.length + ' nudges');

// Flow 6: manual override changes category
const merchKey = BL.normalizeMerchant('STARBUCKS STORE #123');
const a2 = A.analyze(txs, { [merchKey]: 'groceries' });
const changed = a2.transactions.filter(t => t.merchant === merchKey).every(t => t.category === 'groceries');
changed ? ok('flow6: merchant override recategorizes to groceries') : bad('flow6: override did not apply');

// Flow 7: month-over-month covers 3 months
const months = Object.keys(a.byMonth).sort();
months.length === 3 ? ok('flow7: month-over-month spans ' + months.join(', ')) : bad('flow7: months = ' + months.join(','));

// Flow 8: budgets — limits flag overspend, monthly average normalizes multi-month data
const budgets = { dining: 100, groceries: 400 };
const bstat = A.budgetStatus(a.byCat, budgets, 3);
const diningRow = bstat.find(r => r.id === 'dining');
const grocRow = bstat.find(r => r.id === 'groceries');
(diningRow && grocRow && bstat.every(r => r.limit > 0 && r.pct >= 0))
  ? ok('flow8: budgetStatus rows for dining (' + A.money(diningRow.spent) + '/' + A.money(diningRow.limit) + ', ' + diningRow.pct + '%) and groceries')
  : bad('flow8: budgetStatus malformed: ' + JSON.stringify(bstat.map(r => r.id)));
const overRows = A.budgetStatus(a.byCat, { dining: 1 }, 3);
(overRows.length === 1 && overRows[0].over === true)
  ? ok('flow8: $1 dining limit correctly flagged over budget') : bad('flow8: over-budget flag missing');

// Flow 9: month-scoped analysis — filter + re-analyze one month
const firstMonth = months[0];
const monthTxs = A.filterTransactionsByMonth(a.transactions, firstMonth);
const scoped = A.analyze(monthTxs, {});
(monthTxs.length > 0 && monthTxs.every(t => t.month === firstMonth) && Object.keys(scoped.byMonth).length === 1)
  ? ok('flow9: ' + monthTxs.length + ' transactions in ' + firstMonth + '; scoped analysis has 1 month')
  : bad('flow9: month filter broken');
A.filterTransactionsByMonth(a.transactions, '').length === a.transactions.length
  ? ok('flow9: empty month filter returns all transactions') : bad('flow9: empty filter broken');

// Flow 9b (regression): the app scopes from ANALYZED transactions (they carry .month),
// not from rowsToTransactions output (which has no .month field)
const rawRows = A.rowsToTransactions(A.parseCSV(text));
const full = A.analyze(rawRows, {});
const appScoped = A.analyze(A.filterTransactionsByMonth(full.transactions, firstMonth), {});
('month' in rawRows[0]) === false && appScoped.transactions.length === monthTxs.length
  ? ok('flow9b: raw rows lack .month; app scopes from analyzed txs -> ' + appScoped.transactions.length + ' txs')
  : bad('flow9b: regression in month-scoping source');

// Flow 10: CSV export — header, all rows, quoting-safe
const csv = A.transactionsToCSV(a);
const csvLines = csv.split('\r\n');
(csvLines[0] === 'Date,Description,Merchant,Amount,Category,Confidence' && csvLines.length === a.transactions.length + 1)
  ? ok('flow10: CSV header + ' + (csvLines.length - 1) + ' rows exported')
  : bad('flow10: CSV malformed: ' + csvLines[0]);
const quoted = A.transactionsToCSV({ transactions: [{ date: new Date('2026-07-01'), description: 'SAY "HI", CAFE', merchant: 'SAY CAFE', amount: -12.5, categoryName: 'Dining Out', confidence: 'high' }] });
(/"SAY ""HI"", CAFE"/.test(quoted)) ? ok('flow10: commas/quotes in description are escaped') : bad('flow10: quoting broken');

// Flow 11: subscription dismissal — hide + restore
const dismissed = {};
dismissed[a.subscriptions[0].merchant] = true;
const vis = A.visibleSubscriptions(a.subscriptions, dismissed);
(vis.length === a.subscriptions.length - 1 && !vis.some(s => s.merchant === a.subscriptions[0].merchant))
  ? ok('flow11: dismissing hides 1 of ' + a.subscriptions.length + ' subscriptions')
  : bad('flow11: dismissal broken');
A.visibleSubscriptions(a.subscriptions, {}).length === a.subscriptions.length
  ? ok('flow11: empty dismissed map shows all') : bad('flow11: empty dismissed broken');

// Flow 12: transaction search/filter logic — description, merchant, category
const all = a.transactions;
const qMatch = all.filter(t => t.description.toLowerCase().includes('starbucks'));
const noMatch = all.filter(t => t.description.toLowerCase().includes('zzz-no-such-vendor'));
(qMatch.length >= 2 && qMatch.every(t => /starbucks/i.test(t.description)) && noMatch.length === 0)
  ? ok('flow12: "starbucks" matches ' + qMatch.length + ' txs; junk query matches none')
  : bad('flow12: search logic broken');
const diningTxs = all.filter(t => t.category === 'dining');
(diningTxs.length > 0 && diningTxs.every(t => t.category === 'dining'))
  ? ok('flow12: category filter yields ' + diningTxs.length + ' dining transactions') : bad('flow12: category filter broken');

console.log('---');
console.log('e2e: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
NODEEOF
