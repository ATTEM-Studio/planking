import test from 'node:test'; import assert from 'node:assert/strict'; import { manualJobDecision } from '../lib/manual-job-policy.mjs'; const now=new Date('2026-10-06T09:00:00+09:00');
test('manual collection is denied to client role',()=>assert.deepEqual(manualJobDecision({role:'client',now}),{allowed:false,reason:'staff_only'}));
test('active job is reused instead of creating a duplicate',()=>assert.deepEqual(manualJobDecision({role:'staff',hasActiveJob:true,now}),{allowed:false,reason:'active_job'}));
test('manual collection respects five minute cooldown',()=>assert.deepEqual(manualJobDecision({role:'admin',lastManualAt:new Date(now.getTime()-120000),now}),{allowed:false,reason:'cooldown'}));
test('staff may request collection after cooldown',()=>assert.deepEqual(manualJobDecision({role:'owner',lastManualAt:new Date(now.getTime()-600000),now}),{allowed:true,reason:'ok'}));
