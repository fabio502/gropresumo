import { loadSettings, type AppSettings } from './settings';

/**
 * Acessa as settings vivas do banco. Sempre awaitar antes de usar.
 */
export async function getConfig(): Promise<AppSettings> {
  return loadSettings();
}
