import { deleteMessagesUpTo, getMessagesInWindow, saveSummary } from '../db';
import { summarize } from './summarizer';
import { textToSpeech } from './tts';
import { sendWhatsappAudio, sendWhatsappText } from './whatsapp';
import { sendTelegramAudio, sendTelegramText } from './telegram';
import type { Platform } from '../types';

export interface PipelineOptions {
  skipAudio?: boolean;
  skipSend?: boolean;
  persist?: boolean;
  purgeAfter?: boolean;
  minMessages?: number;
}

export interface PipelineResult {
  ok: boolean;
  messageCount: number;
  text?: string;
  audioBytes?: number;
  sent?: boolean;
  persisted?: boolean;
  purged?: number;
  windowStart?: number;
  windowEnd?: number;
  reason?: string;
}

/**
 * Pipeline completo: ler mensagens da janela -> resumir -> TTS -> enviar audio.
 * Tudo em memoria (sem disco), pronto para serverless.
 *
 * Options permitem desativar TTS, envio, persistencia e purge — util para
 * testar o resumo antes das APIs externas estarem conectadas.
 */
export async function runSummaryPipeline(
  platform: Platform,
  groupId: string,
  windowHours: number,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const {
    skipAudio = false,
    skipSend = false,
    persist = true,
    purgeAfter = true,
    minMessages = 3,
  } = options;

  const windowEnd = Date.now();
  const windowStart = windowEnd - windowHours * 60 * 60 * 1000;
  const messages = await getMessagesInWindow(platform, groupId, windowStart, windowEnd);

  console.log(`[pipeline] ${platform}/${groupId}: ${messages.length} mensagens na janela`);
  if (messages.length < minMessages) {
    return {
      ok: false,
      messageCount: messages.length,
      windowStart,
      windowEnd,
      reason: `mensagens insuficientes (min ${minMessages})`,
    };
  }

  const text = await summarize(messages);
  if (!text) {
    return {
      ok: false,
      messageCount: messages.length,
      windowStart,
      windowEnd,
      reason: 'resumo vazio',
    };
  }

  let audio: Buffer | null = null;
  if (!skipAudio && !skipSend) {
    try {
      audio = await textToSpeech(text);
    } catch (err) {
      console.error('[pipeline] falha TTS, vai enviar como texto:', err);
    }
  }

  let sent = false;
  if (!skipSend) {
    try {
      if (platform === 'whatsapp') {
        if (audio) await sendWhatsappAudio(groupId, audio);
        else await sendWhatsappText(groupId, `Resumo do grupo:\n\n${text}`);
      } else {
        if (audio) await sendTelegramAudio(groupId, audio);
        else await sendTelegramText(groupId, `Resumo do grupo:\n\n${text}`);
      }
      sent = true;
    } catch (err: any) {
      console.error('[pipeline] falha ao enviar:', err);
      return {
        ok: false,
        messageCount: messages.length,
        text,
        audioBytes: audio?.length,
        windowStart,
        windowEnd,
        reason: `falha no envio: ${err?.message ?? err}`,
      };
    }
  }

  let persisted = false;
  let purged: number | undefined;
  if (persist) {
    const groupName = messages.find((m) => m.groupName)?.groupName ?? null;
    const audioMs = audio ? Math.round((audio.length * 8) / 128) : 0;
    await saveSummary(platform, groupId, windowStart, windowEnd, text, {
      groupName,
      messageCount: messages.length,
      audioMs,
    });
    persisted = true;
    if (purgeAfter) {
      purged = await deleteMessagesUpTo(platform, groupId, windowEnd);
      console.log(`[pipeline] ${platform}/${groupId}: ${purged} mensagens removidas pos-resumo`);
    }
  }

  return {
    ok: true,
    messageCount: messages.length,
    text,
    audioBytes: audio?.length,
    sent,
    persisted,
    purged,
    windowStart,
    windowEnd,
  };
}
