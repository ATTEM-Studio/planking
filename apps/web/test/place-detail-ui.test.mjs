import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('place detail keeps dashboard return, selected keyword context, and keyword query links', async () => {
  const source = await readFile(new URL('../app/places/[placeId]/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /대시보드로 돌아가기/);
  assert.match(source, /선택한 키워드/);
  assert.match(source, /\/places\/\$\{placeId\}\?keyword=\$\{row\.id\}/);
});
