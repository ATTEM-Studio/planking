import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('navigation defines dashboard and operations once from a shared item list', async () => {
  const source = await readFile(new URL('../components/layout/AppNavigation.tsx', import.meta.url), 'utf8');
  const items = source.match(/const navigationItems = \[(.*?)\];/s)?.[1] ?? '';

  assert.equal((items.match(/label: '대시보드'/g) ?? []).length, 1);
  assert.equal((items.match(/label: '관리'/g) ?? []).length, 1);
  assert.equal((items.match(/href: '\/'/g) ?? []).length, 1);
  assert.equal((items.match(/href: '\/admin'/g) ?? []).length, 1);
});
