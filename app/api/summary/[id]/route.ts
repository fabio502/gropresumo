import { NextRequest, NextResponse } from 'next/server';
import { deleteSummary, getSummary } from '@/src/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ ok: false, error: 'id invalido' }, { status: 400 });
  }
  try {
    const s = await getSummary(n);
    if (!s) return NextResponse.json({ ok: false, error: 'nao encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true, summary: s });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ ok: false, error: 'id invalido' }, { status: 400 });
  }
  try {
    const deleted = await deleteSummary(n);
    return NextResponse.json({ ok: deleted });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
