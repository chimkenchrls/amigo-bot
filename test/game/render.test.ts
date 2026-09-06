import { describe, it, expect } from "vitest";
import {
  renderLobby,
  renderVote,
  renderRoleEphemeral,
  renderActEphemeral,
  renderReveal,
  roleBlurb,
} from "../../src/game/render.js";
import { emptyLobby, addPlayer } from "../../src/game/lobby.js";
import type { GameState, Outcome } from "../../src/game/types.js";

describe("render", () => {
  it("renderLobby lists players by display name and has join/leave/start buttons", () => {
    const lobby = addPlayer(emptyLobby("h"), "a");
    const p = renderLobby(lobby, { h: "Host", a: "Ann" });
    const json = JSON.stringify(p);
    expect(json).toContain("Host");
    expect(json).toContain("Ann");
    expect(json).toContain("wolf:join");
    expect(json).toContain("wolf:start");
  });

  it("renderVote builds a select menu with one option per player", () => {
    const p = renderVote({ p1: "A", p2: "B", p3: "C" }, ["p1", "p2", "p3"]);
    const json = JSON.stringify(p);
    expect(json).toContain("wolf:vote");
    expect(json.match(/"label":"[ABC]"/g) ?? []).toHaveLength(3);
  });

  it("renderRoleEphemeral is ephemeral and shows the starting role blurb", () => {
    const p = renderRoleEphemeral({ startingRole: "seer", nightLines: [], revealed: false });
    expect(p.flags).toBeDefined();
    expect(p.content).toContain(roleBlurb("seer").slice(0, 8));
  });

  it("renderRoleEphemeral appends night lines when present", () => {
    const p = renderRoleEphemeral({
      startingRole: "seer",
      nightLines: ["Ang card ni Dana: werewolf."],
      revealed: false,
    });
    expect(p.content).toContain("werewolf");
  });

  it("renderReveal shows every player, the dealt->final arrow, and the summary", () => {
    const state: GameState = {
      players: ["p1", "p2", "p3"],
      startingRoles: {
        p1: "werewolf",
        p2: "seer",
        p3: "villager",
        "center-0": "robber",
        "center-1": "villager",
        "center-2": "troublemaker",
      },
      currentRoles: {
        p1: "villager",
        p2: "seer",
        p3: "werewolf",
        "center-0": "robber",
        "center-1": "villager",
        "center-2": "troublemaker",
      },
      nightActions: [],
      votes: {},
    };
    const outcome: Outcome = {
      winningTeam: "village",
      deaths: ["p3"],
      summary: "Napatay ang lobo. Panalo ang nayon!",
    };
    const p = renderReveal(null, state, outcome, { p1: "Alice", p2: "Bob", p3: "Carol" });
    expect(p.content).toContain("Alice");
    expect(p.content).toContain("Bob");
    expect(p.content).toContain("Carol");
    expect(p.content).toContain(" → ");
    expect(p.content).toContain("Napatay ang lobo. Panalo ang nayon!");
  });

  it("renderActEphemeral seer gets a mode select", () => {
    const p = renderActEphemeral("seer", { p2: "B", p3: "C" }, ["p2", "p3"]);
    const json = JSON.stringify(p);
    expect(json).toContain("wolf:seer:player");
    expect(json).toContain("wolf:seer:center");
  });

  it("renderActEphemeral villager gets a matulog message and no components", () => {
    const p = renderActEphemeral("villager", {}, []);
    expect(p.content).toMatch(/matulog/i);
    expect(p.components === undefined || p.components.length === 0).toBe(true);
  });

  it("renderActEphemeral robber gets a player select", () => {
    const p = renderActEphemeral("robber", { p2: "B" }, ["p2"]);
    expect(JSON.stringify(p)).toContain("wolf:rob");
  });

  it("renderActEphemeral troublemaker gets a 2-value player select", () => {
    const p = renderActEphemeral("troublemaker", { p2: "B", p3: "C" }, ["p2", "p3"]);
    const json = JSON.stringify(p);
    expect(json).toContain("wolf:tm");
    expect(json).toContain('"min_values":2');
  });
});
