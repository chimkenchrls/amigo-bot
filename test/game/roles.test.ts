import { describe, it, expect } from "vitest";
import { ROLES, selectRoleSet } from "../../src/game/roles.js";

describe("ROLES", () => {
  it("has a wakeIndex order with werewolf first and insomniac last among actors", () => {
    const actors = Object.values(ROLES)
      .filter((r) => r.acts)
      .sort((a, b) => a.wakeIndex - b.wakeIndex)
      .map((r) => r.name);
    expect(actors[0]).toBe("werewolf");
    expect(actors[actors.length - 1]).toBe("insomniac");
  });
  it("marks villager and tanner as non-actors", () => {
    expect(ROLES.villager.acts).toBe(false);
    expect(ROLES.tanner.acts).toBe(false);
  });
});

describe("selectRoleSet", () => {
  it.each([
    [3, 6], [4, 7], [5, 8], [6, 9], [7, 10], [8, 11], [9, 12], [10, 13],
  ])("returns count+3 cards for %i players", (count, cards) => {
    expect(selectRoleSet(count)).toHaveLength(cards);
  });
  it("always contains exactly two werewolves", () => {
    for (let c = 3; c <= 10; c++) {
      const ww = selectRoleSet(c).filter((r) => r === "werewolf").length;
      expect(ww).toBe(2);
    }
  });
  it("only ever returns roles from the catalog", () => {
    for (let c = 3; c <= 10; c++) {
      for (const r of selectRoleSet(c)) expect(ROLES[r]).toBeDefined();
    }
  });
  it("adds minion at 5, insomniac at 6, two masons at 7, tanner at 8", () => {
    expect(selectRoleSet(4)).not.toContain("minion");
    expect(selectRoleSet(5)).toContain("minion");
    expect(selectRoleSet(6)).toContain("insomniac");
    expect(selectRoleSet(7).filter((r) => r === "mason")).toHaveLength(2);
    expect(selectRoleSet(8)).toContain("tanner");
  });
  it("throws below 3 or above 10 players", () => {
    expect(() => selectRoleSet(2)).toThrow();
    expect(() => selectRoleSet(11)).toThrow();
  });
});
