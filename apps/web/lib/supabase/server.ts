import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(values) {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* middleware refreshes sessions */ }
      },
    },
  });
}
