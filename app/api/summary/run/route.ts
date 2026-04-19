import { NextRequest, NextResponse } from 'next/server';
import { runSummaryPipeline } from '@/src/services/pipeline';
import { loadSettings } from '@/src/settings';
import type { Platform } from '@/src/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { platform, groupId, windowHours } = body;
  if (!platform || !groupId) {
    return NextResponse.json(
      { ok: false, error: 'platform e groupId obrigatorios' },
      { status: 400 },
    );
  }
  try {
    const cfg = await loadSettings();
    const result = await runSummaryPipeline(
      platform as Platform,
      String(groupId),
      Number(windowHours ?? cfg.scheduler.windowHours),
    );
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[summary/run]', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
