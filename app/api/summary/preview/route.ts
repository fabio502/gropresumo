import { NextRequest, NextResponse } from 'next/server';
import { runSummaryPipeline } from '@/src/services/pipeline';
import { loadSettings } from '@/src/settings';
import type { Platform } from '@/src/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Gera o resumo textual sem TTS, sem envio, sem persistir.
 * Util para validar o resumo antes das integracoes externas estarem conectadas.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { platform, groupId, windowHours, minMessages } = body;
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
      {
        skipAudio: true,
        skipSend: true,
        persist: false,
        purgeAfter: false,
        minMessages: Number(minMessages ?? 1),
      },
    );
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[summary/preview]', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
