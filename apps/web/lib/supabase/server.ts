import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { readPublicSupabaseConfig } from './config.mjs';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, key } = readPublicSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(values: Array<{ name: string; value: string; options?: any }>) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components may be read-only; proxy refreshes sessions.
        }
      },
    },
  });
}
