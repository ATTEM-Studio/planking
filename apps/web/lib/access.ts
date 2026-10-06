import { notFound, redirect } from 'next/navigation';
import { requireUser } from './auth';
const STAFF_ROLES = ['owner','admin','staff'];
export async function requireStaff() {
  const { supabase, user } = await requireUser();
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
