import { assertRankResult } from './types.mjs';

export function measurementDateKst(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('valid date is required');
  // 14:00 KST is 05:00 UTC. Shift five hours back so the UTC calendar date
  // changes exactly when the PLANKING measurement day changes.
  return new Date(date.getTime() - (5 * 60 * 60 * 1000)).toISOString().slice(0, 10);
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

export async function processClaimedJob({ repository, collector, rawJob, now = new Date() }) {
  const job = normalizeJob(rawJob);
  if (!job.id || !job.slotId || !job.keyword || !job.targetMid) {
    throw new TypeError('claimed rank job is incomplete');
  }

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

  const measuredDate = measurementDateKst(now);
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
  return result;
}

export async function runOne({ repository, collector, now = new Date() }) {
  const rawJob = await repository.claimNextJob();
  if (!rawJob) return 'idle';
  await processClaimedJob({ repository, collector, rawJob, now });
  return 'processed';
}
