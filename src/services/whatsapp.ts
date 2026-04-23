import axios from 'axios';
import { getConfig } from '../config';
import { saveMessage } from '../db';
import { cleanSecret } from '../settings';
import type { StoredMessage } from '../types';

async function client() {
  const cfg = await getConfig();
  return axios.create({
    baseURL: cfg.evolution.url,
    headers: {
      apikey: cleanSecret(cfg.evolution.apiKey),
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });
}

/**
 * Recebe payload do webhook da Evolution API (event MESSAGES_UPSERT) e persiste mensagens.
 */
export async function handleEvolutionWebhook(payload: any): Promise<void> {
  const cfg = await getConfig();
  const event: string = payload?.event ?? '';
  if (!event.toLowerCase().includes('messages.upsert')) return;

  const data = payload.data;
  const items = Array.isArray(data) ? data : [data];

  for (const item of items) {
    const remoteJid: string = item?.key?.remoteJid ?? '';
    if (!remoteJid.endsWith('@g.us')) continue;
    if (cfg.evolution.groups.length && !cfg.evolution.groups.includes(remoteJid)) continue;
    if (item?.key?.fromMe) continue;

    const text: string =
      item?.message?.conversation ??
      item?.message?.extendedTextMessage?.text ??
      item?.message?.imageMessage?.caption ??
      item?.message?.videoMessage?.caption ??
      '';

    if (!text.trim()) continue;

    const senderId: string = item?.key?.participant ?? remoteJid;
    const senderName: string = item?.pushName ?? senderId.split('@')[0];
    const ts = Number(item?.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000;

    const msg: StoredMessage = {
      platform: 'whatsapp',
      groupId: remoteJid,
      groupName: null,
      senderId,
      senderName,
      content: text,
      timestamp: ts,
    };
    await saveMessage(msg);
  }
}

export async function sendWhatsappText(groupId: string, text: string): Promise<void> {
  const cfg = await getConfig();
  const c = await client();
  await c.post(`/message/sendText/${cfg.evolution.instance}`, {
    number: groupId,
    text,
  });
}

/**
 * Envia audio (Buffer) como mensagem de voz (PTT) no grupo.
 */
export async function sendWhatsappAudio(groupId: string, audio: Buffer): Promise<void> {
  const cfg = await getConfig();
  const c = await client();
  await c.post(`/message/sendWhatsAppAudio/${cfg.evolution.instance}`, {
    number: groupId,
    audio: audio.toString('base64'),
    delay: 1200,
    encoding: true,
  });
}
