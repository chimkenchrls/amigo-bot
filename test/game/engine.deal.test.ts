import { describe, it, expect } from "vitest";
import { pickRoleSet, deal, shuffle } from "../../src/game/engine.js";

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("shuffle", () => {
  it("is a permutation and deterministic under a fixed rng", () => {
    const a = shuffle([1, 2, 3, 4, 5], seq([0.1, 0.9, 0.4, 0.2]));
    const b = shuffle([1, 2, 3, 4, 5], seq([0.1, 0.9, 0.4, 0.2]));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("deal", () => {
  it("assigns every player slot plus three center slots", () => {
    const players = ["p1", "p2", "p3"];
    const roleSet = pickRoleSet(3);
    const { startingRoles } = deal(players, roleSet, seq([0.5]));
    expect(Object.keys(startingRoles).sort()).toEqual(
      ["center-0", "center-1", "center-2", "p1", "p2", "p3"].sort(),
    );
  });
  it("uses exactly the multiset of roles from the role set", () => {
    const players = ["p1", "p2", "p3", "p4"];
    const roleSet = pickRoleSet(4);
    const { startingRoles } = deal(players, roleSet, seq([0.2, 0.7, 0.1]));
    expect(Object.values(startingRoles).sort()).toEqual([...roleSet].sort());
  });
  it("is deterministic under a fixed rng", () => {
    const players = ["p1", "p2", "p3"];
    const rs = pickRoleSet(3);
    const one = deal(players, rs, seq([0.3, 0.8, 0.15, 0.6]));
    const two = deal(players, rs, seq([0.3, 0.8, 0.15, 0.6]));
    expect(one).toEqual(two);
  });
});
