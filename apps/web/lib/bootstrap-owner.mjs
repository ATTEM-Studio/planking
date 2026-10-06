import { createHash } from 'node:crypto';

export function isBootstrapOwner({ ownerEmailHash, userEmail }) {
  const normalizedEmail = userEmail?.trim().toLowerCase();
  if (!ownerEmailHash || !normalizedEmail) return false;
  const actualHash = createHash('sha256').update(normalizedEmail).digest('hex');
  return actualHash === ownerEmailHash.trim().toLowerCase();
}

export async function ensureBootstrapOwner({ admin, ownerEmailHash, user, organizationSlug = 'grion' }) {
  if (!isBootstrapOwner({ ownerEmailHash, userEmail: user?.email })) return false;
  const { data: organization, error: organizationError } = await admin.from('organizations').select('id').eq('slug', organizationSlug).maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization?.id) throw new Error(`Bootstrap organization "${organizationSlug}" was not found`);
  const displayName = user.user_metadata?.full_name || user.email.split('@')[0];
  const { error: profileError } = await admin.from('profiles').upsert({ id: user.id, display_name: displayName });
  if (profileError) throw profileError;
  const { error: membershipError } = await admin.from('organization_members').upsert({ organization_id: organization.id, user_id: user.id, role: 'owner' }, { onConflict: 'organization_id,user_id' });
  if (membershipError) throw membershipError;
  return true;
}
