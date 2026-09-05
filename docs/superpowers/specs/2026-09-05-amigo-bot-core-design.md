# AmIgo Bot — Core Architecture, `/roast`, and Casual Chat

**Date:** 2026-09-05
**Status:** Approved design, pre-implementation
**Scope of this spec:** Core bot architecture + `/roast` (vision) slash command + casual `@mention`/reply conversation with persisted per-channel memory.
**Explicitly deferred:** The AI social-deduction game (AI-as-moderator). It gets its own brainstorm + spec + plan before any implementation.

---

## 1. Goals & Context

AmIgo is a public-server Discord bot with a laid-back, slightly chaotic "group chat friend" persona. Three features are planned overall, to be built one at a time in order of increasing risk:

1. `/roast` — vision-based "roast or toast" on an uploaded photo. *(this spec)*
2. Casual conversation — persona chat triggered by `@mention` or reply. *(this spec)*
3. AI-as-moderator social deduction game. *(deferred to its own spec)*

### Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Product hook | No single hook; all three features matter. Still built sequentially. |
| Persistence | Persist **conversation history**; game state (later) stays ephemeral. |
| Abuse guardrails (v1) | Per-user cooldowns + hard context-window cap on chat. No per-guild quota yet. |
| Game shape | AI-as-moderator (assigns roles, narrates phases, tallies votes); not an AI player. Deferred. |
| Chat trigger | `@mention` **or** reply-to-bot. Memory scoped **per channel** (shared "group chat" history). |
| Hosting | Persistent VPS with real disk. SQLite file persists across restarts/deploys. |
| AI provider | Google Gemini via `@google/genai`. Default model `gemini-2.5-flash` (vision-capable, cheap, free tier, fast). Model is an env var. Provider is isolated behind the `ai/` module for future swap. |

### Non-goals for this spec

- Sharding / multi-instance scaling (single process is fine well past initial adoption).
- Per-guild persona customization (single hardcoded persona).
- Unprompted / random chat interjections.
- A datastore abstraction layer beyond "all SQLite access lives in `store/`".
- Per-guild usage quotas.

---

## 2. Stack

- **Runtime:** Node.js, TypeScript, ESM (`module: nodenext`, `verbatimModuleSyntax: true`). Relative imports **must** use `.js` extensions.
- **Dev execution:** `tsx` (watch mode, no build step). Production may run `tsc` output or `tsx` directly.
- **Discord:** `discord.js@14`.
- **AI:** `@google/genai`.
- **Persistence:** `better-sqlite3` (synchronous, single-file, no server).
- **Config:** `dotenv`.
- **Tests:** `vitest`.

### New dependencies to add

- `better-sqlite3`
- `vitest` (dev)
- `@types/better-sqlite3` (dev)

### npm scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `tsx watch src/index.ts` | run the bot locally |
| `start` | `tsx src/index.ts` | run the bot (prod-ish) |
| `deploy` | `tsx src/deploy-commands.ts` | register slash commands (`-- --guild <id>` for instant dev registration) |
| `test` | `vitest run` | run the test suite |
| `test:watch` | `vitest` | watch mode |

---

## 3. Project Layout

Feature-module monolith: folders by role. `commands/` and `events/` know Discord but not Gemini. `ai/` knows Gemini but not Discord. `store/` knows SQLite and nothing else. Handlers wire them together.

