import { NextRequest, NextResponse } from 'next/server';
import { countMessagesInWindow } from '@/src/db';
import { loadSettings } from '@/src/settings';
import type { Platform } from '@/src/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') as Platform | null;
  const groupId = searchParams.get('groupId');
  const windowHoursRaw = searchParams.get('windowHours');
  if (!platform || !groupId) {
    return NextResponse.json(
      { ok: false, error: 'platform e groupId obrigatorios' },
      { status: 400 },
    );
  }
  try {
    const cfg = await loadSettings();
    const windowHours = Number(windowHoursRaw ?? cfg.scheduler.windowHours);
    const windowEnd = Date.now();
    const windowStart = windowEnd - windowHours * 60 * 60 * 1000;
    const count = await countMessagesInWindow(platform, String(groupId), windowStart, windowEnd);
    return NextResponse.json({ ok: true, count, windowStart, windowEnd, windowHours });
  } catch (err: any) {
    console.error('[messages/count]', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
