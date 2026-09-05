import type { DB } from "./db.js";

export type Role = "user" | "model";

export interface MessageRow {
  id: number;
  channelId: string;
  role: Role;
  content: string;
  createdAt: number;
}

export interface MessageStore {
  append(channelId: string, role: Role, content: string): void;
  recent(channelId: string, limit: number): MessageRow[];
  trim(channelId: string, keep: number): void;
  purgeChannel(channelId: string): void;
}

interface RawRow {
  id: number;
  channel_id: string;
  role: Role;
  content: string;
  created_at: number;
}

export function createMessageStore(
  db: DB,
  now: () => number = Date.now,
): MessageStore {
  const insert = db.prepare(
    "INSERT INTO messages (channel_id, role, content, created_at) VALUES (?, ?, ?, ?)",
  );
  const selectRecent = db.prepare(
    "SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?",
  );
  const deleteTrim = db.prepare(
    `DELETE FROM messages WHERE channel_id = ? AND id NOT IN
       (SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?)`,
  );
  const deleteAll = db.prepare("DELETE FROM messages WHERE channel_id = ?");

  const map = (r: RawRow): MessageRow => ({
    id: r.id,
    channelId: r.channel_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  });

  return {
    append: (channelId, role, content) =>
      void insert.run(channelId, role, content, now()),
    recent: (channelId, limit) =>
      (selectRecent.all(channelId, limit) as RawRow[]).map(map).reverse(),
    trim: (channelId, keep) =>
      void deleteTrim.run(channelId, channelId, keep),
    purgeChannel: (channelId) => void deleteAll.run(channelId),
  };
}
