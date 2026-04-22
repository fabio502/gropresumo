import { NextRequest, NextResponse } from 'next/server';
import { saveMessage } from '@/src/db';
import type { Platform, StoredMessage } from '@/src/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Insere mensagens de teste para validar o pipeline de resumo sem depender
 * dos webhooks reais (Evolution/Telegram).
 *
 * Body:
 *  - platform: 'whatsapp' | 'telegram' (default 'whatsapp')
 *  - groupId:  string (obrigatorio)
 *  - messages: Array<{ senderName?, content, minutesAgo? }> (opcional;
 *              se ausente, usa um conjunto de exemplo)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const platform = (body.platform as Platform) ?? 'whatsapp';
  const groupId = String(body.groupId ?? '').trim();
  if (!groupId) {
    return NextResponse.json({ ok: false, error: 'groupId obrigatorio' }, { status: 400 });
  }

  const sample = [
    { senderName: 'Ana',    content: 'pessoal, bom dia! vamos fechar a pauta da reuniao de amanha?' },
    { senderName: 'Bruno',  content: 'bom dia. acho que a prioridade eh rever o roadmap do Q2.' },
    { senderName: 'Carla',  content: 'concordo. preciso tb discutir a vaga que abriu no time de infra.' },
    { senderName: 'Ana',    content: 'otimo. alguem consegue subir um doc no drive ate hoje a tarde?' },
    { senderName: 'Diego',  content: 'eu faco ate as 17h. aproveito e ja incluo as metricas da ultima sprint.' },
    { senderName: 'Bruno',  content: 'perfeito. reuniao fica confirmada 10h entao, meeting com link no de sempre.' },
    { senderName: 'Carla',  content: 'fechou! obrigada galera.' },
  ];
  const input: Array<{ senderName?: string; content: string; minutesAgo?: number }> = Array.isArray(
    body.messages,
  )
    ? body.messages
    : sample.map((m, i) => ({ ...m, minutesAgo: (sample.length - i) * 3 }));

  const now = Date.now();
  let inserted = 0;
  try {
    for (let i = 0; i < input.length; i++) {
      const m = input[i];
      const minutesAgo = Number(m.minutesAgo ?? (input.length - i) * 3);
      const msg: StoredMessage = {
        platform,
        groupId,
        groupName: null,
        senderId: `seed-${i}`,
        senderName: m.senderName ?? `Teste ${i + 1}`,
        content: String(m.content ?? '').trim(),
        timestamp: now - minutesAgo * 60_000,
      };
      if (!msg.content) continue;
      await saveMessage(msg);
      inserted++;
    }
    return NextResponse.json({ ok: true, inserted });
  } catch (err: any) {
    console.error('[messages/seed]', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
