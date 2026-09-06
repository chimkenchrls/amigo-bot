import { describe, it, expect } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { MAX_GAME_MS } from "../../src/game/constants.js";
import { fakeDeps } from "./session-helpers.js";

describe("session safety cap", () => {
  it("aborts a game that exceeds MAX_GAME_MS", async () => {
    let clock = 0;
    const { deps } = fakeDeps({ now: () => clock });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    clock = MAX_GAME_MS + 1;
    await s.start("h").catch(() => {});
    expect(s.phase).toBe("done");
    expect(deps.onEnd).toHaveBeenCalledWith("c1");
  });

  it("arms a MAX_GAME_MS timer that aborts", async () => {
    const { deps, timers } = fakeDeps();
    const s = await createGameSession("h", deps);
    timers.find((t) => t.ms === MAX_GAME_MS)!.fn();
    await Promise.resolve();
    expect(s.phase).toBe("done");
  });
});
