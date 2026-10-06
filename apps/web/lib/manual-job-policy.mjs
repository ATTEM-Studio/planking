import { isStaffRole } from './access-policy.mjs';
export function manualJobDecision({ role, hasActiveJob = false, lastManualAt = null, now = new Date(), cooldownMs = 5 * 60 * 1000 }) {
  if (!isStaffRole(role)) return { allowed: false, reason: 'staff_only' };
  if (hasActiveJob) return { allowed: false, reason: 'active_job' };
  if (lastManualAt) { const elapsed = new Date(now).getTime() - new Date(lastManualAt).getTime(); if (elapsed >= 0 && elapsed < cooldownMs) return { allowed: false, reason: 'cooldown' }; }
  return { allowed: true, reason: 'ok' };
}
