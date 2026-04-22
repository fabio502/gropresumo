import { NextRequest, NextResponse } from 'next/server';
import { textToSpeech } from '@/src/services/tts';
import { getSummary } from '@/src/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Gera (ou regenera) o MP3 a partir de um texto arbitrario ou de um resumo
 * salvo. Retorna audio/mpeg para o browser poder tocar direto.
 *
 * Body: { text?: string; summaryId?: number }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let text: string = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text && body.summaryId != null) {
    const s = await getSummary(Number(body.summaryId));
    if (!s) {
      return NextResponse.json({ ok: false, error: 'resumo nao encontrado' }, { status: 404 });
    }
    text = s.text;
  }
  if (!text) {
    return NextResponse.json(
      { ok: false, error: 'forneca text ou summaryId' },
      { status: 400 },
    );
  }
  try {
    const audio = await textToSpeech(text);
    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[summary/tts]', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'erro gerando audio' },
      { status: 500 },
    );
  }
}
