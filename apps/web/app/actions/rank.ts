'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '../../lib/access';
import { isOpenInternalAccess } from '../../lib/operating-mode.mjs';

async function findActiveJob(supabase: any, keywordId: string) {
  const { data, error } = await supabase.from('collection_jobs').select('id').eq('keyword_id', keywordId).in('status', ['PENDING', 'RUNNING']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function enqueueOpenManualRankJob(supabase: any, keywordId: string) {
  const activeJobId = await findActiveJob(supabase, keywordId);
  if (activeJobId) return activeJobId;

  const cooldownSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await supabase.from('collection_jobs').select('id').eq('keyword_id', keywordId).eq('trigger', 'manual').gt('created_at', cooldownSince).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (recentError) throw recentError;
  if (recent?.id) return recent.id;

  const { data, error } = await supabase.from('collection_jobs').insert({ keyword_id: keywordId, trigger: 'manual', status: 'PENDING' }).select('id').single();
  if (!error) return data.id;
  if (error.code === '23505') {
    const existingJobId = await findActiveJob(supabase, keywordId);
    if (existingJobId) return existingJobId;
  }
  throw error;
}

export async function requestManualRank(formData: FormData) {
  const keywordId = String(formData.get('keyword_id') ?? '').trim();
  if (!keywordId) throw new Error('keyword_id is required');

  const { supabase } = await requireStaff();
  const data = isOpenInternalAccess()
    ? await enqueueOpenManualRankJob(supabase, keywordId)
    : await supabase.rpc('enqueue_manual_rank_job', { p_keyword_id: keywordId }).then(({ data, error }: any) => {
      if (error) throw error;
      return data;
    });

  revalidatePath('/admin/jobs');
  revalidatePath('/admin/places');
  return data;
}
