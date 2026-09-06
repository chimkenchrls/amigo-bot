import { describe, it, expect } from "vitest";
import { emptyLobby, addPlayer, removePlayer, canStart } from "../../src/game/lobby.js";

describe("lobby", () => {
  it("auto-joins the host", () => {
    expect(emptyLobby("h").players).toEqual(["h"]);
  });
  it("adds players and is idempotent", () => {
    let l = emptyLobby("h");
    l = addPlayer(l, "a");
    l = addPlayer(l, "a");
    expect(l.players).toEqual(["h", "a"]);
  });
  it("removes players; missing id is a no-op", () => {
    let l = addPlayer(emptyLobby("h"), "a");
    l = removePlayer(l, "a");
    l = removePlayer(l, "zzz");
    expect(l.players).toEqual(["h"]);
  });
  it("canStart is false below 3, true at 3", () => {
    let l = emptyLobby("h");
    expect(canStart(l)).toBe(false);
    l = addPlayer(addPlayer(l, "a"), "b");
    expect(canStart(l)).toBe(true);
  });
  it("throws when adding past the max", () => {
    let l = emptyLobby("h");
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h2", "i"]) l = addPlayer(l, id);
    expect(l.players).toHaveLength(10);
    expect(() => addPlayer(l, "k")).toThrow();
  });
});
