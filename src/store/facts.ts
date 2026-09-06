import type { DB } from "./db.js";
import { MAX_FACTS_PER_SCOPE } from "../constants.js";

export type FactScope = "channel" | "guild";

export interface Fact {
  id: number;
  scope: FactScope;
  scopeId: string;
  content: string;
  createdBy: string;
  createdAt: number;
}

export interface FactStore {
  /** Adds a fact. Returns null (adds nothing) when the scope is already full. */
  add(
    scope: FactScope,
    scopeId: string,
    content: string,
    createdBy: string,
  ): Fact | null;
  list(scope: FactScope, scopeId: string): Fact[];
  /** The notes to fold into a chat reply: the channel's own + the guild's. */
  forChat(
    channelId: string,
    guildId: string | null,
  ): { channel: Fact[]; guild: Fact[] };
  remove(id: number): boolean;
  count(scope: FactScope, scopeId: string): number;
}

interface RawRow {
  id: number;
  scope: FactScope;
  scope_id: string;
  content: string;
  created_by: string;
  created_at: number;
}

const map = (r: RawRow): Fact => ({
  id: r.id,
  scope: r.scope,
  scopeId: r.scope_id,
  content: r.content,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export function createFactStore(
  db: DB,
  now: () => number = Date.now,
): FactStore {
  const insert = db.prepare(
    "INSERT INTO facts (scope, scope_id, content, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const selectScope = db.prepare(
    "SELECT * FROM facts WHERE scope = ? AND scope_id = ? ORDER BY id",
  );
  const selectOne = db.prepare("SELECT * FROM facts WHERE id = ?");
  const deleteOne = db.prepare("DELETE FROM facts WHERE id = ?");
  const countScope = db.prepare(
    "SELECT count(*) AS n FROM facts WHERE scope = ? AND scope_id = ?",
  );

  const count = (scope: FactScope, scopeId: string): number =>
    (countScope.get(scope, scopeId) as { n: number }).n;

  return {
    count,
    list: (scope, scopeId) =>
      (selectScope.all(scope, scopeId) as RawRow[]).map(map),
    add: (scope, scopeId, content, createdBy) => {
      if (count(scope, scopeId) >= MAX_FACTS_PER_SCOPE) return null;
      const info = insert.run(scope, scopeId, content, createdBy, now());
      return map(
        selectOne.get(Number(info.lastInsertRowid)) as RawRow,
      );
    },
    remove: (id) => deleteOne.run(id).changes > 0,
    forChat: (channelId, guildId) => ({
      channel: (selectScope.all("channel", channelId) as RawRow[]).map(map),
      guild: guildId
        ? (selectScope.all("guild", guildId) as RawRow[]).map(map)
        : [],
    }),
  };
}
