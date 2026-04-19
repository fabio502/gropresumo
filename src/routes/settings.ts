import { Router } from 'express';
import { loadSettings, maskSecrets, saveSettings, type AppSettings } from '../settings';

export const settingsRouter = Router();

/**
 * Retorna settings com chaves mascaradas para exibicao na UI.
 */
settingsRouter.get('/api/settings', (_req, res) => {
  res.json(maskSecrets(loadSettings()));
});

/**
 * Atualiza settings parcialmente. Strings vazias para `apiKey`/`token`
 * sao ignoradas para nao apagar uma chave existente acidentalmente.
 */
settingsRouter.put('/api/settings', (req, res) => {
  const patch = sanitize(req.body);
  try {
    const merged = saveSettings(patch);
    res.json(maskSecrets(merged));
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message ?? 'erro' });
  }
});

const SECRET_KEYS = new Set(['apiKey', 'token']);

function sanitize(input: any): Partial<AppSettings> {
  if (!input || typeof input !== 'object') return {};
  const out: any = {};
  for (const [k, v] of Object.entries(input)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitize(v);
    } else if (SECRET_KEYS.has(k)) {
      const s = String(v ?? '').trim();
      if (s && !s.includes('…') && !s.includes('•')) out[k] = s;
    } else {
      out[k] = v;
    }
  }
  return out;
}
