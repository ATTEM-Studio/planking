import { fileURLToPath } from 'node:url';
import { NaverMapCollector } from './naver-map-collector.mjs';
import { SupabaseRankRepository } from './supabase-repository.mjs';
import { runOne } from './worker.mjs';

function requiredFlag(value, flag) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${flag} is required`);
  return text;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new Error('command is required: once or worker');
  if (command === 'worker') return { command };
  if (command !== 'once') throw new Error(`unknown command: ${command}`);

  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`invalid argument near ${flag ?? '<end>'}`);
    values[flag.slice(2)] = value;
  }
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

async function runWorker() {
  const url = requiredFlag(process.env.SUPABASE_URL, 'SUPABASE_URL');
  const serviceRoleKey = requiredFlag(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  const idleMs = Number.parseInt(process.env.RANK_WORKER_IDLE_MS || '5000', 10);
  const delayMs = Number.parseInt(process.env.RANK_WORKER_DELAY_MS || '1500', 10);
  const repository = new SupabaseRankRepository({ url, serviceRoleKey });
  const collector = new NaverMapCollector();
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
  return args.command === 'once' ? runOnce(args) : runWorker();
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
