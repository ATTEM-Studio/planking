import { notFound, redirect } from 'next/navigation';
import { requireUser } from './auth';
import { createSupabaseAdminClient } from './supabase/admin';
import { isOpenInternalAccess } from './operating-mode.mjs';

const STAFF_ROLES = ['owner','admin','staff'];

export async function requireStaff() {
  if (isOpenInternalAccess()) {
    const supabase = createSupabaseAdminClient();
    const { data: organization, error } = await supabase.from('organizations').select('id').eq('slug', 'grion').maybeSingle();
    if (error) throw error;
    if (!organization) throw new Error('Default organization "grion" was not found');
    return { supabase, user: null, membership: { organization_id: organization.id, role: 'owner' } };
  }

  const { supabase, user } = await requireUser();
  if (!user) throw new Error('Authenticated user is required when open access is disabled');
  const { data, error } = await supabase.from('organization_members').select('organization_id, role').eq('user_id', user.id).in('role', STAFF_ROLES).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) redirect('/');
  return { supabase, user, membership: data };
}

export async function requirePlaceAccess(placeId: string) {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.from('places').select('id, name, naver_place_id, client_id, address, category, place_url').eq('id', placeId).maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  return { supabase, user, place: data };
}