```
src/
  index.ts               // bootstrap: load config, init db, init client, register events, login
  config.ts              // read + validate env; throws at boot if required vars missing
  client.ts              // creates the discord.js Client with intents/partials

  deploy-commands.ts     // standalone script: registers slash commands (global or --guild <id>)

  commands/
    index.ts             // Map<name, Command> of all commands
    roast.ts             // { data: SlashCommandBuilder, execute(interaction) }

  events/
    ready.ts
    interactionCreate.ts // routes slash commands -> commands/*; centralized error handling
    messageCreate.ts     // mention/reply detection -> chat handler

  chat/
    trigger.ts           // shouldRespond(message, botUserId) -> { respond, text }  (pure)
    handler.ts           // handleChat(deps)(message) -> orchestrates cooldown/history/AI/persist/send

  ai/
    client.ts            // single GoogleGenAI instance
    persona.ts           // system-instruction constants (CHAT_PERSONA, ROAST_PERSONA)
    safety.ts            // shared RELAXED safetySettings array
    roast.ts             // buildRoastPrompt(mode); roastImage(base64, mimeType) -> RoastResult
    conversation.ts      // toGeminiHistory(rows); reply(history, userTurn) -> ChatResult

  store/
    db.ts                // better-sqlite3 connection, PRAGMAs, migration runner
    messages.ts          // append / recent / trim / purgeChannel

  lib/
    cooldown.ts          // in-memory Map; check(userId, key, ms) -> { ok, retryAfter }
    image.ts             // validate(attachment) -> Result; fetchAsBase64(url) -> { data, mimeType }
    chunk.ts             // chunk(text, max=2000) -> string[]
    botMessages.ts       // bounded FIFO id cache: remember(id), has(id)
    log.ts               // leveled single-line logger

scripts/
  smoke.ts               // manual: fire one real roast + one real chat reply against live APIs

docs/superpowers/specs/
  2026-09-05-amigo-bot-core-design.md   // this file

test/                    // vitest specs mirror src/ layout
data/                    // gitignored; SQLite file lives here at runtime
```

### Module contracts

- **`chat/trigger.ts`** — pure. No Discord API calls beyond reading fields already on the `Message` object. Fully unit-testable.
- **`chat/handler.ts`** — takes its dependencies (`ai`, `store`, `cooldown`, logger) as an injected object so tests can supply fakes. The `events/messageCreate.ts` file constructs the real deps once and calls the handler.
- **`ai/*`** — take plain strings / arrays / base64. Return typed result objects. Never import from `discord.js` or `store/`.
- **`store/messages.ts`** — the only module that writes SQL. Returns plain objects.
- **`events/*.ts`** — thin. Parse the interaction/message, call a handler, send the result. Logic worth testing lives elsewhere.

---

## 4. Configuration

`src/config.ts` reads `process.env` (after `dotenv/config`) and exports a frozen typed object. Validates at module load; a missing **required** var throws an `Error` listing every missing name, and `index.ts` lets it crash the process with a non-zero exit.

| Var | Required | Default | Notes |
|---|---|---|---|
| `DISCORD_TOKEN` | yes | — | bot token |
| `DISCORD_APP_ID` | yes | — | application (client) id, for command registration |
| `GEMINI_API_KEY` | yes | — | Google AI Studio key |
| `GEMINI_MODEL` | no | `gemini-2.5-flash` | any `@google/genai` model id |
| `DATABASE_PATH` | no | `./data/amigo.db` | SQLite file path |
| `LOG_LEVEL` | no | `info` | `debug` \| `info` \| `warn` \| `error` |

Tunable constants (not env, just named exports — kept in `config.ts` or a `constants.ts`):

| Constant | Value | Meaning |
|---|---|---|
| `ROAST_COOLDOWN_MS` | `30_000` | per-user `/roast` cooldown |
| `CHAT_COOLDOWN_MS` | `5_000` | per-user chat cooldown |
| `CHAT_HISTORY_LOAD` | `15` | messages sent to the model as context |
| `CHAT_HISTORY_KEEP` | `30` | messages retained per channel in SQLite |
| `MAX_IMAGE_BYTES` | `4 * 1024 * 1024` | reject larger attachments |
| `AI_TIMEOUT_MS` | `20_000` | abort a Gemini call after this |
| `DISCORD_MSG_LIMIT` | `2000` | chunk size |

---

## 5. Discord Client

`src/client.ts` creates the `Client` with:

- **Intents:** `Guilds`, `GuildMessages`, `MessageContent` (privileged), `GuildMessageReactions`.
- **Partials:** `Message`, `Channel` (so reply-reference fetches work on uncached messages).

`MessageContent` must be enabled in the Discord Developer Portal. Once AmIgo is in 100+ servers this intent requires Discord approval — a launch/ops concern, noted here so it is not a surprise.

`src/index.ts` bootstrap order:

