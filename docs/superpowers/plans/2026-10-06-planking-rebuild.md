# PLANKING Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild PLANKING into a production-ready Naver Place rank tracking service for Grion staff and clients, while preserving a clean path to SaaS expansion.

**Architecture:** Replace the current mixed static/Python/Vercel-Chromium design with an npm-workspaces monorepo: Next.js web app on Vercel, Supabase for auth/data/queue, and a separate Playwright worker for rank collection. Keep only proven collector ideas and fixtures; remove experimental N1/N2/N3 scoring from the product path.

**Tech Stack:** Node.js 22, npm workspaces, Next.js 15 App Router, React 19, TypeScript, Supabase JS, Playwright, Node test runner, SQL migrations.

**Spec:** `docs/superpowers/specs/2026-10-06-planking-rebuild-design.md`

## Global Constraints

- Target matching is by Naver Place ID, not shop-name fuzzy matching.
- Organic rank excludes ads.
- Default scan depth is TOP 100; data model supports up to TOP 300.
- Rank states and collector failures are separate: `FOUND`, `OUT_OF_RANGE`, `BLOCKED`, `TIMEOUT`, `PARSE_ERROR`, `FAILED`.
- Scheduled collection runs twice daily; manual collection is staff/admin only with cooldown and duplicate-job suppression.
- Vercel must not execute Chromium in the rebuilt architecture.
- Client users can only read places explicitly granted through access control.
- Experimental N1/N2/N3 scores are removed from the primary product.
- No revenue/rank guarantees or claims that ranking is globally absolute.

## Review Focus

- Duplicate manual requests for the same keyword must not create parallel jobs.
- `OUT_OF_RANGE` must never be stored or displayed as a collector failure.
- Blocked/captcha responses must never become a numeric rank.
- A client account must be unable to query another client's place through direct URL or API access.
- Missing Supabase configuration must fail clearly instead of silently rendering fabricated demo data.

---

### Task 1: Monorepo foundation and domain contracts

