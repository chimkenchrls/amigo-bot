import { describe, it, expect } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { LOBBY_TIMEOUT_MS } from "../../src/game/constants.js";
import { fakeDeps } from "./session-helpers.js";

describe("session lobby", () => {
  it("posts a lobby message and starts in the lobby phase", async () => {
    const { deps, sent } = fakeDeps();
    const s = await createGameSession("h", deps);
    expect(s.phase).toBe("lobby");
    expect(sent[0]!.p.content).toContain("One Night Werewolf");
  });

  it("join / leave update the roster and re-render the lobby message", async () => {
    const { deps, sent } = fakeDeps();
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    expect(s.players).toEqual(["h", "a"]);
    expect(sent[0]!.m.edit).toHaveBeenCalled();
    await s.leave("a");
    expect(s.players).toEqual(["h"]);
  });

  it("start below the minimum throws and stays in lobby", async () => {
    const { deps } = fakeDeps();
    const s = await createGameSession("h", deps);
    await expect(s.start("h")).rejects.toThrow();
    expect(s.phase).toBe("lobby");
  });

  it("start by a non-host throws", async () => {
    const { deps } = fakeDeps();
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    await expect(s.start("a")).rejects.toThrow();
  });

  it("host start with 3 players deals roles and moves to night", async () => {
    const { deps } = fakeDeps();
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    await s.join("b", "Bee");
    await s.start("h");
    expect(s.phase).toBe("night");
    expect(Object.keys(s.showRole("h")).length).toBeGreaterThan(0);
  });

  it("abort is idempotent under concurrent calls", async () => {
    const { deps } = fakeDeps();
    const s = await createGameSession("h", deps);
    await Promise.all([s.abort("x"), s.abort("x")]);
    expect(deps.onEnd).toHaveBeenCalledTimes(1);
  });

  it("lobby timeout aborts the game and calls onEnd", async () => {
    const { deps, timers } = fakeDeps();
    const s = await createGameSession("h", deps);
    const lobbyTimer = timers.find((t) => t.ms === LOBBY_TIMEOUT_MS)!;
    expect(lobbyTimer).toBeDefined();
    lobbyTimer.fn();
    await Promise.resolve();
    expect(s.phase).toBe("done");
    expect(deps.onEnd).toHaveBeenCalledWith("c1");
  });
});
