import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface AppSettings {
  evolution: {
    url: string;
    apiKey: string;
    instance: string;
    groups: string[];
  };
  telegram: {
    token: string;
    groups: number[];
  };
  anthropic: {
    apiKey: string;
    model: string;
  };
  elevenlabs: {
    apiKey: string;
    voiceId: string;
    model: string;
  };
  scheduler: {
    cron: string;
    timezone: string;
    windowHours: number;
  };
}

const DATA_DIR = process.env.DATA_DIR ?? 'data';
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

function parseList(s?: string): string[] {
  return (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function defaults(): AppSettings {
  return {
    evolution: {
      url: process.env.EVOLUTION_API_URL ?? '',
      apiKey: process.env.EVOLUTION_API_KEY ?? '',
      instance: process.env.EVOLUTION_INSTANCE ?? '',
      groups: parseList(process.env.WHATSAPP_GROUPS),
    },
    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
      groups: parseList(process.env.TELEGRAM_GROUPS)
        .map((n) => Number(n))
        .filter((n) => !Number.isNaN(n)),
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7',
    },
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY ?? '',
      voiceId: process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM',
      model: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
    },
    scheduler: {
      cron: process.env.SUMMARY_CRON ?? '0 20 * * *',
      timezone: process.env.SUMMARY_TIMEZONE ?? 'America/Sao_Paulo',
      windowHours: Number(process.env.SUMMARY_WINDOW_HOURS ?? 24),
    },
  };
}

let cache: AppSettings | null = null;
const listeners: Array<(s: AppSettings) => void> = [];

function deepMerge<T>(base: T, patch: any): T {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return (patch ?? base) as T;
  }
  const out: any = { ...base };
  for (const key of Object.keys(patch ?? {})) {
    const baseVal = (base as any)[key];
    const patchVal = patch[key];
    if (
      baseVal &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      patchVal &&
      typeof patchVal === 'object' &&
      !Array.isArray(patchVal)
    ) {
      out[key] = deepMerge(baseVal, patchVal);
    } else if (patchVal !== undefined) {
      out[key] = patchVal;
    }
  }
  return out as T;
}

export function loadSettings(): AppSettings {
  if (cache) return cache;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const base = defaults();
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      cache = deepMerge(base, raw);
    } catch (err) {
      console.error('[settings] arquivo invalido, usando defaults:', err);
      cache = base;
    }
  } else {
    cache = base;
  }
  return cache;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const merged = deepMerge(current, patch);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
  cache = merged;
  for (const fn of listeners) {
    try {
      fn(merged);
    } catch (err) {
      console.error('[settings] listener error:', err);
    }
  }
  return merged;
}

export function onSettingsChange(fn: (s: AppSettings) => void): void {
  listeners.push(fn);
}

const SECRET_KEYS = new Set(['apiKey', 'token']);

export function maskSecrets(s: AppSettings): AppSettings {
  const clone = JSON.parse(JSON.stringify(s));
  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (SECRET_KEYS.has(k) && typeof obj[k] === 'string' && obj[k]) {
        obj[k] = obj[k].length > 8 ? `${obj[k].slice(0, 4)}…${obj[k].slice(-4)}` : '••••';
      } else if (typeof obj[k] === 'object') walk(obj[k]);
    }
  };
  walk(clone);
  return clone;
}
