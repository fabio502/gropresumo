import { NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import { loadSettings } from '@/src/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export interface TelegramGroupStatus {
  chatId: number;
  ok: boolean;
  title?: string;
  type?: string;
  memberCount?: number;
  botStatus?: string;
  canSendMessages?: boolean;
  error?: string;
}

export async function GET() {
  const cfg = await loadSettings();
  if (!cfg.telegram.token) {
    return NextResponse.json(
      { ok: false, error: 'bot token nao configurado' },
      { status: 400 },
    );
  }
  if (!cfg.telegram.groups.length) {
    return NextResponse.json({ ok: true, bot: null, groups: [] });
  }

  const bot = new Telegraf(cfg.telegram.token);
  const me = await bot.telegram.getMe().catch((err: any) => {
    throw new Error(`token invalido: ${err?.message ?? err}`);
  });

  const results: TelegramGroupStatus[] = await Promise.all(
    cfg.telegram.groups.map(async (chatId): Promise<TelegramGroupStatus> => {
      try {
        const chat: any = await bot.telegram.getChat(chatId);
        const [member, count] = await Promise.all([
          bot.telegram.getChatMember(chatId, me.id).catch(() => null),
          bot.telegram.getChatMembersCount(chatId).catch(() => undefined),
        ]);
        const status = member?.status ?? 'unknown';
        const canSend =
          status === 'administrator' || status === 'creator' || status === 'member';
        return {
          chatId,
          ok: true,
          title: chat?.title ?? chat?.first_name ?? '(sem titulo)',
          type: chat?.type,
          memberCount: count,
          botStatus: status,
          canSendMessages: canSend,
        };
      } catch (err: any) {
        const desc: string = err?.response?.description ?? err?.message ?? String(err);
        return { chatId, ok: false, error: desc };
      }
    }),
  );

  const allOk = results.every((r) => r.ok && r.canSendMessages);

  return NextResponse.json({
    ok: allOk,
    bot: { id: me.id, username: me.username, name: me.first_name },
    groups: results,
  });
}
