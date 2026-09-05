import { describe, it, expect } from "vitest";
import { openDatabase, MIGRATIONS } from "../../src/store/db.js";

describe("openDatabase", () => {
  it("brings a fresh db to the current schema version", () => {
    const db = openDatabase(":memory:");
    const row = db.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(row.version).toBe(MIGRATIONS.length);
    const cols = db.prepare("PRAGMA table_info(messages)").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["channel_id", "content", "created_at", "id", "role"].sort(),
    );
  });

  it("is idempotent when reopened on the same connection logic", () => {
    const db = openDatabase(":memory:");
    // running migrations again must not throw
    expect(() => {
      for (const m of MIGRATIONS) m(db);
    }).not.toThrow();
  });
});
