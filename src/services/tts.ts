import axios, { AxiosError } from 'axios';
import { getConfig } from '../config';
import { cleanSecret } from '../settings';

const MAX_TTS_CHARS = 5000;

function decodeElevenLabsError(err: AxiosError): string {
  const raw = err.response?.data;
  let payload: any = raw;
  if (raw instanceof ArrayBuffer || Buffer.isBuffer(raw)) {
    try {
      const text = Buffer.from(raw as ArrayBuffer).toString('utf8');
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  const msg =
    payload?.detail?.message ??
    (typeof payload?.detail === 'string' ? payload.detail : undefined) ??
    payload?.message ??
    err.message;
  return msg ?? 'erro desconhecido';
}

/**
 * Gera audio MP3 com a voz configurada e retorna o Buffer (sem salvar em disco).
 */
export async function textToSpeech(text: string): Promise<Buffer> {
  const cfg = await getConfig();
  if (!cfg.elevenlabs.apiKey) throw new Error('ELEVENLABS_API_KEY nao configurado');
  if (!cfg.elevenlabs.voiceId) throw new Error('ELEVENLABS_VOICE_ID nao configurado');

  const clean = text.trim();
  if (!clean) throw new Error('texto vazio para TTS');
  const input = clean.length > MAX_TTS_CHARS ? clean.slice(0, MAX_TTS_CHARS) : clean;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.elevenlabs.voiceId)}`;
  try {
    const resp = await axios.post(
      url,
      {
        text: input,
        model_id: cfg.elevenlabs.model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'xi-api-key': cleanSecret(cfg.elevenlabs.apiKey),
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'arraybuffer',
        timeout: 120_000,
        validateStatus: (s) => s >= 200 && s < 300,
      },
    );
    return Buffer.from(resp.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const msg = decodeElevenLabsError(err);
      if (status === 401) throw new Error(`ElevenLabs: api key invalida (${msg})`);
      if (status === 403) throw new Error(`ElevenLabs: permissao insuficiente — habilite "text_to_speech" na chave (${msg})`);
      if (status === 404) throw new Error(`ElevenLabs: voz ${cfg.elevenlabs.voiceId} nao encontrada (${msg})`);
      if (status === 422) throw new Error(`ElevenLabs: payload invalido — verifique voice_id/model_id (${msg})`);
      if (status === 429) throw new Error(`ElevenLabs: cota excedida ou rate limit (${msg})`);
      throw new Error(`ElevenLabs ${status ?? ''}: ${msg}`.trim());
    }
    throw err;
  }
}
