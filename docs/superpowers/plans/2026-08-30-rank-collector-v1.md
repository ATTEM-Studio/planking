# Rank Collector v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-shaped, queue-driven Naver Place rank collector that records exact organic rank through top 300 and preserves the distinction between `300+` and collection failure.

**Architecture:** Keep the existing Python/Vercel PLANKING analysis runtime unchanged. Add a separate Node 20+ `collector/` subproject using Playwright Chromium for network-response capture, Supabase/Postgres tables for slots/jobs/history, and a small Python enqueue endpoint that writes jobs through Supabase REST without adding Python dependencies.

**Tech Stack:** Existing Python standard-library Vercel runtime, Node.js >=20, Playwright Chromium, Node built-in test runner, Supabase/Postgres REST, SQL migration.

**Spec:** `docs/superpowers/specs/2026-08-30-rank-collector-v1.md`

## Global Constraints

- Search surface is Naver Map in logged-out desktop Chromium.
- Organic rank limit is exactly top 300.
- `OUT_OF_RANGE` stores `rank = null`; never encode it as 301 or 999.
- `BLOCKED`, `TIMEOUT`, and `FAILED` must never be displayed or persisted as `300+`.
- MID matching is exact string equality.
- Collector worker default concurrency is 1.
- No captcha bypass, proxy rotation, session theft, fingerprint evasion, or block circumvention.
- Existing Python runtime remains standard-library only.
- Playwright dependency is isolated under `collector/`.
- Existing N1/N2/N3 formulas and semantics are not changed in this plan.

---

## File Structure

### Create

- `collector/package.json` — Node collector package metadata and test scripts.
- `collector/src/types.mjs` — shared status constants and result validation helpers.
- `collector/src/normalize.mjs` — Naver payload item extraction, ad filtering, MID normalization.
- `collector/src/rank-engine.mjs` — pure cumulative rank calculation across pages.
- `collector/src/naver-map-collector.mjs` — Playwright browser/network transport.
- `collector/src/supabase-repository.mjs` — job claim/update and history UPSERT over Supabase REST.
- `collector/src/worker.mjs` — one-at-a-time queue worker orchestration.
- `collector/src/cli.mjs` — local worker/one-shot entrypoint.
- `collector/tests/normalize.test.mjs` — payload parsing/ad-filter tests.
- `collector/tests/rank-engine.test.mjs` — rank semantics tests.
- `collector/tests/worker.test.mjs` — queue state-machine tests.
- `collector/tests/fixtures/page1.json` — first-page representative fixture.
- `collector/tests/fixtures/graphql-page2.json` — GraphQL representative fixture.
- `collector/tests/fixtures/blocked.html` — block/captcha representative fixture.
- `supabase/migrations/202608300001_rank_tracking.sql` — slots/jobs/history schema and indexes.
- `api/rank_request.py` — standard-library Vercel endpoint to create/find a slot and enqueue a job.
- `tests/test_rank_request_api.py` — endpoint payload and failure tests.
- `docs/RANK_COLLECTOR.md` — local run, environment, status, and operational notes.

### Modify

- `README.md` — link collector docs and clarify analysis-vs-collection boundary.
- `.gitignore` — ignore collector browser/cache artifacts and local env files.
- `.github/workflows/verify.yml` — add Node collector tests and syntax checks while keeping current Python checks.

---

### Task 1: Add rank-tracking schema and shared status contract

**Files:**
- Create: `supabase/migrations/202608300001_rank_tracking.sql`
- Create: `collector/package.json`
- Create: `collector/src/types.mjs`
- Test: `collector/tests/rank-engine.test.mjs`

**Interfaces:**
- Produces: `RANK_STATUSES`, `TERMINAL_STATUSES`, `assertRankResult(result)` from `collector/src/types.mjs`.
- Produces DB tables: `rank_slots`, `rank_jobs`, `rank_history`.

- [ ] **Step 1: Write the failing status-contract test**

Create `collector/tests/rank-engine.test.mjs` with the first test:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRankResult } from '../src/types.mjs';

