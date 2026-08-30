import { fileURLToPath } from 'node:url';
import { NaverMapCollector } from './naver-map-collector.mjs';
import { SupabaseRankRepository } from './supabase-repository.mjs';
import { runOne } from './worker.mjs';

function requiredFlag(value, flag) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${flag} is required`);
  return text;
}

function parseFlagPairs(rest) {
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`invalid argument near ${flag ?? '<end>'}`);
    values[flag.slice(2)] = value;
  }
  return values;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new Error('command is required: once, drain, or worker');
  if (command === 'worker') return { command };

  const values = parseFlagPairs(rest);
  if (command === 'drain') {
    const maxJobs = Number.parseInt(values.max || '10', 10);
    if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 50) {
      throw new Error('--max must be an integer between 1 and 50');
    }
    return { command, maxJobs };
  }
  if (command !== 'once') throw new Error(`unknown command: ${command}`);
  return {
    command,
    keyword: requiredFlag(values.keyword, '--keyword'),
    mid: requiredFlag(values.mid, '--mid'),
  };
}

export function exitCodeForResult(result) {
  return ['FOUND', 'OUT_OF_RANGE'].includes(result?.status) ? 0 : 2;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOnce(args) {
  const collector = new NaverMapCollector();
  const result = await collector.collect({ keyword: args.keyword, targetMid: args.mid, maxRank: 300 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return exitCodeForResult(result);
}

function repositoryFromEnv() {
  const url = requiredFlag(process.env.SUPABASE_URL, 'SUPABASE_URL');
  const serviceRoleKey = requiredFlag(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  return new SupabaseRankRepository({ url, serviceRoleKey });
}

export async function drainQueue({
  repository,
  collector,
  maxJobs = 10,
  delayMs = 1500,
  runOneImpl = runOne,
  sleepImpl = sleep,
}) {
  let processed = 0;
  while (processed < maxJobs) {
    const state = await runOneImpl({ repository, collector, now: new Date() });
    if (state === 'idle') break;
    processed += 1;
    if (processed < maxJobs && delayMs > 0) await sleepImpl(delayMs);
  }
  return processed;
}

async function runDrain(args) {
  const repository = repositoryFromEnv();
  const collector = new NaverMapCollector();
  const delayMs = Number.parseInt(process.env.RANK_WORKER_DELAY_MS || '1500', 10);
  const processed = await drainQueue({ repository, collector, maxJobs: args.maxJobs, delayMs });
  process.stdout.write(`${JSON.stringify({ status: 'DRAINED', processed })}\n`);
  return 0;
}

async function runWorker() {
  const repository = repositoryFromEnv();
  const collector = new NaverMapCollector();
  const idleMs = Number.parseInt(process.env.RANK_WORKER_IDLE_MS || '5000', 10);
  const delayMs = Number.parseInt(process.env.RANK_WORKER_DELAY_MS || '1500', 10);
  let stopping = false;

  const requestStop = () => { stopping = true; };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

  while (!stopping) {
    const state = await runOne({ repository, collector, now: new Date() });
    if (stopping) break;
    await sleep(state === 'idle' ? idleMs : delayMs);
  }
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'once') return runOnce(args);
  if (args.command === 'drain') return runDrain(args);
  return runWorker();
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().then(
    code => { process.exitCode = code; },
    error => {
      process.stderr.write(`${error?.message ?? error}\n`);
      process.exitCode = 1;
    },
  );
}
