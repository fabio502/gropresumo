import axios from 'axios';
import { getConfig } from '../config';

/**
 * Gera audio MP3 com a voz configurada e retorna o Buffer (sem salvar em disco).
 */
export async function textToSpeech(text: string): Promise<Buffer> {
  const cfg = await getConfig();
  if (!cfg.elevenlabs.apiKey) throw new Error('ELEVENLABS_API_KEY nao configurado');

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${cfg.elevenlabs.voiceId}`;
  const resp = await axios.post(
    url,
    {
      text,
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
        'xi-api-key': cfg.elevenlabs.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout: 120_000,
    },
  );

  return Buffer.from(resp.data);
}