test('OUT_OF_RANGE requires a null rank', () => {
  assert.doesNotThrow(() => assertRankResult({
    status: 'OUT_OF_RANGE',
    rank: null,
    pagesScanned: 6,
    itemsScanned: 300,
    matchedMid: null,
  }));
  assert.throws(() => assertRankResult({
    status: 'OUT_OF_RANGE',
    rank: 301,
    pagesScanned: 6,
    itemsScanned: 300,
    matchedMid: null,
  }), /rank must be null/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd collector && node --test tests/rank-engine.test.mjs
```

Expected: FAIL because `../src/types.mjs` does not exist.

- [ ] **Step 3: Add the Node package and status validator**

Create `collector/package.json`:

```json
{
  "name": "planking-rank-collector",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "check": "node --check src/*.mjs"
  },
  "dependencies": {
    "playwright": "latest"
  }
}
```

Create `collector/src/types.mjs`:

```js
export const RANK_STATUSES = Object.freeze([
  'FOUND', 'OUT_OF_RANGE', 'BLOCKED', 'TIMEOUT', 'FAILED',
]);

export const TERMINAL_JOB_STATUSES = Object.freeze([
  'SUCCESS', 'OUT_OF_RANGE', 'BLOCKED', 'TIMEOUT', 'FAILED',
]);

export function assertRankResult(result) {
  if (!RANK_STATUSES.includes(result?.status)) {
    throw new TypeError(`invalid rank status: ${result?.status}`);
  }
  if (result.status === 'FOUND') {
    if (!Number.isInteger(result.rank) || result.rank < 1 || result.rank > 300) {
      throw new TypeError('FOUND rank must be an integer from 1 to 300');
    }
  } else if (result.rank !== null) {
    throw new TypeError(`${result.status} rank must be null`);
  }
  if (!Number.isInteger(result.pagesScanned) || result.pagesScanned < 0) {
    throw new TypeError('pagesScanned must be a non-negative integer');
  }
  if (!Number.isInteger(result.itemsScanned) || result.itemsScanned < 0) {
    throw new TypeError('itemsScanned must be a non-negative integer');
  }
  return result;
}
```

- [ ] **Step 4: Add the SQL migration**

Create `supabase/migrations/202608300001_rank_tracking.sql` with UUID defaults using `gen_random_uuid()`, exact status checks, unique `(keyword, target_mid)` on `rank_slots`, unique `(slot_id, measured_date)` on `rank_history`, and indexes on `rank_jobs(status, requested_at)` and `rank_history(slot_id, measured_date desc)`.

The status checks must be:

```sql
status in ('PENDING','RUNNING','SUCCESS','OUT_OF_RANGE','BLOCKED','TIMEOUT','FAILED')
```

and `rank_history.rank` must use:

```sql
check (rank is null or rank between 1 and 300)
```

- [ ] **Step 5: Run the test and syntax check**

Run:

```bash
cd collector
node --test tests/rank-engine.test.mjs
node --check src/types.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add collector/package.json collector/src/types.mjs collector/tests/rank-engine.test.mjs supabase/migrations/202608300001_rank_tracking.sql
git commit -m "feat: add rank tracking schema and status contract"
```

---

### Task 2: Build the pure Naver payload normalizer and rank engine

**Files:**
- Create: `collector/src/normalize.mjs`
- Create: `collector/src/rank-engine.mjs`
- Create: `collector/tests/normalize.test.mjs`
- Modify: `collector/tests/rank-engine.test.mjs`
- Create: `collector/tests/fixtures/page1.json`
- Create: `collector/tests/fixtures/graphql-page2.json`

**Interfaces:**
- Produces: `extractFirstPageItems(payload): object[]`
- Produces: `extractGraphqlItems(payload): object[]`
- Produces: `normalizeOrganicItems(items): {mid:string,name:string,raw:object}[]`
- Produces: `findRankAcrossPages({targetMid,pages,maxRank}): RankResult`

- [ ] **Step 1: Write failing normalizer tests**

`collector/tests/normalize.test.mjs` must verify all of the following:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFirstPageItems, extractGraphqlItems, normalizeOrganicItems } from '../src/normalize.mjs';

const page1 = {
  result: { place: { list: [
    { id: '111', name: '광고업체', isAd: true },
    { id: 1340244014, name: '태봉곱창 부경대 본점' },
  ] } },
};

test('first page list is extracted and ad rows are removed', () => {
  const raw = extractFirstPageItems(page1);
  const organic = normalizeOrganicItems(raw);
  assert.deepEqual(organic.map(row => row.mid), ['1340244014']);
});

test('GraphQL items are found recursively', () => {
  const payload = [{ data: { search: { result: { items: [{ id: '222', name: 'B' }] } } } }];
  assert.equal(extractGraphqlItems(payload)[0].id, '222');
});
```

Ad detection must conservatively exclude rows when one of these explicit indicators is truthy/present: `isAd`, `ad`, `advertisement`, `isAdvertisement`, `promotion`, or a string `type` equal to `ad`/`advertisement` (case-insensitive). Unknown rows remain organic rather than being guessed as ads.

- [ ] **Step 2: Run normalizer tests and verify failure**

```bash
cd collector && node --test tests/normalize.test.mjs
```

Expected: FAIL because `normalize.mjs` is missing.

- [ ] **Step 3: Implement `normalize.mjs` minimally**

Implement recursive `items` search for GraphQL payloads, exact `result.place.list` handling for first page, MID normalization from `id ?? placeId ?? place_id`, and conservative ad filtering defined in Step 1. Rows without a usable MID must be skipped.

- [ ] **Step 4: Write failing cumulative-rank tests**

Append to `collector/tests/rank-engine.test.mjs`:

```js
import { findRankAcrossPages } from '../src/rank-engine.mjs';

test('finds target on page 2 using organic cumulative offset', () => {
  const pages = [
    Array.from({ length: 50 }, (_, i) => ({ mid: String(1000 + i), name: `P${i}` })),
    [
      { mid: 'ad-x', name: '광고', isAd: true },
      { mid: 'target', name: 'Target' },
    ],
  ];
  const result = findRankAcrossPages({ targetMid: 'target', pages, maxRank: 300 });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.rank, 51);
});

test('complete top-300 traversal returns OUT_OF_RANGE with null rank', () => {
  const pages = Array.from({ length: 6 }, (_, page) =>
    Array.from({ length: 50 }, (_, i) => ({ mid: `${page}-${i}`, name: 'x' })),
  );
  const result = findRankAcrossPages({ targetMid: 'missing', pages, maxRank: 300 });
  assert.deepEqual({ status: result.status, rank: result.rank }, { status: 'OUT_OF_RANGE', rank: null });
});
```

- [ ] **Step 5: Run rank-engine tests and verify failure**

```bash
cd collector && node --test tests/rank-engine.test.mjs
```

Expected: FAIL because `rank-engine.mjs` is missing.

- [ ] **Step 6: Implement `rank-engine.mjs`**

The function must normalize each page before counting, stop at `maxRank`, return immediately on exact MID match, and only return `OUT_OF_RANGE` when traversal is marked complete through `maxRank`. For fixture arrays shorter than 300, accept an explicit `complete: true` option in the function input; production transport passes completeness based on reaching the end of available pages without error.

Use this return shape:

```js
{
  status: 'FOUND' | 'OUT_OF_RANGE',
  rank: number | null,
  pagesScanned: number,
  itemsScanned: number,
  matchedMid: string | null,
}
```

and validate with `assertRankResult`.

- [ ] **Step 7: Run both test files**

```bash
cd collector
node --test tests/normalize.test.mjs tests/rank-engine.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add collector/src/normalize.mjs collector/src/rank-engine.mjs collector/tests/normalize.test.mjs collector/tests/rank-engine.test.mjs collector/tests/fixtures
git commit -m "feat: normalize naver results and calculate organic rank"
```

---

### Task 3: Implement the Playwright Naver Map transport

**Files:**
- Create: `collector/src/naver-map-collector.mjs`
- Create: `collector/tests/naver-map-collector.test.mjs`
- Create: `collector/tests/fixtures/blocked.html`

**Interfaces:**
- Consumes: normalizer and rank-engine from Task 2.
- Produces: `NaverMapCollector` implementing `collect({keyword,targetMid,maxRank=300})`.

- [ ] **Step 1: Write failing transport tests with an injected fake page**

The class constructor must accept an injected browser factory:

```js
new NaverMapCollector({ browserFactory, timeoutMs: 15000, pageDelayMs: 600 })
```

Tests must prove:

1. a `/p/api/search/allSearch` response is used for page 1;
2. a `pcmap-api.place.naver.com/graphql` response is used after clicking page 2;
3. a page containing `captcha`, `Too Many Requests`, or HTTP 429 returns `BLOCKED`;
4. a Playwright timeout returns `TIMEOUT`;
5. unrelated network responses are ignored.

Use fake objects only; tests must not make live Naver requests.

- [ ] **Step 2: Run tests and verify failure**

```bash
cd collector && node --test tests/naver-map-collector.test.mjs
```

Expected: FAIL because the collector module is missing.

- [ ] **Step 3: Implement browser lifecycle and response capture**

Implement these exact responsibilities:

```js
export class NaverMapCollector {
  constructor({ browserFactory, timeoutMs = 15000, pageDelayMs = 600 } = {}) { ... }
  async collect({ keyword, targetMid, maxRank = 300 }) { ... }
}
```

Default `browserFactory` must lazily import `chromium` from `playwright` and launch headless Chromium. Use a fresh browser context per collection, desktop viewport `1920x1080`, no login storage state, and close context/browser in `finally`.

Open:

```text
https://map.naver.com/p/search/<encodeURIComponent(keyword)>
```

Capture JSON only from responses whose URL contains either:

```text
/p/api/search/allSearch
pcmap-api.place.naver.com/graphql
```

For pages 2..6, switch into `iframe#searchIframe`, locate the visible pagination link by exact page text, click, and wait for the matching GraphQL response. Stop early if the target MID is found.

- [ ] **Step 4: Implement block/timeout/error classification**

Classification rules:

- HTTP `429` => `BLOCKED`
- body/title containing case-insensitive `captcha` => `BLOCKED`
- body containing `too many requests` => `BLOCKED`
- Playwright timeout class/name or timeout sentinel => `TIMEOUT`
- all other unexpected exceptions => `FAILED`

All non-`FOUND` error results must have `rank: null` and preserve `pagesScanned/itemsScanned` reached before failure.

- [ ] **Step 5: Run collector tests and syntax checks**

```bash
cd collector
node --test tests/naver-map-collector.test.mjs
node --check src/naver-map-collector.mjs
```

Expected: PASS.

- [ ] **Step 6: Optional local smoke test against Naver**

Only when the operator explicitly runs it and accepts network access:

```bash
cd collector
npm install
npx playwright install chromium
node src/cli.mjs once --keyword "경성대맛집" --mid "1340244014"
```

Expected output shape:

```json
{"status":"FOUND","rank":19,"pagesScanned":1,"itemsScanned":19,"matchedMid":"1340244014"}
```

The numeric rank is not hard-coded; any valid 1..300 rank is acceptable. If Naver blocks the session, `BLOCKED` is an acceptable smoke result and must not be retried with bypass logic.

- [ ] **Step 7: Commit**

```bash
git add collector/src/naver-map-collector.mjs collector/tests/naver-map-collector.test.mjs collector/tests/fixtures/blocked.html
git commit -m "feat: collect naver map rank with playwright"
```

---

### Task 4: Add Supabase queue repository and one-at-a-time worker

**Files:**
- Create: `collector/src/supabase-repository.mjs`
- Create: `collector/src/worker.mjs`
- Create: `collector/tests/worker.test.mjs`

**Interfaces:**
- Produces repository methods:
  - `claimNextJob(): Promise<Job|null>`
  - `completeJob(jobId, result): Promise<void>`
  - `failJob(jobId, result): Promise<void>`
  - `upsertHistory(slotId, measuredDate, result): Promise<void>`
- Produces: `runOne({ repository, collector, now }): Promise<'idle'|'processed'>`

- [ ] **Step 1: Write failing worker state-machine tests**

Use an in-memory fake repository and fake collector. Tests must prove:

- no pending job => `idle` and collector not called;
- pending job => claimed RUNNING, collector called exactly once;
- `FOUND` => history UPSERT then job `SUCCESS`;
- `OUT_OF_RANGE` => history UPSERT with `rank:null` then job `OUT_OF_RANGE`;
- `BLOCKED|TIMEOUT|FAILED` => do not overwrite rank history; only terminal job status/error is written.

- [ ] **Step 2: Run worker tests and verify failure**

```bash
cd collector && node --test tests/worker.test.mjs
```

Expected: FAIL because worker/repository modules are missing.

- [ ] **Step 3: Implement `runOne` before the concrete repository**

`runOne` must depend only on the repository interface and collector interface. Convert `FOUND` to job status `SUCCESS`; preserve the other terminal names. Derive `measuredDate` from injected `now` in `Asia/Seoul` using `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit' })`.

- [ ] **Step 4: Run worker tests and make them pass with the fake repository**

```bash
cd collector && node --test tests/worker.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Implement `SupabaseRankRepository` using built-in fetch**

Constructor:

```js
new SupabaseRankRepository({ url, serviceRoleKey, fetchImpl = fetch })
```

Every request must send:

```text
apikey: <serviceRoleKey>
Authorization: Bearer <serviceRoleKey>
Content-Type: application/json
```

Job claim must use a Postgres RPC named `claim_next_rank_job` added to the migration. The RPC must atomically choose the oldest `PENDING` row with `FOR UPDATE SKIP LOCKED`, set it `RUNNING`, increment `attempt_count`, set `started_at`, and return the joined slot fields `keyword` and `target_mid`.

History UPSERT must target:

```text
/rest/v1/rank_history?on_conflict=slot_id,measured_date
```

with header:

```text
Prefer: resolution=merge-duplicates,return=minimal
```

- [ ] **Step 6: Extend migration with `claim_next_rank_job()` RPC**

Add a `security definer` SQL function returning job id, slot id, keyword, target_mid. Restrict executable access to the service role according to the project's Supabase deployment conventions; do not expose service-role credentials to browser code.

- [ ] **Step 7: Run all Node tests**

```bash
cd collector && npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add collector/src/supabase-repository.mjs collector/src/worker.mjs collector/tests/worker.test.mjs supabase/migrations/202608300001_rank_tracking.sql
git commit -m "feat: add queue repository and rank worker"
```

---

### Task 5: Add enqueue API without changing Python dependency policy

**Files:**
- Create: `api/rank_request.py`
- Create: `tests/test_rank_request_api.py`

**Interfaces:**
- HTTP `POST /api/rank_request`
- Input JSON:

```json
{"keyword":"경성대맛집","targetPlaceId":"1340244014","placeName":"태봉곱창 부경대 본점"}
```

- Output JSON:

```json
{"slotId":"<uuid>","jobId":"<uuid>","status":"PENDING"}
```

- [ ] **Step 1: Write failing payload validation tests**

Tests must call a pure `process_payload(payload, client)` function and verify:

- blank keyword => 400-level `ValueError` message `keyword is required`;
- blank targetPlaceId => `targetPlaceId is required`;
- valid payload trims strings and delegates to the injected client;
- returned status is exactly `PENDING`.

- [ ] **Step 2: Run tests and verify failure**

```bash
python -m pytest tests/test_rank_request_api.py -q
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement a standard-library Supabase client**

Use `urllib.request` only. Implement `enqueue_rank_request(keyword, target_mid, place_name)` as:

1. POST/UPSERT `rank_slots` on conflict `keyword,target_mid`, returning slot id;
2. POST a `PENDING` row to `rank_jobs`, returning job id;
3. return the three-field response above.

Read credentials only from server environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Never serialize the service role key into the response.

- [ ] **Step 4: Add `handler(BaseHTTPRequestHandler)` using the existing `api/analyze.py` style**

Match the repository's existing JSON response/error conventions, `Cache-Control: no-store`, 2 MB body limit, and standard-library-only runtime.

- [ ] **Step 5: Run Python tests**

```bash
python -m pytest -q
```

Expected: all existing and new tests PASS.

- [ ] **Step 6: Commit**

```bash
git add api/rank_request.py tests/test_rank_request_api.py
git commit -m "feat: enqueue rank collection requests"
```

---

### Task 6: Add worker CLI, CI verification, and operator documentation

**Files:**
- Create: `collector/src/cli.mjs`
- Create: `docs/RANK_COLLECTOR.md`
- Modify: `.github/workflows/verify.yml`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- CLI one-shot:

```bash
node collector/src/cli.mjs once --keyword "경성대맛집" --mid "1340244014"
```

- CLI worker:

```bash
node collector/src/cli.mjs worker
```

- [ ] **Step 1: Implement CLI argument parsing with no extra dependency**

`once` creates `NaverMapCollector`, prints one JSON `RankResult`, and exits 0 for `FOUND|OUT_OF_RANGE`, exits 2 for `BLOCKED|TIMEOUT|FAILED`.

`worker` requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, repeatedly calls `runOne`, sleeps `RANK_WORKER_IDLE_MS` (default `5000`) on idle and `RANK_WORKER_DELAY_MS` (default `1500`) after a processed job. It must handle SIGINT/SIGTERM by finishing the current job and exiting cleanly.

- [ ] **Step 2: Update CI**

Keep the existing Python and JS dashboard verification steps. Add Node 20 setup, `npm install --prefix collector`, `npm test --prefix collector`, and `npm run check --prefix collector`. Do not install Chromium in ordinary CI because unit tests use fakes and fixtures.

- [ ] **Step 3: Document deployment and operations**

`docs/RANK_COLLECTOR.md` must include:

- architecture diagram;
- migration application command/process;
- required environment variables;
- local Playwright install command;
- one-shot smoke command;
- recommended worker host as a long-running VM/container rather than Vercel Function;
- status meaning table including `300+ = OUT_OF_RANGE only`;
- no-bypass operational rule;
- suggested initial scale: 15 slots -> 100 -> 500 before increasing further.

- [ ] **Step 4: Update README boundary statement**

Replace the old "live collection is next step" wording with links to `docs/RANK_COLLECTOR.md`, while preserving that `/api/analyze` itself does not crawl Naver.

- [ ] **Step 5: Run complete verification**

```bash
python -m pytest -q
node --test tests-js/*.test.mjs
python -m compileall -q api src
node --check web/app.mjs
npm install --prefix collector
npm test --prefix collector
npm run check --prefix collector
```

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add collector/src/cli.mjs docs/RANK_COLLECTOR.md .github/workflows/verify.yml .gitignore README.md
git commit -m "docs: wire rank collector verification and operations"
```

---

## Self-Review

### Spec coverage

- Top-300 organic rank: Tasks 2-3.
- Exact MID matching: Tasks 2-3.
- `300+` vs failure distinction: Tasks 1-4.
- Queue/worker separation: Task 4.
- Same-day UPSERT: Task 4.
- Python runtime dependency boundary: Task 5.
- Playwright isolation: Tasks 1, 3, 6.
- No captcha/block bypass: Tasks 3 and 6.
- Existing analysis formulas untouched: no task modifies `src/adlog_n123/` or `artifacts/calibration.json`.
- Existing test preservation: Task 6 complete verification.

### Deliberate deferrals

These are outside the approved v1 spec and therefore intentionally have no implementation task: place-name-to-MID resolver, place metric collection, search volume/company count collection, N1/N2/N3 recalibration, dashboard auto-refresh, and multi-worker scaling.
