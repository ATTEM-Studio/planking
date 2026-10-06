export const TABLES = Object.freeze([
  'organizations',
  'profiles',
  'organization_members',
  'clients',
  'places',
  'keywords',
  'client_place_access',
  'collection_jobs',
  'rank_snapshots',
  'place_metric_snapshots',
]);

export const MEMBER_ROLES = Object.freeze(['owner', 'admin', 'staff', 'client']);
export const JOB_STATUSES = Object.freeze([
  'PENDING', 'RUNNING', 'SUCCEEDED', 'OUT_OF_RANGE', 'BLOCKED', 'TIMEOUT', 'PARSE_ERROR', 'FAILED',
]);
export const SNAPSHOT_STATUSES = Object.freeze(['FOUND', 'OUT_OF_RANGE']);
export const JOB_TRIGGERS = Object.freeze(['scheduled', 'manual', 'retry']);
