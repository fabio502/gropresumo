import postgres from 'postgres';
import type { Platform, StoredMessage } from './types';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL nao configurado');
}

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

export const sql =
  global.__sql ??
  postgres(process.env.DATABASE_URL!, {
    ssl: 'require',
    max: 5,
    idle_timeout: 20,
    connect_timeout: 30,
  });

if (process.env.NODE_ENV !== 'production') global.__sql = sql;

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
      id           BIGSERIAL PRIMARY KEY,
      platform     TEXT NOT NULL,
      group_id     TEXT NOT NULL,
      window_start BIGINT NOT NULL,
      window_end   BIGINT NOT NULL,
      text         TEXT NOT NULL,
      created_at   BIGINT NOT NULL
    );

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
): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO summaries (platform, group_id, window_start, window_end, text, created_at)
    VALUES (${platform}, ${groupId}, ${windowStart}, ${windowEnd}, ${text}, ${Date.now()})
  `;
}
