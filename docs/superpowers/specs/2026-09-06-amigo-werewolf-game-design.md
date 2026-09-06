# AmIgo Bot — Feature 3: AI-Moderated One Night Werewolf

**Date:** 2026-09-06
**Status:** Approved design, pre-implementation
**Scope:** The third planned AmIgo feature — a social-deduction game where AmIgo is the
game master (deals roles, narrates phases, tallies votes, calls the winner). Not an
AI player.
**Builds on:** `docs/superpowers/specs/2026-09-05-amigo-bot-core-design.md` (core bot,
`/roast`, casual chat). Game state stays ephemeral per the core spec's locked decision.

---

## 1. Goals & context

The core spec deferred this feature with only its shape locked: **AI-as-moderator**,
**ephemeral game state**, single-process VPS bot, Gemini via `@google/genai`.

This spec picks the game and designs the subsystem.

### Decisions locked during brainstorming (2026-09-06)

| Question | Decision |
|---|---|
| Which game | **One Night Ultimate Werewolf** (ONUW) — one night, one day, one vote, ~10 min, no elimination loop. Simplest state machine of the candidates. |
| Private info delivery | **Ephemeral button replies** in the game channel. No DMs (they break for anyone with server-member DMs off), no per-player threads. |
| Phase pacing | **Fixed timers + host skip.** Autonomous by default; the host may `Skip` to advance early. |
| Role set | **Curated fixed set**, auto-selected by player count. No Doppelgänger, no Hunter in v1. |
| Restart behaviour | **Best-effort abort message** on shutdown. No persistence. Games are short; blast radius is small. |
| Casual chat during a game | **Suppressed** in a channel with an active game. `/roast` unaffected. |
| Game-master voice | **One `GAME_PERSONA`** — AmIgo, emcee mode: dramatic Taglish narration, same humor. |
| Loop architecture | **Timer-driven `GameSession` + pure `engine.ts`.** Rules (dealing, night resolution, tally, win) are pure functions; the session orchestrates Discord I/O, timers, and narration. |

### Non-goals for v1

- Doppelgänger, Hunter, Drunk roles (complex triggers / "become another role").
- DM-based play.
- Persisting game state across restarts.
- Configurable role bags chosen by the host.
- Multiple simultaneous games in the *same* channel.
- Preventing out-of-band cheating (screenshots of ephemerals, side DMs). The bot
  cannot detect this and the AI will not police it.
- Spectator mode, stats/leaderboards, replays.

---

## 2. Game rules as implemented (ONUW v1)

### 2.1 Roles

Pool (v1). Every game always contains exactly **2 Werewolf** cards.

| Role | Team | Night action |
|---|---|---|
| Werewolf ×2 | werewolf | Sees the other werewolf. A lone werewolf (other WW in center) may peek 1 center card. |
| Minion | werewolf | Sees who the werewolves are. Werewolves do **not** see the Minion. |
| Mason ×2 | village | See each other. |
| Seer | village | Peek 1 other player's card **or** 2 of the 3 center cards. |
| Robber | village | Swap own card with another player's, then see the new card (now that role). |
| Troublemaker | village | Swap two *other* players' cards without looking. |
| Insomniac | village | At end of night, see own (possibly changed) card. |
| Villager | village | None. |
| Tanner | tanner | None. Wins **only** if voted out. |

### 2.2 Role-set selection by player count

`cards = players + 3`. Selection order after the mandatory 2 Werewolf:
`Seer, Robber, Troublemaker` → then `Minion` (≥5 players) → `Insomniac` (≥6) →
`Mason, Mason` (≥7) → `Tanner` (≥8) → remaining slots filled with `Villager`.

| Players | Cards | Set |
|---|---|---|
| 3 | 6 | WW, WW, Seer, Robber, Troublemaker, Villager |
| 4 | 7 | + Villager |
| 5 | 8 | + Minion |
| 6 | 9 | + Insomniac |
| 7 | 10 | + Mason, Mason (drop 1 Villager to stay at cards = players+3) |
| 8 | 11 | + Tanner |
| 9 | 12 | + Villager |
| 10 | 13 | + Villager |

