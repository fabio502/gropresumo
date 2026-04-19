import { NextRequest, NextResponse } from 'next/server';
import { loadSettings, maskSecrets, saveSettings, sanitizePatch } from '@/src/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await loadSettings();
  return NextResponse.json(maskSecrets(s));
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const patch = sanitizePatch(body);
  try {
    const merged = await saveSettings(patch);
    return NextResponse.json(maskSecrets(merged));
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 400 });
  }
}
