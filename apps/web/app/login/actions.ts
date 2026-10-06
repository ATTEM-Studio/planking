'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';
export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) redirect('/login?error=email');
  const supabase = await createSupabaseServerClient();
  const headerStore = await headers();
  const origin = headerStore.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback` } });
  if (error) redirect('/login?error=send');
  redirect('/login?sent=1');
}
