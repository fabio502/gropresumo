import { Router } from 'express';
import { handleEvolutionWebhook } from '../services/whatsapp';
import { runSummaryPipeline } from '../services/pipeline';
import { getConfig } from '../config';
import type { Platform } from '../types';

export const webhookRouter = Router();

webhookRouter.post('/evolution', (req, res) => {
  try {
    handleEvolutionWebhook(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error('[webhook] erro evolution:', err);
    res.status(500).json({ ok: false });
  }
});

webhookRouter.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/**
 * Disparo manual: POST /summary/run com { platform, groupId, windowHours? }.
 */
webhookRouter.post('/summary/run', async (req, res) => {
  const { platform, groupId, windowHours } = req.body ?? {};
  if (!platform || !groupId) {
    return res.status(400).json({ ok: false, error: 'platform e groupId obrigatorios' });
  }
  try {
    const result = await runSummaryPipeline(
      platform as Platform,
      String(groupId),
      Number(windowHours ?? getConfig().scheduler.windowHours),
    );
    res.json(result);
  } catch (err: any) {
    console.error('[webhook] erro pipeline:', err);
    res.status(500).json({ ok: false, error: err?.message ?? 'erro' });
  }
});
