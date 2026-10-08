/* BudgetLens analysis engine — CSV parsing, subscriptions, nudges. Browser + node. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    var cat = null;
    try { cat = require("./categorize.js"); } catch (e) { cat = root.BudgetLens || {}; }
    module.exports = factory(cat);
  } else root.BudgetLens = Object.assign(root.BudgetLens || {}, factory(root.BudgetLens || {}));
})(typeof self !== "undefined" ? self : this, function (BL) {

  function parseCSV(text) {
    var rows = [], row = [], field = "", inQ = false;
    text = String(text || "").replace(/^\uFEFF/, "");
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0].trim() !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (f) { return String(f).trim() !== ""; }); });
  }

  function parseAmount(s) {
    var t = String(s || "").trim().replace(/[$,\s]/g, "");
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (t.charAt(0) === "-") { neg = true; t = t.slice(1); }
    var v = parseFloat(t);
    if (isNaN(v)) return null;
    return neg ? -v : v;
  }

  function parseDate(s) {
    var t = String(s || "").trim();
    var d = new Date(t);
    if (!isNaN(d.getTime())) return d;
    var m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      var y = parseInt(m[3], 10); if (y < 100) y += 2000;
      return new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }
    return null;
  }

  function rowsToTransactions(rows) {
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return String(h).toLowerCase(); });
    var di = header.findIndex(function (h) { return /date/.test(h); });
    var de = header.findIndex(function (h) { return /desc|memo|merchant|payee|name/.test(h); });
    var am = header.findIndex(function (h) { return /amount|amt/.test(h); });
    var start = 0;
    if (di === -1 || de === -1 || am === -1) { di = 0; de = 1; am = 2; }
    else start = 1;
    var out = [];
    for (var i = start; i < rows.length; i++) {
      var r = rows[i];
      var d = parseDate(r[di]), a = parseAmount(r[am]);
      var desc = String(r[de] || "").trim();
      if (!d || a === null || !desc) continue;
      out.push({ date: d, description: desc, amount: a });
    }
    return out;
  }

  function money(n) {
    var neg = n < 0, v = Math.abs(n);
    var s = v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-$" : "$") + s;
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Monthly category budgets: budgets = { catId: monthlyLimit }.
  // byCat may span several months — months normalizes spend to a monthly average.
  // Returns [{ id, name, icon, spent, limit, pct, over }], highest pct first.
  function budgetStatus(byCat, budgets, months) {
    months = Math.max(1, parseInt(months, 10) || 1);
    budgets = budgets || {};
    var out = [];
    Object.keys(budgets).forEach(function (id) {
      var limit = parseFloat(budgets[id]);
      if (!(limit > 0)) return;
      var c = BL.categoryById ? BL.categoryById(id) : null;
      var spent = Math.round(((byCat || {})[id] || 0) / months * 100) / 100;
      out.push({
        id: id,
        name: c ? c.name : id,
        icon: c ? (c.icon || "") : "",
        spent: spent,
        limit: limit,
        pct: Math.round(spent / limit * 100),
        over: spent > limit
      });
    });
    out.sort(function (a, b) { return b.pct - a.pct; });
    return out;
  }

  // Transactions for one calendar month (YYYY-MM); falsy monthKey returns all.
  function filterTransactionsByMonth(transactions, mk) {
    if (!mk) return (transactions || []).slice();
    return (transactions || []).filter(function (t) { return t.month === mk; });
  }

  // Full categorized-transaction export for spreadsheets.
  function transactionsToCSV(analysis) {
    var rows = [["Date", "Description", "Merchant", "Amount", "Category", "Confidence"]];
    var txs = ((analysis || {}).transactions || []).slice().sort(function (a, b) {
      var da = a.date instanceof Date ? a.date : new Date(a.date);
      var db = b.date instanceof Date ? b.date : new Date(b.date);
      return da - db;
    });
    txs.forEach(function (t) {
      var d = t.date instanceof Date ? t.date : new Date(t.date);
      rows.push([
        isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10),
        t.description, t.merchant,
        (Math.round(t.amount * 100) / 100).toFixed(2),
        t.categoryName, t.confidence
      ]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  }

  // Hide dismissed recurring charges (dismissed = { merchant: true }).
  function visibleSubscriptions(subscriptions, dismissed) {
    dismissed = dismissed || {};
    return (subscriptions || []).filter(function (s) { return !dismissed[s.merchant]; });
  }

  function monthKey(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }

  function analyze(transactions, overrides) {
    overrides = overrides || {};
    var txs = transactions.map(function (t) {
      var merch = BL.normalizeMerchant(t.description);
      var ov = overrides[merch];
      var c = ov ? BL.categoryById(ov) : BL.categorize(t.description);
      return {
        date: t.date, description: t.description, amount: t.amount,
        merchant: merch,
        category: ov || c.category, categoryName: ov ? BL.categoryById(ov).name : c.name,
        icon: ov ? BL.categoryById(ov).icon : c.icon,
        confidence: ov ? "manual" : c.confidence,
        month: monthKey(t.date instanceof Date ? t.date : new Date(t.date))
      };
    });

    var byCat = {}, byMerchant = {}, byMonth = {};
    var totalIn = 0, totalOut = 0;
    txs.forEach(function (t) {
      if (t.amount >= 0) totalIn += t.amount; else totalOut += -t.amount;
      byCat[t.category] = (byCat[t.category] || 0) + (t.amount < 0 ? -t.amount : 0);
      var m = byMerchant[t.merchant] || (byMerchant[t.merchant] = { total: 0, count: 0, txs: [] });
      m.total += t.amount; m.count++; m.txs.push(t);
      var mo = byMonth[t.month] || (byMonth[t.month] = { in: 0, out: 0 });
      if (t.amount >= 0) mo.in += t.amount; else mo.out += -t.amount;
    });

    var subs = detectSubscriptions(byMerchant);
    var nudges = buildNudges(byCat, subs, txs, totalIn, totalOut);
    return { transactions: txs, byCat: byCat, byMerchant: byMerchant, byMonth: byMonth,
             totalIn: totalIn, totalOut: totalOut, subscriptions: subs, nudges: nudges };
  }

  function detectSubscriptions(byMerchant) {
    var subs = [];
    Object.keys(byMerchant).forEach(function (merch) {
      var g = byMerchant[merch];
      var charges = g.txs.filter(function (t) { return t.amount < 0; }).map(function (t) { return -t.amount; });
      if (charges.length < 2) return;
      var months = {};
      g.txs.forEach(function (t) { months[t.month] = true; });
      if (Object.keys(months).length < 2) return;
      var sorted = charges.slice().sort(function (a, b) { return a - b; });
      var median = sorted[Math.floor(sorted.length / 2)];
      var consistent = charges.every(function (c) { return Math.abs(c - median) / median <= 0.15; });
      if (!consistent) return;
      subs.push({
        merchant: merch,
        example: g.txs[0].description,
        monthly: median,
        yearly: median * 12,
        occurrences: charges.length,
        months: Object.keys(months).sort()
      });
    });
    subs.sort(function (a, b) { return b.yearly - a.yearly; });
    return subs;
  }

  function buildNudges(byCat, subs, txs, totalIn, totalOut) {
    var nudges = [];
    var subTotal = subs.reduce(function (s, x) { return s + x.monthly; }, 0);
    if (subTotal > 0) {
      nudges.push({
        icon: "🔁",
        title: "Subscription check",
        text: "You're paying " + money(subTotal) + "/mo (" + money(subTotal * 12) + "/yr) in subscriptions. " +
              (subs[0] ? "The biggest is " + subs[0].merchant + " at " + money(subs[0].monthly) + "/mo — canceling just that one saves " + money(subs[0].yearly) + " a year." : "")
      });
    }
    var dining = byCat.dining || 0, groceries = byCat.groceries || 0;
    if (dining > 0 && dining > groceries * 0.7) {
      var save = Math.round(dining * 0.3);
      nudges.push({ icon: "🍽️", title: "Dining out",
        text: "You spent " + money(dining) + " eating out vs " + money(groceries) + " on groceries. Cooking two more nights a week could save roughly " + money(save) + " a month." });
    }
    var fees = byCat.fees || 0;
    if (fees > 0) {
      nudges.push({ icon: "⚠️", title: "Fees", text: "You paid " + money(fees) + " in bank fees. A low-balance alert or a no-fee account would keep that money." });
    }
    var top = Object.keys(byCat).filter(function (k) { return k !== "income"; })
      .sort(function (a, b) { return byCat[b] - byCat[a]; })[0];
    if (top && byCat[top] > 0) {
      var nm = BL.categoryById(top).name;
      nudges.push({ icon: "📊", title: "Biggest spend", text: "Your biggest spending category is " + nm + " at " + money(byCat[top]) + ". That's where one small change has the biggest payoff." });
    }
    if (totalIn > 0) {
      var rate = Math.max(0, (totalIn - totalOut) / totalIn);
      nudges.push({ icon: rate >= 0.2 ? "✅" : "💡", title: "Savings rate",
        text: "You're keeping " + Math.round(rate * 100) + "% of what you earn. " +
              (rate >= 0.2 ? "That's a healthy savings rate — nice work." : "Aim for 20%. Closing a " + money(Math.max(0, totalIn * 0.2 - (totalIn - totalOut))) + "/mo gap gets you there.") });
    }
    return nudges;
  }

  return {
    parseCSV: parseCSV, parseAmount: parseAmount, parseDate: parseDate,
    rowsToTransactions: rowsToTransactions, analyze: analyze,
    detectSubscriptions: detectSubscriptions, money: money, monthKey: monthKey,
    budgetStatus: budgetStatus, filterTransactionsByMonth: filterTransactionsByMonth,
    transactionsToCSV: transactionsToCSV, visibleSubscriptions: visibleSubscriptions
  };
});
