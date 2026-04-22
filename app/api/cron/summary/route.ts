import { NextRequest, NextResponse } from 'next/server';
import { runSummaryPipeline } from '@/src/services/pipeline';
import { loadSettings } from '@/src/settings';
import { purgeMessagesOlderThan } from '@/src/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Disparado pelo Vercel Cron (vercel.json). Vercel envia automaticamente
 * o header `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const cfg = await loadSettings();
  const results: any[] = [];

  for (const groupId of cfg.evolution.groups) {
    try {
      const r = await runSummaryPipeline('whatsapp', groupId, cfg.scheduler.windowHours);
      results.push({ platform: 'whatsapp', groupId, ...r });
    } catch (err: any) {
      results.push({ platform: 'whatsapp', groupId, ok: false, error: String(err?.message ?? err) });
    }
  }

  for (const groupId of cfg.telegram.groups) {
    try {
      const r = await runSummaryPipeline('telegram', String(groupId), cfg.scheduler.windowHours);
      results.push({ platform: 'telegram', groupId, ...r });
    } catch (err: any) {
      results.push({ platform: 'telegram', groupId, ok: false, error: String(err?.message ?? err) });
    }
  }

  const safetyMs = cfg.scheduler.windowHours * 2 * 60 * 60 * 1000;
  const purged = await purgeMessagesOlderThan(Date.now() - safetyMs);

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), purged, results });
}
