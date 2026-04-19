import path from 'path';
import dotenv from 'dotenv';
import { loadSettings } from './settings';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR ?? 'data';

/**
 * Caminhos e config nao editavel via UI (porta, paths). Tudo o resto vem das settings.
 */
export const paths = {
  port: Number(process.env.PORT ?? 3000),
  databasePath: process.env.DATABASE_PATH ?? path.join(DATA_DIR, 'grupresumo.db'),
  audioDir: process.env.AUDIO_DIR ?? path.join(DATA_DIR, 'audio'),
};

/**
 * Acessa as settings vivas. Use sempre `getConfig()` em vez de capturar valores no boot,
 * pois a UI permite hot-reload.
 */
export function getConfig() {
  const s = loadSettings();
  return {
    ...paths,
    evolution: s.evolution,
    telegram: s.telegram,
    anthropic: s.anthropic,
    elevenlabs: s.elevenlabs,
    scheduler: s.scheduler,
  };
}
