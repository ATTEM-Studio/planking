import { redirect } from 'next/navigation';
import { ensureBootstrapOwner, isBootstrapOwner } from './bootstrap-owner.mjs';
import { createSupabaseAdminClient } from './supabase/admin';
import { createSupabaseServerClient } from './supabase/server';

export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');
  const ownerEmailHash = process.env.PLANKING_OWNER_EMAIL_SHA256;
  if (isBootstrapOwner({ ownerEmailHash, userEmail: user.email })) {
    await ensureBootstrapOwner({ admin: createSupabaseAdminClient(), ownerEmailHash, user });
  }
  return { supabase, user };
}
