export function readPublicSupabaseConfig(env = process.env) {
  const url = String(env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  const key = String(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!key) throw new Error('A Supabase publishable key is required');
  return { url, key };
}
