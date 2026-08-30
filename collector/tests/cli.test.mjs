import test from 'node:test';
import assert from 'node:assert/strict';
import { exitCodeForResult, parseArgs } from '../src/cli.mjs';

test('parseArgs reads once keyword and mid', () => {
  assert.deepEqual(parseArgs(['once', '--keyword', '경성대맛집', '--mid', '1340244014']), {
    command: 'once', keyword: '경성대맛집', mid: '1340244014',
  });
});

test('result exit code distinguishes successful measurement from collection failure', () => {
  assert.equal(exitCodeForResult({ status: 'FOUND' }), 0);
  assert.equal(exitCodeForResult({ status: 'OUT_OF_RANGE' }), 0);
  assert.equal(exitCodeForResult({ status: 'BLOCKED' }), 2);
  assert.equal(exitCodeForResult({ status: 'TIMEOUT' }), 2);
  assert.equal(exitCodeForResult({ status: 'FAILED' }), 2);
});
