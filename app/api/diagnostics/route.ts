import { NextResponse } from 'next/server';
import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { Telegraf } from 'telegraf';
import { cleanSecret, loadSettings } from '@/src/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Check = { name: string; ok: boolean; detail?: string; skipped?: boolean };

async function checkGemini(apiKey: string, model: string): Promise<Check> {
  if (!apiKey) return { name: 'gemini', ok: false, skipped: true, detail: 'sem api key' };
  try {
    // Valida chave + modelo via metadata — nao consome quota de generateContent
    // (o free tier permite apenas 20 generateContent/dia por modelo).
    const client = new GoogleGenAI({ apiKey: apiKey.trim() });
    const normalized = model.startsWith('models/') ? model : `models/${model}`;
    const info: any = await (client.models as any).get({ model: normalized });
    const display = info?.displayName ?? info?.name ?? model;
    return { name: 'gemini', ok: true, detail: `${display} · chave valida` };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.toLowerCase().includes('not found')) {
      return {
        name: 'gemini',
        ok: false,
        detail: `modelo "${model}" nao disponivel. Tente gemini-2.5-flash, gemini-2.5-flash-lite ou gemini-2.5-pro.`,
      };
    }
    return { name: 'gemini', ok: false, detail: msg };
  }
}

async function checkElevenlabs(apiKey: string, voiceId: string): Promise<Check> {
  if (!apiKey) return { name: 'elevenlabs', ok: false, skipped: true, detail: 'sem api key' };
  const headers = { 'xi-api-key': cleanSecret(apiKey) };
  const extractMsg = (err: any): string =>
    err?.response?.data?.detail?.message ??
    err?.response?.data?.detail ??
    err?.response?.data?.message ??
    err?.message ??
    String(err);

  if (voiceId) {
    try {
      const r = await axios.get(
        `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
        { headers, timeout: 15_000 },
      );
      const name = r.data?.name ?? voiceId;
      const category = r.data?.category ? ` (${r.data.category})` : '';
      return { name: 'elevenlabs', ok: true, detail: `voz "${name}"${category}` };
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = extractMsg(err);
      if (status === 404) {
        return { name: 'elevenlabs', ok: false, detail: `voz ${voiceId} nao encontrada na conta` };
      }
      if (status === 401) {
        return { name: 'elevenlabs', ok: false, detail: 'api key invalida' };
      }
      if (status !== 403) {
        return { name: 'elevenlabs', ok: false, detail: msg };
      }
    }
  }

  try {
    const r = await axios.get('https://api.elevenlabs.io/v1/models', {
      headers,
      timeout: 15_000,
    });
    const models = Array.isArray(r.data) ? r.data : [];
    const extra = voiceId ? ` · voz=${voiceId} nao verificada (falta voices_read)` : '';
    return {
      name: 'elevenlabs',
      ok: true,
      detail: `${models.length} modelo(s) disponivel(is)${extra}`,
    };
  } catch (err: any) {
    const status = err?.response?.status;
    const msg = extractMsg(err);
    if (status === 401) {
      return { name: 'elevenlabs', ok: false, detail: 'api key invalida' };
    }
    if (status === 403 || /permission/i.test(msg)) {
      return {
        name: 'elevenlabs',
        ok: true,
        detail: `chave TTS-only (sem voices_read/models_list) · voz=${voiceId || 'default'} nao verificada`,
      };
    }
    return { name: 'elevenlabs', ok: false, detail: msg };
  }
}

async function checkEvolution(url: string, apiKey: string, instance: string): Promise<Check> {
  if (!url || !apiKey) {
    return { name: 'evolution', ok: false, skipped: true, detail: 'sem url/api key' };
  }
  try {
    const base = url.replace(/\/$/, '');
    const r = await axios.get(`${base}/instance/fetchInstances`, {
      headers: { apikey: cleanSecret(apiKey) },
      timeout: 15_000,
    });
    const list = Array.isArray(r.data) ? r.data : r.data?.instances ?? [];
    const names = list
      .map((i: any) => i?.instance?.instanceName ?? i?.name ?? i?.instanceName)
      .filter(Boolean);
    const found = instance ? names.includes(instance) : true;
    return {
      name: 'evolution',
      ok: found,
      detail: instance
        ? found
          ? `instance "${instance}" ok (${names.length} total)`
          : `instance "${instance}" nao encontrada. Disponiveis: ${names.join(', ') || '(nenhuma)'}`
        : `${names.length} instancia(s): ${names.slice(0, 3).join(', ')}`,
    };
  } catch (err: any) {
    const msg = err?.response?.data?.message ?? err?.message ?? String(err);
    return { name: 'evolution', ok: false, detail: msg };
  }
}

async function checkTelegram(token: string): Promise<Check> {
  if (!token) return { name: 'telegram', ok: false, skipped: true, detail: 'sem bot token' };
  try {
    const bot = new Telegraf(token);
    const me = await bot.telegram.getMe();
    return { name: 'telegram', ok: true, detail: `@${me.username} (id=${me.id})` };
  } catch (err: any) {
    return { name: 'telegram', ok: false, detail: err?.message ?? String(err) };
  }
}

async function checkDatabase(): Promise<Check> {
  try {
    const { sql } = await import('@/src/db');
    await sql`SELECT 1`;
    return { name: 'database', ok: true, detail: 'conectado' };
  } catch (err: any) {
    return { name: 'database', ok: false, detail: err?.message ?? String(err) };
  }
}

export async function GET() {
  try {
    const cfg = await loadSettings();
    const [db, gemini, elevenlabs, evolution, telegram] = await Promise.all([
      checkDatabase(),
      checkGemini(cfg.gemini.apiKey, cfg.gemini.model),
      checkElevenlabs(cfg.elevenlabs.apiKey, cfg.elevenlabs.voiceId),
      checkEvolution(cfg.evolution.url, cfg.evolution.apiKey, cfg.evolution.instance),
      checkTelegram(cfg.telegram.token),
    ]);
    const checks: Check[] = [db, gemini, elevenlabs, evolution, telegram];
    const allOk = checks.every((c) => c.ok || c.skipped);
    return NextResponse.json({ ok: allOk, checks });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
