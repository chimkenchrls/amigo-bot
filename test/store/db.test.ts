import { describe, it, expect, afterEach } from "vitest";
import { openDatabase, MIGRATIONS } from "../../src/store/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("openDatabase", () => {
  it("brings a fresh db to the current schema version", () => {
    const db = openDatabase(":memory:");
    const row = db.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(row.version).toBe(MIGRATIONS.length);
    const count = db
      .prepare("SELECT count(*) AS n FROM schema_version")
      .get() as { n: number };
    expect(count.n).toBe(1);
    const cols = db.prepare("PRAGMA table_info(messages)").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["channel_id", "content", "created_at", "id", "role"].sort(),
    );
    const factCols = db.prepare("PRAGMA table_info(facts)").all() as {
      name: string;
    }[];
    expect(factCols.map((c) => c.name).sort()).toEqual(
      ["content", "created_at", "created_by", "id", "scope", "scope_id", "source"].sort(),
    );
  });

  it("is idempotent when reopened on the same connection", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "amigo-db-test-"));
    const dbPath = join(tmpDir, "test.db");

    try {
      // First open
      const db1 = openDatabase(dbPath);
      expect(
        (
          db1
            .prepare("SELECT count(*) AS n FROM schema_version")
            .get() as { n: number }
        ).n,
      ).toBe(1);
      expect(
        (
          db1.prepare("SELECT version FROM schema_version").get() as {
            version: number;
          }
        ).version,
      ).toBe(MIGRATIONS.length);
      db1.close();

      // Second open should not throw
      expect(() => {
        const db2 = openDatabase(dbPath);
        expect(
          (
            db2
              .prepare("SELECT count(*) AS n FROM schema_version")
              .get() as { n: number }
          ).n,
        ).toBe(1);
        expect(
          (
            db2.prepare("SELECT version FROM schema_version").get() as {
              version: number;
            }
          ).version,
        ).toBe(MIGRATIONS.length);
        db2.close();
      }).not.toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
