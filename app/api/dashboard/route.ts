import { NextResponse } from 'next/server';
import {
  countMessagesSince,
  countSummariesSince,
  getDailyActivity,
  listRecentMessages,
  listSummaries,
  sql,
  sumAudioMsSince,
} from '@/src/db';
import { loadSettings } from '@/src/settings';
import type { Platform } from '@/src/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ServiceStatus {
  key: string;
  name: string;
  short: string;
  detail: string;
  state: 'ok' | 'warn' | 'off';
}

function startOfMonthUTC(ref = Date.now()): number {
  const d = new Date(ref);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekUTC(ref = Date.now()): number {
  const d = new Date(ref);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Retorna o proximo tick de um cron muito simples (so suporta o formato
 * `m h * * *`). Suficiente para o cron padrao configurado em vercel.json.
 */
function nextCronTickUTC(expr: string): number | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [minP, hourP, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const min = Number(minP);
  const hour = Number(hourP);
  if (!Number.isFinite(min) || !Number.isFinite(hour)) return null;
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, min, 0, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime();
}

export async function GET() {
  try {
    const cfg = await loadSettings();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const since24h = now - dayMs;
    const since48h = now - 2 * dayMs;
    const monthStart = startOfMonthUTC(now);
    const weekStart = startOfWeekUTC(now);

    const prevWindowCount = async () => {
      const rows = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM messages
        WHERE timestamp >= ${since48h} AND timestamp < ${since24h}
      `;
      return Number(rows[0]?.count ?? 0);
    };

    const [
      messages24h,
      prev24h,
      summariesMonth,
      summariesWeek,
      audioMsMonth,
      activity,
      recentSummaries,
      recentMessages,
    ] = await Promise.all([
      countMessagesSince(since24h),
      prevWindowCount(),
      countSummariesSince(monthStart),
      countSummariesSince(weekStart),
      sumAudioMsSince(monthStart),
      getDailyActivity(7),
      listSummaries({ limit: 10 }),
      listRecentMessages(20),
    ]);

    const delta24hPct =
      prev24h > 0 ? ((messages24h - prev24h) / prev24h) * 100 : messages24h > 0 ? 100 : 0;

    const whatsappGroups = cfg.evolution.groups ?? [];
    const telegramGroups = cfg.telegram.groups ?? [];
    const groupsActive = whatsappGroups.length + telegramGroups.length;

    const services: ServiceStatus[] = [
      {
        key: 'evolution',
        name: 'Evolution API',
        short: 'EV',
        detail: cfg.evolution.url ? cfg.evolution.instance || cfg.evolution.url : 'nao configurado',
        state: cfg.evolution.url && cfg.evolution.apiKey ? 'ok' : 'off',
      },
      {
        key: 'telegram',
        name: 'Telegram Bot',
        short: 'TG',
        detail: cfg.telegram.token ? `${telegramGroups.length} chats` : 'token ausente',
        state: cfg.telegram.token ? 'ok' : 'off',
      },
      {
        key: 'gemini',
        name: 'Google Gemini',
        short: 'AI',
        detail: cfg.gemini.model || 'modelo padrao',
        state: cfg.gemini.apiKey ? 'ok' : 'off',
      },
      {
        key: 'elevenlabs',
        name: 'ElevenLabs TTS',
        short: 'EL',
        detail: cfg.elevenlabs.apiKey ? cfg.elevenlabs.model : 'chave ausente',
        state: cfg.elevenlabs.apiKey ? 'ok' : 'off',
      },
      {
        key: 'postgres',
        name: 'Postgres',
        short: 'PG',
        detail: 'schema pronto',
        state: 'ok',
      },
      {
        key: 'cron',
        name: 'Vercel Cron',
        short: 'CR',
        detail: '0 23 * * * · UTC',
        state: 'ok',
      },
    ];

    const cronNext = nextCronTickUTC('0 23 * * *');
    const nextRuns =
      cronNext !== null
        ? [
            ...whatsappGroups.slice(0, 5).map((g) => ({
              platform: 'whatsapp' as Platform,
              groupId: g,
              groupName: g,
              scheduledAt: cronNext,
              windowHours: cfg.scheduler.windowHours,
              kind: 'cron' as const,
            })),
            ...telegramGroups.slice(0, 5).map((g) => ({
              platform: 'telegram' as Platform,
              groupId: String(g),
              groupName: String(g),
              scheduledAt: cronNext,
              windowHours: cfg.scheduler.windowHours,
              kind: 'cron' as const,
            })),
          ]
        : [];

    return NextResponse.json({
      ok: true,
      ranAt: new Date(now).toISOString(),
      stats: {
        messages24h,
        messages24hDeltaPct: Math.round(delta24hPct),
        groupsActive,
        groupsCapacity: Math.max(groupsActive, 48),
        summariesMonth,
        summariesWeek,
        audioMsMonth,
      },
      activity,
      nextRuns,
      recentSummaries,
      recentMessages,
      services,
      config: {
        scheduleCron: '0 23 * * *',
        scheduleTz: 'UTC',
        windowHours: cfg.scheduler.windowHours,
        nextRunAt: cronNext,
      },
    });
  } catch (err: any) {
    console.error('[dashboard]', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'erro' },
      { status: 500 },
    );
  }
}
