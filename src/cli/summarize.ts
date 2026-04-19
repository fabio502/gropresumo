import { getConfig } from '../config';
import { runSummaryPipeline } from '../services/pipeline';
import type { Platform } from '../types';

/**
 * Uso: npm run summarize -- <platform> <groupId> [windowHours]
 */
async function main() {
  const [platform, groupId, hoursStr] = process.argv.slice(2);
  if (!platform || !groupId) {
    console.error('Uso: npm run summarize -- <platform> <groupId> [windowHours]');
    process.exit(1);
  }
  const hours = Number(hoursStr ?? getConfig().scheduler.windowHours);
  const r = await runSummaryPipeline(platform as Platform, groupId, hours);
  console.log(r);
  process.exit(r.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
