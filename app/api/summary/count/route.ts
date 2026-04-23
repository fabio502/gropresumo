import { NextRequest, NextResponse } from 'next/server';
import { countMessagesInWindow } from '@/src/db';
import type { Platform } from '@/src/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Retorna quantas mensagens existem no banco para (platform, groupId) na janela.
 * Usado pela UI de disparo manual para avisar antes de tentar gerar o resumo.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform') as Platform | null;
  const groupId = url.searchParams.get('groupId');
  const windowHours = Number(url.searchParams.get('windowHours') ?? '24');
  if (!platform || !groupId) {
    return NextResponse.json(
      { ok: false, error: 'platform e groupId obrigatorios' },
      { status: 400 },
    );
  }
  const windowEnd = Date.now();
  const windowStart = windowEnd - windowHours * 60 * 60 * 1000;
  try {
    const count = await countMessagesInWindow(platform, groupId, windowStart, windowEnd);
    return NextResponse.json({ ok: true, count, windowStart, windowEnd });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'erro' },
      { status: 500 },
    );
  }
}
