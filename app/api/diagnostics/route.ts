import { NextResponse } from 'next/server';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { Telegraf } from 'telegraf';
import { loadSettings } from '@/src/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Check = { name: string; ok: boolean; detail?: string; skipped?: boolean };

async function checkAnthropic(apiKey: string, model: string): Promise<Check> {
  if (!apiKey) return { name: 'anthropic', ok: false, skipped: true, detail: 'sem api key' };
  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    });
    const text = resp.content.find((b: any) => b.type === 'text') as any;
    return { name: 'anthropic', ok: true, detail: `model=${model} id=${resp.id.slice(0, 10)}…` };
  } catch (err: any) {
    return { name: 'anthropic', ok: false, detail: err?.message ?? String(err) };
  }
}

async function checkElevenlabs(apiKey: string, voiceId: string): Promise<Check> {
  if (!apiKey) return { name: 'elevenlabs', ok: false, skipped: true, detail: 'sem api key' };
  try {
    const r = await axios.get('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
      timeout: 15_000,
    });
    const extra = voiceId ? ` voice=${voiceId}` : '';
    return { name: 'elevenlabs', ok: true, detail: `user=${r.data?.xi_api_key?.slice?.(0, 4) ?? 'ok'}${extra}` };
  } catch (err: any) {
    const msg = err?.response?.data?.detail?.message ?? err?.message ?? String(err);
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
      headers: { apikey: apiKey },
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
    const [db, anthropic, elevenlabs, evolution, telegram] = await Promise.all([
      checkDatabase(),
      checkAnthropic(cfg.anthropic.apiKey, cfg.anthropic.model),
      checkElevenlabs(cfg.elevenlabs.apiKey, cfg.elevenlabs.voiceId),
      checkEvolution(cfg.evolution.url, cfg.evolution.apiKey, cfg.evolution.instance),
      checkTelegram(cfg.telegram.token),
    ]);
    const checks: Check[] = [db, anthropic, elevenlabs, evolution, telegram];
    const allOk = checks.every((c) => c.ok || c.skipped);
    return NextResponse.json({ ok: allOk, checks });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
