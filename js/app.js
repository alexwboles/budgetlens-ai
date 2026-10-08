/* BudgetLens app — UI wiring. Requires js/categorize.js and js/analyze.js loaded first. */
(function () {
  "use strict";
  var BL = window.BudgetLens;
  var state = { analysis: null, overrides: {}, txCount: 0, rawTxs: [], month: "", budgets: {}, dismissed: {}, txQ: "", txCat: "all" };

  function $(id) { return document.getElementById(id); }

  function loadStore() {
    try { state.overrides = JSON.parse(localStorage.getItem("bl_overrides") || "{}"); }
    catch (e) { state.overrides = {}; }
    try { state.budgets = JSON.parse(localStorage.getItem("bl_budgets") || "{}"); }
    catch (e) { state.budgets = {}; }
    try { state.dismissed = JSON.parse(localStorage.getItem("bl_dismissed") || "{}"); }
    catch (e) { state.dismissed = {}; }
  }
  function saveStore() {
    try {
      localStorage.setItem("bl_overrides", JSON.stringify(state.overrides));
      localStorage.setItem("bl_budgets", JSON.stringify(state.budgets));
      localStorage.setItem("bl_dismissed", JSON.stringify(state.dismissed));
    } catch (e) {}
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function handleCSV(text, label) {
    lastRows = BL.parseCSV(text);
    var rows = lastRows;
    var txs = BL.rowsToTransactions(rows);
    if (!txs.length) {
      $("uploadMsg").textContent = "Couldn't find any transactions in that file. Make sure it has date, description and amount columns.";
      return;
    }
    state.txCount = txs.length;
    state.analysis = BL.analyze(txs, state.overrides);
    state.rawTxs = state.analysis.transactions; // carries month + category for scoping
    state.month = "";
    $("uploadMsg").textContent = "Loaded " + txs.length + " transactions" + (label ? " from " + label : "") + ".";
    renderAll();
    showTab("dashboard");
  }

  /* ---------- rendering ---------- */

  function showTab(name) {
    var tabs = document.querySelectorAll(".tab");
    var panes = document.querySelectorAll(".pane");
    tabs.forEach(function (t) { t.classList.toggle("active", t.dataset.tab === name); });
    panes.forEach(function (p) { p.classList.toggle("active", p.id === "pane-" + name); });
  }

  function renderAll() {
    if (!state.analysis) return;
    renderMonthPick();
    renderDashboard();
    renderBudgets();
    renderTransactions();
    renderSubscriptions();
    renderNudges();
  }

  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthLabel(mk) {
    var p = String(mk).split("-");
    return (MONTH_NAMES[parseInt(p[1], 10) - 1] || "") + " " + (p[0] || "");
  }

  // Analysis scoped to the picked month ("" = all months).
  function scopedAnalysis() {
    if (!state.analysis) return null;
    if (!state.month) return state.analysis;
    return BL.analyze(BL.filterTransactionsByMonth(state.rawTxs, state.month), state.overrides);
  }
  function monthsInScope() {
    if (!state.analysis) return 1;
    return state.month ? 1 : Math.max(1, Object.keys(state.analysis.byMonth).length);
  }

  function renderMonthPick() {
    var sel = $("monthPick");
    if (!sel || !state.analysis) return;
    var months = Object.keys(state.analysis.byMonth).sort();
    var html = '<option value="">All months</option>' + months.map(function (m) {
      return '<option value="' + m + '"' + (state.month === m ? " selected" : "") + ">" + esc(monthLabel(m)) + "</option>";
    }).join("");
    if (sel.innerHTML !== html) sel.innerHTML = html;
  }

  function renderDashboard() {
    var a = scopedAnalysis();
    var net = a.totalIn - a.totalOut;
    $("statIn").textContent = BL.money(a.totalIn);
    $("statOut").textContent = BL.money(a.totalOut);
    $("statNet").textContent = BL.money(net);
    $("statNet").className = "stat-value " + (net >= 0 ? "pos" : "neg");
    $("statCount").textContent = a.transactions.length;

    // category bars
    var cats = Object.keys(a.byCat).filter(function (k) { return k !== "income" && a.byCat[k] > 0; })
      .sort(function (x, y) { return a.byCat[y] - a.byCat[x]; });
    var max = cats.length ? a.byCat[cats[0]] : 1;
    var html = "";
    cats.forEach(function (id) {
      var c = BL.categoryById(id), v = a.byCat[id];
      var pct = Math.max(3, Math.round(v / max * 100));
      html += '<div class="bar-row"><div class="bar-label">' + esc(c.name) + '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="bar-val">' + BL.money(v) + "</div></div>";
    });
    $("catBars").innerHTML = html || '<p class="muted">No spending yet.</p>';

    // top merchants
    var merchs = Object.keys(a.byMerchant)
      .map(function (k) { return { name: k, total: a.byMerchant[k].total, count: a.byMerchant[k].count }; })
      .filter(function (m) { return m.total < 0; })
      .sort(function (x, y) { return x.total - y.total; })
      .slice(0, 8);
    html = "";
    merchs.forEach(function (m) {
      html += '<div class="merch-row"><span>' + esc(m.name) + ' <span class="muted">×' + m.count + "</span></span><span>" + BL.money(m.total) + "</span></div>";
    });
    $("topMerchants").innerHTML = html || '<p class="muted">No merchants yet.</p>';

    // month over month
    var months = Object.keys(a.byMonth).sort();
    html = '<div class="mom-row mom-head"><span>Month</span><span>In</span><span>Out</span><span>Kept</span></div>';
    months.forEach(function (m) {
      var mo = a.byMonth[m], kept = mo.in - mo.out;
      html += '<div class="mom-row"><span>' + esc(m) + "</span><span>" + BL.money(mo.in) + "</span><span>" + BL.money(mo.out) +
        '</span><span class="' + (kept >= 0 ? "pos" : "neg") + '">' + BL.money(kept) + "</span></div>";
    });
    $("momTable").innerHTML = html;
  }

  function renderTransactions() {
    var a = scopedAnalysis();
    renderTxCatFilter();
    var q = (state.txQ || "").trim().toLowerCase();
    var cf = state.txCat || "all";
    var txs = a.transactions.slice().sort(function (x, y) { return y.date - x.date; }).filter(function (t) {
      if (cf !== "all" && t.category !== cf) return false;
      if (q && t.description.toLowerCase().indexOf(q) < 0 && t.merchant.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var shown = txs.slice(0, 150);
    $("txCount").textContent = txs.length + " transaction" + (txs.length === 1 ? "" : "s") + (txs.length > 150 ? " (showing latest 150)" : "");
    var opts = BL.CATEGORIES.concat([{ id: "other", name: "Other" }])
      .map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + "</option>"; }).join("");
    var html = '<div class="tx-row tx-head"><span>Date</span><span>Description</span><span class="r">Amount</span><span>Category</span></div>';
    shown.forEach(function (t, i) {
      var d = t.date instanceof Date ? t.date : new Date(t.date);
      var ds = d.toISOString().slice(0, 10);
      html += '<div class="tx-row"><span>' + ds + "</span><span>" + esc(t.description) +
        (t.confidence === "low" ? ' <span class="lowconf" title="Not sure about this one">?</span>' : "") +
        '</span><span class="r ' + (t.amount < 0 ? "neg" : "pos") + '">' + BL.money(t.amount) + "</span>" +
        '<span><select data-merch="' + esc(t.merchant) + '" data-idx="' + i + '">' +
        opts.replace('value="' + t.category + '"', 'value="' + t.category + '" selected') +
        "</select></span></div>";
    });
    $("txTable").innerHTML = html || '<p class="muted">No transactions match.</p>';
    $("txTable").querySelectorAll("select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        state.overrides[sel.dataset.merch] = sel.value;
        saveStore();
        if (!lastRows) return;
        var txs = BL.rowsToTransactions(lastRows);
        state.analysis = BL.analyze(txs, state.overrides);
        state.rawTxs = state.analysis.transactions;
        renderAll();
      });
    });
    function reanalyze() {
      // rebuild from last parsed transactions
      var rows = lastRows;
      if (!rows) return;
      var txs = BL.rowsToTransactions(rows);
      state.analysis = BL.analyze(txs, state.overrides);
      renderAll();
    }
  }

  function renderTxCatFilter() {
    var sel = $("txCatFilter");
    if (!sel) return;
    var html = '<option value="all">All categories</option>' + BL.CATEGORIES.concat([{ id: "other", name: "Other" }])
      .map(function (c) { return '<option value="' + c.id + '"' + (state.txCat === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("");
    if (sel.innerHTML !== html) sel.innerHTML = html;
    var q = $("txSearch");
    if (q && q.value !== state.txQ) q.value = state.txQ;
  }

  function renderBudgets() {
    var host = $("budgetList"), form = $("budgetForm");
    if (!host || !form) return;
    if (!state.analysis) {
      host.innerHTML = '<p class="muted">Load transactions to set monthly budgets.</p>';
      form.innerHTML = "";
      return;
    }
    var cats = BL.CATEGORIES.filter(function (c) { return c.id !== "income"; }).concat([{ id: "other", name: "Other", icon: "📦" }]);
    form.innerHTML = cats.map(function (c) {
      return '<label class="budget-field"><span>' + esc(c.icon || "") + " " + esc(c.name) + '</span>' +
        '<input type="number" min="0" step="1" placeholder="No limit" data-budget="' + c.id + '" value="' +
        esc(state.budgets[c.id] != null ? state.budgets[c.id] : "") + '"></label>';
    }).join("") +
      '<div class="budget-actions"><button class="btn" id="budgetSave">Save budgets</button>' +
      '<button class="btn btn-secondary" id="budgetClear">Clear all</button></div>';
    $("budgetSave").addEventListener("click", function () {
      var b = {};
      form.querySelectorAll("[data-budget]").forEach(function (inp) {
        var v = parseFloat(inp.value);
        if (v > 0) b[inp.getAttribute("data-budget")] = v;
      });
      state.budgets = b;
      saveStore();
      renderBudgets();
    });
    $("budgetClear").addEventListener("click", function () {
      state.budgets = {};
      saveStore();
      renderBudgets();
    });

    var scoped = scopedAnalysis();
    var rows = BL.budgetStatus(scoped.byCat, state.budgets, monthsInScope());
    if (!rows.length) {
      host.innerHTML = '<p class="muted">Set a monthly limit above — BudgetLens will flag the categories that blow past it.</p>';
      return;
    }
    var over = rows.filter(function (r) { return r.over; });
    var scopeNote = state.month ? " for " + esc(monthLabel(state.month)) : " (monthly average)";
    var html = over.length
      ? '<div class="budget-alert">Over budget in ' + over.length + " categor" + (over.length === 1 ? "y" : "ies") + scopeNote + ": " +
        over.map(function (r) { return esc(r.name) + " (" + BL.money(r.spent) + " of " + BL.money(r.limit) + ")"; }).join(", ") + ".</div>"
      : '<div class="budget-ok">All budgets on track' + scopeNote + ".</div>";
    rows.forEach(function (r) {
      html += '<div class="bar-row' + (r.over ? " over" : "") + '"><div class="bar-label">' + esc(r.icon) + " " + esc(r.name) + "</div>" +
        '<div class="bar-track"><div class="bar-fill' + (r.over ? " over" : "") + '" style="width:' + Math.max(3, Math.min(100, r.pct)) + '%"></div></div>' +
        '<div class="bar-val">' + BL.money(r.spent) + " / " + BL.money(r.limit) + "</div></div>";
    });
    host.innerHTML = html;
  }

  var lastRows = null;

  function renderSubscriptions() {
    var a = state.analysis;
    var all = a.subscriptions;
    var subs = BL.visibleSubscriptions(all, state.dismissed);
    var dismissedCount = all.length - subs.length;
    var total = subs.reduce(function (s, x) { return s + x.monthly; }, 0);
    var html = '<div class="sub-total">Detected <strong>' + subs.length + "</strong> recurring charges totaling <strong>" +
      BL.money(total) + "/mo</strong> (" + BL.money(total * 12) + "/yr)" +
      (dismissedCount ? ' · <button class="linklike" id="subRestore">' + dismissedCount + " dismissed — restore</button>" : "") + "</div>";
    subs.forEach(function (s) {
      html += '<div class="sub-card"><div><div class="sub-name">' + esc(s.merchant) + "</div>" +
        '<div class="muted">' + esc(s.example) + " · " + s.occurrences + " charges across " + s.months.length + " months</div></div>" +
        '<div class="r"><div><strong>' + BL.money(s.monthly) + "/mo</strong></div>" +
        '<div class="muted">' + BL.money(s.yearly) + '/yr · <span class="cancel">cancel candidate</span></div>' +
        '<div style="margin-top:8px"><button class="btn btn-secondary btn-small" data-dismiss="' + esc(s.merchant) + '">Dismiss</button></div></div></div>';
    });
    $("subList").innerHTML = html || '<p class="muted">No recurring charges detected.</p>';
    $("subList").querySelectorAll("[data-dismiss]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.dismissed[btn.getAttribute("data-dismiss")] = true;
        saveStore();
        renderSubscriptions();
      });
    });
    var rs = $("subRestore");
    if (rs) rs.addEventListener("click", function () {
      state.dismissed = {};
      saveStore();
      renderSubscriptions();
    });
  }

  function renderNudges() {
    var a = state.analysis;
    var html = "";
    a.nudges.forEach(function (n) {
      html += '<div class="nudge"><div class="nudge-dot"></div><div><div class="nudge-title">' +
        esc(n.title) + '</div><div class="nudge-body">' + esc(n.text) + "</div></div></div>";
    });
    $("nudgeList").innerHTML = html || '<p class="muted">Load transactions to get personalized nudges.</p>';
  }

  /* ---------- wiring ---------- */

  document.addEventListener("DOMContentLoaded", function () {
    loadStore();

    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { showTab(t.dataset.tab); });
    });

    $("monthPick").addEventListener("change", function (e) {
      state.month = e.target.value;
      renderAll();
    });

    var txSearch = $("txSearch");
    if (txSearch) txSearch.addEventListener("input", function (e) {
      state.txQ = e.target.value;
      clearTimeout(txSearch._t);
      txSearch._t = setTimeout(renderTransactions, 250);
    });
    $("txCatFilter").addEventListener("change", function (e) {
      state.txCat = e.target.value;
      renderTransactions();
    });
    $("txExport").addEventListener("click", function () {
      if (!state.analysis) return;
      var csv = BL.transactionsToCSV(state.analysis);
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "budgetlens-transactions.csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
    $("txPrint").addEventListener("click", function () {
      if (!state.analysis) return;
      window.print();
    });

    var fileInput = $("fileInput"), drop = $("dropZone");
    $("browseBtn").addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var f = fileInput.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { handleCSV(r.result, f.name); };
      r.readAsText(f);
    });
    ["dragover", "dragenter"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); });
    });
    drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { handleCSV(r.result, f.name); };
      r.readAsText(f);
    });

    $("sampleBtn").addEventListener("click", function () {
      fetch("data/sample.csv").then(function (r) { return r.text(); }).then(function (t) {
        handleCSV(t, "sample data");
      }).catch(function () {
        $("uploadMsg").textContent = "Couldn't load the sample file. Serve this folder with a local web server (e.g. npx serve) instead of opening index.html directly.";
      });
    });

    showTab("upload");
  });
})();
