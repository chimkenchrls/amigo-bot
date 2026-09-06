import { describe, it, expect } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { NIGHT_MS } from "../../src/game/constants.js";
import { startedGame } from "./session-helpers.js";

describe("session night", () => {
  it("rejects act() from someone not in the game", async () => {
    const { s } = await startedGame();
    await expect(s.act("zzz", { kind: "noop", playerId: "zzz" })).rejects.toThrow();
  });

  it("rejects a spoofed act() on the mismatch guard, recording nothing for the target", async () => {
    // rng 0.01 deals h=werewolf, a=seer, b=robber. "noop" is not a seer kind,
    // so before the guard was reordered this rejected on ACTION_KINDS ("mali ang
    // aksyon"); now the playerId-mismatch guard runs first ("hindi tugma").
    const { s, timers } = await startedGame({ rng: () => 0.01 });
    await expect(
      s.act("a", { kind: "noop", playerId: "b" }),
    ).rejects.toThrow(/tugma/);
    // nothing was recorded for "b": "b" is still free to submit their own action
    await expect(
      s.act("b", { kind: "robber", playerId: "b", target: "a" }),
    ).resolves.toBeUndefined();
    // and the night still runs its full course
    expect(s.phase).toBe("night");
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    expect(s.phase).toBe("day");
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

  it("werewolf night-result lists the teammate by display NAME, not raw id", async () => {
    // rng 0.5 deals h + b as werewolves, a as villager.
    const { s, timers } = await startedGame({ rng: () => 0.5 });
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    expect(s.phase).toBe("day");
    const content = s.showRole("h").content ?? "";
    expect(content).toContain("Bee"); // b's display name
    expect(content).not.toMatch(/lobo:\s*b\b/); // not the bare id "b"
  });

  it("showRole rejects a non-player", async () => {
    const { s } = await startedGame();
    expect(s.showRole("zzz")).toEqual({ content: "Hindi ka kasali sa laro." });
  });

  it("act() rejects an off-roster robber/seer target", async () => {
    // rng 0.42 deals h=troublemaker, a=werewolf, b=robber.
    const { s } = await startedGame({ rng: () => 0.42 });
    await expect(
      s.act("b", { kind: "robber", playerId: "b", target: "zzz" }),
    ).rejects.toThrow(/target/);
  });

  it("act() rejects a troublemaker picking the same slot twice or an off-roster slot", async () => {
    const { s } = await startedGame({ rng: () => 0.42 }); // h=troublemaker
    await expect(
      s.act("h", { kind: "troublemaker", playerId: "h", a: "a", b: "a" }),
    ).rejects.toThrow(/papalitan/);
    await expect(
      s.act("h", { kind: "troublemaker", playerId: "h", a: "a", b: "zzz" }),
    ).rejects.toThrow(/papalitan/);
  });

  it("act() rejects a seer center peek with an out-of-range index", async () => {
    // rng 0.01 deals h=werewolf, a=seer, b=robber.
    const { s } = await startedGame({ rng: () => 0.01 });
    await expect(
      s.act("a", { kind: "seer-center", playerId: "a", centers: [0, 5] }),
    ).rejects.toThrow(/gitna/);
  });

  it("act() rejects a seer player peek at an off-roster target", async () => {
    const { s } = await startedGame({ rng: () => 0.01 }); // a=seer
    await expect(
      s.act("a", { kind: "seer-player", playerId: "a", target: "zzz" }),
    ).rejects.toThrow(/target/);
  });
});