The exact table lives in `roles.ts` as data and is asserted in tests (always
`players + 3` cards, always exactly 2 werewolves, pool-only).

### 2.3 Night resolution — canonical wake order

`resolveNight` walks this order and, at each step, records **what that player sees
at the moment they wake** (using swaps applied so far) and then applies their own
swap:

1. **Werewolves** — see each other; lone wolf's optional center peek.
2. **Minion** — sees the werewolves (by starting role).
3. **Masons** — see each other.
4. **Seer** — peek 1 player or 2 center cards. No swap.
5. **Robber** — swap self ↔ target; sees the acquired card.
6. **Troublemaker** — swap two other players. Sees nothing.
7. **Insomniac** — sees own card in `currentRoles` after all the above.

Villager and Tanner never wake.

**The ONUW gotcha the engine must get right:** if the Robber swaps with Dana and then
the Troublemaker swaps Dana ↔ Eli, the Robber was *told* they are now whatever Dana's
card was at step 5, but `currentRoles` after step 6 has moved that card again. The
Robber's reported result is frozen at their wake moment; `currentRoles` is the final
truth used for the win check. Same principle for the Seer (saw an earlier board) and
Insomniac (sees the final board).

**Deliberate simplification vs. tabletop:** night actions are collected *blind* during
the night window (each acting player submits their choice through an ephemeral menu
without seeing a result). All actions resolve once when the night ends; each acting
player's result is then delivered privately — the `My Role` button switches to showing
"what you learned." This removes every action-ordering race (players acting in parallel)
and reduces mid-night metagaming. The cost: a Robber learns their new role at the start
of day rather than instantly.

### 2.4 Voting & win conditions

- **Vote:** every player picks one target through an ephemeral menu; changeable until
  the deadline. Non-voters abstain (no vote recorded).
- **Deaths (`tallyVotes`):** the player(s) with the most votes die. A tie kills all
  tied players. Special ONUW rule: if every player received exactly one vote, **no one
  dies**.
- **Win (`decideWinner`)**, evaluated on `currentRoles` and the death set:
  - At least one Werewolf (by `currentRoles`) died → **village team wins**.
  - No Werewolf died, and ≥1 Werewolf is in play → **werewolf team wins**.
  - No Werewolf is in play at all: village wins **only if nobody died**; otherwise
    werewolves "win" (nobody on village to catch).
  - **Tanner** (by `currentRoles`) died → **Tanner wins**. Werewolves do **not** win
    in this case; village wins *only* if a Werewolf also died.

---

## 3. Architecture

### 3.1 Module layout

```
src/game/
  types.ts       Role, Team, Phase, GameState, NightAction, VoteMap, PlayerView, Outcome
  roles.ts       role catalog (team, acts?, wake index) + selectRoleSet(count)
  engine.ts      PURE: pickRoleSet · deal · resolveNight · tallyVotes · decideWinner · playerView
  lobby.ts       PURE-ish: addPlayer · removePlayer · canStart — operates on a lobby record
  session.ts     GameSession — phase, deadline, timer, pending inputs; orchestrates
  registry.ts    Map<channelId, GameSession>; hasActiveGame · get · set · remove · abortAll
  render.ts      state → Discord message payloads (embeds + button/select rows); no I/O
  buttons.ts     customId encode/decode + routeGameInteraction(interaction, registry)
  constants.ts   game-local tunables (see §6) — or fold into src/constants.ts

src/ai/
  gameMaster.ts  GAME_PERSONA + narrateNight/narrateDay/narrateReveal; ok/blocked + throws
                 contract identical to conversation.ts; public facts only

src/events/
  interactionCreate.ts  EXTENDED — also route isButton()/isStringSelectMenu() "wolf:*"
  messageCreate.ts      EXTENDED — skip chat handler when registry.hasActiveGame(channelId)

src/commands/
  werewolf.ts    /werewolf slash command — opens a lobby
```

### 3.2 Boundaries (consistent with `amigo-bot-conventions`)

- `game/engine.ts`, `game/roles.ts`, `game/types.ts`, `game/lobby.ts` — **pure**. No
  `discord.js`, no `@google/genai`, no `src/store/`. Deterministic given an injected `rng`.
