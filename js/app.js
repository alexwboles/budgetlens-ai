/* BudgetLens app — UI wiring. Requires js/categorize.js and js/analyze.js loaded first. */
(function () {
  "use strict";
  var BL = window.BudgetLens;
  var state = { analysis: null, overrides: {}, txCount: 0 };

  function $(id) { return document.getElementById(id); }

  function loadOverrides() {
    try { state.overrides = JSON.parse(localStorage.getItem("bl_overrides") || "{}"); }
    catch (e) { state.overrides = {}; }
  }
  function saveOverrides() {
    try { localStorage.setItem("bl_overrides", JSON.stringify(state.overrides)); } catch (e) {}
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
    renderDashboard();
    renderTransactions();
    renderSubscriptions();
    renderNudges();
  }

  function renderDashboard() {
    var a = state.analysis;
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
    var a = state.analysis;
    var txs = a.transactions.slice().sort(function (x, y) { return y.date - x.date; }).slice(0, 150);
    var opts = BL.CATEGORIES.concat([{ id: "other", name: "Other" }])
      .map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + "</option>"; }).join("");
    var html = '<div class="tx-row tx-head"><span>Date</span><span>Description</span><span class="r">Amount</span><span>Category</span></div>';
    txs.forEach(function (t, i) {
      var d = t.date instanceof Date ? t.date : new Date(t.date);
      var ds = d.toISOString().slice(0, 10);
      html += '<div class="tx-row"><span>' + ds + "</span><span>" + esc(t.description) +
        (t.confidence === "low" ? ' <span class="lowconf" title="Not sure about this one">?</span>' : "") +
        '</span><span class="r ' + (t.amount < 0 ? "neg" : "pos") + '">' + BL.money(t.amount) + "</span>" +
        '<span><select data-merch="' + esc(t.merchant) + '" data-idx="' + i + '">' +
        opts.replace('value="' + t.category + '"', 'value="' + t.category + '" selected') +
        "</select></span></div>";
    });
    $("txTable").innerHTML = html;
    $("txTable").querySelectorAll("select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        state.overrides[sel.dataset.merch] = sel.value;
        saveOverrides();
        if (!lastRows) return;
        state.analysis = BL.analyze(BL.rowsToTransactions(lastRows), state.overrides);
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

  var lastRows = null;

  function renderSubscriptions() {
    var a = state.analysis, subs = a.subscriptions;
    var total = subs.reduce(function (s, x) { return s + x.monthly; }, 0);
    var html = '<div class="sub-total">Detected <strong>' + subs.length + "</strong> recurring charges totaling <strong>" +
      BL.money(total) + "/mo</strong> (" + BL.money(total * 12) + "/yr)</div>";
    subs.forEach(function (s) {
      html += '<div class="sub-card"><div><div class="sub-name">' + esc(s.merchant) + "</div>" +
        '<div class="muted">' + esc(s.example) + " · " + s.occurrences + " charges across " + s.months.length + " months</div></div>" +
        '<div class="r"><div><strong>' + BL.money(s.monthly) + "/mo</strong></div>" +
        '<div class="muted">' + BL.money(s.yearly) + '/yr · <span class="cancel">cancel candidate</span></div></div></div>';
    });
    $("subList").innerHTML = html || '<p class="muted">No recurring charges detected.</p>';
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
    loadOverrides();

    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { showTab(t.dataset.tab); });
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
