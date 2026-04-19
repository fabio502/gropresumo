import axios from 'axios';
import fs from 'fs';
import { getConfig } from '../config';
import { saveMessage } from '../db';
import type { StoredMessage } from '../types';

function client() {
  const cfg = getConfig();
  return axios.create({
    baseURL: cfg.evolution.url,
    headers: {
      apikey: cfg.evolution.apiKey,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });
}

/**
 * Recebe o payload do webhook da Evolution API (evento MESSAGES_UPSERT)
 * e persiste mensagens de grupos configurados.
 */
export function handleEvolutionWebhook(payload: any): void {
  const cfg = getConfig();
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
    saveMessage(msg);
  }
}

export async function sendWhatsappText(groupId: string, text: string): Promise<void> {
  const cfg = getConfig();
  await client().post(`/message/sendText/${cfg.evolution.instance}`, {
    number: groupId,
    text,
  });
}

/**
 * Envia audio como mensagem de voz (PTT) no grupo.
 */
export async function sendWhatsappAudio(groupId: string, audioPath: string): Promise<void> {
  const cfg = getConfig();
  const audioBase64 = fs.readFileSync(audioPath).toString('base64');
  await client().post(`/message/sendWhatsAppAudio/${cfg.evolution.instance}`, {
    number: groupId,
    audio: audioBase64,
    delay: 1200,
    encoding: true,
  });
}