- `game/render.ts` — imports `discord.js` *types* to shape payloads; performs no I/O.
- `game/session.ts` — the only game module that touches the gateway or calls `ai/`.
  Receives all I/O and time as injected deps.
- `ai/gameMaster.ts` — no `discord.js`. Mirrors the AI error contract
  (`RateLimitError` / `AiUnavailableError` / `AiClientError`, one retry on 5xx).
- `game/registry.ts` — in-memory only. Never imports `src/store/`.

### 3.3 GameSession dependencies (injected)

```ts
interface SessionDeps {
  now(): number;
  setTimer(ms: number, fn: () => void): TimerHandle;
  clearTimer(h: TimerHandle): void;
  channel: {                        // the narrow slice of a discord.js text channel we use
    send(payload): Promise<{ id: string; edit(payload): Promise<void> }>;
  };
  gameMaster: GameMaster;           // ai/gameMaster.ts
  rng(): number;
  logger: Logger;
  onEnd(channelId: string): void;   // registry.remove
}
```

Real implementation wraps `setTimeout` / `clearTimeout`. Tests pass a fake scheduler
that advances on command, a fake channel that records payloads, and a stubbed
`gameMaster`.

---

## 4. Flow

### 4.1 Phases

`lobby → night → day → vote → reveal → done`

Each transition:
1. Resolve the ending phase in the engine (if any).
2. Post the **mechanical message immediately** (instructions + buttons + visible timer).
3. Fire the narration call in parallel (§5); edit the message when it returns.
4. Arm the next timer (or, for `reveal`, call `onEnd`).

A phase also ends early when **all required inputs are in** (all acting players
submitted / all players voted) or the **host presses Skip**.

### 4.2 Lobby

- `/werewolf` in a channel with no active game → create session in `lobby`, register it,
  post the lobby message: embed (title, "3–10 players", roster) + `[Join] [Leave]`;
  the starter (host) additionally sees `[Start]` (disabled < 3) and `[Cancel]`.
- `[Join]` / `[Leave]` mutate the roster via `lobby.ts` and edit the message in place.
- `LOBBY_TIMEOUT_MS` with no start → auto-cancel ("walang naglaro, sayang").
- `[Start]` → `pickRoleSet(count, rng)` → `deal` → transition to `night`.
- `/werewolf` while a game exists → ephemeral "may laro na dito."

### 4.3 Night

Mechanical message: `[🔍 My Role] [🎭 Act]` + host `[⏭ Skip]`, `NIGHT_MS` timer.

- `[🔍 My Role]` — ephemeral, available all game: your **starting** role + description.
  After night resolves it also shows "what you learned."
- `[🎭 Act]` — ephemeral, branch on starting role:
  - Villager / Tanner → "wala kang gagawin, matulog ka na."
  - Werewolf / Minion / Mason → shows what they see (recorded as a no-op action so the
    "all acted" check is satisfied).
  - Seer → select "peek a player" or "peek 2 center" → records `NightAction`.
  - Robber → select a player → records `NightAction`.
  - Troublemaker → select two players → records `NightAction`.
- Ends on timer / host-skip / all acting players submitted → `resolveNight` →
  store `currentRoles` + per-player results → `day`.

### 4.4 Day

Flavor recap + "discussion, ~`DAY_MS`, then vote." `[🔍 My Role]` stays. Host `[⏭ Skip]`.
Players talk in-channel (casual chat suppressed). Ends on timer / host-skip → `vote`.

### 4.5 Vote

Mechanical message: `[🗳 Vote]` + `VOTE_MS` timer. `[🗳 Vote]` → ephemeral player
select; re-voting overwrites until the deadline. Ends on timer / all voted →
`tallyVotes` → `reveal`.

### 4.6 Reveal

`decideWinner` → post: dramatic reveal narration + a table of every player's
**dealt → final** role, the 3 center cards, who died, and the winning team.
`onEnd(channelId)` removes the session.

*Optional nice-to-have (flag in plan, not required):* append a one-line summary to the
chat-history store (`AmIgo: [game] werewolves won, si Dana ang nakain`) so casual chat
can reference it later.

