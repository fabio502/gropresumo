import { NextRequest, NextResponse } from 'next/server';
import { deleteTelegramWebhook, setTelegramWebhook } from '@/src/services/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Helper para registrar/remover o webhook do Telegram.
 * - POST { url } registra o webhook (usa APP_URL+/api/telegram quando url ausente)
 * - DELETE remove o webhook
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const base =
    body.url ??
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!base) {
    return NextResponse.json(
      { ok: false, error: 'forneca url ou defina APP_URL' },
      { status: 400 },
    );
  }
  const target = base.endsWith('/api/telegram') ? base : `${base.replace(/\/$/, '')}/api/telegram`;
  try {
    await setTelegramWebhook(target);
    return NextResponse.json({ ok: true, webhook: target });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await deleteTelegramWebhook();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
