import postgres from 'postgres';
import type { Platform, StoredMessage } from './types';

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

/**
 * Client Postgres com inicializacao preguicosa (lazy). Assim o modulo pode ser
 * importado durante o `next build` (fase "Collecting page data") sem exigir que
 * DATABASE_URL esteja definido — o erro so e lancado quando uma query e feita.
 */
let _client: ReturnType<typeof postgres> | null = null;
function getClient(): ReturnType<typeof postgres> {
  if (global.__sql) return global.__sql;
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL nao configurado');
  const isPooled = url.includes('pooler.supabase.com') || url.includes(':6543');
  _client = postgres(url, {
    ssl: 'require',
    max: 5,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: !isPooled,
  });
  if (process.env.NODE_ENV !== 'production') global.__sql = _client;
  return _client;
}

const sqlTarget: any = (...args: any[]) => (getClient() as any)(...args);
export const sql = new Proxy(sqlTarget, {
  apply: (_, __, args) => (getClient() as any)(...args),
  get: (_, prop: string | symbol) => (getClient() as any)[prop],
}) as ReturnType<typeof postgres>;

let initialized = false;
export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS messages (
      id          BIGSERIAL PRIMARY KEY,
      platform    TEXT NOT NULL,
      group_id    TEXT NOT NULL,
      group_name  TEXT,
      sender_id   TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content     TEXT NOT NULL,
      timestamp   BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_group_time
      ON messages (platform, group_id, timestamp);

    CREATE TABLE IF NOT EXISTS summaries (
      id            BIGSERIAL PRIMARY KEY,
      platform      TEXT NOT NULL,
      group_id      TEXT NOT NULL,
      group_name    TEXT,
      window_start  BIGINT NOT NULL,
      window_end    BIGINT NOT NULL,
      text          TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      audio_ms      INTEGER NOT NULL DEFAULT 0,
      created_at    BIGINT NOT NULL
    );
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS group_name TEXT;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS audio_ms INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_summaries_created
      ON summaries (created_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
  `);
  initialized = true;
}

export async function saveMessage(msg: StoredMessage): Promise<void> {
  if (!msg.content?.trim()) return;
  await ensureSchema();
  await sql`
    INSERT INTO messages (platform, group_id, group_name, sender_id, sender_name, content, timestamp)
    VALUES (${msg.platform}, ${msg.groupId}, ${msg.groupName ?? null}, ${msg.senderId}, ${msg.senderName}, ${msg.content}, ${msg.timestamp})
  `;
}

export async function getMessagesInWindow(
  platform: Platform,
  groupId: string,
  windowStart: number,
  windowEnd: number,
): Promise<StoredMessage[]> {
  await ensureSchema();
  const rows = await sql<StoredMessage[]>`
    SELECT id,
           platform,
           group_id    AS "groupId",
           group_name  AS "groupName",
           sender_id   AS "senderId",
           sender_name AS "senderName",
           content,
           timestamp
    FROM messages
    WHERE platform = ${platform}
      AND group_id = ${groupId}
      AND timestamp BETWEEN ${windowStart} AND ${windowEnd}
    ORDER BY timestamp ASC
  `;
  return rows.map((r) => ({ ...r, timestamp: Number(r.timestamp) }));
}

export async function saveSummary(
  platform: Platform,
  groupId: string,
  windowStart: number,
  windowEnd: number,
  text: string,
  extra: { groupName?: string | null; messageCount?: number; audioMs?: number } = {},
): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO summaries (
      platform, group_id, group_name,
      window_start, window_end, text,
      message_count, audio_ms, created_at
    )
    VALUES (
      ${platform}, ${groupId}, ${extra.groupName ?? null},
      ${windowStart}, ${windowEnd}, ${text},
      ${extra.messageCount ?? 0}, ${extra.audioMs ?? 0}, ${Date.now()}
    )
  `;
}

export async function deleteMessagesUpTo(
  platform: Platform,
  groupId: string,
  upToTimestamp: number,
): Promise<number> {
  await ensureSchema();
  const result = await sql`
    DELETE FROM messages
    WHERE platform = ${platform}
      AND group_id = ${groupId}
      AND timestamp <= ${upToTimestamp}
  `;
  return result.count ?? 0;
}

export async function purgeMessagesOlderThan(timestamp: number): Promise<number> {
  await ensureSchema();
  const result = await sql`DELETE FROM messages WHERE timestamp < ${timestamp}`;
  return result.count ?? 0;
}

export async function countMessagesInWindow(
  platform: Platform,
  groupId: string,
  windowStart: number,
  windowEnd: number,
): Promise<number> {
  await ensureSchema();
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM messages
    WHERE platform = ${platform}
      AND group_id = ${groupId}
      AND timestamp BETWEEN ${windowStart} AND ${windowEnd}
  `;
  return Number(rows[0]?.count ?? 0);
}

export interface StoredSummary {
  id: number;
  platform: Platform;
  groupId: string;
  groupName: string | null;
  windowStart: number;
  windowEnd: number;
  text: string;
  messageCount: number;
  audioMs: number;
  createdAt: number;
}

export async function listSummaries(
  filter: { platform?: Platform; groupId?: string; limit?: number } = {},
): Promise<StoredSummary[]> {
  await ensureSchema();
  const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
  const rows = await sql<any[]>`
    SELECT id,
           platform,
           group_id      AS "groupId",
           group_name    AS "groupName",
           window_start  AS "windowStart",
           window_end    AS "windowEnd",
           text,
           message_count AS "messageCount",
           audio_ms      AS "audioMs",
           created_at    AS "createdAt"
    FROM summaries
    WHERE (${filter.platform ?? null}::text IS NULL OR platform = ${filter.platform ?? null})
      AND (${filter.groupId ?? null}::text IS NULL OR group_id = ${filter.groupId ?? null})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    platform: r.platform,
    groupId: r.groupId,
    groupName: r.groupName ?? null,
    windowStart: Number(r.windowStart),
    windowEnd: Number(r.windowEnd),
    text: r.text,
    messageCount: Number(r.messageCount ?? 0),
    audioMs: Number(r.audioMs ?? 0),
    createdAt: Number(r.createdAt),
  }));
}

