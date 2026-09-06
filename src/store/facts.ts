import type { DB } from "./db.js";
import { MAX_AUTO_FACTS, MAX_FACTS_PER_SCOPE } from "../constants.js";

export type FactScope = "channel" | "guild";
export type FactSource = "user" | "auto";

export interface Fact {
  id: number;
  scope: FactScope;
  scopeId: string;
  content: string;
  source: FactSource;
  createdBy: string;
  createdAt: number;
}

export interface FactStore {
  /** Adds a fact. Returns null (adds nothing) when the scope's user quota is full. */
  add(
    scope: FactScope,
    scopeId: string,
    content: string,
    createdBy: string,
    source?: FactSource,
  ): Fact | null;
  list(scope: FactScope, scopeId: string): Fact[];
  /** The notes to fold into a chat reply: the channel's own + the guild's. */
  forChat(
    channelId: string,
    guildId: string | null,
  ): { channel: Fact[]; guild: Fact[] };
  remove(id: number): boolean;
  count(scope: FactScope, scopeId: string, source?: FactSource): number;
  /** Replace this scope's auto notes with `contents` (capped at MAX_AUTO_FACTS). */
  replaceAuto(scope: FactScope, scopeId: string, contents: string[]): void;
}

interface RawRow {
  id: number;
  scope: FactScope;
  scope_id: string;
  content: string;
  source: FactSource;
  created_by: string;
  created_at: number;
}

const map = (r: RawRow): Fact => ({
  id: r.id,
  scope: r.scope,
  scopeId: r.scope_id,
  content: r.content,
  source: r.source,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export function createFactStore(
  db: DB,
  now: () => number = Date.now,
): FactStore {
  const insert = db.prepare(
    "INSERT INTO facts (scope, scope_id, content, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const selectScope = db.prepare(
    "SELECT * FROM facts WHERE scope = ? AND scope_id = ? ORDER BY id",
  );
  const selectOne = db.prepare("SELECT * FROM facts WHERE id = ?");
  const deleteOne = db.prepare("DELETE FROM facts WHERE id = ?");
  const countAll = db.prepare(
    "SELECT count(*) AS n FROM facts WHERE scope = ? AND scope_id = ?",
  );
  const countBySource = db.prepare(
    "SELECT count(*) AS n FROM facts WHERE scope = ? AND scope_id = ? AND source = ?",
  );
  const deleteAutoScope = db.prepare(
    "DELETE FROM facts WHERE scope = ? AND scope_id = ? AND source = 'auto'",
  );

  const count = (
    scope: FactScope,
    scopeId: string,
    source?: FactSource,
  ): number =>
    (
      (source === undefined
        ? countAll.get(scope, scopeId)
        : countBySource.get(scope, scopeId, source)) as { n: number }
    ).n;

  const replaceAuto = db.transaction(
    (scope: FactScope, scopeId: string, contents: string[]) => {
      deleteAutoScope.run(scope, scopeId);
      const t = now();
      for (const c of contents.slice(0, MAX_AUTO_FACTS)) {
        insert.run(scope, scopeId, c, "auto", "amigo", t);
      }
    },
  );

  return {
    count,
    list: (scope, scopeId) =>
      (selectScope.all(scope, scopeId) as RawRow[]).map(map),
    add: (scope, scopeId, content, createdBy, source = "user") => {
      if (
        source === "user" &&
        count(scope, scopeId, "user") >= MAX_FACTS_PER_SCOPE
      )
        return null;
      const info = insert.run(
        scope,
        scopeId,
        content,
        source,
        createdBy,
        now(),
      );
      return map(selectOne.get(Number(info.lastInsertRowid)) as RawRow);
    },
    remove: (id) => deleteOne.run(id).changes > 0,
    forChat: (channelId, guildId) => ({
      channel: (selectScope.all("channel", channelId) as RawRow[]).map(map),
      guild: guildId
        ? (selectScope.all("guild", guildId) as RawRow[]).map(map)
        : [],
    }),
    replaceAuto: (scope, scopeId, contents) =>
      void replaceAuto(scope, scopeId, contents),
  };
}