1. `import 'dotenv/config'`
2. load `config` (may throw → exit non-zero)
3. ensure `dirname(config.databasePath)` exists
4. `initDb()` → run migrations (failure → exit non-zero)
5. build `client`, attach `ready` / `interactionCreate` / `messageCreate` / `error` / `shardError` listeners
6. install `process` handlers (`unhandledRejection`, `uncaughtException`, `SIGINT`, `SIGTERM`)
7. `client.login(config.discordToken)` (failure → exit non-zero)

---

## 6. Feature: `/roast`

### 6.1 Command definition

```
new SlashCommandBuilder()
  .setName('roast')
  .setDescription('Upload a photo. I decide: brutal roast or unhinged praise.')
  .addAttachmentOption(o =>
    o.setName('image').setDescription('the photo').setRequired(true))
```

### 6.2 Flow (`commands/roast.ts` → `ai/roast.ts`)

1. **Cooldown.** `cooldown.check(userId, 'roast', ROAST_COOLDOWN_MS)`. If not ok → `interaction.reply({ content: \`chill — ${retryAfter}s\`, ephemeral: true })`, return.
2. **Defer.** `await interaction.deferReply()` (public). Must happen within 3s; it is the first real action.
3. **Validate attachment** (`lib/image.ts` `validate`):
   - `contentType` starts with `image/` and is one of png / jpeg / webp / gif
   - `size` ≤ `MAX_IMAGE_BYTES`
   - on failure → `interaction.editReply("that's not a photo I can work with")`, return.
4. **Fetch + encode.** `fetchAsBase64(attachment.url)` → `{ data, mimeType }`. Network failure → `editReply("couldn't grab that image")`, log real error, return.
5. **Coin flip (in code).** `const mode: 'ROAST' | 'TOAST' = Math.random() < 0.5 ? 'ROAST' : 'TOAST'`. Passed into the prompt. True 50/50, deterministic under test via injectable RNG.
6. **Generate** (`ai/roast.ts` `roastImage`):
   ```
   ai.models.generateContent({
     model: config.model,
     contents: [{ role: 'user', parts: [
       { inlineData: { mimeType, data } },
       { text: buildRoastPrompt(mode) },
     ]}],
     config: {
       systemInstruction: ROAST_PERSONA,
       safetySettings: RELAXED,
       temperature: 1.0,
     },
   })
   ```
   wrapped in a 20s `AbortController`.
7. **Classify response** → `RoastResult`:
   - text present → `{ ok: true, text }`
   - empty text or `promptFeedback.blockReason` set → `{ ok: false, reason: 'blocked' }`
   - threw 429 → `RateLimitError`
   - threw 5xx / network → one retry after ~500ms, then `AiUnavailableError`
   - aborted → `AiUnavailableError`
8. **Reply.**
   - ok → `interaction.editReply(clamp(text, 2000))`
   - blocked → `editReply("my roast circuits tripped a breaker on that one")`
   - `RateLimitError` → `editReply("hitting my limits — give me a minute")`
   - `AiUnavailableError` → `editReply("my brain's offline, try again later")`

### 6.3 Prompts

`buildRoastPrompt(mode)`:

- **ROAST:** "Deliver a savage, witty, roast-battle takedown of what you see in this image. Playful-mean, like a comedy roast — not genuinely hateful. 2–3 sentences, punchy. Absolutely no slurs, no jokes about protected characteristics (race, religion, disability, gender identity, sexual orientation), and if the subject appears to be a minor, refuse and say so."
- **TOAST:** "Deliver absurdly over-the-top hype-man praise of what you see in this image. Treat it as the single greatest thing ever captured on camera. 2–3 sentences, unhinged enthusiasm."

Both share the safety clause. `ROAST_PERSONA` system instruction sets the voice (same laid-back chaotic character as chat, dialed for comedy).

### 6.4 Roast data is not persisted

Fire-and-forget. No history table, no analytics beyond logs (mode, latency, block reason).

---

## 7. Feature: Casual Chat

### 7.1 Trigger (`chat/trigger.ts`, pure)

`shouldRespond(message, botUserId): { respond: boolean, text: string }`

- `respond: false` if `message.author.bot` or `message.system`.
- `respond: true` if `message.mentions.users.has(botUserId)`.
- `respond: true` if `message.reference?.messageId` exists **and** the referenced message was authored by the bot. (Resolving authorship needs a `messages.fetch`; see 7.2.)
- `text` = `message.content` with the bot mention token stripped, trimmed.
- If `text` is empty (bare ping) → `text = '(just pinged you with no message)'` so the model greets.

