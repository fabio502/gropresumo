import { getMessagesInWindow, saveSummary } from '../db';
import { summarize } from './summarizer';
import { textToSpeech } from './tts';
import { sendWhatsappAudio, sendWhatsappText } from './whatsapp';
import { sendTelegramAudio, sendTelegramText } from './telegram';
import type { Platform } from '../types';

/**
 * Pipeline completo: ler mensagens da janela -> resumir -> TTS -> enviar audio.
 */
export async function runSummaryPipeline(
  platform: Platform,
  groupId: string,
  windowHours: number,
): Promise<{ ok: boolean; messageCount: number; text?: string; audioPath?: string | null; reason?: string }> {
  const windowEnd = Date.now();
  const windowStart = windowEnd - windowHours * 60 * 60 * 1000;
  const messages = getMessagesInWindow(platform, groupId, windowStart, windowEnd);

  console.log(`[pipeline] ${platform}/${groupId}: ${messages.length} mensagens na janela`);
  if (messages.length < 3) {
    return { ok: false, messageCount: messages.length, reason: 'mensagens insuficientes' };
  }

  const text = await summarize(messages);
  if (!text) {
    return { ok: false, messageCount: messages.length, reason: 'resumo vazio' };
  }

  const filename = `${platform}_${groupId.replace(/[^a-zA-Z0-9]/g, '_')}_${windowEnd}.mp3`;
  let audioPath: string | null = null;
  try {
    audioPath = await textToSpeech(text, filename);
  } catch (err) {
    console.error('[pipeline] falha TTS, enviando como texto:', err);
  }

  try {
    if (platform === 'whatsapp') {
      if (audioPath) await sendWhatsappAudio(groupId, audioPath);
      else await sendWhatsappText(groupId, `Resumo do grupo:\n\n${text}`);
    } else {
      if (audioPath) await sendTelegramAudio(groupId, audioPath);
      else await sendTelegramText(groupId, `Resumo do grupo:\n\n${text}`);
    }
  } catch (err) {
    console.error('[pipeline] falha ao enviar mensagem:', err);
    return { ok: false, messageCount: messages.length, text, audioPath, reason: 'falha no envio' };
  }

  saveSummary(platform, groupId, windowStart, windowEnd, text, audioPath);
  return { ok: true, messageCount: messages.length, text, audioPath };
}