### 4.7 Button / select routing

customId scheme: `wolf:<verb>[:<arg>...]` — `wolf:join`, `wolf:leave`, `wolf:start`,
`wolf:cancel`, `wolf:role`, `wolf:act`, `wolf:seer:<mode>`, `wolf:rob:<id>`,
`wolf:tm:<id>:<id>`, `wolf:vote:<id>`, `wolf:skip`.

`interactionCreate.ts` — after the existing chat-command check:
```
if ((interaction.isButton() || interaction.isStringSelectMenu())
    && interaction.customId.startsWith("wolf:")) {
  return routeGameInteraction(interaction, registry);
}
```
`routeGameInteraction` looks up `registry.get(interaction.channelId)`:
- no session → ephemeral "walang laro dito."
- else `deferUpdate()` / ephemeral-ack immediately, then dispatch to a session method,
  guarding: correct phase, interaction user is a player (or host for `skip`/`cancel`/
  `start`), input not already locked. Duplicate `(phase, userId, verb)` → ignored.

### 4.8 Concurrency, restart, safety

- **One game per channel**, keyed by `channelId`. Other channels independent.
- **`registry.abortAll()`** wired into the existing SIGTERM/SIGINT shutdown path in
  `index.ts`: for each session clear the timer, best-effort `channel.send` an abort
  line, then clear the map. Startup registry is empty.
- **`MAX_GAME_MS`** — a session whose age exceeds this is force-aborted at the next
  transition (and by a periodic sweep), so a bug can't wedge a channel permanently.
- **`/werewolf` per-user cooldown** via the existing `cooldown` lib
  (`WEREWOLF_COOLDOWN_MS`), plus one-lobby-per-channel and the lobby timeout.

---

## 5. AI narration

`ai/gameMaster.ts` exposes:

```ts
narrateNight(facts): Promise<Narration>
narrateDay(facts): Promise<Narration>
narrateReveal(facts): Promise<Narration>
type Narration = { ok: true; text: string } | { ok: false };
```

- `GAME_PERSONA` — AmIgo, emcee mode: dramatic Taglish narrator, 2–4 sentences,
  explicitly instructed **never to invent roles, accuse players, or reveal hidden
  information**, and to narrate only the facts given.
- `facts` are **strictly public**: phase, player display names, player count, center
  count, the death set (reveal only), the winning team (reveal only). No roles, no
  night actions, no votes are ever passed before `reveal`.
- Non-streaming `generateContent`, short `maxOutputTokens`, `thinkingLevel` LOW,
  same safety settings and error classification as `conversation.ts` (one retry on 5xx;
  `AiClientError` / `RateLimitError` propagate).

**The game never blocks on or breaks from narration:**
- The mechanical message is posted first and is fully playable on its own.
- Narration runs in parallel with a `NARRATION_TIMEOUT_MS` (~8s; ~10s for reveal). On
  success the message is edited to prepend AmIgo's text. On failure/timeout the
  mechanical message stands with a tiny canned fallback line, and the failure is logged
  (no message text, per the logging rules).

---

## 6. Tunables

Added to `src/constants.ts` (or `src/game/constants.ts`):

| Constant | Value (initial) | Meaning |
|---|---|---|
| `WEREWOLF_MIN_PLAYERS` | 3 | Start gate. |
| `WEREWOLF_MAX_PLAYERS` | 10 | Join gate. |
| `LOBBY_TIMEOUT_MS` | 180_000 | No-start auto-cancel. |
| `NIGHT_MS` | 90_000 | Night action window. |
| `DAY_MS` | 270_000 | Day discussion. |
| `VOTE_MS` | 45_000 | Vote window. |
| `MAX_GAME_MS` | 1_200_000 | Force-abort a wedged session. |
| `NARRATION_TIMEOUT_MS` | 8_000 | Per-beat narration cap. |
| `WEREWOLF_COOLDOWN_MS` | 60_000 | Per-user `/werewolf` cooldown. |

Timer values are first guesses; tune after a live playtest.

---

## 7. Testing strategy

### 7.1 Pure engine (`engine.ts`, `roles.ts`, `lobby.ts`) — the bulk

