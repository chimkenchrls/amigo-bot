import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { createFactStore, type FactStore } from "../../src/store/facts.js";
import { MAX_AUTO_FACTS, MAX_FACTS_PER_SCOPE } from "../../src/constants.js";

describe("createFactStore", () => {
  let facts: FactStore;
  beforeEach(() => {
    facts = createFactStore(openDatabase(":memory:"), () => 1000);
  });

  it("adds and lists facts per scope, in insertion order", () => {
    facts.add("channel", "c1", "movie night is Fridays", "u1");
    facts.add("channel", "c1", "Dana is studying for the bar", "u2");
    facts.add("channel", "c2", "different channel", "u1");
    const list = facts.list("channel", "c1");
    expect(list.map((f) => f.content)).toEqual([
      "movie night is Fridays",
      "Dana is studying for the bar",
    ]);
    expect(list[0]).toMatchObject({ scope: "channel", scopeId: "c1", createdBy: "u1" });
  });

  it("forChat returns the channel's facts plus the guild's", () => {
    facts.add("channel", "c1", "channel fact", "u1");
    facts.add("guild", "g1", "server runs on PHT", "u1");
    const { channel, guild } = facts.forChat("c1", "g1");
    expect(channel.map((f) => f.content)).toEqual(["channel fact"]);
    expect(guild.map((f) => f.content)).toEqual(["server runs on PHT"]);
  });

  it("forChat returns no guild facts when guildId is null", () => {
    facts.add("guild", "g1", "server fact", "u1");
    expect(facts.forChat("c1", null).guild).toEqual([]);
  });

  it("remove deletes by id and reports whether anything went", () => {
    const f = facts.add("channel", "c1", "temp", "u1")!;
    expect(facts.remove(f.id)).toBe(true);
    expect(facts.remove(f.id)).toBe(false);
    expect(facts.list("channel", "c1")).toEqual([]);
  });

  it("refuses to add past the per-scope cap and returns null", () => {
    for (let i = 0; i < MAX_FACTS_PER_SCOPE; i++) {
      expect(facts.add("channel", "c1", `fact ${i}`, "u1")).not.toBeNull();
    }
    expect(facts.count("channel", "c1")).toBe(MAX_FACTS_PER_SCOPE);
    expect(facts.add("channel", "c1", "one too many", "u1")).toBeNull();
    // a different scope is unaffected
    expect(facts.add("guild", "g1", "still fine", "u1")).not.toBeNull();
  });

  it("defaults new facts to source 'user'", () => {
    const f = facts.add("channel", "c1", "a note", "u1")!;
    expect(f.source).toBe("user");
    expect(facts.list("channel", "c1")[0]!.source).toBe("user");
  });

  it("the per-scope cap counts only user rows", () => {
    facts.replaceAuto("channel", "c1", ["auto one", "auto two", "auto three"]);
    for (let i = 0; i < MAX_FACTS_PER_SCOPE; i++) {
      expect(facts.add("channel", "c1", `user ${i}`, "u1")).not.toBeNull();
    }
    expect(facts.add("channel", "c1", "one too many", "u1")).toBeNull();
    expect(facts.count("channel", "c1", "auto")).toBe(3);
    expect(facts.count("channel", "c1", "user")).toBe(MAX_FACTS_PER_SCOPE);
  });

  it("replaceAuto swaps the scope's auto rows and leaves user rows alone", () => {
    facts.add("channel", "c1", "kept user note", "u1");
    facts.replaceAuto("channel", "c1", ["first pass a", "first pass b"]);
    facts.replaceAuto("channel", "c1", ["second pass only"]);
    const contents = facts.list("channel", "c1").map((f) => f.content);
    expect(contents).toEqual(["kept user note", "second pass only"]);
    expect(facts.list("channel", "c1").find((f) => f.source === "auto")!.createdBy).toBe(
      "amigo",
    );
  });

  it("replaceAuto with an empty list clears the auto rows only", () => {
    facts.add("channel", "c1", "user note", "u1");
    facts.replaceAuto("channel", "c1", ["auto note"]);
    facts.replaceAuto("channel", "c1", []);
    expect(facts.list("channel", "c1").map((f) => f.content)).toEqual(["user note"]);
  });

  it("replaceAuto caps at MAX_AUTO_FACTS", () => {
    const many = Array.from({ length: MAX_AUTO_FACTS + 5 }, (_, i) => `note ${i}`);
    facts.replaceAuto("channel", "c1", many);
    expect(facts.count("channel", "c1", "auto")).toBe(MAX_AUTO_FACTS);
  });
});
