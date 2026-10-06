import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from './supabase/server';
export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');
  return { supabase, user };
}
