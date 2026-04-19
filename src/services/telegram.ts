import { Telegraf } from 'telegraf';
import fs from 'fs';
import { getConfig } from '../config';
import { saveMessage } from '../db';
import { onSettingsChange } from '../settings';

let bot: Telegraf | null = null;
let currentToken = '';

function buildBot(token: string): Telegraf {
  const b = new Telegraf(token);

  b.on('message', (ctx) => {
    const cfg = getConfig();
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
    if (cfg.telegram.groups.length && !cfg.telegram.groups.includes(chat.id)) return;

    const msg: any = ctx.message;
    const text: string = msg?.text ?? msg?.caption ?? '';
    if (!text.trim()) return;

    const from = ctx.from;
    const senderName = from
      ? [from.first_name, from.last_name].filter(Boolean).join(' ') ||
        from.username ||
        String(from.id)
      : 'desconhecido';

    saveMessage({
      platform: 'telegram',
      groupId: String(chat.id),
      groupName: 'title' in chat ? chat.title : null,
      senderId: String(from?.id ?? 'unknown'),
      senderName,
      content: text,
      timestamp: (msg.date ?? Math.floor(Date.now() / 1000)) * 1000,
    });
  });

  return b;
}

export function getBot(): Telegraf {
  const token = getConfig().telegram.token;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN nao configurado');
  if (!bot || token !== currentToken) {
    if (bot) {
      try {
        bot.stop();
      } catch {
        /* noop */
      }
    }
    bot = buildBot(token);
    currentToken = token;
  }
  return bot;
}

export async function sendTelegramText(groupId: string, text: string): Promise<void> {
  await getBot().telegram.sendMessage(groupId, text);
}

export async function sendTelegramAudio(groupId: string, audioPath: string): Promise<void> {
  await getBot().telegram.sendVoice(groupId, { source: fs.createReadStream(audioPath) });
}

export async function startTelegramBot(): Promise<void> {
  const token = getConfig().telegram.token;
  if (!token) {
    console.log('[telegram] desabilitado (token ausente)');
    return;
  }
  const b = getBot();
  b.launch().catch((err) => console.error('[telegram] launch err:', err));
  console.log('[telegram] bot iniciado');
}

export async function restartTelegramBot(): Promise<void> {
  if (bot) {
    try {
      bot.stop();
    } catch {
      /* noop */
    }
    bot = null;
    currentToken = '';
  }
  await startTelegramBot();
}

onSettingsChange((s) => {
  if (s.telegram.token !== currentToken) {
    restartTelegramBot().catch((err) => console.error('[telegram] restart err:', err));
  }
});
