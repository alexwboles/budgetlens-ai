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

console.log('---');
console.log('e2e: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
NODEEOF