export async function deleteSummary(id: number): Promise<boolean> {
  await ensureSchema();
  const result = await sql`DELETE FROM summaries WHERE id = ${id}`;
  return (result.count ?? 0) > 0;
}

export async function getSummary(id: number): Promise<StoredSummary | null> {
  await ensureSchema();
  const rows = await sql<any[]>`
    SELECT id,
           platform,
           group_id      AS "groupId",
           group_name    AS "groupName",
           window_start  AS "windowStart",
           window_end    AS "windowEnd",
           text,
           message_count AS "messageCount",
           audio_ms      AS "audioMs",
           created_at    AS "createdAt"
    FROM summaries
    WHERE id = ${id}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    platform: r.platform,
    groupId: r.groupId,
    groupName: r.groupName ?? null,
    windowStart: Number(r.windowStart),
    windowEnd: Number(r.windowEnd),
    text: r.text,
    messageCount: Number(r.messageCount ?? 0),
    audioMs: Number(r.audioMs ?? 0),
    createdAt: Number(r.createdAt),
  };
}

export async function countSummariesSince(since: number): Promise<number> {
  await ensureSchema();
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM summaries WHERE created_at >= ${since}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function sumAudioMsSince(since: number): Promise<number> {
  await ensureSchema();
  const rows = await sql<{ total: string | null }[]>`
    SELECT COALESCE(SUM(audio_ms),0)::text AS total FROM summaries WHERE created_at >= ${since}
  `;
  return Number(rows[0]?.total ?? 0);
}

export async function countMessagesSince(since: number): Promise<number> {
  await ensureSchema();
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM messages WHERE timestamp >= ${since}
  `;
  return Number(rows[0]?.count ?? 0);
}

export interface DailyBucket {
  day: string;
  messages: number;
  summaries: number;
  audioMs: number;
}

export async function getDailyActivity(days = 7): Promise<DailyBucket[]> {
  await ensureSchema();
  const msPerDay = 24 * 60 * 60 * 1000;
  const anchor = (() => {
    const d = new Date(Date.now() - (days - 1) * msPerDay);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();

  const msgRows = await sql<{ bucket: string; count: string }[]>`
    SELECT to_char(to_timestamp(timestamp / 1000.0), 'YYYY-MM-DD') AS bucket,
           COUNT(*)::text AS count
    FROM messages
    WHERE timestamp >= ${anchor}
    GROUP BY bucket
  `;
  const sumRows = await sql<{ bucket: string; count: string; audio: string | null }[]>`
    SELECT to_char(to_timestamp(created_at / 1000.0), 'YYYY-MM-DD') AS bucket,
           COUNT(*)::text AS count,
           COALESCE(SUM(audio_ms),0)::text AS audio
    FROM summaries
    WHERE created_at >= ${anchor}
    GROUP BY bucket
  `;

  const msgMap = new Map(msgRows.map((r) => [r.bucket, Number(r.count)]));
  const sumMap = new Map(
    sumRows.map((r) => [r.bucket, { c: Number(r.count), a: Number(r.audio ?? 0) }]),
  );

  const out: DailyBucket[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(anchor + i * msPerDay);
    const key = d.toISOString().slice(0, 10);
    const s = sumMap.get(key);
    out.push({
      day: key,
      messages: msgMap.get(key) ?? 0,
      summaries: s?.c ?? 0,
      audioMs: s?.a ?? 0,
    });
  }
  return out;
}

export interface RecentMessage {
  id: number;
  platform: Platform;
  groupId: string;
  groupName: string | null;
  senderName: string;
  content: string;
  timestamp: number;
}

export async function listRecentMessages(limit = 20): Promise<RecentMessage[]> {
  await ensureSchema();
  const n = Math.min(Math.max(limit, 1), 100);
  const rows = await sql<any[]>`
    SELECT id,
           platform,
           group_id   AS "groupId",
           group_name AS "groupName",
           sender_name AS "senderName",
           content,
           timestamp
    FROM messages
    ORDER BY timestamp DESC
    LIMIT ${n}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    platform: r.platform,
    groupId: r.groupId,
    groupName: r.groupName ?? null,
    senderName: r.senderName,
    content: r.content,
    timestamp: Number(r.timestamp),
  }));
}