### 7.2 Reply-reference resolution

`lib/botMessages.ts` exports a bounded FIFO id cache: `remember(id)` and `has(id)` over a `Set<string>` + queue (cap ~200). Both `chat/handler.ts` (when it sends a reply) and `commands/roast.ts` could record ids, but only chat consults it. On an incoming message with `message.reference`:

- if `has(referenceId)` → treat as reply-to-bot, no fetch.
- else → `channel.messages.fetch(referenceId)` once; if `.author.id === botUserId`, treat as reply-to-bot. Fetch failure → treat as not-a-reply.

### 7.3 Flow (`events/messageCreate.ts` → `chat/handler.ts`)

1. `shouldRespond` → bail if `respond` is false.
2. **Cooldown.** `cooldown.check(userId, 'chat', CHAT_COOLDOWN_MS)`. Not ok → `message.react('🥱')` (best-effort, swallow failure), return. No AI call.
3. `await message.channel.sendTyping()`.
4. **Load history.** `messages.recent(channelId, CHAT_HISTORY_LOAD)` → `{ role, content }[]` oldest-first.
5. **Generate** (`ai/conversation.ts` `reply`):
   ```
   const chat = ai.chats.create({
     model: config.model,
     history: toGeminiHistory(rows),
     config: {
       systemInstruction: CHAT_PERSONA,
       safetySettings: RELAXED,
       temperature: 0.9,
     },
   });
   const res = await chat.sendMessage({ message: `${displayName}: ${text}` });
   ```
   A fresh `Chat` object is built from stored history on every message — stateless, restart-safe, no unbounded in-memory `Chat` accumulation across thousands of channels. Wrapped in a 20s `AbortController`.
6. **Classify** → `ChatResult` (same shape/rules as `RoastResult`: ok / blocked / `RateLimitError` / `AiUnavailableError` with one retry on 5xx).
7. **Persist (only on ok).**
   - `messages.append(channelId, 'user', \`${displayName}: ${text}\`)`
   - `messages.append(channelId, 'model', replyText)`
8. **Trim.** `messages.trim(channelId, CHAT_HISTORY_KEEP)`.
9. **Send.** `chunk(replyText, 2000)`; `message.reply(chunks[0])`, then `channel.send(...)` for any remainder. Pass each sent message id to `botMessages.remember(id)`.
   - `message.reply` failing with `10008 Unknown Message` (original deleted) → fall back to `channel.send`.
   - `50013 Missing Permissions` → log, drop silently.
10. **On non-ok:** in-character line via `message.reply`, nothing persisted.

### 7.4 Memory model

- **Scope:** per channel (`channel_id` is the only key). All participants share one thread of history. User turns are stored **with the display name prefixed** (`"Dana: what's up"`, where the name is `message.member?.displayName ?? message.author.username`) so the model can distinguish speakers; model turns are stored raw.
- **Context cap:** `CHAT_HISTORY_LOAD = 15` turns to the model regardless of thread length — the primary cost guardrail.
- **Retention:** `CHAT_HISTORY_KEEP = 30` rows per channel in SQLite (2× buffer). Dead channels retain their last 30 rows indefinitely (negligible size).
- **Persona:** single hardcoded `CHAT_PERSONA` constant used as `systemInstruction`. Not stored in the DB, not per-guild.

---

## 8. Persistence

### 8.1 Engine & file

`better-sqlite3`, synchronous. All access via `store/`. File at `config.databasePath` (default `./data/amigo.db`); `index.ts` creates the parent dir. On the VPS this is real disk and survives restarts/deploys. `data/` is gitignored.

`db.ts` sets on connect: `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = ON;`

### 8.2 Schema (migration 1)

```sql
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT    NOT NULL,
  role       TEXT    NOT NULL CHECK (role IN ('user','model')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, id);

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
```

### 8.3 Migration runner

`db.ts` holds an ordered array `migrations: Array<(db) => void>`. On boot: read `schema_version.version` (absent → treat as 0), run every migration at an index `>= version` inside a transaction, then set `version` to `migrations.length`. Failure throws → process exits non-zero. No migration library.

