import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { paths } from './config';
import type { Platform, StoredMessage } from './types';

fs.mkdirSync(path.dirname(paths.databasePath), { recursive: true });

export const db = new DatabaseSync(paths.databasePath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    platform    TEXT NOT NULL,
    group_id    TEXT NOT NULL,
    group_name  TEXT,
    sender_id   TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    content     TEXT NOT NULL,
    timestamp   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_group_time
    ON messages (platform, group_id, timestamp);

  CREATE TABLE IF NOT EXISTS summaries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    platform     TEXT NOT NULL,
    group_id     TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    window_end   INTEGER NOT NULL,
    text         TEXT NOT NULL,
    audio_path   TEXT,
    created_at   INTEGER NOT NULL
  );
`);

const insertStmt = db.prepare(`
  INSERT INTO messages (platform, group_id, group_name, sender_id, sender_name, content, timestamp)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function saveMessage(msg: StoredMessage): void {
  if (!msg.content?.trim()) return;
  insertStmt.run(
    msg.platform,
    msg.groupId,
    msg.groupName ?? null,
    msg.senderId,
    msg.senderName,
    msg.content,
    msg.timestamp,
  );
}

const selectStmt = db.prepare(`
  SELECT id, platform, group_id as groupId, group_name as groupName,
         sender_id as senderId, sender_name as senderName, content, timestamp
  FROM messages
  WHERE platform = ? AND group_id = ? AND timestamp >= ? AND timestamp <= ?
  ORDER BY timestamp ASC
`);

export function getMessagesInWindow(
  platform: Platform,
  groupId: string,
  windowStart: number,
  windowEnd: number,
): StoredMessage[] {
  return selectStmt.all(platform, groupId, windowStart, windowEnd) as unknown as StoredMessage[];
}

const insertSummary = db.prepare(`
  INSERT INTO summaries (platform, group_id, window_start, window_end, text, audio_path, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function saveSummary(
  platform: Platform,
  groupId: string,
  windowStart: number,
  windowEnd: number,
  text: string,
  audioPath: string | null,
): void {
  insertSummary.run(platform, groupId, windowStart, windowEnd, text, audioPath, Date.now());
}
