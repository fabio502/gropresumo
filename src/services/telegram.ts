import { Telegraf } from 'telegraf';
import { getConfig } from '../config';
import { saveMessage } from '../db';

/**
 * Cria uma instancia do Telegraf por request (serverless: sem estado entre invocacoes).
 */
async function getBot(): Promise<Telegraf> {
  const cfg = await getConfig();
  if (!cfg.telegram.token) throw new Error('TELEGRAM_BOT_TOKEN nao configurado');
  return new Telegraf(cfg.telegram.token);
}

/**
 * Processa um update bruto do webhook do Telegram e persiste a mensagem.
 */
export async function handleTelegramUpdate(update: any): Promise<void> {
  const cfg = await getConfig();
  const msg = update?.message ?? update?.channel_post;
  if (!msg) return;

  const chat = msg.chat;
  if (!chat) return;
  if (chat.type !== 'group' && chat.type !== 'supergroup') return;
  if (cfg.telegram.groups.length && !cfg.telegram.groups.includes(chat.id)) return;

  const text: string = msg.text ?? msg.caption ?? '';
  if (!text.trim()) return;

  const from = msg.from;
  const senderName = from
    ? [from.first_name, from.last_name].filter(Boolean).join(' ') ||
      from.username ||
      String(from.id)
    : 'desconhecido';

  await saveMessage({
    platform: 'telegram',
    groupId: String(chat.id),
    groupName: chat.title ?? null,
    senderId: String(from?.id ?? 'unknown'),
    senderName,
    content: text,
    timestamp: (msg.date ?? Math.floor(Date.now() / 1000)) * 1000,
  });
}

export async function sendTelegramText(groupId: string, text: string): Promise<void> {
  const bot = await getBot();
  await bot.telegram.sendMessage(groupId, text);
}

export async function sendTelegramAudio(groupId: string, audio: Buffer): Promise<void> {
  const bot = await getBot();
  await bot.telegram.sendVoice(groupId, { source: audio });
}

/**
 * Configura o webhook do Telegram apontando para a URL publica do app.
 */
export async function setTelegramWebhook(url: string): Promise<void> {
  const bot = await getBot();
  await bot.telegram.setWebhook(url);
}

export async function deleteTelegramWebhook(): Promise<void> {
  const bot = await getBot();
  await bot.telegram.deleteWebhook();
}
