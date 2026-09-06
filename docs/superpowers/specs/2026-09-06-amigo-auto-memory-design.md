# AmIgo Bot — Auto-Memory (background fact distillation)

**Date:** 2026-09-06
**Status:** Approved design, pre-implementation
**Scope:** A background subsystem that watches channel conversations and, when one
settles, distils it into a short list of durable notes stored alongside the manual
`/remember` facts. Those notes are already folded into every chat reply by the
existing `withFacts` mechanism.
**Builds on:** the persistent-facts feature (`src/store/facts.ts`, `/remember`,
`/facts`, and `ReplyParams.facts` in `src/ai/conversation.ts`).
**Companion (separate spec, later):** proactive presence (reactions + opt-in
chime-in). This spec designs the shared background scheduler and activity tracker
so that feature can reuse them.

---

## 1. Goals & context

`/remember` is manual. Casual chat only sees the last ~16 turns (30 retained), and
everything else is forgotten on the next message and on restart. Auto-memory closes
that gap: the bot quietly keeps a running list of what's going on in a channel —
ongoing situations, plans, facts about the regulars, running jokes — and carries it
into every reply.

### Decisions locked during brainstorming (2026-09-06)

| Question | Decision |
|---|---|
| Background scheduling | **One polling ticker** (`setInterval`, ~2 min) in the composition root, driven by an in-memory per-channel activity tracker fed from `onMessageCreate`. Serves every "did something / did nothing happen" trigger both this feature and proactive presence need. |
| Distillation trigger | **When a conversation settles** — a channel that had ≥ `MIN_MSGS_FOR_DISTILL` new messages and has since been quiet ≥ `MEMORY_SETTLE_MS`. |
| Stale/contradictory facts | **Rewrite the whole auto-fact set each pass.** The distiller receives the current auto notes + the recent transcript and returns the new full list (keep / revise / drop / add). |
| Scope | **Channel-only** for v1. No per-guild auto-facts (needs cross-channel reading — a separate privacy question). |
| Fact populations | `source` column on `facts`: `'user'` (from `/remember`) and `'auto'` (distilled). Separate caps; auto notes never consume the `/remember` budget. |
| Opt-out toggle | **Not in v1.** Auto-memory is on everywhere. Control is via `/facts` (view + delete individual, `wipe:true` to clear all auto notes). A persisted per-channel on/off lands with proactive presence, which needs a `channel_settings` table anyway. |
| Self-tuning | Out of scope (that was a proactive-presence question). |

### Non-goals for this spec

- Proactive messages or reactions (companion spec).
- A `channel_settings` table / per-channel auto-memory on/off.
- Per-guild or per-user auto-facts.
- Retrying a failed distillation, or any user-facing signal that distillation ran or failed.
- Summarising on a fixed clock or every-N-messages (settle-based only).

---

## 2. Data model

Migration #3:

```sql
ALTER TABLE facts ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
```

- `source = 'user'` — created by `/remember`. `created_by` is the user's id.
- `source = 'auto'` — created by the distiller. `created_by = 'amigo'`.

The existing `idx_facts_scope (scope, scope_id, id)` index still covers the common
reads. No new index — the `source` filters run over already-small per-scope sets.

Caps:

| | `source='user'` | `source='auto'` |
|---|---|---|
| Cap | `MAX_FACTS_PER_SCOPE` (40) | `MAX_AUTO_FACTS` (12) |
| Enforced by | `FactStore.add` (counts only `'user'` rows) | `FactStore.replaceAuto` (slices the incoming list) |

---

## 3. Architecture

### 3.1 Module layout

```
src/lib/activity.ts        createActivityTracker() — in-memory per-channel state.
                           SHARED: proactive presence will consume this too.
src/ai/distill.ts           createDistiller(genai, model) — the "update the notes" call.
                           Pure AI module: imports @google/genai + ./errors only.
src/memory/autoMemory.ts    createAutoMemory(deps) — the orchestrator + the ticker loop.
```

Modified:

- `src/store/facts.ts` — `source` on `Fact`; `add` gains a `source` param and a
  source-aware cap; `count` gains an optional `source`; new `replaceAuto`.
- `src/store/db.ts` — migration #3.
- `src/events/messageCreate.ts` — call `deps.autoMemory.note(channelId)` for every
  non-bot, non-system human message, before the trigger check.
