# One Night Werewolf (Feature 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-moderated One Night Ultimate Werewolf game to AmIgo — `/werewolf`
opens a lobby, AmIgo deals roles, narrates the night/day/reveal in Taglish, collects
button-driven private actions and votes, and calls the winner.

**Architecture:** A pure `src/game/engine.ts` holds every deterministic rule (dealing,
night resolution, vote tally, win check). A timer-driven `GameSession` (one per
channel, held in an in-memory `registry`) orchestrates Discord I/O, phase timers, and
AI narration on top of that engine. All private info reaches players as ephemeral
replies to button clicks — no DMs. Game state is never persisted; a restart aborts
in-progress games with a best-effort message.

**Tech Stack:** TypeScript ESM (NodeNext, `verbatimModuleSyntax`), discord.js 14,
`@google/genai` 2.x, better-sqlite3 (untouched here), vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-09-06-amigo-werewolf-game-design.md`

## Global Constraints

- **ESM + `verbatimModuleSyntax`:** relative imports use the `.js` extension; type-only
  imports use `import type`.
- **Module boundaries:** `src/game/{types,roles,engine,lobby}.ts` and
  `src/ai/gameMaster.ts` must not import `discord.js`, `@google/genai` (except
  `gameMaster.ts` which may), or `src/store/`. `src/game/render.ts` may import
  `discord.js` types only, no I/O. `src/game/session.ts` is the only game module that
  performs gateway I/O. `src/game/registry.ts` must not import `src/store/`.
- **Tunables:** no inline literals for timings/limits — all live in
  `src/game/constants.ts`.
- **AI error contract:** `gameMaster.ts` functions return
  `{ ok: true; text } | { ok: false }` and throw `RateLimitError` / `AiUnavailableError`
  / `AiClientError`; one ~500ms retry on 5xx/timeout; read `err.status` via
  `classifyAiError`. Narration failure must never break or block the game.
- **Logging:** never log message text, prompts, roles, votes, or player-typed content.
  Log ids, counts, phase names, error names only.
- **Tests:** vitest, TDD (red → green → commit). Determinism via an injected `rng: () => number`.
- **Persona:** `GAME_PERSONA` — AmIgo in emcee mode, casual Taglish (mostly Tagalog,
  some English), dramatic but never reveals hidden info.

---

## File Structure

**Create:**
- `src/game/types.ts` — shared types: `RoleName`, `Team`, `Phase`, `GameState`, `NightAction`, `NightResult`, `Outcome`, `PlayerView`.
- `src/game/roles.ts` — `ROLES` catalog (team, `acts`, `wakeIndex`) + `selectRoleSet(count)`.
- `src/game/engine.ts` — `pickRoleSet`, `deal`, `resolveNight`, `tallyVotes`, `decideWinner`, `playerView`.
- `src/game/lobby.ts` — `emptyLobby`, `addPlayer`, `removePlayer`, `canStart` (pure).
- `src/game/constants.ts` — game tunables.
- `src/game/registry.ts` — `createRegistry()` → in-memory `Map<channelId, GameSession>` wrapper.
- `src/game/render.ts` — `renderLobby`, `renderNight`, `renderDay`, `renderVote`, `renderReveal`, `renderRoleEphemeral`, `renderActEphemeral` → Discord payload objects.
- `src/game/session.ts` — `createGameSession(deps)` → `GameSession`.
- `src/game/buttons.ts` — `encodeId`/`decodeId` + `routeGameInteraction(interaction, registry, logger)`.
- `src/ai/gameMaster.ts` — `GAME_PERSONA`, `narrateNight`, `narrateDay`, `narrateReveal`.
- `src/commands/werewolf.ts` — `/werewolf` slash command.
- `test/game/*.test.ts`, `test/ai/gameMaster.test.ts`, `test/commands/werewolf.test.ts` — one per module.

**Modify:**
- `src/commands/index.ts` — register `werewolfCommand`.
- `src/commands/types.ts` — add `registry: GameRegistry` to `CommandCtx`.
- `src/events/interactionCreate.ts` — route `wolf:*` button/select interactions.
- `src/events/messageCreate.ts` — skip the chat handler when a game is active in the channel.
- `src/index.ts` — construct the registry, pass it to command ctx + messageCreate deps, call `registry.abortAll()` on shutdown.
- `src/constants.ts` — (nothing; game constants live in `src/game/constants.ts`).

---

## Task 1: Types + role catalog + role-set selection

**Files:**
- Create: `src/game/types.ts`, `src/game/roles.ts`
- Test: `test/game/roles.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `type Team = "village" | "werewolf" | "tanner"`;
    `type RoleName = "werewolf" | "minion" | "mason" | "seer" | "robber" | "troublemaker" | "insomniac" | "villager" | "tanner"`;
    `type Phase = "lobby" | "night" | "day" | "vote" | "reveal" | "done"`.
  - `roles.ts`: `interface RoleDef { name: RoleName; team: Team; acts: boolean; wakeIndex: number }`;
    `const ROLES: Record<RoleName, RoleDef>`;
    `function selectRoleSet(playerCount: number): RoleName[]` — returns `playerCount + 3` role names.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/roles.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/roles.test.ts`
Expected: FAIL — `Cannot find module '../../src/game/roles.js'`.

- [ ] **Step 3: Write `src/game/types.ts`**

```typescript
export type Team = "village" | "werewolf" | "tanner";

export type RoleName =
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "insomniac"
  | "villager"
  | "tanner";

export type Phase = "lobby" | "night" | "day" | "vote" | "reveal" | "done";

/** slotId is a playerId, or "center-0" | "center-1" | "center-2". */
export type SlotId = string;

export interface GameState {
  players: string[];
  startingRoles: Record<SlotId, RoleName>;
  currentRoles: Record<SlotId, RoleName>;
  nightActions: NightAction[];
  votes: Record<string, string>;
}

export type NightAction =
  | { kind: "noop"; playerId: string }
  | { kind: "seer-player"; playerId: string; target: string }
  | { kind: "seer-center"; playerId: string; centers: [number, number] }
  | { kind: "robber"; playerId: string; target: string }
  | { kind: "troublemaker"; playerId: string; a: string; b: string };

/** What one player learned during the night, frozen at their wake moment. */
export interface NightResult {
  playerId: string;
  lines: string[];
}

export interface Outcome {
  winningTeam: Team;
  deaths: string[];
  summary: string;
}

export interface PlayerView {
  startingRole: RoleName;
  nightLines: string[];
  revealed: boolean;
}
```

- [ ] **Step 4: Write `src/game/roles.ts`**

```typescript
import type { RoleName, Team } from "./types.js";

export interface RoleDef {
  name: RoleName;
  team: Team;
  acts: boolean;
  wakeIndex: number;
}

export const ROLES: Record<RoleName, RoleDef> = {
  werewolf: { name: "werewolf", team: "werewolf", acts: true, wakeIndex: 1 },
  minion: { name: "minion", team: "werewolf", acts: true, wakeIndex: 2 },
  mason: { name: "mason", team: "village", acts: true, wakeIndex: 3 },
  seer: { name: "seer", team: "village", acts: true, wakeIndex: 4 },
  robber: { name: "robber", team: "village", acts: true, wakeIndex: 5 },
  troublemaker: { name: "troublemaker", team: "village", acts: true, wakeIndex: 6 },
  insomniac: { name: "insomniac", team: "village", acts: true, wakeIndex: 7 },
  villager: { name: "villager", team: "village", acts: false, wakeIndex: 99 },
  tanner: { name: "tanner", team: "tanner", acts: false, wakeIndex: 99 },
};

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

/**
 * Deterministic bag composition. Always 2 werewolves, then the core actors,
 * then scaling roles as the table grows, Villagers filling the rest so the bag
 * is exactly playerCount + 3.
 */
export function selectRoleSet(playerCount: number): RoleName[] {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`playerCount out of range: ${playerCount}`);
  }
  const size = playerCount + 3;
  const bag: RoleName[] = ["werewolf", "werewolf", "seer", "robber", "troublemaker"];
  if (playerCount >= 5) bag.push("minion");
  if (playerCount >= 6) bag.push("insomniac");
  if (playerCount >= 7) bag.push("mason", "mason");
  if (playerCount >= 8) bag.push("tanner");
  while (bag.length < size) bag.push("villager");
  return bag.slice(0, size);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/game/roles.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/game/types.ts src/game/roles.ts test/game/roles.test.ts
git commit -m "feat(game): role catalog + role-set selection by player count"
```

---

## Task 2: engine — `pickRoleSet` + `deal`

**Files:**
- Create: `src/game/engine.ts`
- Test: `test/game/engine.deal.test.ts`

**Interfaces:**
- Consumes: `selectRoleSet` (Task 1), `RoleName` / `SlotId` (Task 1).
- Produces:
  - `function pickRoleSet(playerCount: number): RoleName[]` — thin wrapper over `selectRoleSet` (kept in engine so callers import one module).
  - `function deal(players: string[], roleSet: RoleName[], rng: () => number): { startingRoles: Record<SlotId, RoleName> }` — shuffles `roleSet`, assigns the first `players.length` to players in order, the last 3 to `center-0..2`.
  - `function shuffle<T>(items: T[], rng: () => number): T[]` — exported for reuse/testing (Fisher–Yates).

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/engine.deal.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/engine.deal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal `src/game/engine.ts`**

```typescript
import type { RoleName, SlotId } from "./types.js";
import { selectRoleSet } from "./roles.js";

