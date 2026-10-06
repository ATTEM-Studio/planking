import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaffRole, canAccessPlace } from '../lib/access-policy.mjs';

test('staff roles can manage organization resources', () => {
  assert.equal(isStaffRole('owner'), true);
  assert.equal(isStaffRole('admin'), true);
  assert.equal(isStaffRole('staff'), true);
  assert.equal(isStaffRole('client'), false);
});

test('client can access only explicit place grant', () => {
  assert.equal(canAccessPlace({ role: 'client', userId: 'u1', grantUserId: 'u1', canView: true }), true);
  assert.equal(canAccessPlace({ role: 'client', userId: 'u1', grantUserId: 'u2', canView: true }), false);
  assert.equal(canAccessPlace({ role: 'client', userId: 'u1', grantUserId: 'u1', canView: false }), false);
});

test('staff can access places inside their organization without a client grant', () => {
  assert.equal(canAccessPlace({ role: 'staff', userId: 'u1' }), true);
});
