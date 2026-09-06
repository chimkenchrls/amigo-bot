import { describe, it, expect } from "vitest";
import { encodeId, decodeId } from "../../src/game/buttons.js";
import type { GameAction } from "../../src/game/buttons.js";

describe("customId codec", () => {
  it("round-trips every verb", () => {
    const cases: GameAction[] = [
      { verb: "join" }, { verb: "leave" }, { verb: "start" }, { verb: "cancel" },
      { verb: "role" }, { verb: "act" }, { verb: "skip" },
      { verb: "seer", mode: "player" }, { verb: "seer", mode: "center" },
      { verb: "rob" }, { verb: "tm" }, { verb: "vote" },
    ];
    for (const c of cases) expect(decodeId(encodeId(c))).toEqual(c);
  });

  it("every encoded id starts with wolf: and fits Discord's 100-char customId limit", () => {
    const cases: GameAction[] = [
      { verb: "seer", mode: "center" }, { verb: "vote" }, { verb: "tm" }, { verb: "join" },
    ];
    for (const c of cases) {
      const id = encodeId(c);
      expect(id.startsWith("wolf:")).toBe(true);
      expect(id.length).toBeLessThanOrEqual(100);
    }
  });

  it("returns null for foreign or malformed ids", () => {
    expect(decodeId("other:thing")).toBeNull();
    expect(decodeId("wolf:bogus")).toBeNull();
    expect(decodeId("wolf:")).toBeNull();
    expect(decodeId("wolf:seer")).toBeNull();
    expect(decodeId("wolf:seer:bogus")).toBeNull();
    expect(decodeId("wolf:join:extra")).toBeNull();
  });
});
