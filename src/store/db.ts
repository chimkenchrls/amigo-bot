import Database from "better-sqlite3";

export type DB = Database.Database;

export const MIGRATIONS: ReadonlyArray<(db: DB) => void> = [
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT    NOT NULL,
        role       TEXT    NOT NULL CHECK (role IN ('user','model')),
        content    TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_channel
        ON messages (channel_id, id);
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        scope      TEXT    NOT NULL CHECK (scope IN ('channel','guild')),
        scope_id   TEXT    NOT NULL,
        content    TEXT    NOT NULL,
        created_by TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_facts_scope
        ON facts (scope, scope_id, id);
    `);
  },
  (db) => {
    db.exec(`
      ALTER TABLE facts ADD COLUMN source TEXT NOT NULL DEFAULT 'user'
        CHECK (source IN ('user','auto'));
    `);
  },
];

export function openDatabase(dbPath: string): DB {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Check if schema_version table exists before preparing
  const hasVersionTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    )
    .get() !== undefined;

  let current = 0;
  if (hasVersionTable) {
    const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
      | { version: number }
      | undefined;
    current = row?.version ?? 0;
  }

  if (current < MIGRATIONS.length) {
    const run = db.transaction(() => {
      for (let i = current; i < MIGRATIONS.length; i++) {
        MIGRATIONS[i]!(db);
      }
      db.prepare("DELETE FROM schema_version").run();
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
        MIGRATIONS.length,
      );
    });
    run();
  }

  return db;
}