### 8.4 Repo API (`store/messages.ts`)

| Function | Behavior |
|---|---|
| `append(channelId, role, content)` | one `INSERT` with `created_at = Date.now()`; returns `void` |
| `recent(channelId, limit)` | `SELECT id, channel_id, role, content, created_at WHERE channel_id = ? ORDER BY id DESC LIMIT ?`, reversed in JS → oldest-first array |
| `trim(channelId, keep)` | `DELETE WHERE channel_id = ? AND id NOT IN (SELECT id WHERE channel_id = ? ORDER BY id DESC LIMIT ?)` |
| `purgeChannel(channelId)` | `DELETE WHERE channel_id = ?` — not wired to any command in this spec; present for a future `/forget` |

All statements are prepared once at module load.

### 8.5 Concurrency

`better-sqlite3` is synchronous; the Node event loop serializes all writes. No application-level locking needed at this scale. WAL mode handles the read/write overlap.

---

## 9. Error Handling & Resilience

**Principle:** every user-facing failure yields exactly one in-character line; the real error goes to logs only. Handler errors never crash the process.

### 9.1 Boot-time (fail fast, exit non-zero)

- Missing required env var (`config.ts` throws).
- DB migration failure.
- `client.login` failure.

### 9.2 Slash commands (`interactionCreate.ts`)

- Every `command.execute` call wrapped in try/catch at the router.
- Commands calling Gemini must `deferReply()` as their first real action (3s rule).
- On throw: `interaction.deferred || interaction.replied ? editReply(line) : reply({ content: line, ephemeral: true })`.
- Unknown command name → log `warn`, ephemeral "I don't know that one".

### 9.3 Chat (`messageCreate.ts`)

- Whole handler wrapped in try/catch → `message.reply("my brain just blue-screened, say that again?")` on throw.
- A failed exchange is never persisted (no half-written turn).

### 9.4 AI call layer (`ai/*`)

Each exported call function try/catches and classifies:

| Situation | Result |
|---|---|
| text present | `{ ok: true, text }` |
| empty text / `blockReason` present | `{ ok: false, reason: 'blocked' }` — not thrown |
| HTTP 429 | throw `RateLimitError` |
| HTTP 5xx / network error | one retry after ~500ms, then throw `AiUnavailableError` |
| `AbortController` timeout (`AI_TIMEOUT_MS`) | throw `AiUnavailableError` |

Caller maps: `blocked` → "can't touch that one" style line; `RateLimitError` → "hitting my limits, give me a minute"; `AiUnavailableError` → "my brain's offline, try later".

### 9.5 Discord API errors

- `message.reply` → `10008 Unknown Message` → retry via `channel.send`; swallow if that also fails.
- `50013 Missing Permissions` → log, drop silently.
- `client.on('error')` / `client.on('shardError')` → log; discord.js auto-reconnects.

### 9.6 Process-level

- `process.on('unhandledRejection')` → log with stack, **do not exit**.
- `process.on('uncaughtException')` → log with stack, **exit non-zero** (state may be corrupt); process manager (systemd / pm2) restarts.
- `SIGINT` / `SIGTERM` → close DB connection, `client.destroy()`, exit 0.

### 9.7 Logging (`lib/log.ts`)

Leveled (`debug`/`info`/`warn`/`error`), timestamped, single-line, level from `LOG_LEVEL`.

- **Logs:** command invocations (user id, guild id, latency), coin-flip outcome, AI block reasons, all errors with stack.
- **Never logs:** message text, image bytes, prompts with user content, tokens/keys.

---

## 10. Slash Command Registration

`src/deploy-commands.ts` — standalone script, not part of the bot process.

- Collects `command.data.toJSON()` from `commands/index.ts`.
- Default: global registration (`Routes.applicationCommands(appId)`) — up to ~1h propagation.
- `-- --guild <id>`: guild registration (`Routes.applicationGuildCommands(appId, guildId)`) — instant, for dev.
- Run manually via `npm run deploy` whenever command definitions change. Not run on bot startup.

---

## 11. Testing Strategy

**Runner:** `vitest` (`vitest run` in CI, `vitest` watch locally).

### 11.1 Pure unit tests (no I/O)

