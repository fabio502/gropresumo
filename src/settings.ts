import { ensureSchema, sql } from './db';

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
    windowHours: number;
  };
}

const SETTINGS_KEY = 'app';

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
      windowHours: Number(process.env.SUMMARY_WINDOW_HOURS ?? 24),
    },
  };
}

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

export async function loadSettings(): Promise<AppSettings> {
  await ensureSchema();
  const rows = await sql<{ value: any }[]>`SELECT value FROM settings WHERE key = ${SETTINGS_KEY}`;
  const stored = rows[0]?.value ?? {};
  return deepMerge(defaults(), stored);
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  const merged = deepMerge(current, patch);
  await sql`
    INSERT INTO settings (key, value)
    VALUES (${SETTINGS_KEY}, ${sql.json(merged as any)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
  return merged;
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

export function sanitizePatch(input: any): Partial<AppSettings> {
  if (!input || typeof input !== 'object') return {};
  const out: any = {};
  for (const [k, v] of Object.entries(input)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizePatch(v);
    } else if (SECRET_KEYS.has(k)) {
      const s = String(v ?? '').trim();
      if (s && !s.includes('…') && !s.includes('•')) out[k] = s;
    } else {
      out[k] = v;
    }
  }
  return out;
}