**Files:**
- Replace: root `package.json`, `README.md`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/src/index.mjs`, `packages/core/test/rank-result.test.mjs`
- Create: `apps/web/package.json`, `workers/rank-collector/package.json`

**Interfaces:**
- Produces `normalizeRankResult(input)` and `rankLabel(result)` in `@planking/core`.
- Defines canonical rank statuses used by web, DB helpers, and worker.

- [ ] **Step 1: Write failing core tests** for valid `FOUND`, valid `OUT_OF_RANGE`, and rejection of numeric rank on failure states.
- [ ] **Step 2: Run** `node --test packages/core/test/*.test.mjs` and verify failure.
- [ ] **Step 3: Implement** the core status/result contract and root workspace scripts.
- [ ] **Step 4: Run core tests** and verify pass.
- [ ] **Step 5: Commit** `refactor: establish planking monorepo contracts`.

### Task 2: Supabase schema, RLS, and queue RPCs

**Files:**
- Create: `supabase/migrations/202610060001_planking_rebuild.sql`
- Create: `supabase/seed.sql`
- Create: `packages/db/package.json`, `packages/db/src/schema.mjs`, `packages/db/test/schema-contract.test.mjs`

**Interfaces:**
- Produces table names/constants and SQL schema for `organizations`, `profiles`, `organization_members`, `clients`, `places`, `keywords`, `client_place_access`, `collection_jobs`, `rank_snapshots`, `place_metric_snapshots`.
- Produces RPC contracts: `enqueue_scheduled_rank_jobs`, `enqueue_manual_rank_job`, `claim_next_rank_job`, `finish_rank_job`.

- [ ] **Step 1: Write schema contract tests** asserting required tables, status checks, unique constraints, RLS enablement, and duplicate-job prevention SQL are present.
- [ ] **Step 2: Run** `node --test packages/db/test/*.test.mjs` and verify failure.
- [ ] **Step 3: Implement migration and schema constants.**
- [ ] **Step 4: Run DB contract tests** and verify pass.
- [ ] **Step 5: Commit** `feat: add rank tracking data model and queue`.

### Task 3: Rank collector engine and worker

**Files:**
- Create: `workers/rank-collector/src/engine.mjs`, `src/parser.mjs`, `src/repository.mjs`, `src/worker.mjs`, `src/cli.mjs`
- Create: `workers/rank-collector/test/engine.test.mjs`, `parser.test.mjs`, fixtures under `test/fixtures/`
- Reuse concepts/fixtures from legacy collector only where behavior remains valid.

**Interfaces:**
- Consumes `{ keyword, targetPlaceId, maxRank }`.
- Produces `{ status, rank, itemsScanned, pagesScanned, errorCode?, errorMessage? }`.
- Worker claims jobs from Supabase and persists snapshots only for `FOUND`/`OUT_OF_RANGE`.

- [ ] **Step 1: Write parser/engine tests** for exact Place ID matching, ad exclusion, out-of-range, blocked page, timeout mapping, and parse failure.
- [ ] **Step 2: Run worker tests** and verify failure.
- [ ] **Step 3: Implement minimal parser and collector engine** with Playwright injected behind an adapter for testability.
- [ ] **Step 4: Implement Supabase repository and worker loop.**
- [ ] **Step 5: Run worker tests** and verify pass.
- [ ] **Step 6: Commit** `feat: rebuild naver place rank collector`.

### Task 4: Web authentication and access boundary

**Files:**
- Create: `apps/web/app/layout.tsx`, `app/login/page.tsx`, `app/auth/callback/route.ts`
- Create: `apps/web/lib/supabase/server.ts`, `client.ts`, `auth.ts`, `access.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/test/access.test.mjs`

**Interfaces:**
- Produces `requireUser()`, `requireStaff()`, `requirePlaceAccess(placeId)` server-side guards.
- All dashboard/admin routes use server-side access checks; RLS remains the final DB boundary.

- [ ] **Step 1: Write access policy tests** including cross-client place denial and staff access.
- [ ] **Step 2: Run access tests** and verify failure.
- [ ] **Step 3: Implement Supabase clients, auth callback, middleware, and access helpers.**
- [ ] **Step 4: Run tests** and verify pass.
- [ ] **Step 5: Commit** `feat: add authenticated client access boundary`.

### Task 5: Dashboard, place detail, and rank history UI

**Files:**
- Create: `apps/web/app/page.tsx`, `app/places/[placeId]/page.tsx`
- Create: `apps/web/components/dashboard/*`, `components/rank/*`, `app/globals.css`
- Create: `apps/web/lib/queries/dashboard.ts`, `rank-history.ts`
- Create: `apps/web/test/presentation.test.mjs`

**Interfaces:**
- Dashboard reads only observed data: place count, keyword count, rising/falling counts, collection success rate.
- Place detail displays current rank, previous/7d/30d deltas, TOP 3/10/20 counts, status, and history.

- [ ] **Step 1: Write presentation tests** for `FOUND`, `OUT_OF_RANGE`, no-data, and collector-error copy.
- [ ] **Step 2: Run tests** and verify failure.
- [ ] **Step 3: Implement query mappers and dashboard/place UI.**
- [ ] **Step 4: Add responsive, data-first styling without experimental SEO scores.**
- [ ] **Step 5: Run tests and TypeScript check.**
- [ ] **Step 6: Commit** `feat: replace planking dashboard with rank history product`.

### Task 6: Admin management and manual collection

**Files:**
- Create: `apps/web/app/admin/page.tsx`, `app/admin/clients/page.tsx`, `app/admin/places/page.tsx`, `app/admin/jobs/page.tsx`
- Create: `apps/web/app/actions/admin.ts`, `rank.ts`
- Create: `apps/web/test/manual-job.test.mjs`

**Interfaces:**
- Staff/admin can create clients, places, keywords, access grants, and manual collection requests.
- Manual enqueue uses `enqueue_manual_rank_job`; duplicate pending/running jobs return the existing job instead of inserting another.

- [ ] **Step 1: Write manual enqueue tests** for staff-only access, cooldown, and duplicate suppression.
- [ ] **Step 2: Run tests** and verify failure.
- [ ] **Step 3: Implement server actions and admin pages.**
- [ ] **Step 4: Run tests and TypeScript check.**
- [ ] **Step 5: Commit** `feat: add planking admin operations`.

### Task 7: Scheduling, CI, operations docs, and cutover

**Files:**
- Replace: `.github/workflows/*` with `verify.yml` and `rank-schedule.yml`
- Create: `docs/operations/DEPLOYMENT.md`, `docs/operations/COLLECTOR.md`, `.env.example`
- Update: root `README.md`

**Interfaces:**
- CI runs core/db/web/worker tests and TypeScript checks.
- Schedule invokes the queue enqueue path twice daily without running Chromium on Vercel.

- [ ] **Step 1: Add CI verification workflow** for all workspaces.
- [ ] **Step 2: Add twice-daily scheduling workflow/endpoint contract.**
- [ ] **Step 3: Document Vercel, Supabase, worker environment variables and deployment boundaries.**
- [ ] **Step 4: Run complete verification**: `npm test`, `npm run check`.
- [ ] **Step 5: Inspect repository tree to confirm legacy N1/N2/N3 and Vercel Chromium paths are absent from the new root tree.**
- [ ] **Step 6: Commit** `chore: cut over planking to rebuilt architecture`.
