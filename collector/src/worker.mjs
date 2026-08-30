import { assertRankResult } from './types.mjs';

function kstDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeJob(job) {
  return {
    id: String(job.id ?? job.job_id ?? ''),
    slotId: String(job.slotId ?? job.slot_id ?? ''),
    keyword: String(job.keyword ?? ''),
    targetMid: String(job.targetMid ?? job.target_mid ?? ''),
  };
}

function failedFromException(error) {
  return {
    status: 'FAILED',
    rank: null,
    pagesScanned: 0,
    itemsScanned: 0,
    matchedMid: null,
    errorCode: error?.code ?? 'WORKER_ERROR',
    errorMessage: String(error?.message ?? error),
  };
}

function hasObservedMetrics(metrics) {
  return metrics && Object.values(metrics).some(value => value !== null && value !== undefined);
}

export async function runOne({ repository, collector, now = new Date() }) {
  const rawJob = await repository.claimNextJob();
  if (!rawJob) return 'idle';
  const job = normalizeJob(rawJob);

  let result;
  try {
    result = assertRankResult(await collector.collect({
      keyword: job.keyword,
      targetMid: job.targetMid,
      maxRank: 300,
    }));
  } catch (error) {
    result = assertRankResult(failedFromException(error));
  }

  const measuredDate = kstDate(now);
  if (result.status === 'FOUND' || result.status === 'OUT_OF_RANGE') {
    await repository.upsertHistory(job.slotId, measuredDate, result);
    if (result.status === 'FOUND' && hasObservedMetrics(result.placeMetrics)) {
      await repository.upsertPlaceMetrics(job.targetMid, measuredDate, result.placeMetrics);
    }
    await repository.completeJob(job.id, {
      ...result,
      status: result.status === 'FOUND' ? 'SUCCESS' : 'OUT_OF_RANGE',
    });
  } else {
    await repository.failJob(job.id, result);
  }
  return 'processed';
}
