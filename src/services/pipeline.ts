import { getMessagesInWindow, saveSummary } from '../db';
import { summarize } from './summarizer';
import { textToSpeech } from './tts';
import { sendWhatsappAudio, sendWhatsappText } from './whatsapp';
import { sendTelegramAudio, sendTelegramText } from './telegram';
import type { Platform } from '../types';

export interface PipelineResult {
  ok: boolean;
  messageCount: number;
  text?: string;
  audioBytes?: number;
  reason?: string;
}

/**
 * Pipeline completo: ler mensagens da janela -> resumir -> TTS -> enviar audio.
 * Tudo em memoria (sem disco), pronto para serverless.
 */
export async function runSummaryPipeline(
  platform: Platform,
  groupId: string,
  windowHours: number,
): Promise<PipelineResult> {
  const windowEnd = Date.now();
  const windowStart = windowEnd - windowHours * 60 * 60 * 1000;
  const messages = await getMessagesInWindow(platform, groupId, windowStart, windowEnd);

  console.log(`[pipeline] ${platform}/${groupId}: ${messages.length} mensagens na janela`);
  if (messages.length < 3) {
    return { ok: false, messageCount: messages.length, reason: 'mensagens insuficientes' };
  }

  const text = await summarize(messages);
  if (!text) return { ok: false, messageCount: messages.length, reason: 'resumo vazio' };

  let audio: Buffer | null = null;
  try {
    audio = await textToSpeech(text);
  } catch (err) {
    console.error('[pipeline] falha TTS, vai enviar como texto:', err);
  }

  try {
    if (platform === 'whatsapp') {
      if (audio) await sendWhatsappAudio(groupId, audio);
      else await sendWhatsappText(groupId, `Resumo do grupo:\n\n${text}`);
    } else {
      if (audio) await sendTelegramAudio(groupId, audio);
      else await sendTelegramText(groupId, `Resumo do grupo:\n\n${text}`);
    }
  } catch (err: any) {
    console.error('[pipeline] falha ao enviar:', err);
    return {
      ok: false,
      messageCount: messages.length,
      text,
      audioBytes: audio?.length,
      reason: `falha no envio: ${err?.message ?? err}`,
    };
  }

  await saveSummary(platform, groupId, windowStart, windowEnd, text);
  return { ok: true, messageCount: messages.length, text, audioBytes: audio?.length };
}
