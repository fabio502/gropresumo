import { NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import { loadSettings } from '@/src/settings';
import { listTelegramChats, upsertTelegramChat } from '@/src/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export interface DiscoveredChat {
  chatId: number;
  title: string | null;
  type: string | null;
  memberCount?: number;
  active: boolean;
  source: 'db' | 'getUpdates' | 'both';
  lastSeen?: number;
}

export interface WebhookDiagnostic {
  url: string;
  pendingCount: number;
  lastErrorAt?: number;
  lastErrorMessage?: string;
  hasError: boolean;
}

export async function GET() {
  const cfg = await loadSettings();
  if (!cfg.telegram.token) {
    return NextResponse.json(
      { ok: false, error: 'bot token nao configurado' },
      { status: 400 },
    );
  }

  const bot = new Telegraf(cfg.telegram.token);
  const active = new Set(cfg.telegram.groups.map(Number));
  const byId = new Map<number, DiscoveredChat>();

  // 1) Chats vistos anteriormente pelo webhook (persistidos no DB)
  const dbChats = await listTelegramChats().catch(() => []);
  for (const c of dbChats) {
    byId.set(c.chatId, {
      chatId: c.chatId,
      title: c.title,
      type: c.type,
      active: active.has(c.chatId),
      source: 'db',
      lastSeen: c.lastSeen,
    });
  }

  // 2) Fallback via getUpdates — funciona apenas quando webhook nao esta registrado.
  //    Util na primeira configuracao, antes do webhook estar ativo.
  let webhookInfoNote: string | null = null;
  let webhook: WebhookDiagnostic | null = null;
  try {
    const info: any = await bot.telegram.getWebhookInfo();
    if (info?.url) {
      webhook = {
        url: info.url,
        pendingCount: info.pending_update_count ?? 0,
        lastErrorAt: info.last_error_date ? info.last_error_date * 1000 : undefined,
        lastErrorMessage: info.last_error_message,
        hasError: Boolean(info.last_error_message),
      };
      webhookInfoNote = `webhook ativo em ${info.url} — getUpdates desativado. Grupos aparecem apos o bot receber mensagens.`;
    } else {
      const updates: any[] = await (bot.telegram as any).getUpdates(100, 100, 0, [
        'message',
        'channel_post',
      ]);
      for (const u of updates) {
        const m = u?.message ?? u?.channel_post;
        const chat = m?.chat;
        if (!chat) continue;
        if (chat.type !== 'group' && chat.type !== 'supergroup') continue;
        const existing = byId.get(chat.id);
        byId.set(chat.id, {
          chatId: chat.id,
          title: chat.title ?? existing?.title ?? null,
          type: chat.type ?? existing?.type ?? null,
          active: active.has(chat.id),
          source: existing ? 'both' : 'getUpdates',
          lastSeen: (m?.date ?? Math.floor(Date.now() / 1000)) * 1000,
        });
        // persiste o chat descoberto para sessoes futuras
        await upsertTelegramChat(chat.id, chat.title ?? null, chat.type).catch(() => {});
      }
    }
  } catch (err: any) {
    webhookInfoNote = `falha em getUpdates: ${err?.message ?? err}`;
  }

  // 3) Enriquece com contagem de membros quando possivel
  const chats = Array.from(byId.values());
  await Promise.all(
    chats.map(async (c) => {
      try {
        c.memberCount = await bot.telegram.getChatMembersCount(c.chatId);
      } catch {
        /* grupo onde o bot nao esta mais, ignora */
      }
    }),
  );

  // Grupos ativos nao-descobertos (cadastrados mas nunca vistos) tambem vao na lista
  for (const chatId of active) {
    if (!byId.has(chatId)) {
      chats.push({
        chatId,
        title: null,
        type: null,
        active: true,
        source: 'db',
      });
    }
  }

  chats.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

  return NextResponse.json({
    ok: true,
    note: webhookInfoNote,
    webhook,
    chats,
  });
}
