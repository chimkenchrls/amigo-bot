import { describe, it, expect } from "vitest";
import { tallyVotes, decideWinner } from "../../src/game/engine.js";
import type { RoleName, SlotId } from "../../src/game/types.js";

describe("tallyVotes", () => {
  it("kills the single most-voted player", () => {
    const { deaths } = tallyVotes(
      { p1: "p3", p2: "p3", p3: "p1" }, ["p1", "p2", "p3"],
    );
    expect(deaths).toEqual(["p3"]);
  });
  it("kills all players tied for the most votes", () => {
    const { deaths } = tallyVotes(
      { p1: "p2", p2: "p1", p3: "p1", p4: "p2" }, ["p1", "p2", "p3", "p4"],
    );
    expect(deaths.sort()).toEqual(["p1", "p2"]);
  });
  it("kills nobody when every player has exactly one vote", () => {
    const { deaths } = tallyVotes(
      { p1: "p2", p2: "p3", p3: "p1" }, ["p1", "p2", "p3"],
    );
    expect(deaths).toEqual([]);
  });
  it("ignores abstainers (players with no vote recorded)", () => {
    const { deaths } = tallyVotes({ p1: "p2", p2: "p1" }, ["p1", "p2", "p3"]);
    expect(deaths.sort()).toEqual(["p1", "p2"]);
  });
});

describe("decideWinner", () => {
  const P = ["p1", "p2", "p3"];
  it("village wins when a werewolf dies", () => {
    const roles: Record<SlotId, RoleName> = { p1: "werewolf", p2: "villager", p3: "seer" };
    expect(decideWinner(roles, ["p1"], P).winningTeam).toBe("village");
  });
  it("werewolves win when no werewolf dies and one is in play", () => {
    const roles: Record<SlotId, RoleName> = { p1: "werewolf", p2: "villager", p3: "seer" };
    expect(decideWinner(roles, ["p2"], P).winningTeam).toBe("werewolf");
  });
  it("no werewolf in play, nobody dies → village wins", () => {
    const roles: Record<SlotId, RoleName> = { p1: "villager", p2: "villager", p3: "seer" };
    expect(decideWinner(roles, [], P).winningTeam).toBe("village");
  });
  it("no werewolf in play, someone dies → werewolves win", () => {
    const roles: Record<SlotId, RoleName> = { p1: "villager", p2: "villager", p3: "seer" };
    expect(decideWinner(roles, ["p1"], P).winningTeam).toBe("werewolf");
  });
  it("tanner dies → tanner wins, werewolves do not", () => {
    const roles: Record<SlotId, RoleName> = { p1: "tanner", p2: "werewolf", p3: "seer" };
    expect(decideWinner(roles, ["p1"], P).winningTeam).toBe("tanner");
  });
  it("tanner dies and a werewolf also dies → village wins", () => {
    const roles: Record<SlotId, RoleName> = { p1: "tanner", p2: "werewolf", p3: "seer" };
    expect(decideWinner(roles, ["p1", "p2"], P).winningTeam).toBe("village");
  });
});
