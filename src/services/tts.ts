import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getConfig, paths } from '../config';

/**
 * Gera audio MP3 com a voz configurada da ElevenLabs e salva em disco.
 * Retorna o caminho do arquivo gerado.
 */
export async function textToSpeech(text: string, filename: string): Promise<string> {
  const cfg = getConfig();
  if (!cfg.elevenlabs.apiKey) throw new Error('ELEVENLABS_API_KEY nao configurado');

  fs.mkdirSync(paths.audioDir, { recursive: true });
  const outPath = path.join(paths.audioDir, filename);

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

  fs.writeFileSync(outPath, Buffer.from(resp.data));
  return outPath;
}
