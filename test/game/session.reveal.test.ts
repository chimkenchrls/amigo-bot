import { describe, it, expect, vi } from "vitest";
import { startedGame } from "./session-helpers.js";
import { NIGHT_MS } from "../../src/game/constants.js";
import type { MessagePayload } from "../../src/game/render.js";

describe("session reveal", () => {
  it("posts the reveal table, ends the game, and calls onEnd once", async () => {
    const { s, timers, deps, sent } = await startedGame({ rng: () => 0.01 });

    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve(); // -> day
    await s.skip("h"); // -> vote

    await s.vote("h", "a");
    await s.vote("a", "b");
    await s.vote("b", "a"); // all three voted -> reveal -> done

    expect(s.phase).toBe("done");
    expect(deps.onEnd).toHaveBeenCalledTimes(1);
    expect(deps.onEnd).toHaveBeenCalledWith("c1");
    expect(JSON.stringify(sent.at(-1)!.p)).toMatch(/Ann|Bee/);
  });

  it("a concurrent abort during the reveal send does not double onEnd", async () => {
    let releaseReveal!: () => void;
    const revealGate = new Promise<void>((resolve) => {
      releaseReveal = resolve;
    });
    const send = vi.fn(async (p: MessagePayload) => {
      if (typeof p.content === "string" && p.content.includes("mga role")) {
        await revealGate;
      }
      return { id: "m", edit: vi.fn(async () => {}) };
    });

    const { s, timers, deps } = await startedGame({
      rng: () => 0.01,
      channel: { id: "c1", send },
    });

    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve(); // -> day
    await s.skip("h"); // -> vote

    await s.vote("h", "a");
    await s.vote("a", "b");
    const lastVote = s.vote("b", "a"); // kicks enterReveal; its send hangs
    await Promise.resolve();

    await s.abort("x"); // races the hung reveal send
    releaseReveal();
    await lastVote;

    expect(s.phase).toBe("done");
    expect(deps.onEnd).toHaveBeenCalledTimes(1);
  });
});
