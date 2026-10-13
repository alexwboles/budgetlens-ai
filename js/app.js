/* BudgetLens app — UI wiring. Requires js/categorize.js and js/analyze.js loaded first. */
(function () {
  "use strict";
  var BL = window.BudgetLens;
  var state = { analysis: null, overrides: {}, txCount: 0, rawTxs: [], month: "", budgets: {}, dismissed: {}, txQ: "", txCat: "all", goal: "", planMonth: "", plan: {} };

  function $(id) { return document.getElementById(id); }

  function loadStore() {
    try { state.overrides = JSON.parse(localStorage.getItem("bl_overrides") || "{}"); }
    catch (e) { state.overrides = {}; }
    try { state.budgets = JSON.parse(localStorage.getItem("bl_budgets") || "{}"); }
    catch (e) { state.budgets = {}; }
    try { state.dismissed = JSON.parse(localStorage.getItem("bl_dismissed") || "{}"); }
    catch (e) { state.dismissed = {}; }
    try { state.goal = localStorage.getItem("bl_goal") || ""; }
    catch (e) { state.goal = ""; }
    try { state.plan = JSON.parse(localStorage.getItem("bl_plan") || "{}"); }
    catch (e) { state.plan = {}; }
  }
  function saveStore() {
    try {
      localStorage.setItem("bl_overrides", JSON.stringify(state.overrides));
      localStorage.setItem("bl_budgets", JSON.stringify(state.budgets));
      localStorage.setItem("bl_dismissed", JSON.stringify(state.dismissed));
      localStorage.setItem("bl_plan", JSON.stringify(state.plan));
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
    var pmonths = Object.keys(state.analysis.byMonth).sort();
    state.planMonth = pmonths[pmonths.length - 1] || "";
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
    renderPace();
    renderGoal();
    renderDupes();
    renderOutliers();
    renderCatTrends();
    renderBudgets();
    renderTransactions();
    renderSubscriptions();
    renderIncome();
    renderNudges();
    renderPlan();
    renderReports();
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

  function renderPace() {
    var host = $("paceBox");
    if (!host || !state.analysis) return;
    var p = BL.spendPace(state.rawTxs);
    host.innerHTML =
      '<div class="pace-line"><b>' + BL.money(p.perDay) + '</b><span>/day so far this month</span></div>' +
      '<div class="pace-line">On pace for <b>' + BL.money(p.projected) + '</b> by month-end</div>' +
      '<div class="pace-line muted">Last month you spent ' + BL.money(p.lastMonth) + ' · ' +
      p.dayOfMonth + ' of ' + p.daysInMonth + ' days in</div>';
  }

  function renderGoal() {
    var host = $("goalBox");
    if (!host || !state.analysis) return;
    var a = scopedAnalysis();
    var st = BL.savingsGoalStatus(a.totalIn, a.totalOut, state.goal);
    var html = '<div class="goal-form"><label>Monthly goal $<input type="number" id="goalInput" min="0" step="50" value="' +
      esc(state.goal || "") + '"></label><button class="btn btn-small" id="goalSave">Save</button></div>';
    if (st) {
      var pct = Math.max(3, Math.min(100, st.pct));
      html += '<div class="bar-row"><div class="bar-label">' + (st.onTrack ? "Goal met" : "Kept so far") + '</div>' +
        '<div class="bar-track"><div class="bar-fill' + (st.onTrack ? "" : " behind") + '" style="width:' + pct + '%"></div></div>' +
        '<div class="bar-val">' + BL.money(st.kept) + " / " + BL.money(st.goal) + "</div></div>";
    } else {
      html += '<p class="muted small">Set a goal to track your progress.</p>';
    }
    host.innerHTML = html;
    $("goalSave").addEventListener("click", function () {
      state.goal = $("goalInput").value;
      try { localStorage.setItem("bl_goal", String(state.goal || "")); } catch (e) {}
      renderGoal();
    });
  }

  function renderDupes() {
    var host = $("dupeBox");
    if (!host || !state.analysis) return;
    var dups = BL.detectDuplicates(state.rawTxs);
    if (!dups.length) {
      host.innerHTML = '<p class="muted">No duplicate charges found. Clean books.</p>';
      return;
    }
    host.innerHTML = dups.map(function (g) {
      return '<div class="sub-card"><div><div class="sub-name">' + esc(g.merchant) + "</div>" +
        '<div class="muted">' + g.txs.map(function (t) {
          var d = t.date instanceof Date ? t.date : new Date(t.date);
          return esc(t.description) + " · " + d.toISOString().slice(0, 10);
        }).join("<br>") + '</div></div>' +
        '<div class="r"><div><strong>' + BL.money(g.amount) + '</strong></div>' +
        '<div class="muted">×' + g.txs.length + " charges</div></div></div>";
    }).join("");
  }

  function renderOutliers() {
    var host = $("outlierBox");
    if (!host || !state.analysis) return;
    var outs = BL.detectOutliers(state.rawTxs);
    if (!outs.length) {
      host.innerHTML = '<p class="muted">No unusually large charges. Nothing sticking out.</p>';
      return;
    }
    host.innerHTML = outs.slice(0, 10).map(function (o) {
      var d = o.date instanceof Date ? o.date : new Date(o.date);
      return '<div class="merch-row"><span>' + esc(o.description) + '<br><span class="muted">' +
        d.toISOString().slice(0, 10) + " · " + esc(o.categoryName) + " · usually around " + BL.money(o.median) + "</span></span>" +
        '<span><strong class="neg">' + BL.money(o.amount) + '</strong> <span class="muted">' + o.ratio + "×</span></span></div>";
    }).join("");
  }

  function renderCatTrends() {
    var host = $("trendBox");
    if (!host || !state.analysis) return;
    var trends = BL.categoryTrends(state.analysis.byCatMonth);
    if (!trends.length) {
      host.innerHTML = '<p class="muted">Need at least two months of data to spot trends.</p>';
      return;
    }
    host.innerHTML = trends.slice(0, 8).map(function (t) {
      var arrow = t.up ? '<span class="neg">▲</span>' : '<span class="pos">▼</span>';
      var sign = t.pct > 0 ? "+" : "";
      return '<div class="merch-row"><span>' + esc(t.icon) + " " + esc(t.name) + "</span><span>" + arrow + " " +
        sign + t.pct + '% <span class="muted">' + BL.money(t.last) + " vs " + BL.money(t.avg) + " avg</span></span></div>";
    }).join("");
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

  function renderIncome() {
    var host = $("incomeList");
    if (!host || !state.analysis) return;
    var inc = state.analysis.recurringIncome;
    if (!inc.length) {
      host.innerHTML = '<p class="muted">No recurring income detected. Steady paychecks or payouts will show up here.</p>';
      return;
    }
    var total = inc.reduce(function (s, x) { return s + x.monthly; }, 0);
    var html = '<div class="sub-total">Detected <strong>' + inc.length + "</strong> recurring income source" +
      (inc.length === 1 ? "" : "s") + " totaling <strong>" + BL.money(total) + "/mo</strong></div>";
    inc.forEach(function (s) {
      html += '<div class="sub-card"><div><div class="sub-name">' + esc(s.merchant) + "</div>" +
        '<div class="muted">' + esc(s.example) + " · " + s.occurrences + " deposits across " + s.months.length + " months</div></div>" +
        '<div class="r"><div><strong class="pos">' + BL.money(s.monthly) + "/mo</strong></div>" +
        '<div class="muted">' + BL.money(s.yearly) + "/yr</div></div></div>";
    });
    host.innerHTML = html;
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

  /* ---------- plan (envelope) ---------- */

  function planAssignments() { return state.plan[state.planMonth] || {}; }
  function savePlan(month, assigns) {
    if (!month) return;
    state.plan[month] = assigns;
    saveStore();
  }

  function stepPlan(dir) {
    var months = Object.keys(state.analysis.byMonth).sort();
    var i = months.indexOf(state.planMonth);
    i = Math.max(0, Math.min(months.length - 1, i + dir));
    state.planMonth = months[i] || state.planMonth;
    renderPlan();
  }

  function renderPlan() {
    var host = $("planTable"), banner = $("planBanner");
    if (!host || !banner || !state.analysis) return;
    var months = Object.keys(state.analysis.byMonth).sort();
    if (!state.planMonth || months.indexOf(state.planMonth) < 0) {
      state.planMonth = months[months.length - 1] || "";
    }
    $("planMonthLabel").textContent = state.planMonth ? monthLabel(state.planMonth) : "—";
    $("planPrev").disabled = months.indexOf(state.planMonth) <= 0;
    $("planNext").disabled = months.indexOf(state.planMonth) >= months.length - 1;
    if (!state.planMonth) {
      banner.innerHTML = '<div class="rta"><div class="rta-label">Ready to assign</div><div class="rta-value">—</div></div>';
      host.innerHTML = '<p class="muted">Load transactions to build a plan.</p>';
      return;
    }
    var plan = BL.planForMonth(state.analysis, state.planMonth, planAssignments());
    var readyCls = plan.ready > 0 ? "pos" : (plan.ready < 0 ? "neg" : "");
    var assignPct = plan.income > 0 ? Math.min(100, Math.round(plan.assigned / plan.income * 100)) : 0;
    var bh = '<div class="rta"><div><div class="rta-label">Ready to assign</div>' +
      '<div class="rta-value ' + readyCls + '">' + BL.money(plan.ready) + "</div></div>" +
      '<div class="rta-meter"><div class="rta-meter-row"><span>Income assigned</span><span>' + assignPct + "%</span></div>" +
      '<div class="rta-track"><div class="rta-fill" style="width:' + assignPct + '%"></div></div>' +
      '<div class="rta-meta">' + BL.money(plan.income) + " income in " + esc(monthLabel(plan.month)) +
      " · " + BL.money(plan.assigned) + " assigned</div></div></div>";
    if (plan.ready < 0) {
      bh += '<div class="plan-warn">You assigned ' + BL.money(-plan.ready) + " more than this month\u2019s income. Trim a category or cover it with less.</div>";
    }
    bh += '<div id="planNote" class="plan-note"></div>';
    banner.innerHTML = bh;

    var html = '<div class="plan-row plan-head"><span>Category</span><span class="r">Budgeted</span><span class="r">Activity</span><span class="r">Available</span><span></span></div>';
    plan.groups.forEach(function (g) {
      html += '<div class="plan-row plan-group"><span>' + esc(g.name) + "</span>" +
        '<span class="r">' + BL.money(g.budgeted) + '</span><span class="r">' + BL.money(g.activity) + "</span>" +
        '<span class="r ' + (g.available < 0 ? "neg" : "pos") + '">' + BL.money(g.available) + "</span><span></span></div>";
      g.rows.forEach(function (r) {
        var cls = r.over ? "neg" : (r.available > 0 ? "pos" : "");
        html += '<div class="plan-row' + (r.over ? " over" : "") + '"><span>' + esc(r.name) + "</span>" +
          '<span class="r"><input type="number" min="0" step="1" class="plan-input" data-plan-cat="' + r.id +
          '" value="' + (r.budgeted ? r.budgeted : "") + '" placeholder="0" aria-label="Budget for ' + esc(r.name) + '"></span>' +
          '<span class="r">' + BL.money(r.activity) + '</span>' +
          '<span class="r ' + cls + '"><strong>' + BL.money(r.available) + "</strong></span>" +
          '<span class="r">' + (r.over
            ? '<button class="btn btn-secondary btn-small" data-cover="' + r.id + '" data-amt="' + (-r.available).toFixed(2) + '">Cover ' + BL.money(-r.available) + "</button>"
            : "") + "</span></div>";
      });
    });
    host.innerHTML = html;

    host.querySelectorAll("[data-plan-cat]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var a = Object.assign({}, planAssignments());
        var v = parseFloat(inp.value);
        if (v > 0) a[inp.getAttribute("data-plan-cat")] = Math.round(v * 100) / 100;
        else delete a[inp.getAttribute("data-plan-cat")];
        savePlan(state.planMonth, a);
        renderPlan();
      });
    });
    host.querySelectorAll("[data-cover]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var note = $("planNote");
        var next = BL.coverFromPool(plan, planAssignments(), btn.getAttribute("data-cover"), parseFloat(btn.getAttribute("data-amt")));
        if (!next) {
          if (note) note.textContent = "Not enough in Ready to Assign to cover that.";
          return;
        }
        savePlan(state.planMonth, next);
        renderPlan();
      });
    });
  }

  /* ---------- reports ---------- */

  function renderReports() {
    if (!state.analysis) return;
    var ive = $("reportIve"), rate = $("reportRate"), share = $("reportShare");
    if (!ive || !rate || !share) return;
    var rows = BL.incomeVsExpense(state.analysis.byMonth);
    if (!rows.length) {
      ive.innerHTML = rate.innerHTML = share.innerHTML = '<p class="muted">Load transactions to see reports.</p>';
      return;
    }
    var maxV = Math.max.apply(null, rows.map(function (r) { return Math.max(r.in, r.out); }).concat([1]));
    ive.innerHTML = rows.map(function (r) {
      var iw = Math.max(3, Math.round(r.in / maxV * 100));
      var ow = Math.max(3, Math.round(r.out / maxV * 100));
      return '<div class="rep-month"><div class="rep-mlabel">' + esc(monthLabel(r.month)) + "</div>" +
        '<div class="rep-bars">' +
        '<div class="rep-bar-row"><span class="rep-blabel">In</span><div class="rep-track"><div class="rep-fill in" style="width:' + iw + '%"></div></div><span class="rep-val pos">' + BL.money(r.in) + "</span></div>" +
        '<div class="rep-bar-row"><span class="rep-blabel">Out</span><div class="rep-track"><div class="rep-fill out" style="width:' + ow + '%"></div></div><span class="rep-val neg">' + BL.money(r.out) + "</span></div>" +
        "</div>" +
        '<div class="rep-kept ' + (r.kept >= 0 ? "pos" : "neg") + '">Kept ' + BL.money(r.kept) + "</div></div>";
    }).join("");
    rate.innerHTML = rows.map(function (r) {
      var w = Math.max(3, Math.min(100, r.savingsRate));
      var good = r.savingsRate >= 20;
      return '<div class="bar-row"><div class="bar-label">' + esc(monthLabel(r.month)) + "</div>" +
        '<div class="bar-track"><div class="bar-fill' + (good ? "" : " behind") + '" style="width:' + w + '%"></div></div>' +
        '<div class="bar-val">' + r.savingsRate + "%</div></div>";
    }).join("");
    var sh = BL.categoryShare(state.analysis.byCat);
    share.innerHTML = sh.length ? sh.slice(0, 8).map(function (s) {
      return '<div class="bar-row"><div class="bar-label">' + esc(s.name) + "</div>" +
        '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(3, s.pct) + '%"></div></div>' +
        '<div class="bar-val">' + s.pct + "%</div></div>";
    }).join("") : '<p class="muted">No spending yet.</p>';
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

    $("planPrev").addEventListener("click", function () { stepPlan(-1); });
    $("planNext").addEventListener("click", function () { stepPlan(1); });
    $("planAuto").addEventListener("click", function () {
      if (!state.analysis || !state.planMonth) return;
      savePlan(state.planMonth, BL.suggestAssignments(state.analysis, state.planMonth));
      renderPlan();
    });
    $("planClear").addEventListener("click", function () {
      if (!state.planMonth) return;
      savePlan(state.planMonth, {});
      renderPlan();
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
