import { GoogleGenAI } from '@google/genai';
import { getConfig } from '../config';
import type { StoredMessage } from '../types';

async function getClient(): Promise<GoogleGenAI> {
  const cfg = await getConfig();
  if (!cfg.gemini.apiKey) throw new Error('GEMINI_API_KEY nao configurado');
  return new GoogleGenAI({ apiKey: cfg.gemini.apiKey });
}

const SYSTEM_PROMPT = `Voce e um assistente que resume conversas de grupos.
Produza um resumo conciso, em portugues do Brasil, em formato de texto corrido (sem listas, sem markdown), com no maximo 200 palavras.
Foque nos topicos discutidos, decisoes tomadas, perguntas em aberto e mencoes importantes.
O texto sera convertido em audio: escreva em tom natural de fala, frases curtas e claras, sem emojis e sem caracteres especiais.`;

function formatMessages(messages: StoredMessage[]): string {
  return messages
    .map((m) => {
      const date = new Date(m.timestamp);
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      return `[${hh}:${mm}] ${m.senderName}: ${m.content}`;
    })
    .join('\n');
}

export async function summarize(messages: StoredMessage[]): Promise<string> {
  if (!messages.length) return '';
  const cfg = await getConfig();
  const client = await getClient();

  const transcript = formatMessages(messages);
  const userMsg = `Resuma a conversa a seguir do grupo (${messages.length} mensagens):\n\n${transcript}`;

  const resp = await client.models.generateContent({
    model: cfg.gemini.model,
    contents: userMsg,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 1024,
      temperature: 0.7,
    },
  });

  return (resp.text ?? '').trim();
}