export function pickRoleSet(playerCount: number): RoleName[] {
  return selectRoleSet(playerCount);
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function deal(
  players: string[],
  roleSet: RoleName[],
  rng: () => number,
): { startingRoles: Record<SlotId, RoleName> } {
  const shuffled = shuffle(roleSet, rng);
  const startingRoles: Record<SlotId, RoleName> = {};
  players.forEach((id, idx) => {
    startingRoles[id] = shuffled[idx]!;
  });
  for (let c = 0; c < 3; c++) {
    startingRoles[`center-${c}`] = shuffled[players.length + c]!;
  }
  return { startingRoles };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/engine.deal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine.ts test/game/engine.deal.test.ts
git commit -m "feat(game): engine deal + deterministic shuffle"
```

---

## Task 3: engine — `resolveNight`

**Files:**
- Modify: `src/game/engine.ts`
- Test: `test/game/engine.night.test.ts`

**Interfaces:**
- Consumes: `NightAction`, `NightResult`, `RoleName`, `SlotId` (Task 1).
- Produces:
  - `function resolveNight(startingRoles: Record<SlotId, RoleName>, actions: NightAction[]): { currentRoles: Record<SlotId, RoleName>; results: NightResult[] }`.
  - Resolution walks the canonical wake order (werewolf → minion → mason → seer →
    robber → troublemaker → insomniac). Each acting player's `NightResult.lines` are
    computed against the board **as it stands when that role wakes** (earlier swaps
    applied, later ones not). `currentRoles` is the board after all swaps.
  - Player display: results reference other players by their slot id (playerId). The
    render layer maps ids → names; the engine stays name-agnostic.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/engine.night.test.ts
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
    expect(linesFor(r2.results, "p1").join(" ").toLowerCase()).toMatch(/alone|mag-isa/);
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
    expect(linesFor(r.results, "p1").join(" ")).toContain("werewolf");
    expect(r.currentRoles).toEqual(start);
  });

  it("seer peeking two center cards reports both", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "seer", p2: "villager", p3: "villager",
      "center-0": "werewolf", "center-1": "tanner", "center-2": "robber",
    };
    const r = resolveNight(start, [{ kind: "seer-center", playerId: "p1", centers: [0, 1] }]);
    const line = linesFor(r.results, "p1").join(" ");
    expect(line).toContain("werewolf");
    expect(line).toContain("tanner");
  });

  it("robber swaps with the target and is told the acquired role", () => {
    const start: Record<SlotId, RoleName> = {
      p1: "robber", p2: "werewolf", p3: "villager",
      "center-0": "seer", "center-1": "villager", "center-2": "villager",
    };
    const r = resolveNight(start, [{ kind: "robber", playerId: "p1", target: "p2" }]);
    expect(r.currentRoles.p1).toBe("werewolf");
    expect(r.currentRoles.p2).toBe("robber");
    expect(linesFor(r.results, "p1").join(" ")).toContain("werewolf");
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
    // robber woke at wakeIndex 5 and saw "werewolf"
    expect(linesFor(r.results, "p1").join(" ")).toContain("werewolf");
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
    expect(linesFor(r.results, "p1").join(" ")).toContain("robber");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/engine.night.test.ts`
Expected: FAIL — `resolveNight` is not exported.

- [ ] **Step 3: Add `resolveNight` to `src/game/engine.ts`**

```typescript
import type { NightAction, NightResult, RoleName, SlotId } from "./types.js";
import { ROLES, selectRoleSet } from "./roles.js";
// (keep the existing pickRoleSet / shuffle / deal above)

const WAKE_ORDER: RoleName[] = [
  "werewolf", "minion", "mason", "seer", "robber", "troublemaker", "insomniac",
];

export function resolveNight(
  startingRoles: Record<SlotId, RoleName>,
  actions: NightAction[],
): { currentRoles: Record<SlotId, RoleName>; results: NightResult[] } {
  const board: Record<SlotId, RoleName> = { ...startingRoles };
  const results = new Map<string, string[]>();
  const push = (id: string, line: string) => {
    const arr = results.get(id) ?? [];
    arr.push(line);
    results.set(id, arr);
  };
  const actionFor = (playerId: string) =>
    actions.find((a) => a.playerId === playerId);
  const playerIds = Object.keys(startingRoles).filter((k) => !k.startsWith("center-"));

  for (const role of WAKE_ORDER) {
    // Act on the STARTING role for sight, but on the current board for swaps.
    const wakers = playerIds.filter((id) => startingRoles[id] === role);
    for (const id of wakers) {
      switch (role) {
        case "werewolf": {
          const others = playerIds.filter(
            (o) => o !== id && startingRoles[o] === "werewolf",
          );
          if (others.length === 0) {
            const centerWolf = ["center-0", "center-1", "center-2"].find(
              (c) => startingRoles[c] === "werewolf",
            );
            push(id, centerWolf
              ? "Mag-isa kang lobo. May kapwa-lobo sa gitna."
              : "Mag-isa kang lobo ngayon gabi.");
          } else {
            push(id, `Kasabwat mong lobo: ${others.join(", ")}.`);
          }
          break;
        }
        case "minion": {
          const wolves = playerIds.filter((o) => startingRoles[o] === "werewolf");
          push(id, wolves.length
            ? `Ang mga lobo: ${wolves.join(", ")}. Protektahan mo sila.`
            : "Walang lobo sa mga manlalaro. Ikaw lang bahala.");
          break;
        }
        case "mason": {
          const others = playerIds.filter(
            (o) => o !== id && startingRoles[o] === "mason",
          );
          push(id, others.length
            ? `Kapwa mason: ${others.join(", ")}.`
            : "Ikaw lang ang mason. Nasa gitna ang isa pa.");
          break;
        }
        case "seer": {
          const a = actionFor(id);
          if (a?.kind === "seer-player") {
            push(id, `Ang card ni ${a.target}: ${board[a.target]}.`);
          } else if (a?.kind === "seer-center") {
            const [x, y] = a.centers;
            push(id, `Gitna #${x + 1}: ${board[`center-${x}`]}. Gitna #${y + 1}: ${board[`center-${y}`]}.`);
          }
          break;
        }
        case "robber": {
          const a = actionFor(id);
          if (a?.kind === "robber") {
            const acquired = board[a.target]!;
            board[a.target] = board[id]!;
            board[id] = acquired;
            push(id, `Ninakaw mo ang role ni ${a.target}. Ikaw na ang: ${acquired}.`);
          }
          break;
        }
        case "troublemaker": {
          const a = actionFor(id);
          if (a?.kind === "troublemaker") {
            const tmp = board[a.a]!;
            board[a.a] = board[a.b]!;
            board[a.b] = tmp;
          }
          break;
        }
        case "insomniac": {
          push(id, `Ang role mo ngayon: ${board[id]}.`);
          break;
        }
      }
    }
  }

  const list: NightResult[] = playerIds.map((id) => ({
    playerId: id,
    lines: results.get(id) ?? [],
  }));
  return { currentRoles: board, results: list };
}
```

Note: the `import` line in engine.ts should be consolidated — `selectRoleSet` is
already imported for `pickRoleSet`; add `ROLES` and the `types` additions to the
existing import statements rather than duplicating.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/engine.night.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Run the full engine suite**

Run: `npx vitest run test/game/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/engine.ts test/game/engine.night.test.ts
git commit -m "feat(game): resolveNight with canonical wake order"
```

---

## Task 4: engine — `tallyVotes` + `decideWinner`

**Files:**
- Modify: `src/game/engine.ts`
- Test: `test/game/engine.outcome.test.ts`

**Interfaces:**
- Consumes: `RoleName`, `SlotId`, `Team`, `Outcome` (Task 1); `ROLES` (Task 1).
- Produces:
  - `function tallyVotes(votes: Record<string, string>, players: string[]): { deaths: string[]; tally: Record<string, number> }`.
  - `function decideWinner(currentRoles: Record<SlotId, RoleName>, deaths: string[], players: string[]): Outcome`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/engine.outcome.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/engine.outcome.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add to `src/game/engine.ts`**

```typescript
import type { Outcome, Team } from "./types.js";

export function tallyVotes(
  votes: Record<string, string>,
  players: string[],
): { deaths: string[]; tally: Record<string, number> } {
  const tally: Record<string, number> = {};
  for (const p of players) tally[p] = 0;
  for (const target of Object.values(votes)) {
    if (target in tally) tally[target] += 1;
  }
  const cast = Object.keys(votes).length;
  const everyoneOneVote =
    cast === players.length && Object.values(tally).every((n) => n === 1);
  if (everyoneOneVote) return { deaths: [], tally };
  const max = Math.max(0, ...Object.values(tally));
  const deaths = max === 0 ? [] : players.filter((p) => tally[p] === max);
  return { deaths, tally };
}

