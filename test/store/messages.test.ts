import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { createMessageStore } from "../../src/store/messages.js";

function store() {
  return createMessageStore(openDatabase(":memory:"));
}

describe("createMessageStore", () => {
  it("append + recent round-trips oldest-first", () => {
    const s = store();
    s.append("c1", "user", "hi");
    s.append("c1", "model", "yo");
    const rows = s.recent("c1", 10);
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ["user", "hi"],
      ["model", "yo"],
    ]);
  });

  it("recent respects the limit and keeps the newest", () => {
    const s = store();
    for (let i = 0; i < 5; i++) s.append("c1", "user", `m${i}`);
    const rows = s.recent("c1", 2);
    expect(rows.map((r) => r.content)).toEqual(["m3", "m4"]);
  });

  it("trim keeps exactly the newest N", () => {
    const s = store();
    for (let i = 0; i < 6; i++) s.append("c1", "user", `m${i}`);
    s.trim("c1", 3);
    expect(s.recent("c1", 99).map((r) => r.content)).toEqual(["m3", "m4", "m5"]);
  });

  it("isolates channels", () => {
    const s = store();
    s.append("c1", "user", "a");
    s.append("c2", "user", "b");
    expect(s.recent("c1", 99).map((r) => r.content)).toEqual(["a"]);
    s.trim("c1", 0);
    expect(s.recent("c2", 99).map((r) => r.content)).toEqual(["b"]);
  });

  it("purgeChannel removes everything for a channel", () => {
    const s = store();
    s.append("c1", "user", "a");
    s.purgeChannel("c1");
    expect(s.recent("c1", 99)).toEqual([]);
  });
});