- `src/commands/facts.ts` — tag auto rows in the listing; add `wipe:<bool>`.
- `src/commands/remember.ts` — copy tweak on the "full" message.
- `src/ai/conversation.ts` — `withFacts` caps the injected auto notes at `MAX_AUTO_FACTS`.
- `src/index.ts` — construct `activity`, `distiller`, `autoMemory`; pass `autoMemory`
  into the messageCreate deps; `autoMemory.start()` after login; `autoMemory.stop()`
  in the SIGINT/SIGTERM handler.
- `src/constants.ts` — tunables (§6).

### 3.2 Boundaries

- `src/ai/distill.ts` — no `discord.js`, no `src/store/`. Mirrors `src/ai/gameMaster.ts`:
  returns `{ ok } | { ok: false }`, but a thrown API error is allowed to propagate
  (the orchestrator swallows it). One `~500ms` retry on 5xx via `classifyAiError`.
- `src/lib/activity.ts` — pure, in-memory, injected `now()`. No imports beyond types.
- `src/memory/autoMemory.ts` — the orchestration seam. May touch `store/`, `ai/`,
  `lib/`, `logger`. All timing and I/O injected via `deps`. No direct `discord.js`.
- `src/store/facts.ts` stays SQLite-only.

### 3.3 `ChannelActivity` (`src/lib/activity.ts`)

```ts
export interface ChannelActivity {
  /** A human message landed in this channel. */
  note(channelId: string): void;
  /** Channels whose conversation has wrapped and is worth distilling. */
  settled(): { channelId: string; msgCount: number }[];
  /** Reset the counter + stamp the time, so this burst isn't re-distilled. */
  markDistilled(channelId: string): void;
}

export function createActivityTracker(now?: () => number): ChannelActivity;
```

Per-channel state: `{ lastMsgAt: number; msgsSinceDistill: number; lastDistillAt: number }`.

- `note(id)` — `lastMsgAt = now(); msgsSinceDistill++`.
- `settled()` — every channel where
  `now() - lastMsgAt >= MEMORY_SETTLE_MS` **and** `msgsSinceDistill >= MIN_MSGS_FOR_DISTILL`.
  Returns `{ channelId, msgCount: msgsSinceDistill }`. While walking, prune entries with
  `msgsSinceDistill === 0 && now() - lastMsgAt > 24h` so the map can't grow unbounded.
- `markDistilled(id)` — `msgsSinceDistill = 0; lastDistillAt = now()`. After this the
  channel fails the `>= MIN_MSGS_FOR_DISTILL` check until fresh activity accumulates.

### 3.4 `Distiller` (`src/ai/distill.ts`)

```ts
export type Distilled = { ok: true; notes: string[] } | { ok: false };

export interface Distiller {
  distill(args: { existing: string[]; transcript: string }): Promise<Distilled>;
}

export function createDistiller(genai: GoogleGenAI, model: string): Distiller;
```

