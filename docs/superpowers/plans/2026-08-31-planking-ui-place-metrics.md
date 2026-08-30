# PLANKING UI + Place Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign PLANKING around the supplied blue logo, improve mobile UX, remove registration examples, and add daily Naver Place metrics with today-based 1/7/30-day changes and multi-series history charts.

**Architecture:** Keep rank history (`rank_history`) keyword×MID scoped and add `place_metrics_history` as MID×KST-date history so the same place is not duplicated per keyword. The collector reuses the matched Naver place raw item when available to extract `visitorReviewCount`, `blogCafeReviewCount`, and the raw `saveCount` string; failures or out-of-range scans never fabricate metrics. Rank APIs perform a second metrics query keyed by target MID and join the result into slot/detail responses. The frontend computes exact-date 1/7/30 comparisons from today and renders raw save-count transitions without numeric fabrication.

**Tech Stack:** Supabase/Postgres, Python BaseHTTPRequestHandler Vercel functions, Node.js 20+, Playwright collector, vanilla ES modules/CSS.

**Spec:** `docs/superpowers/specs/2026-08-31-planking-ui-place-metrics-design.md`

## Global Constraints

- Brand palette switches from green to the supplied PLANKING blue logo with white and neutral gray support colors.
- Remove all `예:` placeholders from the rank registration form.
- Today-based windows are exact KST calendar dates: today-1, today-7, today-30. Missing exact comparison dates display `—`; do not substitute nearest dates.
- `saveCount` values such as `87,000+`, `1,000+`, `~100` are stored and displayed exactly as Naver returns them.
- Never fabricate a numeric save-count delta. For raw bucket changes show `old → new`; unchanged raw buckets show `변동 없음`.
- Place metrics are written only from successfully observed target-place payloads; collection failures do not overwrite previous metrics.
- Existing strict `300+` contract remains unchanged: only a complete 300-item traversal may produce OUT_OF_RANGE.
- Mobile interactions must not depend on hover; respect `prefers-reduced-motion`.

---

### Task 1: Place metrics database contract

**Files:**
- Create: `supabase/migrations/202608310001_place_metrics_history.sql`
- Create/Modify tests: `tests/test_place_metrics_migration.py`

**Interfaces:**
- Produces table `public.place_metrics_history(target_mid, measured_date, visitor_review_count, blog_review_count, save_count_raw, measured_at)` with unique `(target_mid, measured_date)`.
- Service-role only access; anon/authenticated direct access revoked and RLS enabled.

- [ ] Write a failing Python migration test asserting table columns, unique constraint, RLS, and service-role grants.
- [ ] Run `python -m pytest tests/test_place_metrics_migration.py -q` and verify failure because the migration is absent.
- [ ] Add the migration with nullable integer review fields and `save_count_raw text`.
- [ ] Re-run the migration test and all Python tests.
- [ ] Commit `feat: add place metrics history schema`.

### Task 2: Collector metric extraction and persistence

**Files:**
- Modify: `collector/src/normalize.mjs`
- Modify: `collector/src/naver-map-collector.mjs`
- Modify: `collector/src/supabase-repository.mjs`
- Modify: `collector/src/worker.mjs`
- Modify tests: `collector/tests/normalize.test.mjs`, `collector/tests/naver-map-collector.test.mjs`, `collector/tests/supabase-repository.test.mjs`, `collector/tests/worker.test.mjs`

**Interfaces:**
- `extractPlaceMetrics(rawItem)` returns `{ visitorReviewCount: number|null, blogReviewCount: number|null, saveCountRaw: string|null }` preserving raw save text.
- Successful `FOUND` collector result may include `placeMetrics`; other statuses do not fabricate it.
- `SupabaseRankRepository.upsertPlaceMetrics(targetMid, measuredDate, metrics)` upserts MID×date.

- [ ] Add failing tests for integer review parsing, raw save preservation, and missing fields.
- [ ] Verify collector tests fail because extraction/persistence does not exist.
- [ ] Implement extraction and attach metrics when the target MID is found in captured organic items.
- [ ] Add repository upsert with `on_conflict=target_mid,measured_date`.
- [ ] Update worker so a FOUND result with metrics writes both rank history and place metrics; no metrics write occurs for OUT_OF_RANGE/INCOMPLETE/BLOCKED/TIMEOUT/FAILED.
- [ ] Run full collector tests and commit `feat: collect daily place metrics`.

### Task 3: API joins for overview and detail

**Files:**
- Modify: `api/rank_status.py`
- Modify: `api/rank_manage.py`
- Modify/Create tests: `tests/test_rank_status_api.py`, `tests/test_rank_manage_api.py`

