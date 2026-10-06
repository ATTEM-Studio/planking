import { collectRank, PlaywrightNaverAdapter } from './engine.mjs';
const [keyword, targetPlaceId, maxRankRaw] = process.argv.slice(2);
if (!keyword || !targetPlaceId) { console.error('Usage: node src/cli.mjs <keyword> <targetPlaceId> [maxRank]'); process.exit(2); }
const result = await collectRank({ keyword, targetPlaceId, maxRank: Number(maxRankRaw ?? 100) }, new PlaywrightNaverAdapter());
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'FAILED' ? 1 : 0);