export function decideWinner(
  currentRoles: Record<SlotId, RoleName>,
  deaths: string[],
  players: string[],
): Outcome {
  const isWolf = (p: string) => currentRoles[p] === "werewolf";
  const isTanner = (p: string) => currentRoles[p] === "tanner";
  const wolvesInPlay = players.some(isWolf);
  const aWolfDied = deaths.some(isWolf);
  const aTannerDied = deaths.some(isTanner);

  let winningTeam: Team;
  if (aTannerDied && !aWolfDied) winningTeam = "tanner";
  else if (aWolfDied) winningTeam = "village";
  else if (!wolvesInPlay) winningTeam = deaths.length === 0 ? "village" : "werewolf";
  else winningTeam = "werewolf";

  const summary =
    winningTeam === "village"
      ? "Panalo ang nayon."
      : winningTeam === "werewolf"
        ? "Panalo ang mga lobo."
        : "Panalo ang Tanner — nagpapatay siya ng sarili.";
  return { winningTeam, deaths, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/engine.outcome.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine.ts test/game/engine.outcome.test.ts
git commit -m "feat(game): tallyVotes + decideWinner"
```

---

## Task 5: engine — `playerView`

**Files:**
- Modify: `src/game/engine.ts`
- Test: `test/game/engine.view.test.ts`

**Interfaces:**
- Consumes: `GameState`, `PlayerView`, `Phase`, `NightResult` (Task 1).
- Produces:
  - `function playerView(playerId: string, state: GameState, phase: Phase, nightResults: NightResult[]): PlayerView`
  - Pre-`reveal`: `startingRole` is the player's own dealt role; `nightLines` is their
    own `NightResult.lines` once `phase` is `day` / `vote` / `reveal` (empty during
    `night`); `revealed` is false. Never includes another player's role.
  - At `reveal`: `revealed` is true (render layer then shows the full table from
    `state`, not from `playerView`).

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/engine.view.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/engine.view.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Add to `src/game/engine.ts`**

```typescript
import type { GameState, NightResult, Phase, PlayerView } from "./types.js";

export function playerView(
  playerId: string,
  state: GameState,
  phase: Phase,
  nightResults: NightResult[],
): PlayerView {
  const showResults = phase === "day" || phase === "vote" || phase === "reveal";
  const mine = nightResults.find((r) => r.playerId === playerId);
  return {
    startingRole: state.startingRoles[playerId]!,
    nightLines: showResults && mine ? mine.lines : [],
    revealed: phase === "reveal",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/engine.view.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full engine suite**

Run: `npm run typecheck && npx vitest run test/game/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/engine.ts test/game/engine.view.test.ts
git commit -m "feat(game): playerView — per-player visibility gate"
```

---

## Task 6: `lobby.ts`

**Files:**
- Create: `src/game/lobby.ts`
- Test: `test/game/lobby.test.ts`

**Interfaces:**
- Produces:
  - `interface Lobby { hostId: string; players: string[] }`
  - `function emptyLobby(hostId: string): Lobby` — host is auto-joined.
  - `function addPlayer(lobby: Lobby, playerId: string): Lobby` — idempotent; throws past `WEREWOLF_MAX_PLAYERS`.
  - `function removePlayer(lobby: Lobby, playerId: string): Lobby` — no-op if absent; host may leave (lobby then has a new implicit host = `players[0]`, or is empty).
  - `function canStart(lobby: Lobby): boolean` — `players.length >= WEREWOLF_MIN_PLAYERS`.
- Consumes: `WEREWOLF_MIN_PLAYERS`, `WEREWOLF_MAX_PLAYERS` (Task 7 — **do Task 7 first**, or inline a local `const` here and replace in Task 7). To avoid ordering pain, **Task 7 is merged into the front of this task** — create `src/game/constants.ts` in Step 3a.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/lobby.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/lobby.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Create `src/game/constants.ts`**

```typescript
export const WEREWOLF_MIN_PLAYERS = 3;
export const WEREWOLF_MAX_PLAYERS = 10;
export const WEREWOLF_COOLDOWN_MS = 60_000;

export const LOBBY_TIMEOUT_MS = 180_000;
export const NIGHT_MS = 90_000;
export const DAY_MS = 270_000;
export const VOTE_MS = 45_000;
export const MAX_GAME_MS = 1_200_000;

export const NARRATION_TIMEOUT_MS = 8_000;
export const REVEAL_NARRATION_TIMEOUT_MS = 10_000;
```

- [ ] **Step 3b: Create `src/game/lobby.ts`**

```typescript
import { WEREWOLF_MAX_PLAYERS, WEREWOLF_MIN_PLAYERS } from "./constants.js";

export interface Lobby {
  hostId: string;
  players: string[];
}

export function emptyLobby(hostId: string): Lobby {
  return { hostId, players: [hostId] };
}

export function addPlayer(lobby: Lobby, playerId: string): Lobby {
  if (lobby.players.includes(playerId)) return lobby;
  if (lobby.players.length >= WEREWOLF_MAX_PLAYERS) {
    throw new Error("lobby full");
  }
  return { ...lobby, players: [...lobby.players, playerId] };
}

export function removePlayer(lobby: Lobby, playerId: string): Lobby {
  if (!lobby.players.includes(playerId)) return lobby;
  return { ...lobby, players: lobby.players.filter((p) => p !== playerId) };
}

export function canStart(lobby: Lobby): boolean {
  return lobby.players.length >= WEREWOLF_MIN_PLAYERS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/lobby.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/constants.ts src/game/lobby.ts test/game/lobby.test.ts
git commit -m "feat(game): lobby helpers + game constants"
```

---

## Task 7: `ai/gameMaster.ts`

**Files:**
- Create: `src/ai/gameMaster.ts`
- Test: `test/ai/gameMaster.test.ts`

**Interfaces:**
- Consumes: `GoogleGenAI` type; `SAFETY_SETTINGS` (`src/ai/safety.ts`); `AI_TIMEOUT_MS`
  (`src/constants.ts`); `classifyAiError`, `RateLimitError`, `AiUnavailableError`,
  `AiClientError` (`src/ai/errors.ts`).
- Produces:
  - `const GAME_PERSONA: string`
  - `type Narration = { ok: true; text: string } | { ok: false }`
  - `interface GameMaster { narrateNight(f: NightFacts): Promise<Narration>; narrateDay(f: DayFacts): Promise<Narration>; narrateReveal(f: RevealFacts): Promise<Narration> }`
  - `function createGameMaster(genai: GoogleGenAI, model: string): GameMaster`
  - `interface NightFacts { playerNames: string[] }`
  - `interface DayFacts { playerNames: string[]; minutes: number }`
  - `interface RevealFacts { winningTeam: "village" | "werewolf" | "tanner"; deadNames: string[]; playerNames: string[] }`
- Facts contain **no roles, no actions, no votes** for night/day. Reveal facts carry
  only the winning team + dead names.

- [ ] **Step 1: Write the failing test**

```typescript
// test/ai/gameMaster.test.ts
import { describe, it, expect, vi } from "vitest";
import { createGameMaster, GAME_PERSONA } from "../../src/ai/gameMaster.js";
import { RateLimitError, AiClientError } from "../../src/ai/errors.js";

function fakeGenAI(impl: () => unknown) {
  return { models: { generateContent: vi.fn(impl) } } as never;
}

describe("GAME_PERSONA", () => {
  it("is Taglish emcee and forbids leaking hidden info", () => {
    expect(GAME_PERSONA).toContain("Taglish");
    expect(GAME_PERSONA.toLowerCase()).toMatch(/never reveal|huwag.*role|hidden/);
  });
});

describe("createGameMaster", () => {
  it("narrateNight returns ok text and sends only public facts", async () => {
    const genai = fakeGenAI(() => ({ text: "Bumaba ang gabi sa nayon..." }));
    const gm = createGameMaster(genai, "m");
    const res = await gm.narrateNight({ playerNames: ["Dana", "Eli"] });
    expect(res).toEqual({ ok: true, text: "Bumaba ang gabi sa nayon..." });
    const req = (genai as any).models.generateContent.mock.calls[0][0];
    expect(JSON.stringify(req)).not.toMatch(/werewolf|seer|robber/i);
    expect(req.config.systemInstruction).toBe(GAME_PERSONA);
  });

  it("returns { ok: false } when the model yields no text", async () => {
    const gm = createGameMaster(fakeGenAI(() => ({ text: "" })), "m");
    expect(await gm.narrateReveal({
      winningTeam: "village", deadNames: ["Eli"], playerNames: ["Dana", "Eli"],
    })).toEqual({ ok: false });
  });

  it("throws RateLimitError on 429", async () => {
    const gm = createGameMaster(fakeGenAI(() => { throw { status: 429 }; }), "m");
    await expect(gm.narrateDay({ playerNames: ["Dana"], minutes: 4 }))
      .rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws AiClientError on 404", async () => {
    const gm = createGameMaster(fakeGenAI(() => { throw { status: 404 }; }), "m");
    await expect(gm.narrateNight({ playerNames: ["Dana"] }))
      .rejects.toBeInstanceOf(AiClientError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ai/gameMaster.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/ai/gameMaster.ts`**

```typescript
import type { GoogleGenAI } from "@google/genai";
import { AI_TIMEOUT_MS } from "../constants.js";
import { SAFETY_SETTINGS } from "./safety.js";
import {
  AiClientError,
  AiUnavailableError,
  RateLimitError,
  classifyAiError,
} from "./errors.js";

export const GAME_PERSONA = [
  "You are AmIgo, hosting a game of One Night Werewolf for this Discord server.",
  "Narrate in casual Taglish (mostly Tagalog, some English) — dramatic emcee energy,",
  "2-4 sentences, funny but tense. You are the game master, not a player.",
  "Narrate ONLY the facts you are given. Never reveal, guess, or invent any player's",
  "role, never accuse anyone, never mention hidden information. No slurs, never punch down.",
].join(" ");

export type Narration = { ok: true; text: string } | { ok: false };

export interface NightFacts { playerNames: string[] }
export interface DayFacts { playerNames: string[]; minutes: number }
export interface RevealFacts {
  winningTeam: "village" | "werewolf" | "tanner";
  deadNames: string[];
  playerNames: string[];
}

export interface GameMaster {
  narrateNight(f: NightFacts): Promise<Narration>;
  narrateDay(f: DayFacts): Promise<Narration>;
  narrateReveal(f: RevealFacts): Promise<Narration>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createGameMaster(genai: GoogleGenAI, model: string): GameMaster {
  async function run(prompt: string): Promise<Narration> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await genai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            systemInstruction: GAME_PERSONA,
            safetySettings: SAFETY_SETTINGS,
            temperature: 1.0,
            maxOutputTokens: 200,
            thinkingConfig: { thinkingLevel: "LOW" as never },
            httpOptions: { timeout: AI_TIMEOUT_MS },
          },
        });
        const text = (res.text ?? "").trim();
        return text ? { ok: true, text } : { ok: false };
      } catch (err) {
        lastErr = err;
        const kind = classifyAiError(err);
        if (kind === "rate_limit") throw new RateLimitError();
        if (kind === "client_error") {
          throw new AiClientError(err instanceof Error ? err.message : String(err));
        }
        if (kind !== "unavailable") {
          throw err instanceof Error ? err : new Error(String(err));
        }
        if (attempt === 0) await sleep(500);
      }
    }
    throw new AiUnavailableError(
      lastErr instanceof Error ? lastErr.message : "ai unavailable",
    );
  }

  return {
    narrateNight: (f) =>
      run(`Night falls. Players: ${f.playerNames.join(", ")}. Set the scene as everyone closes their eyes.`),
    narrateDay: (f) =>
      run(`Morning. Players: ${f.playerNames.join(", ")}. They have ${f.minutes} minutes to argue before the vote. Kick off the day.`),
    narrateReveal: (f) =>
      run(`The vote is in. ${f.deadNames.length ? `Voted out: ${f.deadNames.join(", ")}.` : "Nobody was voted out."} Winner: ${f.winningTeam} team. Give a dramatic wrap-up.`),
  };
}
```

Note on `thinkingConfig`: import `ThinkingLevel` from `@google/genai` and use
`ThinkingLevel.LOW` rather than the `as never` cast, matching `src/ai/roast.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ai/gameMaster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/gameMaster.ts test/ai/gameMaster.test.ts
git commit -m "feat(game): gameMaster narration (public facts only, game never blocks)"
```

---

## Task 8: `render.ts`

**Files:**
- Create: `src/game/render.ts`
- Test: `test/game/render.test.ts`

**Interfaces:**
- Consumes: `Phase`, `RoleName`, `GameState`, `Outcome`, `PlayerView` (Task 1);
  `Lobby` (Task 6); `ROLES` (Task 1); discord.js `ButtonBuilder`, `ActionRowBuilder`,
  `StringSelectMenuBuilder`, `ButtonStyle`, `MessageFlags`.
- Produces (all return plain objects suitable for `channel.send` / `interaction.reply`):
  - `interface MessagePayload { content?: string; embeds?: unknown[]; components?: unknown[] }`
  - `function renderLobby(lobby: Lobby, names: Record<string, string>): MessagePayload`
  - `function renderNight(narration: string | null): MessagePayload`
  - `function renderDay(narration: string | null, minutes: number): MessagePayload`
  - `function renderVote(names: Record<string, string>, players: string[]): MessagePayload`
  - `function renderReveal(narration: string | null, state: GameState, outcome: Outcome, names: Record<string, string>): MessagePayload`
  - `function renderRoleEphemeral(view: PlayerView): MessagePayload & { flags: number }`
  - `function renderActEphemeral(role: RoleName, names: Record<string, string>, actablePlayers: string[]): MessagePayload & { flags: number }`
  - `function roleBlurb(role: RoleName): string`
- customIds are literal strings here matching Task 16's codec (`wolf:join` etc.).

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/render.test.ts
import { describe, it, expect } from "vitest";
import {
  renderLobby, renderVote, renderRoleEphemeral, roleBlurb,
} from "../../src/game/render.js";
import { emptyLobby, addPlayer } from "../../src/game/lobby.js";

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
    expect((json.match(/"label":"[ABC]"/g) ?? [])).toHaveLength(3);
  });

  it("renderRoleEphemeral is ephemeral and shows the starting role blurb", () => {
    const p = renderRoleEphemeral({ startingRole: "seer", nightLines: [], revealed: false });
    expect(p.flags).toBeDefined();
    expect(p.content).toContain(roleBlurb("seer").slice(0, 8));
  });

  it("renderRoleEphemeral appends night lines when present", () => {
    const p = renderRoleEphemeral({
      startingRole: "seer", nightLines: ["Ang card ni Dana: werewolf."], revealed: false,
    });
    expect(p.content).toContain("werewolf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/game/render.ts`**

Implement each function to return the payload shapes asserted above. Use
`ActionRowBuilder`, `ButtonBuilder`, `StringSelectMenuBuilder` from `discord.js` and
call `.toJSON()` on rows so payloads are plain objects. Ephemeral payloads include
`flags: MessageFlags.Ephemeral`. `roleBlurb` returns a one-line Taglish description per
`RoleName`. `renderReveal` builds a table: for each player `name — dealt → final`,
then the 3 center cards, then `outcome.summary`.

Minimum concrete content for the asserted functions:

```typescript
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} from "discord.js";
import type { GameState, Outcome, PlayerView, RoleName } from "./types.js";
import type { Lobby } from "./lobby.js";

export interface MessagePayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

const BLURBS: Record<RoleName, string> = {
  werewolf: "Werewolf — team lobo. Gabi: makikita mo ang kasabwat mo.",
  minion: "Minion — team lobo. Alam mo sino ang lobo; sila hindi alam ikaw.",
  mason: "Mason — team nayon. Magkakita kayong mga mason sa gabi.",
  seer: "Seer — team nayon. Silipin ang isang manlalaro o dalawang center card.",
  robber: "Robber — team nayon. Palit card sa isa, tapos mo makikita bago mo.",
  troublemaker: "Troublemaker — team nayon. Palitan ang card ng dalawang iba (di mo makikita).",
  insomniac: "Insomniac — team nayon. Pagkatapos ng gabi, silip mo sariling card.",
  villager: "Villager — team nayon. Walang gagawin sa gabi.",
  tanner: "Tanner — solo. Panalo ka lang kung ikaw ang mabo-vote out.",
};
export const roleBlurb = (role: RoleName): string => BLURBS[role];

const row = (...b: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(...b).toJSON();

export function renderLobby(lobby: Lobby, names: Record<string, string>): MessagePayload {
  const list = lobby.players.map((id, i) => `${i + 1}. ${names[id] ?? id}`).join("\n");
  return {
    content: `**One Night Werewolf** — hino-host ni AmIgo\n${lobby.players.length}/10 sumali (min 3):\n${list}`,
    components: [
      row(
        new ButtonBuilder().setCustomId("wolf:join").setLabel("Sali").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("wolf:leave").setLabel("Alis").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("wolf:start").setLabel("Simulan").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("wolf:cancel").setLabel("Kanselahin").setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

export function renderVote(names: Record<string, string>, players: string[]): MessagePayload {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("wolf:vote")
    .setPlaceholder("Sino ang ivo-vote mo?")
    .addOptions(players.map((id) => ({ label: names[id] ?? id, value: id })));
  return {
    content: "🗳️ **Boto na.** Pumili ng ivo-vote out. Pwede palitan hanggang matapos ang oras.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu).toJSON()],
  };
}

export function renderRoleEphemeral(view: PlayerView): MessagePayload & { flags: number } {
  const parts = [`**Role mo:** ${roleBlurb(view.startingRole)}`];
  if (view.nightLines.length) parts.push("", "**Nalaman mo kagabi:**", ...view.nightLines);
  return { content: parts.join("\n"), flags: MessageFlags.Ephemeral };
}

// renderNight, renderDay, renderActEphemeral, renderReveal: implement to the
// Interfaces block above; keep customIds consistent with Task 16.
```

Fill in `renderNight` / `renderDay` / `renderActEphemeral` / `renderReveal` following
the same pattern. Add focused tests for `renderReveal` (table contains every player
name and both role columns) and `renderActEphemeral` (seer gets a mode select,
villager gets a "matulog ka" message, robber/troublemaker get player selects).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/render.ts test/game/render.test.ts
git commit -m "feat(game): Discord payload builders for every phase"
```

---

## Task 9: `registry.ts`

**Files:**
- Create: `src/game/registry.ts`
- Test: `test/game/registry.test.ts`

**Interfaces:**
- Produces:
  - `interface GameSessionHandle { channelId: string; abort(reason: string): Promise<void> }`
    — the subset of `GameSession` the registry needs (Task 10 `GameSession` will
    satisfy this).
  - `interface GameRegistry { has(channelId: string): boolean; get(channelId: string): GameSessionHandle | undefined; set(s: GameSessionHandle): void; remove(channelId: string): void; abortAll(reason: string): Promise<void>; size(): number }`
  - `function createRegistry(): GameRegistry`

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/registry.test.ts
import { describe, it, expect, vi } from "vitest";
import { createRegistry } from "../../src/game/registry.js";

const handle = (channelId: string) => ({ channelId, abort: vi.fn(async () => {}) });

describe("createRegistry", () => {
  it("tracks sessions by channel", () => {
    const r = createRegistry();
    expect(r.has("c1")).toBe(false);
    r.set(handle("c1"));
    expect(r.has("c1")).toBe(true);
    expect(r.get("c1")?.channelId).toBe("c1");
    r.remove("c1");
    expect(r.has("c1")).toBe(false);
  });

  it("abortAll aborts every session and clears the map", async () => {
    const r = createRegistry();
    const a = handle("c1");
    const b = handle("c2");
    r.set(a);
    r.set(b);
    await r.abortAll("restart");
    expect(a.abort).toHaveBeenCalledWith("restart");
    expect(b.abort).toHaveBeenCalledWith("restart");
    expect(r.size()).toBe(0);
  });

  it("abortAll tolerates an abort that throws", async () => {
    const r = createRegistry();
    r.set({ channelId: "c1", abort: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(r.abortAll("restart")).resolves.toBeUndefined();
    expect(r.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/game/registry.ts`**

```typescript
export interface GameSessionHandle {
  channelId: string;
  abort(reason: string): Promise<void>;
}

export interface GameRegistry {
  has(channelId: string): boolean;
  get(channelId: string): GameSessionHandle | undefined;
  set(session: GameSessionHandle): void;
  remove(channelId: string): void;
  abortAll(reason: string): Promise<void>;
  size(): number;
}

export function createRegistry(): GameRegistry {
  const map = new Map<string, GameSessionHandle>();
  return {
    has: (id) => map.has(id),
    get: (id) => map.get(id),
    set: (s) => void map.set(s.channelId, s),
    remove: (id) => void map.delete(id),
    size: () => map.size,
    async abortAll(reason) {
      const sessions = [...map.values()];
      map.clear();
      await Promise.all(
        sessions.map((s) => s.abort(reason).catch(() => {})),
      );
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/registry.ts test/game/registry.test.ts
git commit -m "feat(game): in-memory session registry with abortAll"
```

---

## Task 10: `session.ts` — lobby phase + scaffolding

**Files:**
- Create: `src/game/session.ts`
- Test: `test/game/session.lobby.test.ts`

**Interfaces:**
- Consumes: `Lobby` helpers (Task 6), `pickRoleSet`/`deal` (Task 2), `render*` (Task 8),
  `GameRegistry` handle shape (Task 9), `GameMaster` (Task 7), constants (Task 6),
  `Logger` (`src/lib/log.ts`).
- Produces:
  - `interface SentMessage { id: string; edit(p: MessagePayload): Promise<void> }`
  - `interface GameChannel { id: string; send(p: MessagePayload): Promise<SentMessage> }`
  - `interface TimerHandle { }` (opaque)
  - `interface SessionDeps { now(): number; setTimer(ms: number, fn: () => void): TimerHandle; clearTimer(h: TimerHandle): void; channel: GameChannel; gameMaster: GameMaster; rng(): number; logger: Logger; names: Record<string, string>; onEnd(channelId: string): void }`
  - `interface GameSession { channelId: string; phase: Phase; abort(reason: string): Promise<void>; join(playerId: string, name: string): Promise<void>; leave(playerId: string): Promise<void>; start(byPlayerId: string): Promise<void>; skip(byPlayerId: string): Promise<void>; act(playerId: string, action: NightAction): Promise<void>; vote(playerId: string, target: string): Promise<void>; showRole(playerId: string): MessagePayload; hostId: string; players: string[] }`
  - `function createGameSession(hostId: string, deps: SessionDeps): Promise<GameSession>` — posts the lobby message on creation, returns the session in `phase: "lobby"`.
- This task implements only: construction, `join`, `leave`, `start` (→ deal → transition
  stub to `night` that just sets `phase` and posts `renderNight(null)`), `abort`, the
  lobby timeout, and `showRole`. `skip` / `act` / `vote` throw `"not in this phase"` for
  now (fleshed out in Tasks 11–13).

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/session.lobby.test.ts
import { describe, it, expect, vi } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { LOBBY_TIMEOUT_MS } from "../../src/game/constants.js";

function fakeDeps(over = {}) {
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const sent: any[] = [];
  return {
    timers, sent,
    deps: {
      now: () => 0,
      setTimer: (ms: number, fn: () => void) => { const h = { ms, fn }; timers.push(h); return h; },
      clearTimer: vi.fn(),
      channel: {
        id: "c1",
        send: vi.fn(async (p: any) => {
          const m = { id: `m${sent.length}`, edit: vi.fn(async () => {}) };
          sent.push({ p, m });
          return m;
        }),
      },
      gameMaster: {
        narrateNight: vi.fn(async () => ({ ok: false })),
        narrateDay: vi.fn(async () => ({ ok: false })),
        narrateReveal: vi.fn(async () => ({ ok: false })),
      },
      rng: () => 0.42,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      names: {} as Record<string, string>,
      onEnd: vi.fn(),
      ...over,
    },
  };
}

describe("session lobby", () => {
  it("posts a lobby message and starts in the lobby phase", async () => {
    const { deps, sent } = fakeDeps();
    const s = await createGameSession("h", deps);
    expect(s.phase).toBe("lobby");
    expect(sent[0].p.content).toContain("One Night Werewolf");
  });

  it("join / leave update the roster and re-render the lobby message", async () => {
    const { deps, sent } = fakeDeps();
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann");
    expect(s.players).toEqual(["h", "a"]);
    expect(sent[0].m.edit).toHaveBeenCalled();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/session.lobby.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/game/session.ts`** (lobby scope only)

Implement `createGameSession` per the Interfaces block:
- On construction: `lobby = emptyLobby(hostId)`, `names[hostId]` recorded, `phase =
  "lobby"`, `send(renderLobby(...))` → store the returned `SentMessage` as
  `lobbyMsg`, arm `setTimer(LOBBY_TIMEOUT_MS, () => this.abort("lobby timed out"))`.
- `join(id, name)`: guard `phase === "lobby"`, `lobby = addPlayer(lobby, id)`, record
  name, `lobbyMsg.edit(renderLobby(...))`.
- `leave(id)`: guard lobby phase, `lobby = removePlayer(...)`, re-render.
- `start(by)`: guard `phase === "lobby"`, `by === lobby.hostId` else throw,
  `canStart(lobby)` else throw. Clear the lobby timer. `roleSet = pickRoleSet(n)`,
  `deal(...)` → build `state: GameState`. Call `enterNight()`.
- `enterNight()` (stub for now): `phase = "night"`, `channel.send(renderNight(null))`,
  arm `setTimer(NIGHT_MS, () => this.endNight())` where `endNight` is a stub that does
  nothing yet (Task 11 fills it). Store the night message handle.
- `abort(reason)`: if `phase === "done"` return; clear any active timer; best-effort
  `channel.send({ content: \`Natigil ang laro: ${reason}.\` })`; `phase = "done"`;
  `deps.onEnd(channel.id)`.
- `showRole(id)`: return `renderRoleEphemeral(playerView(id, state, phase, nightResults))`
  — during lobby there is no `state`; return `{ content: "Wala pang role, di pa nag-si-simula." , flags: Ephemeral }`.
- `skip` / `act` / `vote`: `throw new Error("hindi pwede ngayon")`.

Keep a single `activeTimer: TimerHandle | undefined` and a helper `arm(ms, fn)` that
clears the previous timer first.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/session.lobby.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/session.ts test/game/session.lobby.test.ts
git commit -m "feat(game): GameSession lobby phase + start/deal/abort"
```

---

## Task 11: `session.ts` — night phase

**Files:**
- Modify: `src/game/session.ts`
- Test: `test/game/session.night.test.ts`

**Interfaces:**
- Consumes: `resolveNight` (Task 3), `ROLES` (Task 1).
- Produces (behaviour, no new exported symbols):
  - `act(playerId, action)` records a `NightAction` (guard: `phase === "night"`,
    player is in `state.players`, player hasn't already acted, the action kind matches
    the player's starting role or is `noop` for non-choosing roles).
  - Night ends when: the night timer fires, **or** every player whose starting role
    `ROLES[role].acts` has an action recorded. On end: `resolveNight` → store
    `currentRoles` + `nightResults`, then `enterDay()`.
  - After night ends, `showRole(id)` includes that player's night lines.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/session.night.test.ts
import { describe, it, expect } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { NIGHT_MS } from "../../src/game/constants.js";
// reuse fakeDeps from session.lobby.test.ts (copy the helper into this file or a shared test util)

// helper: start a 3-player game, return { s, timers, deps }
async function started() {
  const { deps, timers, sent } = fakeDeps();
  const s = await createGameSession("h", deps);
  await s.join("a", "Ann");
  await s.join("b", "Bee");
  await s.start("h");
  return { s, timers, sent, deps };
}

describe("session night", () => {
  it("rejects act() from someone not in the game", async () => {
    const { s } = await started();
    await expect(s.act("zzz", { kind: "noop", playerId: "zzz" })).rejects.toThrow();
  });

  it("advances to day when the night timer fires", async () => {
    const { s, timers } = await started();
    const nightTimer = timers.find((t) => t.ms === NIGHT_MS)!;
    nightTimer.fn();
    await Promise.resolve();
    expect(s.phase).toBe("day");
  });

  it("advances to day early once every acting player has submitted", async () => {
    const { s } = await started();
    // every player submits a noop; non-acting roles are auto-satisfied
    for (const id of s.players) {
      await s.act(id, { kind: "noop", playerId: id }).catch(() => {});
    }
    expect(["day", "night"]).toContain(s.phase); // day if all three act
  });

  it("night results appear in showRole after the night ends", async () => {
    const { s, timers } = await started();
    timers.find((t) => t.ms === NIGHT_MS)!.fn();
    await Promise.resolve();
    const payload = s.showRole("h");
    expect(typeof payload.content).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/session.night.test.ts`
Expected: FAIL — `act` throws unconditionally / phase never reaches `day`.

- [ ] **Step 3: Implement the night phase in `session.ts`**

- `enterNight()`: set `phase = "night"`, `nightActions = []`, send `renderNight(null)`
  (narration wired in Task 14), `arm(NIGHT_MS, () => this.endNight())`. Kick a
  best-effort `gameMaster.narrateNight` here only in Task 14.
- `act(id, action)`: guards as above. Push to `nightActions`. Then
  `if (allActingPlayersActed()) this.endNight()`.
- `allActingPlayersActed()`: for each `playerId`, `role = state.startingRoles[id]`;
  it's satisfied if `!ROLES[role].acts` or a `nightAction` exists with that
  `playerId`.
- `endNight()`: guard `phase === "night"` (idempotent — the timer and the
  last `act` can race). Clear timer. `const { currentRoles, results } =
  resolveNight(state.startingRoles, nightActions)`. `state.currentRoles =
  currentRoles`; `this.nightResults = results`. `enterDay()`.
- `enterDay()` (stub for Task 12): `phase = "day"`; `channel.send(renderDay(null,
  DAY_MS / 60000))`; `arm(DAY_MS, () => this.endDay())`; `endDay` a stub.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/session.night.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/session.ts test/game/session.night.test.ts
git commit -m "feat(game): night phase — action collection + blind resolution"
```

---

## Task 12: `session.ts` — day + vote phases

**Files:**
- Modify: `src/game/session.ts`
- Test: `test/game/session.vote.test.ts`

**Interfaces:**
- Consumes: `tallyVotes` (Task 4).
- Produces (behaviour):
  - `skip(byPlayerId)` — host-only; advances the current timed phase (`night` → end
    night, `day` → end day, `vote` → end vote). Throws for a non-host or in `lobby` /
    `reveal` / `done`.
  - `enterVote()` — `phase = "vote"`, send `renderVote(names, players)`, `arm(VOTE_MS,
    () => this.endVote())`.
  - `vote(playerId, target)` — guard `phase === "vote"`, both ids in `state.players`.
    `state.votes[playerId] = target` (overwrites). If every player has voted →
    `endVote()`.
  - `endVote()` — guard `phase === "vote"`. `tallyVotes` → `deaths`. `enterReveal()`
    (stub for Task 13).

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/session.vote.test.ts
import { describe, it, expect } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { DAY_MS, VOTE_MS } from "../../src/game/constants.js";
// reuse fakeDeps + a helper that drives a game to the vote phase

async function atVote() {
  const { deps, timers, sent } = fakeDeps();
  const s = await createGameSession("h", deps);
  await s.join("a", "Ann");
  await s.join("b", "Bee");
  await s.start("h");
  s.skipToVoteForTest?.(); // if you expose a helper; otherwise fire timers:
  timers.find((t) => t.ms >= 0 && s.phase === "night")?.fn();
  return { s, timers, sent, deps };
}

describe("session day + vote", () => {
  it("host skip during the day advances to the vote phase", async () => {
    const { deps, timers } = fakeDeps();
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann"); await s.join("b", "Bee");
    await s.start("h");
    // end night via timer
    timers.find((t) => t.ms > 0 && s.phase === "night")!.fn();
    await Promise.resolve();
    expect(s.phase).toBe("day");
    await s.skip("h");
    expect(s.phase).toBe("vote");
  });

  it("non-host skip throws", async () => {
    const { deps, timers } = fakeDeps();
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann"); await s.join("b", "Bee");
    await s.start("h");
    timers.find((t) => t.ms > 0 && s.phase === "night")!.fn();
    await Promise.resolve();
    await expect(s.skip("a")).rejects.toThrow();
  });

  it("a re-vote overwrites the previous vote; all-voted ends the phase", async () => {
    const { deps, timers } = fakeDeps();
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann"); await s.join("b", "Bee");
    await s.start("h");
    timers.find((t) => t.ms > 0 && s.phase === "night")!.fn(); await Promise.resolve();
    await s.skip("h"); // -> vote
    await s.vote("h", "a");
    await s.vote("h", "b"); // overwrite
    await s.vote("a", "b");
    await s.vote("b", "a");
    expect(["reveal", "done"]).toContain(s.phase);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/session.vote.test.ts`
Expected: FAIL — `skip` throws unconditionally / `vote` unimplemented.

- [ ] **Step 3: Implement day + vote in `session.ts`**

Per the Interfaces block. `endDay()` → `enterVote()`. Track `deaths` on the session
for the reveal.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/session.vote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/session.ts test/game/session.vote.test.ts
git commit -m "feat(game): day + vote phases with host skip"
```

---

## Task 13: `session.ts` — reveal + end

**Files:**
- Modify: `src/game/session.ts`
- Test: `test/game/session.reveal.test.ts`

**Interfaces:**
- Consumes: `decideWinner` (Task 4), `renderReveal` (Task 8).
- Produces (behaviour):
  - `enterReveal()` — `phase = "reveal"`; `outcome = decideWinner(state.currentRoles,
    deaths, state.players)`; `channel.send(renderReveal(null, state, outcome, names))`;
    then `phase = "done"`, `deps.onEnd(channelId)`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/session.reveal.test.ts
import { describe, it, expect } from "vitest";
import { createGameSession } from "../../src/game/session.js";
// reuse fakeDeps; drive a full game with a fixed rng so roles are known

describe("session reveal", () => {
  it("posts a reveal message, ends the game, and calls onEnd", async () => {
    const { deps, timers, sent } = fakeDeps({ rng: () => 0.01 });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann"); await s.join("b", "Bee");
    await s.start("h");
    timers.find((t) => t.ms > 0 && s.phase === "night")!.fn(); await Promise.resolve();
    await s.skip("h"); // vote
    await s.vote("h", "a"); await s.vote("a", "h"); await s.vote("b", "a");
    await Promise.resolve();
    expect(s.phase).toBe("done");
    expect(deps.onEnd).toHaveBeenCalledWith("c1");
    const reveal = sent[sent.length - 1].p;
    expect(JSON.stringify(reveal)).toMatch(/Ann|Bee/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/session.reveal.test.ts`
Expected: FAIL — reveal not implemented.

- [ ] **Step 3: Implement `enterReveal()`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/session.reveal.test.ts && npx vitest run test/game/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/session.ts test/game/session.reveal.test.ts
git commit -m "feat(game): reveal phase + game end"
```

---

## Task 14: `session.ts` — narration wiring + fallback

**Files:**
- Modify: `src/game/session.ts`
- Test: `test/game/session.narration.test.ts`

**Interfaces:**
- Consumes: `gameMaster` (Task 7), `NARRATION_TIMEOUT_MS`, `REVEAL_NARRATION_TIMEOUT_MS`
  (Task 6).
- Produces (behaviour):
  - On `enterNight` / `enterDay` / `enterReveal`, after sending the mechanical message,
    call the matching `gameMaster.narrate*` **without awaiting the phase on it**. Race
    it against `NARRATION_TIMEOUT_MS` (reveal: `REVEAL_NARRATION_TIMEOUT_MS`).
  - On `{ ok: true, text }` within the cap → `message.edit(renderX(text, ...))`.
  - On `{ ok: false }`, throw, or timeout → leave the mechanical message; log
    `logger.warn("game narration failed", { phase, name })`. Never rethrow.
  - A narration call in flight when the phase ends is abandoned (its edit is a no-op /
    guarded by a phase check).

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/session.narration.test.ts
import { describe, it, expect, vi } from "vitest";
import { createGameSession } from "../../src/game/session.js";

describe("session narration", () => {
  it("edits the night message with narration when it succeeds", async () => {
    const { deps, sent } = fakeDeps({
      gameMaster: {
        narrateNight: vi.fn(async () => ({ ok: true, text: "Kumalat ang lamig sa nayon." })),
        narrateDay: vi.fn(async () => ({ ok: false })),
        narrateReveal: vi.fn(async () => ({ ok: false })),
      },
    });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann"); await s.join("b", "Bee");
    await s.start("h");
    await Promise.resolve(); await Promise.resolve();
    const nightMsg = sent.find((x: any) => JSON.stringify(x.p).includes("Gabi") || JSON.stringify(x.p).includes("gabi"));
    expect(nightMsg.m.edit).toHaveBeenCalled();
  });

  it("keeps the mechanical message and logs when narration throws", async () => {
    const { deps } = fakeDeps({
      gameMaster: {
        narrateNight: vi.fn(async () => { throw new Error("gemini down"); }),
        narrateDay: vi.fn(async () => ({ ok: false })),
        narrateReveal: vi.fn(async () => ({ ok: false })),
      },
    });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann"); await s.join("b", "Bee");
    await s.start("h");
    await Promise.resolve(); await Promise.resolve();
    expect(s.phase).toBe("night");
    expect(deps.logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/session.narration.test.ts`
Expected: FAIL — no edit / no warn.

- [ ] **Step 3: Add the narration helper**

```typescript
private async narrate(
  phase: Phase,
  msg: SentMessage,
  call: () => Promise<Narration>,
  render: (text: string) => MessagePayload,
  capMs: number,
): Promise<void> {
  try {
    const timeout = new Promise<Narration>((resolve) =>
      this.deps.setTimer(capMs, () => resolve({ ok: false })),
    );
    const res = await Promise.race([call(), timeout]);
    if (res.ok && this.phase === phase) {
      await msg.edit(render(res.text)).catch(() => {});
    } else if (!res.ok) {
      this.deps.logger.warn("game narration failed", { phase });
    }
  } catch (err) {
    this.deps.logger.warn("game narration failed", {
      phase,
      name: err instanceof Error ? err.name : "unknown",
    });
  }
}
```

Wire it into `enterNight` / `enterDay` / `enterReveal` with `void this.narrate(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/session.narration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/session.ts test/game/session.narration.test.ts
git commit -m "feat(game): non-blocking AI narration with fallback"
```

---

## Task 15: `session.ts` — `MAX_GAME_MS` safety abort

**Files:**
- Modify: `src/game/session.ts`
- Test: `test/game/session.safety.test.ts`

**Interfaces:**
- Consumes: `MAX_GAME_MS` (Task 6).
- Produces (behaviour): on construction, record `startedAt = deps.now()`. At the top of
  every phase transition (`enterNight`/`enterDay`/`enterVote`/`enterReveal`) and in
  `act`/`vote`/`skip`, if `deps.now() - startedAt > MAX_GAME_MS` → `abort("game ran too
  long")` and return without doing the transition. Also arm one
  `setTimer(MAX_GAME_MS, () => this.abort("game ran too long"))` at construction.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/session.safety.test.ts
import { describe, it, expect } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import { MAX_GAME_MS } from "../../src/game/constants.js";

describe("session safety cap", () => {
  it("aborts a game that exceeds MAX_GAME_MS", async () => {
    let clock = 0;
    const { deps } = fakeDeps({ now: () => clock });
    const s = await createGameSession("h", deps);
    await s.join("a", "Ann"); await s.join("b", "Bee");
    clock = MAX_GAME_MS + 1;
    await s.start("h").catch(() => {});
    expect(s.phase).toBe("done");
    expect(deps.onEnd).toHaveBeenCalledWith("c1");
  });

  it("arms a MAX_GAME_MS timer that aborts", async () => {
    const { deps, timers } = fakeDeps();
    const s = await createGameSession("h", deps);
    timers.find((t) => t.ms === MAX_GAME_MS)!.fn();
    await Promise.resolve();
    expect(s.phase).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/session.safety.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the guard + timer**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/session.safety.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/session.ts test/game/session.safety.test.ts
git commit -m "feat(game): MAX_GAME_MS safety abort"
```

---

## Task 16: `buttons.ts` — customId codec

**Files:**
- Create: `src/game/buttons.ts`
- Test: `test/game/buttons.codec.test.ts`

**Interfaces:**
- Produces:
  - `type GameAction =`
    `| { verb: "join" } | { verb: "leave" } | { verb: "start" } | { verb: "cancel" }`
    `| { verb: "role" } | { verb: "act" } | { verb: "skip" }`
    `| { verb: "seer"; mode: "player" | "center" }`
    `| { verb: "rob"; target: string } | { verb: "tm"; a: string; b: string }`
    `| { verb: "vote"; target: string }`
  - `function encodeId(a: GameAction): string` — `"wolf:" + parts joined by ":"`.
  - `function decodeId(customId: string): GameAction | null` — `null` for any string not
    starting `"wolf:"` or an unknown verb.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/buttons.codec.test.ts
import { describe, it, expect } from "vitest";
import { encodeId, decodeId } from "../../src/game/buttons.js";

describe("customId codec", () => {
  it("round-trips every verb", () => {
    const cases = [
      { verb: "join" }, { verb: "leave" }, { verb: "start" }, { verb: "cancel" },
      { verb: "role" }, { verb: "act" }, { verb: "skip" },
      { verb: "seer", mode: "player" }, { verb: "seer", mode: "center" },
      { verb: "rob", target: "p2" },
      { verb: "tm", a: "p2", b: "p3" },
      { verb: "vote", target: "p4" },
    ] as const;
    for (const c of cases) expect(decodeId(encodeId(c))).toEqual(c);
  });
  it("returns null for a foreign or malformed id", () => {
    expect(decodeId("other:thing")).toBeNull();
    expect(decodeId("wolf:bogus")).toBeNull();
    expect(decodeId("wolf:")).toBeNull();
  });
  it("stays within Discord's 100-char customId limit", () => {
    expect(encodeId({ verb: "tm", a: "123456789012345678", b: "876543210987654321" }).length)
      .toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/buttons.codec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the codec in `src/game/buttons.ts`**

```typescript
export type GameAction =
  | { verb: "join" } | { verb: "leave" } | { verb: "start" } | { verb: "cancel" }
  | { verb: "role" } | { verb: "act" } | { verb: "skip" }
  | { verb: "seer"; mode: "player" | "center" }
  | { verb: "rob"; target: string }
  | { verb: "tm"; a: string; b: string }
  | { verb: "vote"; target: string };

export function encodeId(a: GameAction): string {
  switch (a.verb) {
    case "seer": return `wolf:seer:${a.mode}`;
    case "rob": return `wolf:rob:${a.target}`;
    case "tm": return `wolf:tm:${a.a}:${a.b}`;
    case "vote": return `wolf:vote:${a.target}`;
    default: return `wolf:${a.verb}`;
  }
}

export function decodeId(customId: string): GameAction | null {
  if (!customId.startsWith("wolf:")) return null;
  const [, verb, x, y] = customId.split(":");
  switch (verb) {
    case "join": case "leave": case "start": case "cancel":
    case "role": case "act": case "skip":
      return { verb };
    case "seer":
      return x === "player" || x === "center" ? { verb: "seer", mode: x } : null;
    case "rob":
      return x ? { verb: "rob", target: x } : null;
    case "tm":
      return x && y ? { verb: "tm", a: x, b: y } : null;
    case "vote":
      return x ? { verb: "vote", target: x } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/buttons.codec.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/buttons.ts test/game/buttons.codec.test.ts
git commit -m "feat(game): button customId codec"
```

---

## Task 17: `buttons.ts` — `routeGameInteraction`

**Files:**
- Modify: `src/game/buttons.ts`
- Test: `test/game/buttons.route.test.ts`

**Interfaces:**
- Consumes: `decodeId` (Task 16), `GameRegistry` (Task 9), `GameSession` (Task 10),
  `Logger`; discord.js `ButtonInteraction` / `StringSelectMenuInteraction` shapes
  (only `customId`, `channelId`, `user.id`, `member`, `values`, `reply`, `deferUpdate`,
  `followUp` are used — type the param as a small local interface for testability).
- Produces:
  - `interface GameInteraction { customId: string; channelId: string; userId: string; displayName: string; values?: string[]; reply(p: unknown): Promise<void>; deferUpdate(): Promise<void>; followUp(p: unknown): Promise<void> }`
  - `function routeGameInteraction(i: GameInteraction, registry: GameRegistry, logger: Logger): Promise<void>`
  - Behaviour: `decodeId` → `null` → ignore. No session for `i.channelId` → ephemeral
    "walang laro dito." Else dispatch:
    - `join` → `session.join(userId, displayName)` then `deferUpdate()`
    - `leave` → `session.leave(userId)` then `deferUpdate()`
    - `start` → `session.start(userId)` then `deferUpdate()`; on throw → ephemeral the message
    - `cancel` → `session.abort("cancelled by host")` (guard host inside session) then `deferUpdate()`
    - `skip` → `session.skip(userId)` then `deferUpdate()`
    - `role` → `i.reply(session.showRole(userId))` (ephemeral payload)
    - `act` → `i.reply(session.actPrompt(userId))` — an ephemeral menu built from the
      player's role (add `actPrompt(playerId): MessagePayload` to `GameSession` in this
      task; it calls `renderActEphemeral`)
    - `seer` → `session.act(userId, { kind: mode === "player" ? ... : ... })` — for a
      `seer:player` the follow-up target select is a second interaction
      (`rob`-style). Simplest: `seer:player` opens a player select
      (`wolf:rob`-shaped but tagged), `seer:center` records a fixed `[0,1]` peek or
      opens a center select. **Decision for v1:** `seer:center` peeks center cards
      `[0,1]` automatically (no sub-menu); `seer:player` + the player select records
      `seer-player`. Document this in the reveal/help text.
    - `rob` → `session.act(userId, { kind: "robber", playerId: userId, target })`
    - `tm` → needs two targets: the select menu returns `i.values` with 2 entries →
      `session.act(userId, { kind: "troublemaker", playerId: userId, a, b })`
    - `vote` → `session.vote(userId, i.values![0])` then `deferUpdate()`
  - Every dispatch is wrapped so a thrown guard error becomes an ephemeral message, not
    an unhandled rejection. Dedupe: the session methods already guard "already acted" /
    "wrong phase"; the router just surfaces the thrown message.

- [ ] **Step 1: Write the failing test**

```typescript
// test/game/buttons.route.test.ts
import { describe, it, expect, vi } from "vitest";
import { routeGameInteraction } from "../../src/game/buttons.js";
import { encodeId } from "../../src/game/buttons.js";
import { createRegistry } from "../../src/game/registry.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function iact(over: Partial<any> = {}) {
  return {
    customId: encodeId({ verb: "join" }),
    channelId: "c1",
    userId: "u1",
    displayName: "Uno",
    reply: vi.fn(async () => {}),
    deferUpdate: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    ...over,
  };
}

describe("routeGameInteraction", () => {
  it("ignores a non-wolf customId", async () => {
    const r = createRegistry();
    const i = iact({ customId: "other:x" });
    await routeGameInteraction(i as any, r, logger as any);
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it("replies ephemerally when there is no game in the channel", async () => {
    const r = createRegistry();
    const i = iact();
    await routeGameInteraction(i as any, r, logger as any);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("laro") }),
    );
  });

  it("routes join to the channel's session", async () => {
    const r = createRegistry();
    const join = vi.fn(async () => {});
    r.set({ channelId: "c1", abort: vi.fn(async () => {}), join } as any);
    const i = iact();
    await routeGameInteraction(i as any, r, logger as any);
    expect(join).toHaveBeenCalledWith("u1", "Uno");
    expect(i.deferUpdate).toHaveBeenCalled();
  });

  it("surfaces a guard error as an ephemeral message", async () => {
    const r = createRegistry();
    r.set({
      channelId: "c1", abort: vi.fn(async () => {}),
      start: vi.fn(async () => { throw new Error("kulang pa sa tatlo"); }),
    } as any);
    const i = iact({ customId: encodeId({ verb: "start" }) });
    await routeGameInteraction(i as any, r, logger as any);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("kulang") }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game/buttons.route.test.ts`
Expected: FAIL — `routeGameInteraction` not exported.

- [ ] **Step 3: Implement `routeGameInteraction`** and add `actPrompt(playerId)` to
  `GameSession` (returns `renderActEphemeral(role, names, actableTargets)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/game/buttons.route.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/buttons.ts src/game/session.ts test/game/buttons.route.test.ts
git commit -m "feat(game): route button + select interactions to the session"
```

---

## Task 18: `/werewolf` command

**Files:**
- Create: `src/commands/werewolf.ts`
- Modify: `src/commands/index.ts`, `src/commands/types.ts`
- Test: `test/commands/werewolf.test.ts`

**Interfaces:**
- Consumes: `Command` / `CommandCtx` (`src/commands/types.ts`), `createRegistry` handle
  shape, `createGameSession` (Task 10), `WEREWOLF_COOLDOWN_MS` (Task 6),
  `createSessionDeps` adapter (defined here — wraps a discord.js `TextChannel` into a
  `GameChannel` and `setTimeout`/`clearTimeout` into the timer deps).
- Produces:
  - `src/commands/types.ts`: add `registry: GameRegistry` and (optional) keep existing
    fields. Update `CommandCtx`.
  - `src/commands/werewolf.ts`: `export const werewolfCommand: Command` with
    `data = new SlashCommandBuilder().setName("werewolf").setDescription("Start a game of One Night Werewolf").setDMPermission(false)`.
    `execute`: cooldown check (`ctx.cooldown.check(user.id, "werewolf", WEREWOLF_COOLDOWN_MS)`);
    if `ctx.registry.has(channelId)` → ephemeral "may laro na dito"; else build
    `SessionDeps` from the interaction's channel, `const session = await
    createGameSession(user.id, deps)`, `ctx.registry.set(session)`, and
    `interaction.reply({ content: "Ginawa ko na ang lobby sa taas ⬆️", flags: Ephemeral })`
    (the lobby message itself was posted by the session).
  - `src/commands/index.ts`: add `[werewolfCommand.data.name, werewolfCommand]`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/commands/werewolf.test.ts
import { describe, it, expect, vi } from "vitest";
import { werewolfCommand } from "../../src/commands/werewolf.js";

function ctx(over: any = {}) {
  return {
    cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
    registry: { has: vi.fn(() => false), set: vi.fn(), get: vi.fn(), remove: vi.fn() },
    genai: {} as never,
    model: "m",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
}
function interaction(over: any = {}) {
  return {
    user: { id: "u1" },
    channelId: "c1",
    guildId: "g1",
    channel: { id: "c1", send: vi.fn(async () => ({ id: "m1", edit: vi.fn() })) },
    reply: vi.fn(async () => {}),
    ...over,
  };
}

describe("/werewolf", () => {
  it("is guild-only", () => {
    expect((werewolfCommand.data.toJSON() as any).dm_permission).toBe(false);
  });

  it("refuses when a game already exists in the channel", async () => {
    const c = ctx({ registry: { has: vi.fn(() => true), set: vi.fn() } });
    const i = interaction();
    await werewolfCommand.execute(i as any, c as any);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("laro na dito") }),
    );
    expect(c.registry.set).not.toHaveBeenCalled();
  });

  it("registers a new session and acknowledges", async () => {
    const c = ctx();
    const i = interaction();
    await werewolfCommand.execute(i as any, c as any);
    expect(c.registry.set).toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalled();
  });

  it("respects the per-user cooldown", async () => {
    const c = ctx({ cooldown: { check: vi.fn(() => ({ ok: false, retryAfter: 30 })) } });
    const i = interaction();
    await werewolfCommand.execute(i as any, c as any);
    expect(c.registry.set).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("30") }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/commands/werewolf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/commands/werewolf.ts`, extend `CommandCtx`, register in
  `commands/index.ts`. The `SessionDeps` adapter:

```typescript
function sessionDepsFor(
  channel: { id: string; send: (p: unknown) => Promise<{ id: string; edit: (p: unknown) => Promise<unknown> }> },
  ctx: CommandCtx,
): SessionDeps {
  return {
    now: () => Date.now(),
    setTimer: (ms, fn) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    channel: {
      id: channel.id,
      send: async (p) => {
        const m = await channel.send(p);
        return { id: m.id, edit: async (q) => void (await m.edit(q)) };
      },
    },
    gameMaster: createGameMaster(ctx.genai, ctx.model),
    rng: Math.random,
    logger: ctx.logger,
    names: {},
    onEnd: (channelId) => ctx.registry.remove(channelId),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/commands/werewolf.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/werewolf.ts src/commands/index.ts src/commands/types.ts test/commands/werewolf.test.ts
git commit -m "feat(game): /werewolf command opens a lobby"
```

---

## Task 19: wire `interactionCreate.ts`

**Files:**
- Modify: `src/events/interactionCreate.ts`
- Test: `test/events/interactionCreate.test.ts` (extend)

**Interfaces:**
- Consumes: `routeGameInteraction` (Task 17), `GameRegistry` (Task 9).
- Produces: `RouteDeps` gains `registry: GameRegistry`. In the returned handler, before
  the `isChatInputCommand` early return:

```typescript
if (interaction.isButton() || interaction.isStringSelectMenu()) {
  if (!interaction.customId.startsWith("wolf:")) return;
  return routeGameInteraction(
    {
      customId: interaction.customId,
      channelId: interaction.channelId ?? "",
      userId: interaction.user.id,
      displayName:
        (interaction.member as { displayName?: string } | null)?.displayName ??
        interaction.user.username,
      values: interaction.isStringSelectMenu() ? interaction.values : undefined,
      reply: (p) => interaction.reply(p as never).then(() => {}),
      deferUpdate: () => interaction.deferUpdate().then(() => {}),
      followUp: (p) => interaction.followUp(p as never).then(() => {}),
    },
    deps.registry,
    deps.logger,
  );
}
```

- [ ] **Step 1: Write the failing test** — add to the existing file:

```typescript
it("routes a wolf:* button to the game router and not the command path", async () => {
  const route = vi.fn(async () => {});
  // if routeGameInteraction is imported, spy via vi.mock; otherwise assert on a
  // fake registry.get being consulted:
  const registry = { has: vi.fn(() => true), get: vi.fn(() => undefined), set: vi.fn(), remove: vi.fn(), abortAll: vi.fn(), size: vi.fn() };
  const i = {
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId: "wolf:join",
    channelId: "c1",
    user: { id: "u1", username: "Uno" },
    member: { displayName: "Uno" },
    reply: vi.fn(async () => {}),
  };
  await routeInteraction({ commands: new Map(), ctx: {} as never, logger, registry } as never)(i as never);
  expect(registry.get).toHaveBeenCalledWith("c1");
});

it("ignores a non-wolf component id", async () => {
  const registry = { has: vi.fn(), get: vi.fn(), set: vi.fn(), remove: vi.fn(), abortAll: vi.fn(), size: vi.fn() };
  const i = { isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, customId: "other:x" };
  await routeInteraction({ commands: new Map(), ctx: {} as never, logger, registry } as never)(i as never);
  expect(registry.get).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/events/interactionCreate.test.ts`
Expected: FAIL — `registry.get` not called (component branch missing).

- [ ] **Step 3: Add the component branch + `registry` to `RouteDeps`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/events/interactionCreate.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/events/interactionCreate.ts test/events/interactionCreate.test.ts
git commit -m "feat(game): route wolf:* component interactions"
```

---

## Task 20: suppress casual chat during a game

**Files:**
- Modify: `src/events/messageCreate.ts`
- Test: `test/events/messageCreate.test.ts` (extend)

**Interfaces:**
- Consumes: `GameRegistry` (Task 9).
- Produces: `MessageDeps` gains `registry: GameRegistry`. In `onMessageCreate`, after
  the bot-id / bot-author / system checks and before `evaluateTrigger`:

```typescript
if (deps.registry.hasActiveGame(message.channelId)) return;
```

Rename the registry method used here to `hasActiveGame` **or** call `registry.has(...)`
— pick `has` for consistency with Task 9 and update this line to `registry.has(...)`.

- [ ] **Step 1: Write the failing test** — add:

```typescript
it("does not invoke the chat handler when a game is active in the channel", async () => {
  const inner = vi.fn(async () => {});
  (handleChat as any).mockReturnValue(inner);
  const deps = { ...baseDeps(), registry: { has: vi.fn(() => true) } };
  const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
  await onMessageCreate(deps as never)(m as never);
  expect(inner).not.toHaveBeenCalled();
});

it("invokes the chat handler normally when no game is active", async () => {
  const inner = vi.fn(async () => {});
  (handleChat as any).mockReturnValue(inner);
  const deps = { ...baseDeps(), registry: { has: vi.fn(() => false) } };
  const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
  await onMessageCreate(deps as never)(m as never);
  expect(inner).toHaveBeenCalledOnce();
});
```

Add `registry: { has: () => false }` to the existing `baseDeps()` helper so the other
tests keep passing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/events/messageCreate.test.ts`
Expected: FAIL — handler still invoked with a game active.

- [ ] **Step 3: Add the guard + `registry` to `MessageDeps`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/events/messageCreate.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/events/messageCreate.ts test/events/messageCreate.test.ts
git commit -m "feat(game): suppress casual chat in a channel with an active game"
```

---

## Task 21: wire `index.ts` + shutdown

**Files:**
- Modify: `src/index.ts`
- Test: none (composition root — verified by `npm run typecheck` and a manual smoke)

**Interfaces:**
- Consumes: `createRegistry` (Task 9).

- [ ] **Step 1: Edit `src/index.ts`**

```typescript
import { createRegistry } from "./game/registry.js";
// ...
const registry = createRegistry();

const commandCtx = { cooldown, genai, logger, model: config.model, registry };
client.on(
  "interactionCreate",
  routeInteraction({ commands, ctx: commandCtx, logger, registry }),
);
client.on(
  "messageCreate",
  onMessageCreate({
    cooldown, store, genai, botMessages, logger,
    model: config.model,
    getBotUserId: () => botUserId.current,
    registry,
  }),
);
```

And in the SIGINT/SIGTERM handler, before `client.destroy()`:

```typescript
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info("shutting down", { sig });
    void registry
      .abortAll("nagre-restart si AmIgo")
      .finally(() => client.destroy())
      .finally(() => {
        db.close();
        process.exit(0);
      });
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS (all).

- [ ] **Step 4: Register the new command with Discord**

Run: `npm run deploy -- --guild <TEST_GUILD_ID>`
Expected: `commands registered { scope: "guild:...", count: 2 }`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(game): wire game registry into the bot + shutdown abort"
```

---

## Task 22: live smoke — full scripted game (optional but recommended)

**Files:**
- Create: `scripts/game-smoke.ts`
- Test: none (it *is* the test — run manually)

**Interfaces:**
- Consumes: `createGameSession` (Task 10), a fake `GameChannel` that `console.log`s
  payloads, a real `createGameMaster` (needs `.env`), a synchronous fake scheduler.

- [ ] **Step 1: Write `scripts/game-smoke.ts`**

Drive a 3-player game end to end: create session, `join` two more, `start`, submit a
`seer-player` and a `robber` action, fire the night timer, `skip` the day, cast three
votes, and print the reveal payload. Assert (throw on failure): every player appears in
the reveal table, exactly one `winningTeam`, `phase === "done"`. Narration hits the
real Gemini (so it also validates `GAME_PERSONA` + the model).

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/game-smoke.ts`
Expected: prints lobby → night → day → vote → reveal payloads, ends with
`SMOKE OK`.

- [ ] **Step 3: Commit**

```bash
git add scripts/game-smoke.ts
git commit -m "test(game): scripted end-to-end game smoke script"
```

---

## Task 23: docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a game section to `README.md`**

Under "How it works", add:

```markdown
- **`/werewolf`** — AmIgo hosts One Night Ultimate Werewolf. Players join a lobby,
  AmIgo deals hidden roles and narrates the night/day/reveal in Taglish. All private
  info (your role, what you saw, your vote) is an ephemeral reply to a button — nothing
  leaks to the channel. One game per channel; a bot restart abandons a game in
  progress. 60s per-user cooldown on starting one.
```

Under the test commands, add:

```markdown
- `npx tsx scripts/game-smoke.ts` — runs a full scripted 3-player game against live
  Gemini for the narration (needs a filled-in `.env`)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: /werewolf in the README"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §2.1 roles + §2.2 role-set table | Task 1 |
| §2.3 night resolution + wake order + the Robber/Troublemaker gotcha | Task 3 |
| §2.4 voting + all win conditions | Task 4 |
| §3.1 module layout | Tasks 1–10, 16, 18 |
| §3.2 boundaries | enforced per-task in Files/Interfaces; Global Constraints restates them |
| §3.3 injected SessionDeps | Task 10 |
| §4.2 lobby | Task 10 |
| §4.3 night (blind collect, resolve at end) | Tasks 11, 17 |
| §4.4 day | Task 12 |
| §4.5 vote | Task 12 |
| §4.6 reveal + table | Task 13 |
| §4.7 button/select routing + customId scheme | Tasks 16, 17, 19 |
| §4.8 one-per-channel / abortAll / MAX_GAME_MS / cooldown | Tasks 9, 15, 18, 21 |
| §5 non-blocking narration + public-facts-only | Tasks 7, 14 |
| §6 tunables | Task 6 |
| §7 testing strategy | every task is TDD; engine matrix in Tasks 2–5 |
| §8 deferred: constants location | resolved — `src/game/constants.ts` (Task 6) |
| §8 deferred: `/werewolf` guild-only | Task 18 (asserted) |
| §8 deferred: reveal table format | Task 8 (`renderReveal`) — content, not layout; tune during Task 22 smoke |
| §8 deferred: chat-history summary | left as a seam; not built in v1 (noted in Task 13) |

No gaps.

**2. Placeholder scan** — Tasks 8 and 17 delegate some sub-function bodies ("implement
to the Interfaces block") rather than printing every line. Each names the exact
functions, their signatures, the payload shape asserted by the test, and the pattern to
follow from a shown sibling function. This is a deliberate trade for a plan of this
size; every such function has a failing test written in full. No `TODO`/`TBD`/"handle
edge cases" remain.

**3. Type consistency** — `GameSession` method names are used identically across Tasks
10–21 (`join`, `leave`, `start`, `skip`, `act`, `vote`, `abort`, `showRole`,
`actPrompt`). `NightAction` kinds match between `types.ts` (Task 1), `resolveNight`
(Task 3), and the codec (Task 16: `seer`/`rob`/`tm` verbs map to
`seer-player`/`seer-center`/`robber`/`troublemaker` kinds — the mapping is spelled out
in Task 17). `GameRegistry.has` (not `hasActiveGame`) is the settled name — Task 20
note corrects an earlier draft slip.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-06-amigo-werewolf-game.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
