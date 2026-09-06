import { describe, it, expect } from "vitest";
import { playerView } from "../../src/game/engine.js";
import type { GameState } from "../../src/game/types.js";

const state = (): GameState => ({
  players: ["p1", "p2", "p3"],
  startingRoles: { p1: "seer", p2: "werewolf", p3: "villager", "center-0": "robber", "center-1": "villager", "center-2": "tanner" },
  currentRoles: { p1: "seer", p2: "werewolf", p3: "villager", "center-0": "robber", "center-1": "villager", "center-2": "tanner" },
  nightActions: [],
  votes: {},
});
const nr = [{ playerId: "p1", lines: ["Ang card ni p2: werewolf."] }];

describe("playerView", () => {
  it("shows only the player's own starting role during night, no results yet", () => {
    const v = playerView("p1", state(), "night", nr);
    expect(v.startingRole).toBe("seer");
    expect(v.nightLines).toEqual([]);
    expect(v.revealed).toBe(false);
  });
  it("exposes the player's own night results from day onward", () => {
    const v = playerView("p1", state(), "day", nr);
    expect(v.nightLines).toEqual(["Ang card ni p2: werewolf."]);
  });
  it("never returns another player's night results", () => {
    const v = playerView("p2", state(), "day", nr);
    expect(v.nightLines).toEqual([]);
  });
  it("marks revealed at the reveal phase", () => {
    expect(playerView("p3", state(), "reveal", nr).revealed).toBe(true);
  });
});