Prompt (English — a system task, not AmIgo's voice):

> You maintain a short list of durable notes about a Discord channel — ongoing
> situations, plans, facts about the regulars, running jokes. Not one-off chatter or
> anything that will be irrelevant tomorrow.
>
> Current notes:
> {existing joined by "\n", or "(none)"}
>
> Recent conversation:
> {transcript}
>
> Return the UPDATED full list of notes: keep what is still true, revise what changed,
> drop what is stale or contradicted, add anything new and durable. One note per line,
> at most {MAX_AUTO_FACTS} lines, each under {MAX_FACT_CHARS} characters. If there is
> nothing worth keeping, return exactly: NONE

- Non-streaming `genai.models.generateContent`, `systemInstruction` = a one-line role
  ("You distil Discord channels into durable notes."), `safetySettings` = `SAFETY_SETTINGS`,
  `temperature: 0.4`, `maxOutputTokens: 500`, `thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }`,
  `httpOptions: { timeout: AI_TIMEOUT_MS }`.
- One `~500ms` retry when `classifyAiError` says `"unavailable"`; `rate_limit` /
  `client_error` / anything else → throw (the orchestrator's `catch` handles it).
- Parsing `res.text`:
  - trimmed to `""` or `/^none$/i` → `{ ok: true, notes: [] }` (this *clears* the auto set).
  - otherwise: split on `\n`, strip leading `-`, `*`, `•`, `N.` / `N)` markers, `trim`,
    drop empties, dedupe (case-insensitive), clamp each to `MAX_FACT_CHARS`, take the
    first `MAX_AUTO_FACTS` → `{ ok: true, notes }`.
- `{ ok: false }` is returned only if the API resolves with no text — treated by the
  orchestrator as "no change", **not** as "clear".

### 3.5 Transcript format

`format(rows: MessageRow[]): string` — `rows` from `store.recent(channelId, DISTILL_TRANSCRIPT_TURNS)`:

- `role: "user"` rows are already stored as `"Dana: <text>"` (the chat handler prepends
  the display name) → emit verbatim.
- `role: "model"` rows are AmIgo's replies → emit as `"AmIgo: <text>"`.
- Join with `\n`. If there are no rows, `run()` returns early without calling the distiller.

### 3.6 `AutoMemory` (`src/memory/autoMemory.ts`)

```ts
export interface AutoMemoryDeps {
  activity: ChannelActivity;
  store: MessageStore;
  facts: FactStore;
  distiller: Distiller;
  logger: Logger;
  setInterval(fn: () => void, ms: number): AutoMemoryTimer;
  clearInterval(t: AutoMemoryTimer): void;
}

export interface AutoMemory {
  note(channelId: string): void;   // -> activity.note; called from messageCreate
  start(): void;                    // arm the interval
  stop(): void;                     // clear it (shutdown)
  tick(): Promise<void>;            // one pass; also what the interval calls
}

export function createAutoMemory(deps: AutoMemoryDeps): AutoMemory;
```

`type AutoMemoryTimer = unknown` (fake in tests, `NodeJS.Timeout` in prod — same pattern
as the game's `TimerHandle`).

`tick()`:
1. `for (const { channelId } of deps.activity.settled())`:
2. `if (inFlight.has(channelId)) continue;`
3. `deps.activity.markDistilled(channelId);` — synchronously, before the async work, so
   the next tick won't re-select this channel while `run` is in progress.
4. `inFlight.add(channelId); void this.run(channelId);`

`run(channelId)`:
- `const rows = deps.store.recent(channelId, DISTILL_TRANSCRIPT_TURNS);`
- `if (rows.length === 0) { inFlight.delete(channelId); return; }`
- `const existing = deps.facts.list("channel", channelId).filter(f => f.source === "auto").map(f => f.content);`
- `try`
  - `const res = await deps.distiller.distill({ existing, transcript: format(rows) });`
  - `if (res.ok) deps.facts.replaceAuto("channel", channelId, res.notes);`
- `catch (err)` → `deps.logger.warn("auto-memory distill failed", { channelId, name: <err.name|"unknown"> });`
- `finally` → `inFlight.delete(channelId);`

`start()` → `this.timer = deps.setInterval(() => void this.tick(), MEMORY_TICK_MS);`
`stop()` → `if (this.timer !== undefined) deps.clearInterval(this.timer);`

### 3.7 Wiring (`src/index.ts`)

```ts
const activity = createActivityTracker();
const distiller = createDistiller(genai, config.model);
const autoMemory = createAutoMemory({
  activity, store, facts, distiller, logger,
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (t) => clearInterval(t as ReturnType<typeof setInterval>),
});

// messageCreate deps gain: autoMemory
// after client.login(...) resolves (or in the "ready" handler): autoMemory.start();
// in the SIGINT/SIGTERM handler, before client.destroy(): autoMemory.stop();
```

`src/events/messageCreate.ts` — near the top of `onMessageCreate`, after
`if (message.author.bot || message.system) return;` and before the game-suppression
check:

```ts
deps.autoMemory.note(message.channelId);
```

(So it tracks activity even in channels with an active game or where chat is otherwise
suppressed — the memory of what happened is still worth keeping.)

---

## 4. `FactStore` changes (`src/store/facts.ts`)

```ts
export type FactSource = "user" | "auto";

export interface Fact {
  id: number;
  scope: FactScope;
  scopeId: string;
  content: string;
  source: FactSource;
  createdBy: string;
  createdAt: number;
}

export interface FactStore {
  add(
    scope: FactScope, scopeId: string, content: string, createdBy: string,
    source?: FactSource,   // default "user"
  ): Fact | null;
  list(scope: FactScope, scopeId: string): Fact[];
  forChat(channelId: string, guildId: string | null): { channel: Fact[]; guild: Fact[] };
  remove(id: number): boolean;
  count(scope: FactScope, scopeId: string, source?: FactSource): number;
  /** Replace this scope's auto notes with `contents` (capped at MAX_AUTO_FACTS). */
  replaceAuto(scope: FactScope, scopeId: string, contents: string[]): void;
}
```

- `add(..., source = "user")` — when `source === "user"`, the cap check is
  `count(scope, scopeId, "user") >= MAX_FACTS_PER_SCOPE`. (`add` with `source: "auto"`
  is never called directly — `replaceAuto` does the auto inserts.)
- `count(scope, scopeId, source?)` — `source` omitted → all rows.
- `replaceAuto` — `db.transaction(() => { deleteAuto.run(scope, scopeId); for (const c of contents.slice(0, MAX_AUTO_FACTS)) insert.run(scope, scopeId, c, "amigo", "auto", now()); })`.
  An empty `contents` just clears the auto rows.
- `list` / `forChat` — unchanged behaviour; every returned `Fact` now carries `source`.

---

## 5. Command changes

### 5.1 `/facts`

- Listing: one numbered list in `id` order (so `forget:N` still indexes correctly).
  Auto rows get an inline tag: `` `3. Dana's taking the bar in Nov  ·picked up` ``.
- New boolean option `wipe` — `wipe:true` → `ctx.facts.replaceAuto(scope, scopeId, [])`
  (clears **auto** notes only; user notes untouched); ephemeral confirmation. Ignored
  if combined with `forget` (forget wins) or reported as "nothing to wipe" when there
  are no auto notes.

### 5.2 `/remember`

- The "scope full" message clarifies it's the user's own notes:
  `"puno na ang notes mo dito (40 max) — burahin mo muna 'yung iba sa /facts"`.
  (Auto notes are separate and unaffected.)

### 5.3 `withFacts` (`src/ai/conversation.ts`)

- Currently injects all channel + guild facts. Change: inject all `user` facts, plus at
  most `MAX_AUTO_FACTS` `auto` facts (channel scope), guild `user` facts as today. Keeps
  the "Long-term notes" block bounded (~50 short lines worst case). No visible
  user/auto distinction in the prompt.

---

## 6. Tunables (`src/constants.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `MEMORY_TICK_MS` | `120_000` | How often the ticker polls for settled channels. |
| `MEMORY_SETTLE_MS` | `600_000` | Quiet-for-this-long ⇒ the conversation has wrapped. |
| `MIN_MSGS_FOR_DISTILL` | `12` | Don't distil a handful of messages. |
| `DISTILL_TRANSCRIPT_TURNS` | `30` | How much history the distiller sees. Bounded above by `CHAT_HISTORY_KEEP` (30) — the store never retains more — so this is effectively "all retained history". |
| `MAX_AUTO_FACTS` | `12` | Cap on auto notes per scope, and on how many are injected. |

`MAX_FACT_CHARS` (300) already exists and bounds each note.

---

## 7. Failure handling & safety

- **Every distillation failure is silent.** `logger.warn` with `{ channelId, name }` only —
  never the transcript, never a note's content, never a user-facing message. No retry
  beyond the distiller's own single 5xx retry.
- A channel that never reaches `MIN_MSGS_FOR_DISTILL` is simply never distilled.
- `{ ok: false }` (API returned no text) means "leave the notes as they are" — it must
  **not** clear the auto set. Only an explicit `NONE` clears it.
- **Transparency & control:** auto notes are visible in `/facts`, individually
  deletable with `forget:N`, and clearable with `/facts wipe:true`.
- **Prompt-injection surface:** the transcript is untrusted user content fed to Gemini.
  The distiller's output is treated as data — parsed into plain strings, clamped, and
  stored; it is never executed and only ever re-injected as background context. The
  system instruction tells the model to produce notes, not follow instructions in the
  conversation. Note this is a *wider* surface than casual chat: auto-memory (like
  `/remember`) promotes channel-authored text into the **system instruction** via
  `withFacts`, but does so **automatically, with no command** — a user never has to run
  `/remember` for channel text to reach the system prompt. Residual risk is still low:
  each note is clamped to 300 chars, at most 12 auto notes are injected, notes are
  `- `-prefixed and framed as "treat as background", and the distiller's own system
  instruction carries an explicit anti-injection line. Auto notes are also visible and
  removable in `/facts` (`forget:N`, `wipe:true`).
- **Known v1 characteristic — the settle trigger and the distilled transcript disagree
  on what "a conversation" is.** `activity.note()` counts *every* human message in a
  channel, but the transcript handed to the distiller is `store.recent(...)`, which only
  holds AmIgo's own triggered exchanges (`store.append` runs only after a successful
  reply). So a channel where AmIgo is never addressed accumulates settle-trigger hits
  from chatter the distiller never sees and is effectively never distilled; and a
  chatty channel where AmIgo is seldom addressed would otherwise re-distil the same
  unchanged transcript every tick. The per-channel last-message-id guard in
  `autoMemory.run()` prevents those redundant re-distills (skips when the newest
  `store` row id is unchanged since the last pass). Aligning the trigger with the
  distilled content is deferred to v2.
- Logging rules unchanged: no message text, prompts, or note content in logs.

---

## 8. Testing strategy

Vitest, TDD. Injected clocks and timers throughout.

### `src/lib/activity.ts`
- `note` then `settled()` before `MEMORY_SETTLE_MS` elapsed → not settled.
- quiet ≥ `MEMORY_SETTLE_MS` but < `MIN_MSGS_FOR_DISTILL` messages → not settled.
- quiet + ≥ `MIN_MSGS_FOR_DISTILL` → settled, with the right `msgCount`.
- `markDistilled` resets the counter → not settled again until fresh `note`s.
- an entry idle > 24h with a zeroed counter is pruned.

### `src/ai/distill.ts`
- parses a newline list into `notes`, stripping `-` / `*` / `1.` markers and trimming.
- `"NONE"` / `"none"` / empty → `{ ok: true, notes: [] }`.
- caps at `MAX_AUTO_FACTS` and clamps each line to `MAX_FACT_CHARS`.
- dedupes case-insensitively.
- request carries `systemInstruction`, `safetySettings`, LOW thinking; the transcript
  and existing notes are in the prompt.
- 429 → throws `RateLimitError`; 503 → one retry then throws `AiUnavailableError`;
  API resolves with `""` → `{ ok: false }`.

### `src/memory/autoMemory.ts` (fake activity, store, facts, distiller)
- `tick()` calls `distiller.distill` for each settled channel with the formatted
  transcript and the channel's existing `auto` notes only.
- on `{ ok: true, notes }` → `facts.replaceAuto("channel", id, notes)`.
- on `{ ok: false }` → `replaceAuto` **not** called.
- on the distiller throwing → `logger.warn`, `replaceAuto` not called, `tick()` resolves.
- `markDistilled(id)` is called **before** the async `run`, exactly once per settled channel.
- a channel already in-flight is skipped on the next `tick()`.
- `run` returns early (no distiller call) when `store.recent` is empty.
- `start()` arms one interval; `stop()` clears it.

### `src/store/facts.ts`
- `add` default `source` is `"user"`; a returned `Fact` has `source`.
- the 40-cap counts only `user` rows — `replaceAuto`-ing 12 auto rows does not block `add`.
- `replaceAuto` is transactional: deletes prior auto rows, inserts the new ones,
  leaves `user` rows for that scope intact; slices to `MAX_AUTO_FACTS`; `[]` clears.
- `count(scope, id, "auto")` / `count(scope, id, "user")` / `count(scope, id)`.

### `src/store/db.ts`
- `db.test.ts`: a fresh db has the `facts.source` column; `schema_version` is the new
  `MIGRATIONS.length`; reopening is idempotent.

### Commands & chat
- `commands/facts.test.ts` — auto rows tagged in the listing; `wipe:true` clears auto
  only (user rows and `list` still return them); `wipe` with no auto notes → "nothing".
- `commands/remember.test.ts` — unchanged behaviour; the full-scope message still fires
  when 40 `user` rows exist even if there are also auto rows.
- `ai/conversation.test.ts` — the existing facts test still passes; a channel with >12
  auto facts injects at most `MAX_AUTO_FACTS` of them.

### Not covered by unit tests
- The live end-to-end (real Gemini distilling a real transcript) — add a line to
  `scripts/smoke.ts` or a small `scripts/memory-smoke.ts`, run manually with `.env`.

---

## 9. Deferred to the implementation plan

- Whether the ticker interval also drives a lightweight prune sweep, or pruning stays
  inside `settled()`.
- `scripts/memory-smoke.ts` vs. a line in the existing smoke script.
- Exact wording of the distiller's system instruction and the `/facts` auto tag.
- Task ordering: migration + `FactStore` → `activity` → `distill` → `autoMemory` →
  wiring → `/facts` + `withFacts` + `/remember` copy → smoke.
