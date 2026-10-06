import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicSupabaseConfig } from '../lib/supabase/config.mjs';

test('missing Supabase URL fails clearly', () => {
  assert.throws(() => readPublicSupabaseConfig({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk_test' }), /NEXT_PUBLIC_SUPABASE_URL is required/);
});

test('missing Supabase public key fails clearly', () => {
  assert.throws(() => readPublicSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }), /publishable key is required/);
});

test('current publishable key is preferred with legacy anon key fallback', () => {
  assert.deepEqual(readPublicSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk_current', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy' }), { url: 'https://example.supabase.co', key: 'pk_current' });
  assert.deepEqual(readPublicSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy' }), { url: 'https://example.supabase.co', key: 'legacy' });
});
