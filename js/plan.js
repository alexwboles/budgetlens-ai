/* BudgetLens plan engine — YNAB-style envelope math. Browser + node (no deps). */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    var cat = null;
    try { cat = require("./categorize.js"); } catch (e) { cat = root.BudgetLens || {}; }
    module.exports = factory(cat);
  } else root.BudgetLens = Object.assign(root.BudgetLens || {}, factory(root.BudgetLens || {}));
})(typeof self !== "undefined" ? self : this, function (BL) {

  var PLAN_GROUPS = [
    { name: "Fixed bills", ids: ["housing", "utilities", "subscriptions", "transport"] },
    { name: "Everyday", ids: ["groceries", "dining", "shopping", "entertainment"] },
    { name: "Health & other", ids: ["health", "travel", "fees", "other"] }
  ];

  function r2(n) { return Math.round(n * 100) / 100; }

  // Spend per category for one calendar month (YYYY-MM).
  function spendByCategory(transactions, month) {
    var out = {};
    (transactions || []).forEach(function (t) {
      if (t.month !== month || !(t.amount < 0)) return;
      out[t.category] = (out[t.category] || 0) + -t.amount;
    });
    return out;
  }

  // Envelope plan for one month. assignments = { catId: budgetedAmount }.
  // Returns { month, income, assigned, ready, groups: [{ name, rows, budgeted, activity, available }] }
  // where each row = { id, name, budgeted, activity, available, over }.
  function planForMonth(analysis, month, assignments) {
    assignments = assignments || {};
    var txs = analysis.transactions || [];
    var income = 0;
    txs.forEach(function (t) { if (t.month === month && t.amount >= 0) income += t.amount; });
    var spend = spendByCategory(txs, month);
    var groups = PLAN_GROUPS.map(function (g) {
      var rows = g.ids.map(function (id) {
        var c = BL.categoryById ? BL.categoryById(id) : { name: id };
        var budgeted = r2(Math.max(0, parseFloat(assignments[id]) || 0));
        var activity = r2(spend[id] || 0);
        var available = r2(budgeted - activity);
        return { id: id, name: c.name, budgeted: budgeted, activity: activity,
                 available: available, over: available < 0 };
      });
      function sum(f) { return r2(rows.reduce(function (s, r) { return s + r[f]; }, 0)); }
      return { name: g.name, rows: rows, budgeted: sum("budgeted"),
               activity: sum("activity"), available: sum("available") };
    });
    var assigned = r2(groups.reduce(function (s, g) { return s + g.budgeted; }, 0));
    return { month: month, income: r2(income), assigned: assigned,
             ready: r2(income - assigned), groups: groups };
  }

  // Suggest assignments for `month`: each category's spend in the previous
  // month with data, falling back to the all-time monthly average.
  function suggestAssignments(analysis, month) {
    var months = Object.keys(analysis.byMonth || {}).sort();
    var prev = months.filter(function (m) { return m < month; });
    var source = prev.length ? prev[prev.length - 1] : null;
    var out = {};
    PLAN_GROUPS.forEach(function (g) { g.ids.forEach(function (id) { out[id] = 0; }); });
    if (source) {
      var spend = spendByCategory(analysis.transactions, source);
      Object.keys(out).forEach(function (id) { out[id] = r2(spend[id] || 0); });
    } else {
      var n = Math.max(1, months.length);
      Object.keys(analysis.byCat || {}).forEach(function (id) {
        if (id in out) out[id] = r2((analysis.byCat[id] || 0) / n);
      });
    }
    return out;
  }

  // Move `amount` from the ready pool into a category's assignment (cover overspend).
  // Returns the updated assignments object, or null when the pool can't cover it.
  function coverFromPool(plan, assignments, catId, amount) {
    amount = r2(amount);
    if (!(amount > 0) || plan.ready < amount) return null;
    var next = Object.assign({}, assignments);
    next[catId] = r2((parseFloat(next[catId]) || 0) + amount);
    return next;
  }

  // Income-vs-expense report rows, oldest month first.
  // [{ month, in, out, kept, savingsRate }]
  function incomeVsExpense(byMonth) {
    return Object.keys(byMonth || {}).sort().map(function (m) {
      var mo = byMonth[m];
      var kept = r2(mo.in - mo.out);
      return { month: m, in: r2(mo.in), out: r2(mo.out), kept: kept,
               savingsRate: mo.in > 0 ? Math.round(Math.max(0, kept / mo.in) * 100) : 0 };
    });
  }

  // Share of total spend per category: [{ id, name, value, pct }], desc.
  function categoryShare(byCat) {
    var total = Object.keys(byCat || {}).reduce(function (s, k) {
      return s + (k === "income" ? 0 : (byCat[k] || 0));
    }, 0);
    if (!(total > 0)) return [];
    return Object.keys(byCat).filter(function (k) { return k !== "income" && byCat[k] > 0; })
      .map(function (k) {
        var c = BL.categoryById ? BL.categoryById(k) : { name: k };
        return { id: k, name: c.name, value: r2(byCat[k]), pct: Math.round(byCat[k] / total * 100) };
      })
      .sort(function (a, b) { return b.value - a.value; });
  }

  function planGroups() { return PLAN_GROUPS.map(function (g) { return { name: g.name, ids: g.ids.slice() }; }); }

  return {
    planGroups: planGroups, planForMonth: planForMonth,
    suggestAssignments: suggestAssignments, coverFromPool: coverFromPool,
    incomeVsExpense: incomeVsExpense, categoryShare: categoryShare,
    spendByCategory: spendByCategory
  };
});
