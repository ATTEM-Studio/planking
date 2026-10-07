import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpenInternalAccess } from '../lib/operating-mode.mjs';

test('internal access is open by default so the dashboard does not require login', () => {
  assert.equal(isOpenInternalAccess({}), true);
});

test('internal access can be explicitly disabled when authentication is needed again', () => {
  assert.equal(isOpenInternalAccess({ PLANKING_OPEN_ACCESS: 'false' }), false);
});
