import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const ts = Date.now();
  try {
    const { sql } = await import('@/src/db');
    await sql`SELECT 1`;
    return NextResponse.json({ ok: true, db: true, ts });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, db: false, ts, error: err?.message ?? 'erro' },
      { status: 200 },
    );
  }
}
