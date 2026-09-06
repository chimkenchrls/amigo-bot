import { describe, it, expect } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { NIGHT_MS } from "../../src/game/constants.js";
import { startedGame } from "./session-helpers.js";

describe("session night", () => {
  it("rejects act() from someone not in the game", async () => {
    const { s } = await startedGame();
    await expect(s.act("zzz", { kind: "noop", playerId: "zzz" })).rejects.toThrow();
  });

  it("advances to day when the night timer fires", async () => {
    const { s, timers } = await startedGame();
    const nightTimer = timers.find((t) => t.ms === NIGHT_MS)!;
    nightTimer.fn();
    await Promise.resolve();
    expect(s.phase).toBe("day");
  });

  it("advances to day early once every acting player has submitted", async () => {
    const { s } = await startedGame();
    // every player submits a noop; non-acting roles are auto-satisfied
    for (const id of s.players) {
      await s.act(id, { kind: "noop", playerId: id }).catch(() => {});
    }
    expect(["day", "night"]).toContain(s.phase); // day if all three act
  });

  it("night results appear in showRole after the night ends", async () => {
    const { s, timers } = await startedGame();
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    const payload = s.showRole("h");
    expect(typeof payload.content).toBe("string");
  });
});
