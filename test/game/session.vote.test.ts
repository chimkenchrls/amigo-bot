import { describe, it, expect } from "vitest";
import { startedGame } from "./session-helpers.js";
import { NIGHT_MS, VOTE_MS, DAY_MS } from "../../src/game/constants.js";

describe("session day + vote", () => {
  it("host skip during the night advances to day and posts the day message", async () => {
    const { s, sent } = await startedGame();
    await s.skip("h");
    expect(s.phase).toBe("day");
    const dayPost = sent.find(
      (r) => typeof r.p.content === "string" && r.p.content.includes("minuto"),
    );
    expect(dayPost).toBeDefined();
  });

  it("host skip during the day advances to the vote phase", async () => {
    const { s, timers } = await startedGame();
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    expect(s.phase).toBe("day");
    expect(timers.some((t) => t.ms === DAY_MS)).toBe(true);
    await s.skip("h");
    expect(s.phase).toBe("vote");
  });

  it("non-host skip throws", async () => {
    const { s, timers } = await startedGame();
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    await expect(s.skip("a")).rejects.toThrow();
  });

  it("the vote timer ends the vote phase", async () => {
    const { s, timers } = await startedGame();
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    await s.skip("h"); // -> vote
    expect(s.phase).toBe("vote");
    timers.find((t) => t.ms === VOTE_MS)!.fn();
    await Promise.resolve();
    expect(s.phase).toBe("reveal");
  });

  it("vote by a non-player throws; vote for a non-player target throws", async () => {
    const { s, timers } = await startedGame();
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    await s.skip("h"); // -> vote
    await expect(s.vote("zzz", "a")).rejects.toThrow();
    await expect(s.vote("a", "zzz")).rejects.toThrow();
  });

  it("a re-vote overwrites the previous vote; all-voted ends the phase", async () => {
    const { s, timers, deps } = await startedGame();
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    await s.skip("h"); // -> vote
    await s.vote("h", "a");
    await s.vote("h", "b"); // overwrite
    await s.vote("a", "b");
    await s.vote("b", "a");
    expect(s.phase).toBe("reveal");
    expect(deps.onEnd).not.toHaveBeenCalled();
  });
});