**Interfaces:**
- Slot overview adds `placeMetrics`, newest-first, max 31 KST dates.
- Detail response adds complete `placeMetrics` history for the MID.
- No nearest-date substitution is performed server-side.

- [ ] Write failing API tests showing the second Supabase query and grouped metric output.
- [ ] Verify tests fail under current one-query implementation.
- [ ] Implement batched MID metrics fetch in rank status and single-MID fetch in rank manage.
- [ ] Run targeted and full Python tests.
- [ ] Commit `feat: expose place metrics history`.

### Task 4: Frontend metric comparison utilities

**Files:**
- Modify: `web/rank-tracker-utils.mjs`
- Modify: `tests-js/rank-tracker-utils.test.mjs`

**Interfaces:**
- `metricSnapshotForDate(history, date)` performs exact date match.
- `buildMetricWindows(history, today)` returns today/current plus 1/7/30 comparison objects.
- Integer metrics return signed numeric deltas; save raw returns `same`, `changed`, or unavailable without fabricated arithmetic.
- `buildMetricChartPoints(history, field, width, height)` supports review counts; save chart uses ordinal/raw change points if values are bucket strings.

- [ ] Write failing unit tests for exact dates, missing dates, review deltas, raw save transitions, and chart point generation.
- [ ] Run JS tests and verify RED.
- [ ] Implement minimal utility functions.
- [ ] Run all JS tests and commit `feat: add place metric comparison helpers`.

### Task 5: Blue brand redesign, logo asset, mobile UX

**Files:**
- Add binary asset: `assets/planking-logo.png`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `manage.css`
- Modify: `web/app.mjs`

**Interfaces:**
- Header uses `/assets/planking-logo.png` with accessible alt text.
- Registration inputs have no examples/placeholders.
- Each slot card renders a compact 1일/7일/30일 metric switch/summary with rank, visitor reviews, blog reviews, save raw values.
- Mobile uses one-column cards, larger touch targets, bottom-sheet modal behavior, short entry/press animations, and reduced-motion fallback.

- [ ] Add DOM/source-contract tests (or extend existing static tests) that fail until logo path, no-placeholder rule, period UI hooks, and metric containers exist.
- [ ] Verify RED.
- [ ] Add logo asset and rebuild semantic HTML structure.
- [ ] Replace green tokens with PLANKING blue tokens and responsive spacing/type scale.
- [ ] Update rendering logic to show today-based 1/7/30 place metric changes and unavailable states honestly.
- [ ] Add card stagger/fade and press feedback with `prefers-reduced-motion` override.
- [ ] Run static/JS tests and commit `feat: redesign rank tracker dashboard`.

### Task 6: Multi-metric detail modal charts

**Files:**
- Modify: `index.html`
- Modify: `manage.css`
- Modify: `web/app.mjs`
- Modify tests: `tests-js/rank-tracker-utils.test.mjs` and static UI tests

**Interfaces:**
- Existing 7/30/90/all history period tabs remain.
- Detail modal shows separate, clearly labelled charts for rank, visitor review, blog review, and save-count history.
- Save-count chart labels raw values exactly; if raw buckets cannot be meaningfully plotted numerically, render change timeline/step labels rather than inventing counts.

- [ ] Add failing UI-contract tests for four chart containers and labels.
- [ ] Verify RED.
- [ ] Implement metric chart rendering and empty/missing-data states.
- [ ] Make modal responsive as a bottom sheet on small screens with scroll-safe sticky controls.
- [ ] Run JS/static tests and commit `feat: add place metric history charts`.

### Task 7: Database rollout, regression verification, merge and production deploy

**Files:**
- Apply migration to PLANKING Supabase project.
- No additional production code unless verification exposes a defect.

**Interfaces:**
- Existing worker secrets remain `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Existing Vercel production domain remains `https://planking-choi18.vercel.app`.

- [ ] Run full GitHub CI on feature branch: Python tests, JS tests, collector tests, syntax checks.
- [ ] Apply the new migration to Supabase and verify table/RLS/grants using SQL inspection.
- [ ] Run one worker smoke with a known FOUND slot and verify rank history plus place metrics write when Naver payload exposes those fields.
- [ ] Review for regressions: strict 300+ behavior, failures never overwrite success, raw save strings preserved.
- [ ] Merge PR to `main` after all checks pass.
- [ ] Deploy latest main bundle to Vercel production and verify `/api/health`, `/api/rank_status`, root page, and responsive markup.
- [ ] Record completion status in project docs if any metric source limitation remains.
