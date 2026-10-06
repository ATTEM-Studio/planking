import { createClient } from '@supabase/supabase-js';
export function createSupabaseAdminClient() { const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(); const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(); if(!url||!key)throw new Error('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required'); return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}}); }
