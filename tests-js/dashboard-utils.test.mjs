import test from 'node:test';
import assert from 'node:assert/strict';
import { formatScore, scoreTone, confidenceLabel } from '../web/dashboard-utils.mjs';

test('formatScore handles unavailable regional score', () => {
  assert.equal(formatScore(null), '—');
  assert.equal(formatScore(87), '87');
});

test('scoreTone creates stable comparison bands', () => {
  assert.equal(scoreTone(85), 'strong');
  assert.equal(scoreTone(60), 'mid');
  assert.equal(scoreTone(40), 'weak');
  assert.equal(scoreTone(null), 'neutral');
});

test('confidenceLabel translates provenance confidence', () => {
  assert.equal(confidenceLabel('high'), '높음');
  assert.equal(confidenceLabel('medium'), '보통');
  assert.equal(confidenceLabel('low'), '실험');
});