Vitest, seeded `rng`.

- **`selectRoleSet` / `pickRoleSet`** — for every count 3–10: exactly `count + 3`
  cards, exactly 2 werewolves, every card from the pool; deterministic under a seed.
- **`deal`** — all player + 3 center slots assigned; dealt multiset equals the role set.
- **`resolveNight`** — matrix:
  - no actions → `currentRoles` deep-equals `startingRoles`.
  - robber swap → roles exchanged in `currentRoles`; robber's reported result is the
    target's pre-swap card.
  - troublemaker swap → the two targets exchanged.
  - **robber then troublemaker moves the robber's acquired card** → robber's reported
    result frozen at wake moment; `currentRoles` reflects the later swap.
  - seer peek player / peek 2 center → correct card(s) reported; no state change.
  - werewolf sees the other werewolf; lone werewolf's center peek.
  - minion sees werewolves (by starting role); masons see each other.
  - insomniac sees the final own card (e.g. robbed from → reports "werewolf").
- **`tallyVotes`** — clear plurality; tie → all tied die; everyone-one-vote → no death.
- **`decideWinner`** — werewolf dies → village; no werewolf dies (≥1 in play) →
  werewolves; no werewolf in play, no death → village; no werewolf in play, a death →
  werewolves; tanner dies → tanner; tanner dies + a werewolf also dies → village.
- **`playerView`** — pre-reveal never contains another player's role; post-night
  contains this player's own results; reveal contains the full table.
- **`lobby`** — add/remove idempotency; `canStart` false below `WEREWOLF_MIN_PLAYERS`;
  join blocked at `WEREWOLF_MAX_PLAYERS`.

### 7.2 Session (`session.ts`) — fake scheduler, fake channel, stub gameMaster

- lobby: join/leave update roster message; start blocked < min; lobby timeout cancels
  and unregisters.
- progression: `night→day→vote→reveal` each fire on timer; host `skip` advances early;
  all-acted / all-voted ends the phase before the timer.
- night: non-acting role gets the "sleep" ephemeral; acting role's submission recorded;
  wrong-phase or non-player interaction rejected; duplicate submission ignored.
- vote: re-vote overwrites; non-voter abstains; tally drives the reveal.
- reveal: table payload posted; `onEnd` called; session removed from registry.
- **narration failure** (stub throws / returns `{ok:false}`) → mechanical message still
  posted, fallback line present, phase still advances.
- `abortAll` → timers cleared, abort line sent, registry emptied.
- `MAX_GAME_MS` → force-abort at the next transition.

### 7.3 Routing & integration

- **`buttons.ts`** — customId encode/decode round-trips for every verb; unknown or
  non-`wolf:` customId ignored; no-session → ephemeral notice.
- **`interactionCreate.ts`** — a `wolf:*` button routes to the game router and not the
  command path; existing command routing unchanged.
- **`messageCreate.ts`** — `hasActiveGame` true → chat handler not invoked; false →
  behaviour unchanged.
- **Optional integration smoke** (mirrors `scripts/smoke.ts`, not a unit test): drive a
  full scripted 3-player game through the real engine + a fake channel and assert a
  coherent reveal (roles consistent, exactly one winning team, table complete).

### 7.4 Conventions

TDD throughout (red → green → commit). SQLite is untouched by this feature. No logging
of message text, prompts, roles, or votes.

---

## 8. Deferred to the implementation plan

- Game constants location: `src/constants.ts` vs. a new `src/game/constants.ts`
  (leaning new file — this feature roughly doubles the tunable count).
- Reveal table formatting: embed fields vs. a monospace block (mobile width).
- `/werewolf` guild-only (no DM context) — assert it.
- Whether to build the §4.6 optional chat-history summary in v1 or leave a seam for it.
- Task ordering. The natural build order is: types + roles → engine (pure, heavily
  tested) → lobby → render → gameMaster → session (fake deps) → buttons/routing →
  event wiring + `/werewolf` command → shutdown hook → optional integration smoke.
  This is a large plan; it may be split into "engine + session core" and "Discord
  wiring" sub-plans if it runs long.
