import { NextRequest, NextResponse } from 'next/server';
import { runSummaryPipeline } from '@/src/services/pipeline';
import { summarize } from '@/src/services/summarizer';
import { loadSettings } from '@/src/settings';
import type { Platform, StoredMessage } from '@/src/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Transforma um bloco de texto colado em StoredMessage[] sinteticas — uma por
 * linha nao vazia. Formato aceito: "Nome: mensagem" ou "mensagem" (nome anonimo).
 */
function parsePastedConversation(raw: string): StoredMessage[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const now = Date.now();
  return lines.map((line, i) => {
    const m = line.match(/^([^:]{1,40}):\s*(.+)$/);
    const senderName = m ? m[1].trim() : 'anon';
    const content = m ? m[2].trim() : line;
    return {
      id: i + 1,
      platform: 'telegram' as Platform,
      groupId: 'preview',
      groupName: 'Preview colado',
      senderId: `preview-${i}`,
      senderName,
      content,
      timestamp: now - (lines.length - i) * 60_000,
    };
  });
}

/**
 * Gera o resumo textual sem TTS, sem envio, sem persistir.
 * Util para validar o resumo antes das integracoes externas estarem conectadas.
 *
 * Modos:
 *  - { platform, groupId, windowHours } -> le do banco na janela
 *  - { pastedText } -> usa o texto colado (1 linha por mensagem, opcional "Nome: ...")
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { platform, groupId, windowHours, minMessages, pastedText } = body;

  // Modo texto colado — bypass da captura
  if (typeof pastedText === 'string' && pastedText.trim()) {
    const messages = parsePastedConversation(pastedText);
    if (messages.length === 0) {
      return NextResponse.json({
        ok: false,
        messageCount: 0,
        reason: 'texto colado vazio — cole 1 linha por mensagem',
      });
    }
    try {
      const text = await summarize(messages);
      if (!text) {
        return NextResponse.json({
          ok: false,
          messageCount: messages.length,
          reason: 'resumo vazio (Gemini retornou texto em branco)',
        });
      }
      return NextResponse.json({ ok: true, messageCount: messages.length, text });
    } catch (err: any) {
      console.error('[summary/preview pasted]', err);
      return NextResponse.json(
        { ok: false, error: err?.message ?? 'erro no summarizer' },
        { status: 500 },
      );
    }
  }

  if (!platform || !groupId) {
    return NextResponse.json(
      { ok: false, error: 'platform e groupId obrigatorios (ou envie pastedText)' },
      { status: 400 },
    );
  }
  try {
    const cfg = await loadSettings();
    const result = await runSummaryPipeline(
      platform as Platform,
      String(groupId),
      Number(windowHours ?? cfg.scheduler.windowHours),
      {
        skipAudio: true,
        skipSend: true,
        persist: false,
        purgeAfter: false,
        minMessages: Number(minMessages ?? 1),
      },
    );
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[summary/preview]', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
