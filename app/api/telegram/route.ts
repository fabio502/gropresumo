import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/src/services/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    await handleTelegramUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[telegram webhook]', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
