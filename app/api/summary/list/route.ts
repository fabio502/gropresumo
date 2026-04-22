import { NextRequest, NextResponse } from 'next/server';
import { listSummaries } from '@/src/db';
import type { Platform } from '@/src/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') as Platform | null;
  const groupId = searchParams.get('groupId');
  const limit = Number(searchParams.get('limit') ?? 20);

  try {
    const rows = await listSummaries({
      platform: platform ?? undefined,
      groupId: groupId ?? undefined,
      limit,
    });
    return NextResponse.json({ ok: true, summaries: rows });
  } catch (err: any) {
    console.error('[summary/list]', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
