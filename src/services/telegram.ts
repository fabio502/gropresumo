import { Telegraf } from 'telegraf';
import { getConfig } from '../config';
import { saveMessage, upsertTelegramChat } from '../db';

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
 * Loga verbosamente todos os motivos de rejeicao para facilitar diagnostico.
 */
export async function handleTelegramUpdate(update: any): Promise<void> {
  const updateId = update?.update_id;
  const msg = update?.message ?? update?.channel_post ?? update?.edited_message ?? update?.edited_channel_post;
  if (!msg) {
    console.log(`[telegram] update ${updateId} sem message/channel_post — keys:`, Object.keys(update ?? {}));
    return;
  }

  const chat = msg.chat;
  if (!chat) {
    console.log(`[telegram] update ${updateId} sem chat`);
    return;
  }
  if (chat.type !== 'group' && chat.type !== 'supergroup') {
    console.log(`[telegram] update ${updateId} ignorado — chat.type=${chat.type} (so grupos)`);
    return;
  }

  // Registra o chat como "visto" para facilitar descoberta de grupos na UI,
  // mesmo que ainda nao esteja cadastrado em settings.telegram.groups.
  await upsertTelegramChat(chat.id, chat.title ?? null, chat.type).catch((err) => {
    console.error('[telegram] upsertTelegramChat falhou:', err?.message ?? err);
  });

  const cfg = await getConfig();
  if (cfg.telegram.groups.length && !cfg.telegram.groups.includes(chat.id)) {
    console.log(
      `[telegram] chat ${chat.id} (${chat.title}) visto mas NAO cadastrado em settings.telegram.groups — ignorando mensagem`,
    );
    return;
  }

  const text: string = msg.text ?? msg.caption ?? '';
  if (!text.trim()) {
    console.log(`[telegram] chat ${chat.id} msg sem texto (tipo?: ${Object.keys(msg).join(',')})`);
    return;
  }

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
  console.log(
    `[telegram] ✓ msg salva · chat=${chat.id} (${chat.title}) sender=${senderName} text="${text.slice(0, 60)}"`,
  );
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
  // allowed_updates explicito garante que recebemos mensagens de texto de grupos
  // (se omitido, o Telegram aplica o padrao que inclui message, mas seja explicito).
  await bot.telegram.setWebhook(url, {
    allowed_updates: [
      'message',
      'edited_message',
      'channel_post',
      'edited_channel_post',
      'my_chat_member',
    ],
    drop_pending_updates: false,
  });
}

export async function deleteTelegramWebhook(): Promise<void> {
  const bot = await getBot();
  await bot.telegram.deleteWebhook();
}
