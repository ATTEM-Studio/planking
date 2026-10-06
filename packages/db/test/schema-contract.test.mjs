import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, JOB_STATUSES } from '../src/schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(here, '../../../supabase/migrations/202610060001_planking_rebuild.sql');

function sql() { return fs.readFileSync(sqlPath, 'utf8'); }

test('schema exports all required tables and job statuses', () => {
  assert.deepEqual(TABLES, ['organizations','profiles','organization_members','clients','places','keywords','client_place_access','collection_jobs','rank_snapshots','place_metric_snapshots']);
  assert.ok(JOB_STATUSES.includes('OUT_OF_RANGE'));
  assert.ok(JOB_STATUSES.includes('BLOCKED'));
});

test('migration creates required tables and enables RLS', () => {
  const text = sql();
  for (const table of TABLES) {
    assert.match(text, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(text, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
});

test('migration prevents duplicate active jobs and constrains rank snapshots', () => {
  const text = sql();
  assert.match(text, /unique index[^;]+collection_jobs[^;]+where status in \('PENDING','RUNNING'\)/is);
  assert.match(text, /status in \('FOUND','OUT_OF_RANGE'\)/i);
  assert.match(text, /status = 'FOUND' and rank is not null/i);
});

test('migration defines queue RPCs and client place access policy', () => {
  const text = sql();
  for (const fn of ['enqueue_scheduled_rank_jobs','enqueue_manual_rank_job','claim_next_rank_job','finish_rank_job']) {
    assert.match(text, new RegExp(`create or replace function public\\.${fn}`, 'i'));
  }
  assert.match(text, /client_place_access/i);
  assert.match(text, /organization_members/i);
  assert.match(text, /auth\.uid\(\)/i);
});
