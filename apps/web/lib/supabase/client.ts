import { createBrowserClient } from '@supabase/ssr';
import { readPublicSupabaseConfig } from './config.mjs';

export function createSupabaseBrowserClient() {
  const { url, key } = readPublicSupabaseConfig();
  return createBrowserClient(url, key);
}
