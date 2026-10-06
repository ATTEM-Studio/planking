export function isStaffRole(role) {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

export function canAccessPlace({ role, userId, grantUserId, canView = false }) {
  if (isStaffRole(role)) return true;
  if (role !== 'client') return false;
  return Boolean(canView && userId && grantUserId && String(userId) === String(grantUserId));
}
