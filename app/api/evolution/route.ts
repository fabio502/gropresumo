import { NextRequest, NextResponse } from 'next/server';
import { handleEvolutionWebhook } from '@/src/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await handleEvolutionWebhook(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[evolution webhook]', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
