# REDESIGN-AUDIT — budgetlens-ai (2026-10-13)

Competitors referenced: **YNAB** (envelope budgeting), **Empower Personal Dashboard** (cash-flow reports, net worth), **EveryDollar** (guided plan).

## Visual gaps vs competitors
- Dashboard is a flat widget stack: stat tiles → widget cards, no hero narrative. Empower opens with a cash-flow hero and big tabular numbers; YNAB opens with the budget plan itself. BudgetLens buries its best insight under the fold.
- Month control is a plain `<select>` dropdown. YNAB/EveryDollar use a prominent ‹ Month › stepper as the primary navigation gesture.
- Category bars are thin, low-contrast tracks with tiny labels — no sense of "Budgeted vs Activity vs Available" the way YNAB's three-column rows communicate a plan at a glance.
- Stat tiles are generic dark boxes; numbers small relative to tile; no savings-rate or cash-flow-trend signal.
- Empty state is blank tiles — competitors show designed empty states ("Load your data to build your plan").

## Functional gaps vs competitors
1. **No envelope plan (YNAB's core mechanic).** "Budgets" is passive monthly caps with no "give every dollar a job" flow: no Ready-to-Assign pool, no per-month assignment, no overspend-cover interaction. This is the single biggest "doesn't work like the real thing" gap.
2. **No income-vs-expense report.** Empower's signature report (income top, expenses bottom, one page) is missing; "Month over month" is a plain table without trend visualization.
3. **No savings-rate / kept trend.** Empower shows net-worth trajectory; BudgetLens shows only a single "Kept" tile.
4. Budgets aren't month-scoped per plan (limits apply to a normalized average, not a real month the user plans in).
5. No auto-assign from prior spending (YNAB "budget last month's spending" convenience).

## What this redesign does (bounded)
- New **Plan** tab: YNAB-style envelope table — Ready-to-Assign banner, ‹ Month › stepper, category groups with Budgeted (editable) / Activity / Available columns, overspend cover-from-pool action, auto-assign from last month's spending, persisted per month (bl_plan).
- New **Reports** tab: Empower-style income-vs-expense monthly chart, savings-rate per month, kept-trend, top-category share.
- Dashboard polish: hero stat band with bigger tabular figures, refined spacing; keep observatory identity (slate + emerald), no rounded edges.
- All existing features preserved: budgets, transactions search, subscriptions, recurring income, duplicates, outliers, trends, nudges, CSV export/print.
