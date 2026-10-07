import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('operations screens retain their actions, input contracts, and stable titles', async () => {
  const [overview, clients, places, jobs] = await Promise.all([
    readFile(new URL('../app/admin/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/admin/clients/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/admin/places/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/admin/jobs/page.tsx', import.meta.url), 'utf8'),
  ]);
  for (const value of ['createClient', 'inviteClientUser', 'grantPlaceAccess', 'name="name"', 'name="email"', 'name="user_id"']) assert.match(clients, new RegExp(value));
  for (const value of ['createPlace', 'createKeyword', 'requestManualRank', 'name="client_id"', 'name="place_id"', 'name="keyword"']) assert.match(places, new RegExp(value));
  assert.match(overview, /<h1>관리<\/h1>/); assert.match(overview, /순위 추적을 시작/); assert.match(overview, /확인이 필요한 작업/);
  assert.match(clients, /클라이언트/); assert.match(places, /업체와 키워드/); assert.match(jobs, /수집 작업/); assert.match(jobs, /수집 완료/);
});
