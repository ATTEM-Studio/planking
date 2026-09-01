import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

import { createChromiumExecutableResolver } from './chromium-runtime.mjs';
import { NaverMapCollector } from '../collector/src/naver-map-collector.mjs';
import { SupabaseRankRepository } from '../collector/src/supabase-repository.mjs';
import { processClaimedJob } from '../collector/src/worker.mjs';

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function readJsonBody(request) {
  if (request?.body && typeof request.body === 'object') return request.body;
  if (typeof request?.body === 'string' && request.body.trim()) return JSON.parse(request.body);
  return {};
}

const resolveChromiumExecutable = createChromiumExecutableResolver({
  getExecutablePath: () => chromium.executablePath(),
});

export async function serverlessBrowserFactory() {
  const executablePath = await resolveChromiumExecutable();
  return playwrightChromium.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
}

function repositoryFromEnv() {
  return new SupabaseRankRepository({
    url: required(process.env.SUPABASE_URL, 'SUPABASE_URL'),
    serviceRoleKey: required(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'),
  });
}

export async function collectRankJob({
  jobId,
  repository,
  browserFactory = serverlessBrowserFactory,
  now = new Date(),
}) {
  const claimed = await repository.claimJobById(required(jobId, 'jobId'));
  if (!claimed) {
    return { status: 'ALREADY_CLAIMED', result: null };
  }

  const collector = new NaverMapCollector({
    browserFactory,
    timeoutMs: 15000,
    pageDelayMs: 450,
    metricEnrichmentTimeoutMs: 9000,
  });
  const result = await processClaimedJob({
    repository,
    collector,
    rawJob: claimed,
    now,
    requeueOnFailure: true,
  });

  if (result.status === 'FOUND' || result.status === 'OUT_OF_RANGE') {
    return { status: 'DONE', result };
  }
  return { status: 'REQUEUED', result };
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const payload = readJsonBody(request);
    const outcome = await collectRankJob({
      jobId: payload.jobId,
      repository: repositoryFromEnv(),
    });

    if (outcome.status === 'DONE') {
      response.status(200).json(outcome);
      return;
    }
    if (outcome.status === 'ALREADY_CLAIMED') {
      response.status(202).json(outcome);
      return;
    }
    response.status(202).json(outcome);
  } catch (error) {
    const isInputError = error instanceof TypeError || error instanceof SyntaxError;
    response.status(isInputError ? 400 : 503).json({
      error: isInputError ? String(error.message || error) : 'immediate rank collection unavailable',
    });
  }
}