| Module | Cases |
|---|---|
| `lib/cooldown.ts` | first call ok; repeat within window blocked with correct `retryAfter`; expires after window; distinct keys independent |
| `lib/image.ts` `validate` | accepts png/jpeg/webp/gif; rejects `application/pdf`, missing `contentType`, oversize |
| `lib/chunk.ts` | short → 1 chunk; >2000 → splits on whitespace, every chunk ≤ 2000, never empty; text with no whitespace still hard-splits |
| `chat/trigger.ts` `shouldRespond` | mention → true + stripped text; bot author → false; system message → false; reply-to-bot → true; bare ping → true with placeholder text |
| `ai/roast.ts` `buildRoastPrompt` | ROAST vs TOAST differ; both contain the safety clause |
| `ai/conversation.ts` `toGeminiHistory` | maps `user`/`model` roles; preserves order; empty history → empty array |

### 11.2 SQLite tests (real `:memory:` db)

| Module | Cases |
|---|---|
| `store/messages.ts` | `append` then `recent` round-trips oldest-first; `recent` respects limit; `trim` keeps exactly N newest; different `channel_id`s isolated; migration runner brings a fresh db to current version |

### 11.3 AI-client-mocked tests (`vi.mock` the `GoogleGenAI` instance)

| Target | Assertions |
|---|---|
| `ai/roast.ts` `roastImage` | payload has `inlineData` with correct `mimeType`/`data`; `systemInstruction` + `safetySettings` passed; blocked response → `{ ok: false, reason: 'blocked' }`; 429 → `RateLimitError`; 5xx → one retry then `AiUnavailableError` |
| `ai/conversation.ts` `reply` | history passed to `ai.chats.create`; `systemInstruction` + `safetySettings` set; user turn formatted `"Name: text"`; error classification as above |
| `chat/handler.ts` `handleChat` | cooldown short-circuits before any AI call (🥱 react, no `ai` call); on ok → history loaded, AI called, both turns persisted, `trim` called; on AI error → nothing persisted, in-character reply sent |

### 11.4 Not automated

- Live Discord gateway + real slash-command registration → manual, via a dev guild (`npm run deploy -- --guild <id>`).
- Live Gemini calls → `scripts/smoke.ts`, run manually before deploy: one real `/roast`-style call on a local image + one real chat exchange, printed to stdout.
- `events/*.ts` → kept thin enough that their logic lives in tested modules.

### 11.5 TDD flow

Per the test-driven-development skill: red → green → refactor on each pure module and each `store/` / `ai/` function before it is wired into a handler. Every `lib/`, `chat/`, `store/`, and prompt-builder function has tests before integration.

### 11.6 CI (optional, pending confirmation)

A `.github/workflows/test.yml` running `npm ci && npm test` on push/PR. Include only if desired.

---

## 12. Build Order (implementation sequencing)

1. Scaffolding: `config.ts`, `lib/log.ts`, `store/db.ts` + migration runner, `client.ts`, `index.ts` bootstrap (bot connects, does nothing).
2. `lib/` primitives: `cooldown.ts`, `image.ts`, `chunk.ts` (TDD).
3. `ai/` foundation: `client.ts`, `persona.ts`, `safety.ts`.
4. `/roast`: `ai/roast.ts` (TDD w/ mock) → `commands/roast.ts` → `events/interactionCreate.ts` → `deploy-commands.ts`. Manual smoke test.
5. Chat: `store/messages.ts` (TDD) → `ai/conversation.ts` (TDD w/ mock) → `chat/trigger.ts` (TDD) → `chat/handler.ts` (TDD w/ fakes) → `events/messageCreate.ts`. Manual smoke test.
6. Resilience pass: process handlers, Discord error codes, graceful shutdown.
7. `scripts/smoke.ts`, README with setup/run/deploy steps.

---

## 13. Open Items / Future Specs

- **AI-as-moderator social deduction game** — separate brainstorm + spec + plan.
- **`/forget` command** — wipe a channel's history (`purgeChannel` already exists). Small follow-up.
- **Per-guild daily quota** — if API costs become a problem in the wild.
- **`MessageContent` intent approval** — required at 100+ servers.
- **CI workflow** — include on request.
- **Provider swap** — `ai/` module is the seam if Gemini Flash is outgrown.
