import { describe, it, expect } from "vitest";
import { resolveNight } from "../../src/game/engine.js";
import type { RoleName, SlotId } from "../../src/game/types.js";

const linesFor = (results: ReturnType<typeof resolveNight>["results"], id: string) =>
  results.find((r) => r.playerId === id)?.lines ?? [];

describe("resolveNight", () => {
  it("no actions → currentRoles equals startingRoles", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "villager", p2: "werewolf", p3: "seer",
      "center-0": "werewolf", "center-1": "robber", "center-2": "troublemaker",
    };
    const { currentRoles } = resolveNight(start, []);
    expect(currentRoles).toEqual(start);
  });

  it("werewolf sees the other werewolf; lone werewolf is told they are alone", () => {
    const twoWolves: Record<SlotId, RoleName> = {
      p1: "werewolf", p2: "werewolf", p3: "villager",
      "center-0": "seer", "center-1": "robber", "center-2": "villager",
    };
    const r = resolveNight(twoWolves, [{ kind: "noop", playerId: "p1" }, { kind: "noop", playerId: "p2" }]);
    expect(linesFor(r.results, "p1").join(" ")).toContain("p2");

    const loneWolf: Record<SlotId, RoleName> = {
      p1: "werewolf", p2: "villager", p3: "villager",
      "center-0": "werewolf", "center-1": "seer", "center-2": "robber",
    };
    const r2 = resolveNight(loneWolf, [{ kind: "noop", playerId: "p1" }]);
    expect(linesFor(r2.results, "p1").join(" ").toLowerCase()).toMatch(/lone|alone|only/);
  });

  it("minion sees the werewolves; masons see each other", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "minion", p2: "werewolf", p3: "werewolf",
      "center-0": "mason", "center-1": "mason", "center-2": "villager",
    };
    const r = resolveNight(start, [{ kind: "noop", playerId: "p1" }]);
    const line = linesFor(r.results, "p1").join(" ");
    expect(line).toContain("p2");
    expect(line).toContain("p3");
  });

  it("seer peeking a player reports that player's card, no state change", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "seer", p2: "werewolf", p3: "villager",
      "center-0": "robber", "center-1": "troublemaker", "center-2": "villager",
    };
    const r = resolveNight(start, [{ kind: "seer-player", playerId: "p1", target: "p2" }]);
    expect(linesFor(r.results, "p1").join(" ")).toContain("Aswang");
    expect(r.currentRoles).toEqual(start);
  });

  it("seer peeking two center cards reports both", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "seer", p2: "villager", p3: "villager",
      "center-0": "werewolf", "center-1": "tanner", "center-2": "robber",
    };
    const r = resolveNight(start, [{ kind: "seer-center", playerId: "p1", centers: [0, 1] }]);
    const line = linesFor(r.results, "p1").join(" ");
    expect(line).toContain("Aswang");
    expect(line).toContain("Martir");
  });

  it("robber swaps with the target and is told the acquired role", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "robber", p2: "werewolf", p3: "villager",
      "center-0": "seer", "center-1": "villager", "center-2": "villager",
    };
    const r = resolveNight(start, [{ kind: "robber", playerId: "p1", target: "p2" }]);
    expect(r.currentRoles.p1).toBe("werewolf");
    expect(r.currentRoles.p2).toBe("robber");
    expect(linesFor(r.results, "p1").join(" ")).toContain("Aswang");
  });

  it("troublemaker swaps two other players without being told anything", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "troublemaker", p2: "werewolf", p3: "villager",
      "center-0": "seer", "center-1": "villager", "center-2": "villager",
    };
    const r = resolveNight(start, [{ kind: "troublemaker", playerId: "p1", a: "p2", b: "p3" }]);
    expect(r.currentRoles.p2).toBe("villager");
    expect(r.currentRoles.p3).toBe("werewolf");
    expect(linesFor(r.results, "p1")).toEqual([]);
  });

  it("robber then troublemaker: robber's reported role is frozen, currentRoles reflects the later swap", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "robber", p2: "werewolf", p3: "troublemaker",
      "center-0": "seer", "center-1": "villager", "center-2": "villager",
    };
    const actions = [
      { kind: "robber", playerId: "p1", target: "p2" } as const,
      { kind: "troublemaker", playerId: "p3", a: "p1", b: "p2" } as const,
    ];
    const r = resolveNight(start, actions);
    // robber woke at wakeIndex 5 and saw the werewolf card
    expect(linesFor(r.results, "p1").join(" ")).toContain("Aswang");
    // troublemaker (index 6) then swapped p1 <-> p2
    expect(r.currentRoles.p1).toBe("robber");
    expect(r.currentRoles.p2).toBe("werewolf");
  });

  it("insomniac sees their final card after being robbed", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "insomniac", p2: "robber", p3: "villager",
      "center-0": "werewolf", "center-1": "villager", "center-2": "villager",
    };
    const r = resolveNight(start, [{ kind: "robber", playerId: "p2", target: "p1" }]);
    expect(r.currentRoles.p1).toBe("robber");
    expect(linesFor(r.results, "p1").join(" ")).toContain("Magnanakaw");
  });
});
