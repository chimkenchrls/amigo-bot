# AmIgo Bot Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public-ready Discord bot ("AmIgo") with a `/roast` vision command and a persona-driven `@mention`/reply chat, backed by per-channel SQLite conversation memory.

**Architecture:** Feature-module monolith — one Node process, folders by role. `commands/` and `events/` know Discord but not Gemini; `ai/` knows Gemini but not Discord; `store/` knows SQLite and nothing else. Pure logic lives in injectable functions/factories so it is unit-testable without a live gateway or API. A fresh `@google/genai` `Chat` is rebuilt from stored history on every message (stateless, restart-safe).

**Tech Stack:** TypeScript (ESM, `nodenext`), `tsx` runtime, `discord.js@14`, `@google/genai`, `better-sqlite3`, `dotenv`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-09-05-amigo-bot-core-design.md` — read it alongside this plan.

## Global Constraints

- **ESM + `verbatimModuleSyntax`:** every relative import uses a `.js` extension (e.g. `import { config } from "./config.js"`). Type-only imports use `import type`.
- **No secrets in code or tests.** Real tokens live only in `.env` (gitignored). Tests use dummy values.
- **AI module isolation:** files under `src/ai/` never import from `discord.js` or `src/store/`. Files under `src/store/` never import from `discord.js` or `src/ai/`.
- **Tunable values come from `src/constants.ts` or `src/config.ts`** — never inline literals for cooldowns, history sizes, limits, timeouts.
- **Model default:** `gemini-2.5-flash` (env `GEMINI_MODEL` overrides).
- **Logging never emits** message text, prompts containing user content, image bytes, tokens, or keys.
- **Every commit message ends with these two trailer lines** (blank line before them):

  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL
  ```

- **Test runner:** `npx vitest run` for a full pass; `npx vitest run <path>` for one file.
- **TDD:** write the failing test, watch it fail, implement minimally, watch it pass, commit. No implementation code before a red test (except pure type/interface declarations and trivial constant modules, which are noted where they occur).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/constants.ts` | Named numeric/string tunables (cooldowns, history sizes, limits, timeout, msg limit). |
| `src/config.ts` | `loadConfig(env)` — validate + parse env; exported `config`. |
| `src/client.ts` | `createClient()` — discord.js `Client` with intents/partials. |
| `src/index.ts` | Bootstrap: dotenv → config → db → client → event wiring → process handlers → login. |
| `src/deploy-commands.ts` | Standalone script: register slash commands globally or `--guild <id>`. |
| `src/lib/log.ts` | `createLogger(level)` — leveled single-line logger. |
| `src/lib/cooldown.ts` | `createCooldown(now?)` — in-memory per-`(user,key)` cooldown. |
| `src/lib/chunk.ts` | `chunk(text, max?)` — split to Discord-sized pieces. |
| `src/lib/botMessages.ts` | `createBotMessageCache(cap?)` — bounded FIFO id set (`remember`, `has`). |
| `src/lib/image.ts` | `validateImage(att)` pure; `fetchImageAsBase64(url)`. |
| `src/store/db.ts` | `openDatabase(path)` — connection, PRAGMAs, migration runner. |
| `src/store/messages.ts` | `createMessageStore(db)` — `append` / `recent` / `trim` / `purgeChannel`. |
| `src/ai/errors.ts` | `RateLimitError`, `AiUnavailableError`, `classifyAiError(err)`. |
| `src/ai/safety.ts` | `SAFETY_SETTINGS` array. |
| `src/ai/persona.ts` | `CHAT_PERSONA`, `ROAST_PERSONA` constants. |
| `src/ai/client.ts` | `createGenAI(apiKey)` — single `GoogleGenAI` instance. |
| `src/ai/roast.ts` | `pickRoastMode(rng?)`, `buildRoastPrompt(mode)`, `roastImage(genai, params)`. |
| `src/ai/conversation.ts` | `toGeminiHistory(rows)`, `generateReply(genai, params)`. |
| `src/chat/trigger.ts` | `stripMention(content, botUserId)`, `evaluateTrigger(msg, botUserId, isReplyToBot)`. |
| `src/chat/handler.ts` | `handleChat(deps)` → `(ctx) => Promise<void>` — orchestration. |
| `src/commands/roast.ts` | Slash command `data` + `execute`. |
| `src/commands/index.ts` | `commands` Map<name, Command>. |
| `src/events/ready.ts` | On ready: log tag, cache bot user id. |
| `src/events/interactionCreate.ts` | Route slash commands, centralized error reply. |
| `src/events/messageCreate.ts` | Trigger detection (incl. reply resolution) → build `ctx` → `handleChat`. |
| `scripts/smoke.ts` | Manual: one real roast on a local image + one real chat exchange. |
| `README.md` | Setup, env, run, deploy, test. |

Tests mirror the tree under `test/` (e.g. `test/lib/cooldown.test.ts`).

---

## Task 1: Project setup

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/constants.ts`
- Modify: `.gitignore` (already has `data/`, `*.log` — verify)

**Interfaces:**
- Consumes: nothing.
- Produces: `src/constants.ts` exports:
  - `ROAST_COOLDOWN_MS = 30_000`
  - `CHAT_COOLDOWN_MS = 5_000`
  - `CHAT_HISTORY_LOAD = 15`
  - `CHAT_HISTORY_KEEP = 30`
  - `MAX_IMAGE_BYTES = 4 * 1024 * 1024`
  - `AI_TIMEOUT_MS = 20_000`
  - `DISCORD_MSG_LIMIT = 2000`
  - `BOT_MESSAGE_CACHE_CAP = 200`
  - `ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const`

- [ ] **Step 1: Install dependencies**

```bash
npm install better-sqlite3
npm install -D vitest @types/better-sqlite3
```

- [ ] **Step 2: Update `package.json` scripts**

Replace the `scripts` block with:

```json
"scripts": {
  "dev": "tsx watch src/index.ts",
  "start": "tsx src/index.ts",
  "deploy": "tsx src/deploy-commands.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
},
"type": "module"
```

Confirm `"type": "module"` is present at top level (add if missing).

- [ ] **Step 3: Update `tsconfig.json`**

Change `"types": []` to `"types": ["node"]`. Add `"lib": ["esnext"]`. Add `"rootDir": "./src"` and `"outDir": "./dist"` (uncomment). Leave the strict flags as they are.

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 5: Create `.env.example`**

```
DISCORD_TOKEN=
DISCORD_APP_ID=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
DATABASE_PATH=./data/amigo.db
LOG_LEVEL=info
```

- [ ] **Step 6: Create `src/constants.ts`**

```typescript
export const ROAST_COOLDOWN_MS = 30_000;
export const CHAT_COOLDOWN_MS = 5_000;
export const CHAT_HISTORY_LOAD = 15;
export const CHAT_HISTORY_KEEP = 30;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const AI_TIMEOUT_MS = 20_000;
export const DISCORD_MSG_LIMIT = 2000;
export const BOT_MESSAGE_CACHE_CAP = 200;
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
```

- [ ] **Step 7: Verify build tooling**

Run: `npx vitest run`
Expected: exits 0, "No test files found" is acceptable (passWithNoTests).

Run: `npm run typecheck`
Expected: exits 0 (no `.ts` files with errors yet; `src/index.ts` is empty).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src/constants.ts .gitignore
git commit -m "chore: project setup — vitest, better-sqlite3, constants

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 2: `src/config.ts`

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LogLevel = "debug" | "info" | "warn" | "error"`
  - `interface Config { discordToken: string; discordAppId: string; geminiApiKey: string; model: string; databasePath: string; logLevel: LogLevel }`
  - `function loadConfig(env: NodeJS.ProcessEnv): Config` — throws `Error` listing every missing required var; applies defaults for `model` (`"gemini-2.5-flash"`), `databasePath` (`"./data/amigo.db"`), `logLevel` (`"info"`); an unrecognized `LOG_LEVEL` falls back to `"info"`.
  - `const config: Config` — `loadConfig(process.env)`, evaluated at module load.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const full = {
  DISCORD_TOKEN: "t",
  DISCORD_APP_ID: "a",
  GEMINI_API_KEY: "k",
};

describe("loadConfig", () => {
  it("parses required vars and applies defaults", () => {
    const c = loadConfig({ ...full });
    expect(c.discordToken).toBe("t");
    expect(c.discordAppId).toBe("a");
    expect(c.geminiApiKey).toBe("k");
    expect(c.model).toBe("gemini-2.5-flash");
    expect(c.databasePath).toBe("./data/amigo.db");
    expect(c.logLevel).toBe("info");
  });

  it("honors overrides", () => {
    const c = loadConfig({
      ...full,
      GEMINI_MODEL: "gemini-3-flash-preview",
      DATABASE_PATH: "/data/x.db",
      LOG_LEVEL: "debug",
    });
    expect(c.model).toBe("gemini-3-flash-preview");
    expect(c.databasePath).toBe("/data/x.db");
    expect(c.logLevel).toBe("debug");
  });

  it("falls back to info on unknown LOG_LEVEL", () => {
    expect(loadConfig({ ...full, LOG_LEVEL: "loud" }).logLevel).toBe("info");
  });

  it("throws listing every missing required var", () => {
    expect(() => loadConfig({})).toThrow(/DISCORD_TOKEN/);
    expect(() => loadConfig({})).toThrow(/DISCORD_APP_ID/);
    expect(() => loadConfig({})).toThrow(/GEMINI_API_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  discordToken: string;
  discordAppId: string;
  geminiApiKey: string;
  model: string;
  databasePath: string;
  logLevel: LogLevel;
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const required = {
    DISCORD_TOKEN: env.DISCORD_TOKEN,
    DISCORD_APP_ID: env.DISCORD_APP_ID,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v || v.trim() === "")
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const rawLevel = env.LOG_LEVEL as LogLevel | undefined;
  const logLevel: LogLevel =
    rawLevel && LOG_LEVELS.includes(rawLevel) ? rawLevel : "info";

  return {
    discordToken: required.DISCORD_TOKEN!,
    discordAppId: required.DISCORD_APP_ID!,
    geminiApiKey: required.GEMINI_API_KEY!,
    model: env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    databasePath: env.DATABASE_PATH?.trim() || "./data/amigo.db",
    logLevel,
  };
}

export const config: Config = loadConfig(process.env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (4 tests).

> Note: the test imports only `loadConfig`, but the module also evaluates `export const config = loadConfig(process.env)` at import time. In the vitest process the real env is unset, so this throws. **Prevent that:** in `vitest.config.ts` add `test.env` with dummy values, OR guard the eager `config` export. Use the env approach — update `vitest.config.ts`:

```typescript
    env: {
      DISCORD_TOKEN: "test-token",
      DISCORD_APP_ID: "test-app",
      GEMINI_API_KEY: "test-key",
    },
```

Re-run the test after adding this.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts vitest.config.ts
git commit -m "feat: config loader with env validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 3: `src/lib/log.ts`

**Files:**
- Create: `src/lib/log.ts`
- Test: `test/lib/log.test.ts`

**Interfaces:**
- Consumes: `LogLevel` from `src/config.ts`.
- Produces:
  - `interface Logger { debug(msg: string, meta?: unknown): void; info(...): void; warn(...): void; error(...): void }`
  - `function createLogger(level: LogLevel, sink?: (line: string) => void): Logger` — `sink` defaults to `console.log`. Emits one line: `` `${ISO timestamp} ${LEVEL} ${msg}` `` plus `` ` ${JSON.stringify(meta)}` `` when `meta !== undefined`. Messages below `level` are dropped (order: debug < info < warn < error).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../../src/lib/log.js";

describe("createLogger", () => {
  it("drops messages below the configured level", () => {
    const lines: string[] = [];
    const log = createLogger("warn", (l) => lines.push(l));
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("WARN");
    expect(lines[0]).toContain("w");
    expect(lines[1]).toContain("ERROR");
  });

  it("appends JSON meta when provided", () => {
    const lines: string[] = [];
    const log = createLogger("debug", (l) => lines.push(l));
    log.info("hello", { a: 1 });
    expect(lines[0]).toContain("hello");
    expect(lines[0]).toContain('{"a":1}');
  });

  it("emits a single line with no newline", () => {
    const lines: string[] = [];
    const log = createLogger("info", (l) => lines.push(l));
    log.info("x\ny");
    expect(lines[0].endsWith("\n")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/log.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { LogLevel } from "../config.js";

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(
  level: LogLevel,
  sink: (line: string) => void = console.log,
): Logger {
  const emit = (lvl: LogLevel, msg: string, meta?: unknown) => {
    if (RANK[lvl] < RANK[level]) return;
    const flat = msg.replace(/\s+/g, " ");
    const tail = meta === undefined ? "" : ` ${JSON.stringify(meta)}`;
    sink(`${new Date().toISOString()} ${lvl.toUpperCase()} ${flat}${tail}`);
  };
  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/log.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/log.ts test/lib/log.test.ts
git commit -m "feat: leveled single-line logger

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 4: `src/lib/cooldown.ts`

**Files:**
- Create: `src/lib/cooldown.ts`
- Test: `test/lib/cooldown.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CooldownResult { ok: boolean; retryAfter: number }` — `retryAfter` is whole seconds remaining (rounded up), `0` when `ok`.
  - `interface Cooldown { check(userId: string, key: string, ms: number): CooldownResult }`
  - `function createCooldown(now?: () => number): Cooldown` — `now` defaults to `Date.now`. `check` returns `{ ok: true, retryAfter: 0 }` and records the timestamp when the `(userId,key)` pair is unused or its window elapsed; otherwise `{ ok: false, retryAfter }` without updating the timestamp.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createCooldown } from "../../src/lib/cooldown.js";

describe("createCooldown", () => {
  it("allows the first call and blocks an immediate repeat", () => {
    let t = 1000;
    const cd = createCooldown(() => t);
    expect(cd.check("u", "roast", 30_000)).toEqual({ ok: true, retryAfter: 0 });
    t = 1000;
    const r = cd.check("u", "roast", 30_000);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBe(30);
  });

  it("rounds retryAfter up to whole seconds", () => {
    let t = 0;
    const cd = createCooldown(() => t);
    cd.check("u", "k", 30_000);
    t = 29_100;
    expect(cd.check("u", "k", 30_000).retryAfter).toBe(1);
  });

  it("allows again after the window elapses", () => {
    let t = 0;
    const cd = createCooldown(() => t);
    cd.check("u", "k", 5_000);
    t = 5_000;
    expect(cd.check("u", "k", 5_000).ok).toBe(true);
  });

  it("tracks (user,key) pairs independently", () => {
    let t = 0;
    const cd = createCooldown(() => t);
    cd.check("u", "roast", 30_000);
    expect(cd.check("u", "chat", 5_000).ok).toBe(true);
    expect(cd.check("v", "roast", 30_000).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/cooldown.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface CooldownResult {
  ok: boolean;
  retryAfter: number;
}

export interface Cooldown {
  check(userId: string, key: string, ms: number): CooldownResult;
}

export function createCooldown(now: () => number = Date.now): Cooldown {
  const last = new Map<string, number>();
  return {
    check(userId, key, ms) {
      const id = `${userId}:${key}`;
      const prev = last.get(id);
      const t = now();
      if (prev !== undefined && t - prev < ms) {
        return { ok: false, retryAfter: Math.ceil((ms - (t - prev)) / 1000) };
      }
      last.set(id, t);
      return { ok: true, retryAfter: 0 };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/cooldown.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cooldown.ts test/lib/cooldown.test.ts
git commit -m "feat: in-memory per-user cooldown

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 5: `src/lib/chunk.ts`

**Files:**
- Create: `src/lib/chunk.ts`
- Test: `test/lib/chunk.test.ts`

**Interfaces:**
- Consumes: `DISCORD_MSG_LIMIT` from `src/constants.ts`.
- Produces: `function chunk(text: string, max?: number): string[]` — `max` defaults to `DISCORD_MSG_LIMIT`. Never returns a chunk longer than `max`; never returns an empty-string chunk; returns `[]` for empty/whitespace-only input. Splits on the last whitespace at or before `max`; a run with no whitespace is hard-split at `max`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { chunk } from "../../src/lib/chunk.js";

describe("chunk", () => {
  it("returns a single chunk for short text", () => {
    expect(chunk("hello", 2000)).toEqual(["hello"]);
  });

  it("returns [] for empty or whitespace input", () => {
    expect(chunk("", 2000)).toEqual([]);
    expect(chunk("   \n ", 2000)).toEqual([]);
  });

  it("splits on whitespace and keeps every chunk within max", () => {
    const word = "ab ";
    const text = word.repeat(50); // 150 chars
    const out = chunk(text, 20);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.length).toBeLessThanOrEqual(20);
      expect(c.length).toBeGreaterThan(0);
    }
    expect(out.join(" ").replace(/\s+/g, " ").trim()).toBe(
      text.replace(/\s+/g, " ").trim(),
    );
  });

  it("hard-splits a run with no whitespace", () => {
    const out = chunk("x".repeat(45), 20);
    expect(out).toEqual(["x".repeat(20), "x".repeat(20), "x".repeat(5)]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/chunk.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { DISCORD_MSG_LIMIT } from "../constants.js";

export function chunk(text: string, max: number = DISCORD_MSG_LIMIT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    const nl = rest.lastIndexOf("\n", max);
    if (nl > cut) cut = nl;
    if (cut <= 0) cut = max;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/chunk.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chunk.ts test/lib/chunk.test.ts
git commit -m "feat: message chunker for Discord 2000-char limit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 6: `src/lib/botMessages.ts`

**Files:**
- Create: `src/lib/botMessages.ts`
- Test: `test/lib/botMessages.test.ts`

**Interfaces:**
- Consumes: `BOT_MESSAGE_CACHE_CAP` from `src/constants.ts`.
- Produces:
  - `interface BotMessageCache { remember(id: string): void; has(id: string): boolean }`
  - `function createBotMessageCache(cap?: number): BotMessageCache` — `cap` defaults to `BOT_MESSAGE_CACHE_CAP`. FIFO: once `cap` ids are stored, the oldest is evicted on the next `remember`. Re-remembering an existing id is a no-op (does not change its position — acceptable).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createBotMessageCache } from "../../src/lib/botMessages.js";

describe("createBotMessageCache", () => {
  it("remembers and recalls ids", () => {
    const c = createBotMessageCache(3);
    c.remember("a");
    expect(c.has("a")).toBe(true);
    expect(c.has("z")).toBe(false);
  });

  it("evicts oldest past capacity", () => {
    const c = createBotMessageCache(2);
    c.remember("a");
    c.remember("b");
    c.remember("c");
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/botMessages.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { BOT_MESSAGE_CACHE_CAP } from "../constants.js";

export interface BotMessageCache {
  remember(id: string): void;
  has(id: string): boolean;
}

export function createBotMessageCache(
  cap: number = BOT_MESSAGE_CACHE_CAP,
): BotMessageCache {
  const set = new Set<string>();
  const queue: string[] = [];
  return {
    remember(id) {
      if (set.has(id)) return;
      set.add(id);
      queue.push(id);
      if (queue.length > cap) {
        const evicted = queue.shift();
        if (evicted !== undefined) set.delete(evicted);
      }
    },
    has: (id) => set.has(id),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/botMessages.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/botMessages.ts test/lib/botMessages.test.ts
git commit -m "feat: bounded FIFO cache of recent bot message ids

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 7: `src/lib/image.ts`

**Files:**
- Create: `src/lib/image.ts`
- Test: `test/lib/image.test.ts`

**Interfaces:**
- Consumes: `ALLOWED_IMAGE_TYPES`, `MAX_IMAGE_BYTES` from `src/constants.ts`.
- Produces:
  - `interface AttachmentLike { contentType: string | null; size: number; url: string }`
  - `type ImageValidation = { ok: true; mimeType: string } | { ok: false; reason: string }`
  - `function validateImage(att: AttachmentLike): ImageValidation` — rejects when `contentType` is null/not in `ALLOWED_IMAGE_TYPES` (reason `"not-an-image"`) or `size > MAX_IMAGE_BYTES` (reason `"too-large"`). On success returns the normalized `mimeType` (the matched entry from `ALLOWED_IMAGE_TYPES`).
  - `function fetchImageAsBase64(url: string, mimeType: string): Promise<{ data: string; mimeType: string }>` — `fetch` the url, throw on non-OK response, return base64 of the body.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { validateImage } from "../../src/lib/image.js";

const base = { url: "https://x/y.png" };

describe("validateImage", () => {
  it("accepts allowed image types", () => {
    for (const t of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(validateImage({ ...base, contentType: t, size: 100 })).toEqual({
        ok: true,
        mimeType: t,
      });
    }
  });

  it("rejects non-images", () => {
    expect(
      validateImage({ ...base, contentType: "application/pdf", size: 100 }),
    ).toEqual({ ok: false, reason: "not-an-image" });
    expect(validateImage({ ...base, contentType: null, size: 100 })).toEqual({
      ok: false,
      reason: "not-an-image",
    });
  });

  it("rejects oversize files", () => {
    expect(
      validateImage({ ...base, contentType: "image/png", size: 5_000_000 }),
    ).toEqual({ ok: false, reason: "too-large" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/image.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "../constants.js";

export interface AttachmentLike {
  contentType: string | null;
  size: number;
  url: string;
}

export type ImageValidation =
  | { ok: true; mimeType: string }
  | { ok: false; reason: string };

export function validateImage(att: AttachmentLike): ImageValidation {
  const ct = att.contentType?.split(";")[0]?.trim().toLowerCase() ?? null;
  const match = ALLOWED_IMAGE_TYPES.find((t) => t === ct);
  if (!match) return { ok: false, reason: "not-an-image" };
  if (att.size > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };
  return { ok: true, mimeType: match };
}

export async function fetchImageAsBase64(
  url: string,
  mimeType: string,
): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString("base64"), mimeType };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/image.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/image.ts test/lib/image.test.ts
git commit -m "feat: image attachment validation + base64 fetch

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 8: `src/store/db.ts`

**Files:**
- Create: `src/store/db.ts`
- Test: `test/store/db.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DB = import("better-sqlite3").Database`
  - `function openDatabase(path: string): DB` — opens (creating the file if `path !== ":memory:"`), sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`, runs all pending migrations in a transaction, returns the connection.
  - `const MIGRATIONS: ReadonlyArray<(db: DB) => void>` — exported for the test; index 0 creates the `messages` table + index and the `schema_version` table.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { openDatabase, MIGRATIONS } from "../../src/store/db.js";

describe("openDatabase", () => {
  it("brings a fresh db to the current schema version", () => {
    const db = openDatabase(":memory:");
    const row = db.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(row.version).toBe(MIGRATIONS.length);
    const cols = db.prepare("PRAGMA table_info(messages)").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["channel_id", "content", "created_at", "id", "role"].sort(),
    );
  });

  it("is idempotent when reopened on the same connection logic", () => {
    const db = openDatabase(":memory:");
    // running migrations again must not throw
    expect(() => {
      for (const m of MIGRATIONS) m(db);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store/db.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import Database from "better-sqlite3";

export type DB = Database.Database;

export const MIGRATIONS: ReadonlyArray<(db: DB) => void> = [
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT    NOT NULL,
        role       TEXT    NOT NULL CHECK (role IN ('user','model')),
        content    TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_channel
        ON messages (channel_id, id);
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    `);
  },
];

export function openDatabase(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const versionRow = db
    .prepare(
      "SELECT version FROM schema_version LIMIT 1",
    )
    .safeIntegers(false);
  let current = 0;
  try {
    const row = versionRow.get() as { version: number } | undefined;
    current = row?.version ?? 0;
  } catch {
    current = 0; // schema_version table does not exist yet
  }

  const run = db.transaction(() => {
    for (let i = current; i < MIGRATIONS.length; i++) {
      MIGRATIONS[i]!(db);
    }
    db.prepare("DELETE FROM schema_version").run();
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      MIGRATIONS.length,
    );
  });
  run();

  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store/db.test.ts`
Expected: PASS (2 tests).

If `better-sqlite3` fails to load (native build), run `npm rebuild better-sqlite3` and retry; if it still fails, note the Node/toolchain issue in the task report.

- [ ] **Step 5: Commit**

```bash
git add src/store/db.ts test/store/db.test.ts
git commit -m "feat: sqlite connection + migration runner

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 9: `src/store/messages.ts`

**Files:**
- Create: `src/store/messages.ts`
- Test: `test/store/messages.test.ts`

**Interfaces:**
- Consumes: `DB` from `src/store/db.ts`.
- Produces:
  - `type Role = "user" | "model"`
  - `interface MessageRow { id: number; channelId: string; role: Role; content: string; createdAt: number }`
  - `interface MessageStore { append(channelId: string, role: Role, content: string): void; recent(channelId: string, limit: number): MessageRow[]; trim(channelId: string, keep: number): void; purgeChannel(channelId: string): void }`
  - `function createMessageStore(db: DB, now?: () => number): MessageStore` — `now` defaults to `Date.now`. `recent` returns rows oldest-first (ascending `id`), at most `limit`. `trim` deletes all but the newest `keep` rows for the channel.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/store/db.js";
import { createMessageStore } from "../../src/store/messages.js";

function store() {
  return createMessageStore(openDatabase(":memory:"));
}

describe("createMessageStore", () => {
  it("append + recent round-trips oldest-first", () => {
    const s = store();
    s.append("c1", "user", "hi");
    s.append("c1", "model", "yo");
    const rows = s.recent("c1", 10);
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ["user", "hi"],
      ["model", "yo"],
    ]);
  });

  it("recent respects the limit and keeps the newest", () => {
    const s = store();
    for (let i = 0; i < 5; i++) s.append("c1", "user", `m${i}`);
    const rows = s.recent("c1", 2);
    expect(rows.map((r) => r.content)).toEqual(["m3", "m4"]);
  });

  it("trim keeps exactly the newest N", () => {
    const s = store();
    for (let i = 0; i < 6; i++) s.append("c1", "user", `m${i}`);
    s.trim("c1", 3);
    expect(s.recent("c1", 99).map((r) => r.content)).toEqual(["m3", "m4", "m5"]);
  });

  it("isolates channels", () => {
    const s = store();
    s.append("c1", "user", "a");
    s.append("c2", "user", "b");
    expect(s.recent("c1", 99).map((r) => r.content)).toEqual(["a"]);
    s.trim("c1", 0);
    expect(s.recent("c2", 99).map((r) => r.content)).toEqual(["b"]);
  });

  it("purgeChannel removes everything for a channel", () => {
    const s = store();
    s.append("c1", "user", "a");
    s.purgeChannel("c1");
    expect(s.recent("c1", 99)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store/messages.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { DB } from "./db.js";

export type Role = "user" | "model";

export interface MessageRow {
  id: number;
  channelId: string;
  role: Role;
  content: string;
  createdAt: number;
}

export interface MessageStore {
  append(channelId: string, role: Role, content: string): void;
  recent(channelId: string, limit: number): MessageRow[];
  trim(channelId: string, keep: number): void;
  purgeChannel(channelId: string): void;
}

interface RawRow {
  id: number;
  channel_id: string;
  role: Role;
  content: string;
  created_at: number;
}

export function createMessageStore(
  db: DB,
  now: () => number = Date.now,
): MessageStore {
  const insert = db.prepare(
    "INSERT INTO messages (channel_id, role, content, created_at) VALUES (?, ?, ?, ?)",
  );
  const selectRecent = db.prepare(
    "SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?",
  );
  const deleteTrim = db.prepare(
    `DELETE FROM messages WHERE channel_id = ? AND id NOT IN
       (SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?)`,
  );
  const deleteAll = db.prepare("DELETE FROM messages WHERE channel_id = ?");

  const map = (r: RawRow): MessageRow => ({
    id: r.id,
    channelId: r.channel_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  });

  return {
    append: (channelId, role, content) =>
      void insert.run(channelId, role, content, now()),
    recent: (channelId, limit) =>
      (selectRecent.all(channelId, limit) as RawRow[]).map(map).reverse(),
    trim: (channelId, keep) =>
      void deleteTrim.run(channelId, channelId, keep),
    purgeChannel: (channelId) => void deleteAll.run(channelId),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store/messages.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/messages.ts test/store/messages.test.ts
git commit -m "feat: per-channel message store (append/recent/trim/purge)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 10: AI foundation — `errors.ts`, `safety.ts`, `persona.ts`, `client.ts`

**Files:**
- Create: `src/ai/errors.ts`
- Create: `src/ai/safety.ts`
- Create: `src/ai/persona.ts`
- Create: `src/ai/client.ts`
- Test: `test/ai/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class RateLimitError extends Error` (name `"RateLimitError"`)
  - `class AiUnavailableError extends Error` (name `"AiUnavailableError"`)
  - `type AiErrorKind = "rate_limit" | "unavailable" | "other"`
  - `function classifyAiError(err: unknown): AiErrorKind` — `429` → `"rate_limit"`; status `500`–`599`, or an `AbortError`/timeout, or a `TypeError` from `fetch` → `"unavailable"`; otherwise `"other"`. Reads `err.status` (number) per `@google/genai` `ApiError`.
  - `const SAFETY_SETTINGS` — array of `{ category, threshold }` for the four adjustable harm categories at `BLOCK_ONLY_HIGH`.
  - `const CHAT_PERSONA: string`, `const ROAST_PERSONA: string`.
  - `function createGenAI(apiKey: string): GoogleGenAI`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  RateLimitError,
  AiUnavailableError,
  classifyAiError,
} from "../../src/ai/errors.js";

describe("classifyAiError", () => {
  it("maps 429 to rate_limit", () => {
    expect(classifyAiError({ status: 429 })).toBe("rate_limit");
  });
  it("maps 5xx to unavailable", () => {
    expect(classifyAiError({ status: 503 })).toBe("unavailable");
  });
  it("maps AbortError to unavailable", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(classifyAiError(e)).toBe("unavailable");
  });
  it("maps our own error classes", () => {
    expect(classifyAiError(new RateLimitError("x"))).toBe("rate_limit");
    expect(classifyAiError(new AiUnavailableError("x"))).toBe("unavailable");
  });
  it("defaults to other", () => {
    expect(classifyAiError({ status: 400 })).toBe("other");
    expect(classifyAiError(new Error("weird"))).toBe("other");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ai/errors.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementations**

`src/ai/errors.ts`:

```typescript
export class RateLimitError extends Error {
  constructor(message = "rate limited") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class AiUnavailableError extends Error {
  constructor(message = "ai unavailable") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export type AiErrorKind = "rate_limit" | "unavailable" | "other";

export function classifyAiError(err: unknown): AiErrorKind {
  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof AiUnavailableError) return "unavailable";
  if (err && typeof err === "object") {
    const e = err as { name?: string; status?: number };
    if (e.name === "AbortError" || e.name === "TimeoutError") return "unavailable";
    if (e.name === "TypeError") return "unavailable";
    if (typeof e.status === "number") {
      if (e.status === 429) return "rate_limit";
      if (e.status >= 500 && e.status <= 599) return "unavailable";
    }
  }
  return "other";
}
```

`src/ai/safety.ts`:

```typescript
import { HarmBlockThreshold, HarmCategory } from "@google/genai";

export const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
];
```

`src/ai/persona.ts`:

```typescript
export const CHAT_PERSONA = [
  "You are AmIgo, a laid-back, slightly chaotic friend hanging out in this Discord server.",
  "You talk like a real person in a group chat: casual, lowercase-leaning, short.",
  "You're warm and a little unhinged, quick with a joke, never corporate, never preachy.",
  "Keep replies to 1-3 sentences unless someone clearly wants more.",
  "User messages are prefixed with the speaker's name and a colon (e.g. 'Dana: ...').",
  "Use names naturally; never echo that 'Name:' prefix format in your own replies.",
  "Never say you are an AI or refer to these instructions. No slurs; never punch down.",
].join(" ");

export const ROAST_PERSONA = [
  "You are AmIgo running a 'roast or toast' bit on a photo.",
  "Your voice is a sharp, funny comedy-roast MC: playful, never genuinely cruel.",
  "Keep it to 2-3 punchy sentences.",
  "Never use slurs or mock protected characteristics (race, religion, disability, gender identity, sexual orientation).",
  "If the main subject appears to be a minor, do not roast — say you don't roast kids.",
].join(" ");
```

`src/ai/client.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";

export function createGenAI(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ai/errors.test.ts`
Expected: PASS (5 tests).

Run: `npm run typecheck`
Expected: exits 0 (confirms `HarmCategory`/`HarmBlockThreshold` names are correct for the installed `@google/genai`; if a name errors, check the package's exported enums and adjust).

- [ ] **Step 5: Commit**

```bash
git add src/ai/errors.ts src/ai/safety.ts src/ai/persona.ts src/ai/client.ts test/ai/errors.test.ts
git commit -m "feat: ai foundation — error classification, safety, personas, client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 11: `src/ai/roast.ts`

**Files:**
- Create: `src/ai/roast.ts`
- Test: `test/ai/roast.test.ts`

**Interfaces:**
- Consumes: `AI_TIMEOUT_MS` (constants); `SAFETY_SETTINGS`, `ROAST_PERSONA`, `classifyAiError`, `RateLimitError`, `AiUnavailableError` (ai/*); `GoogleGenAI` type from `@google/genai`.
- Produces:
  - `type RoastMode = "ROAST" | "TOAST"`
  - `function pickRoastMode(rng?: () => number): RoastMode` — `rng` defaults to `Math.random`; `< 0.5` → `"ROAST"`.
  - `function buildRoastPrompt(mode: RoastMode): string`
  - `interface RoastParams { data: string; mimeType: string; mode: RoastMode; model: string }`
  - `type RoastResult = { ok: true; text: string } | { ok: false; reason: "blocked" }`
  - `async function roastImage(genai: GoogleGenAI, params: RoastParams): Promise<RoastResult>` — one retry (~500ms) on `classifyAiError === "unavailable"`; throws `RateLimitError` on `"rate_limit"`, `AiUnavailableError` after the retry fails or on timeout; returns `{ ok: false, reason: "blocked" }` when the response has no text.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  pickRoastMode,
  buildRoastPrompt,
  roastImage,
} from "../../src/ai/roast.js";
import { RateLimitError, AiUnavailableError } from "../../src/ai/errors.js";

function fakeGenAI(impl: () => unknown) {
  return { models: { generateContent: vi.fn(impl) } } as never;
}

const params = {
  data: "BASE64",
  mimeType: "image/png",
  mode: "ROAST" as const,
  model: "m",
};

describe("pickRoastMode", () => {
  it("splits on 0.5", () => {
    expect(pickRoastMode(() => 0.1)).toBe("ROAST");
    expect(pickRoastMode(() => 0.9)).toBe("TOAST");
  });
});

describe("buildRoastPrompt", () => {
  it("differs by mode and always carries the safety clause", () => {
    const r = buildRoastPrompt("ROAST");
    const t = buildRoastPrompt("TOAST");
    expect(r).not.toBe(t);
    expect(r.toLowerCase()).toContain("minor");
    expect(r.toLowerCase()).toContain("slur");
  });
});

describe("roastImage", () => {
  it("sends inlineData + prompt with persona and safety settings", async () => {
    const genai = fakeGenAI(() => ({ text: "you look like a discount gargoyle" }));
    const res = await roastImage(genai, params);
    expect(res).toEqual({ ok: true, text: "you look like a discount gargoyle" });
    const call = (genai as never as { models: { generateContent: any } }).models
      .generateContent.mock.calls[0][0];
    expect(call.model).toBe("m");
    expect(call.contents[0].parts[0].inlineData).toEqual({
      mimeType: "image/png",
      data: "BASE64",
    });
    expect(call.config.systemInstruction).toContain("roast");
    expect(Array.isArray(call.config.safetySettings)).toBe(true);
  });

  it("returns blocked when the model yields no text", async () => {
    const genai = fakeGenAI(() => ({ text: "" }));
    expect(await roastImage(genai, params)).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  it("throws RateLimitError on 429", async () => {
    const genai = fakeGenAI(() => {
      throw { status: 429, name: "ApiError" };
    });
    await expect(roastImage(genai, params)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("retries once then throws AiUnavailableError on 5xx", async () => {
    let calls = 0;
    const genai = fakeGenAI(() => {
      calls++;
      throw { status: 503, name: "ApiError" };
    });
    await expect(roastImage(genai, params)).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ai/roast.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { GoogleGenAI } from "@google/genai";
import { AI_TIMEOUT_MS } from "../constants.js";
import { ROAST_PERSONA } from "./persona.js";
import { SAFETY_SETTINGS } from "./safety.js";
import {
  AiUnavailableError,
  RateLimitError,
  classifyAiError,
} from "./errors.js";

export type RoastMode = "ROAST" | "TOAST";

export function pickRoastMode(rng: () => number = Math.random): RoastMode {
  return rng() < 0.5 ? "ROAST" : "TOAST";
}

export function buildRoastPrompt(mode: RoastMode): string {
  if (mode === "ROAST") {
    return (
      "Roast what you see in this image. Savage, witty, roast-battle energy — " +
      "2-3 sentences, playful-mean not hateful. No slurs, no jabs at protected " +
      "characteristics. If the subject looks like a minor, refuse and say you " +
      "don't roast kids."
    );
  }
  return (
    "Hype up what you see in this image. Absurd, over-the-top hype-man praise — " +
    "treat it as the greatest thing ever photographed. 2-3 sentences of " +
    "unhinged enthusiasm. No slurs."
  );
}

export interface RoastParams {
  data: string;
  mimeType: string;
  mode: RoastMode;
  model: string;
}

export type RoastResult =
  | { ok: true; text: string }
  | { ok: false; reason: "blocked" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function roastImage(
  genai: GoogleGenAI,
  params: RoastParams,
): Promise<RoastResult> {
  const request = {
    model: params.model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: params.mimeType, data: params.data } },
          { text: buildRoastPrompt(params.mode) },
        ],
      },
    ],
    config: {
      systemInstruction: ROAST_PERSONA,
      safetySettings: SAFETY_SETTINGS,
      temperature: 1.0,
      httpOptions: { timeout: AI_TIMEOUT_MS },
    },
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await genai.models.generateContent(request);
      const text = (res.text ?? "").trim();
      return text ? { ok: true, text } : { ok: false, reason: "blocked" };
    } catch (err) {
      lastErr = err;
      const kind = classifyAiError(err);
      if (kind === "rate_limit") throw new RateLimitError();
      if (kind !== "unavailable") throw err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) await sleep(500);
    }
  }
  throw new AiUnavailableError(
    lastErr instanceof Error ? lastErr.message : "ai unavailable",
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ai/roast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/roast.ts test/ai/roast.test.ts
git commit -m "feat: roastImage — vision call with coin-flip mode + error handling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 12: `src/ai/conversation.ts`

**Files:**
- Create: `src/ai/conversation.ts`
- Test: `test/ai/conversation.test.ts`

**Interfaces:**
- Consumes: `AI_TIMEOUT_MS` (constants); `CHAT_PERSONA`, `SAFETY_SETTINGS`, error helpers (ai/*); `MessageRow` role/content shape from `src/store/messages.ts` (`Pick<MessageRow, "role" | "content">`); `GoogleGenAI` type.
- Produces:
  - `interface HistoryTurn { role: "user" | "model"; parts: [{ text: string }] }`
  - `function toGeminiHistory(rows: { role: "user" | "model"; content: string }[]): HistoryTurn[]` — maps each row to a turn; **drops any leading `model` turns** so history starts with `user` (Gemini requirement); preserves order.
  - `interface ReplyParams { history: HistoryTurn[]; userTurn: string; model: string }`
  - `type ChatResult = { ok: true; text: string } | { ok: false; reason: "blocked" }`
  - `async function generateReply(genai: GoogleGenAI, params: ReplyParams): Promise<ChatResult>` — same retry/throw contract as `roastImage`. Builds a chat via `genai.chats.create({ model, history, config })` then `chat.sendMessage({ message: userTurn })`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { toGeminiHistory, generateReply } from "../../src/ai/conversation.js";
import { RateLimitError } from "../../src/ai/errors.js";

describe("toGeminiHistory", () => {
  it("maps roles and preserves order", () => {
    expect(
      toGeminiHistory([
        { role: "user", content: "hi" },
        { role: "model", content: "yo" },
      ]),
    ).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "yo" }] },
    ]);
  });

  it("drops leading model turns", () => {
    expect(
      toGeminiHistory([
        { role: "model", content: "stale" },
        { role: "user", content: "hi" },
      ]),
    ).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("returns [] for empty input", () => {
    expect(toGeminiHistory([])).toEqual([]);
  });
});

function fakeGenAI(sendImpl: () => unknown) {
  const sendMessage = vi.fn(sendImpl);
  const create = vi.fn(() => ({ sendMessage }));
  return { genai: { chats: { create } } as never, create, sendMessage };
}

describe("generateReply", () => {
  it("passes history + persona + safety and returns text", async () => {
    const { genai, create, sendMessage } = fakeGenAI(() => ({ text: "sup" }));
    const history = [{ role: "user" as const, parts: [{ text: "hi" }] }];
    const res = await generateReply(genai, {
      history,
      userTurn: "Dana: hello",
      model: "m",
    });
    expect(res).toEqual({ ok: true, text: "sup" });
    expect(create.mock.calls[0][0].model).toBe("m");
    expect(create.mock.calls[0][0].history).toBe(history);
    expect(create.mock.calls[0][0].config.systemInstruction).toContain("AmIgo");
    expect(Array.isArray(create.mock.calls[0][0].config.safetySettings)).toBe(true);
    expect(sendMessage.mock.calls[0][0]).toEqual({ message: "Dana: hello" });
  });

  it("returns blocked on empty text", async () => {
    const { genai } = fakeGenAI(() => ({ text: "" }));
    expect(
      await generateReply(genai, { history: [], userTurn: "x", model: "m" }),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("throws RateLimitError on 429", async () => {
    const { genai } = fakeGenAI(() => {
      throw { status: 429 };
    });
    await expect(
      generateReply(genai, { history: [], userTurn: "x", model: "m" }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ai/conversation.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { GoogleGenAI } from "@google/genai";
import { AI_TIMEOUT_MS } from "../constants.js";
import { CHAT_PERSONA } from "./persona.js";
import { SAFETY_SETTINGS } from "./safety.js";
import {
  AiUnavailableError,
  RateLimitError,
  classifyAiError,
} from "./errors.js";

export interface HistoryTurn {
  role: "user" | "model";
  parts: [{ text: string }];
}

export function toGeminiHistory(
  rows: { role: "user" | "model"; content: string }[],
): HistoryTurn[] {
  let start = 0;
  while (start < rows.length && rows[start]!.role === "model") start++;
  return rows.slice(start).map((r) => ({
    role: r.role,
    parts: [{ text: r.content }],
  }));
}

export interface ReplyParams {
  history: HistoryTurn[];
  userTurn: string;
  model: string;
}

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; reason: "blocked" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generateReply(
  genai: GoogleGenAI,
  params: ReplyParams,
): Promise<ChatResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const chat = genai.chats.create({
        model: params.model,
        history: params.history,
        config: {
          systemInstruction: CHAT_PERSONA,
          safetySettings: SAFETY_SETTINGS,
          temperature: 0.9,
          httpOptions: { timeout: AI_TIMEOUT_MS },
        },
      });
      const res = await chat.sendMessage({ message: params.userTurn });
      const text = (res.text ?? "").trim();
      return text ? { ok: true, text } : { ok: false, reason: "blocked" };
    } catch (err) {
      lastErr = err;
      const kind = classifyAiError(err);
      if (kind === "rate_limit") throw new RateLimitError();
      if (kind !== "unavailable")
        throw err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) await sleep(500);
    }
  }
  throw new AiUnavailableError(
    lastErr instanceof Error ? lastErr.message : "ai unavailable",
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ai/conversation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/conversation.ts test/ai/conversation.test.ts
git commit -m "feat: generateReply — stateless chat rebuilt from stored history

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 13: `src/chat/trigger.ts`

**Files:**
- Create: `src/chat/trigger.ts`
- Test: `test/chat/trigger.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `function stripMention(content: string, botUserId: string): string` — removes `<@ID>` and `<@!ID>` tokens for `botUserId`, collapses whitespace, trims.
  - `interface TriggerMessage { authorBot: boolean; system: boolean; content: string; mentionsBot: boolean }`
  - `interface TriggerOutcome { respond: boolean; text: string }`
  - `function evaluateTrigger(msg: TriggerMessage, botUserId: string, isReplyToBot: boolean): TriggerOutcome` — `respond: false` if `authorBot` or `system`; else `respond: true` if `mentionsBot || isReplyToBot`. `text` = `stripMention(content, botUserId)`, or `"(just pinged you with no message)"` when that is empty.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { stripMention, evaluateTrigger } from "../../src/chat/trigger.js";

describe("stripMention", () => {
  it("removes the bot mention tokens and trims", () => {
    expect(stripMention("<@123> hey there", "123")).toBe("hey there");
    expect(stripMention("hey <@!123> there", "123")).toBe("hey there");
  });
  it("leaves other mentions intact", () => {
    expect(stripMention("<@999> yo <@123>", "123")).toBe("<@999> yo");
  });
});

const m = (over: Partial<Parameters<typeof evaluateTrigger>[0]> = {}) => ({
  authorBot: false,
  system: false,
  content: "<@123> hi",
  mentionsBot: true,
  ...over,
});

describe("evaluateTrigger", () => {
  it("responds to a mention with stripped text", () => {
    expect(evaluateTrigger(m(), "123", false)).toEqual({
      respond: true,
      text: "hi",
    });
  });
  it("ignores bots and system messages", () => {
    expect(evaluateTrigger(m({ authorBot: true }), "123", false).respond).toBe(false);
    expect(evaluateTrigger(m({ system: true }), "123", false).respond).toBe(false);
  });
  it("responds to a reply-to-bot even without a mention", () => {
    expect(
      evaluateTrigger(m({ mentionsBot: false, content: "no ping" }), "123", true),
    ).toEqual({ respond: true, text: "no ping" });
  });
  it("uses a placeholder for a bare ping", () => {
    expect(evaluateTrigger(m({ content: "<@123>" }), "123", false)).toEqual({
      respond: true,
      text: "(just pinged you with no message)",
    });
  });
  it("does not respond when neither mentioned nor a reply", () => {
    expect(
      evaluateTrigger(m({ mentionsBot: false }), "123", false).respond,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/chat/trigger.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
export function stripMention(content: string, botUserId: string): string {
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TriggerMessage {
  authorBot: boolean;
  system: boolean;
  content: string;
  mentionsBot: boolean;
}

export interface TriggerOutcome {
  respond: boolean;
  text: string;
}

export function evaluateTrigger(
  msg: TriggerMessage,
  botUserId: string,
  isReplyToBot: boolean,
): TriggerOutcome {
  if (msg.authorBot || msg.system) return { respond: false, text: "" };
  const respond = msg.mentionsBot || isReplyToBot;
  const stripped = stripMention(msg.content, botUserId);
  return {
    respond,
    text: stripped || "(just pinged you with no message)",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/chat/trigger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/trigger.ts test/chat/trigger.test.ts
git commit -m "feat: chat trigger evaluation + mention stripping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 14: `src/chat/handler.ts`

**Files:**
- Create: `src/chat/handler.ts`
- Test: `test/chat/handler.test.ts`

**Interfaces:**
- Consumes: `CHAT_COOLDOWN_MS`, `CHAT_HISTORY_LOAD`, `CHAT_HISTORY_KEEP` (constants); `Cooldown` (lib/cooldown); `MessageStore` (store/messages); `Logger` (lib/log); `BotMessageCache` (lib/botMessages); `toGeminiHistory`, `generateReply` (ai/conversation); `chunk` (lib/chunk); `RateLimitError`, `AiUnavailableError` (ai/errors); `GoogleGenAI` type.
- Produces:
  - `interface ChatDeps { cooldown: Cooldown; store: MessageStore; genai: GoogleGenAI; botMessages: BotMessageCache; logger: Logger; model: string }`
  - `interface ChatContext { channelId: string; userId: string; displayName: string; text: string; guildId: string | null; sendTyping(): Promise<void>; reply(content: string): Promise<{ id: string }>; followUp(content: string): Promise<{ id: string }>; react(emoji: string): Promise<void> }`
  - `function handleChat(deps: ChatDeps): (ctx: ChatContext) => Promise<void>` — orchestrates cooldown → typing → history load → `generateReply` → persist (only on ok) → trim → chunked send (remembering each sent id). On cooldown: `ctx.react("🥱")`, no AI call. On `RateLimitError` / `AiUnavailableError` / blocked: one in-character `ctx.reply`, nothing persisted. All `ctx.*` failures are caught and logged, never thrown.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleChat } from "../../src/chat/handler.js";
import { RateLimitError } from "../../src/ai/errors.js";

vi.mock("../../src/ai/conversation.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, generateReply: vi.fn() };
});
import { generateReply } from "../../src/ai/conversation.js";

function deps(over: Partial<Parameters<typeof handleChat>[0]> = {}) {
  return {
    cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
    store: {
      recent: vi.fn(() => []),
      append: vi.fn(),
      trim: vi.fn(),
      purgeChannel: vi.fn(),
    },
    genai: {} as never,
    botMessages: { remember: vi.fn(), has: vi.fn(() => false) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    model: "m",
    ...over,
  };
}

function ctx(over: Partial<Parameters<ReturnType<typeof handleChat>>[0]> = {}) {
  return {
    channelId: "c",
    userId: "u",
    displayName: "Dana",
    text: "hello",
    guildId: "g",
    sendTyping: vi.fn(async () => {}),
    reply: vi.fn(async () => ({ id: "r1" })),
    followUp: vi.fn(async () => ({ id: "r2" })),
    react: vi.fn(async () => {}),
    ...over,
  };
}

describe("handleChat", () => {
  it("reacts and does nothing else when on cooldown", async () => {
    const d = deps();
    d.cooldown.check = vi.fn(() => ({ ok: false, retryAfter: 3 }));
    const c = ctx();
    await handleChat(d)(c);
    expect(c.react).toHaveBeenCalledWith("🥱");
    expect(generateReply).not.toHaveBeenCalled();
    expect(c.reply).not.toHaveBeenCalled();
  });

  it("loads history, replies, and persists both turns on success", async () => {
    (generateReply as any).mockResolvedValue({ ok: true, text: "sup" });
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(d.store.recent).toHaveBeenCalledWith("c", 15);
    expect(c.reply).toHaveBeenCalledWith("sup");
    expect(d.store.append).toHaveBeenNthCalledWith(1, "c", "user", "Dana: hello");
    expect(d.store.append).toHaveBeenNthCalledWith(2, "c", "model", "sup");
    expect(d.store.trim).toHaveBeenCalledWith("c", 30);
    expect(d.botMessages.remember).toHaveBeenCalledWith("r1");
  });

  it("does not persist when the model is blocked", async () => {
    (generateReply as any).mockResolvedValue({ ok: false, reason: "blocked" });
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalled();
    expect(d.store.append).not.toHaveBeenCalled();
    expect(d.store.trim).not.toHaveBeenCalled();
  });

  it("sends an in-character line and does not persist on RateLimitError", async () => {
    (generateReply as any).mockRejectedValue(new RateLimitError());
    const d = deps();
    const c = ctx();
    await handleChat(d)(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(d.store.append).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/chat/handler.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { GoogleGenAI } from "@google/genai";
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_KEEP,
  CHAT_HISTORY_LOAD,
} from "../constants.js";
import type { Cooldown } from "../lib/cooldown.js";
import type { MessageStore } from "../store/messages.js";
import type { Logger } from "../lib/log.js";
import type { BotMessageCache } from "../lib/botMessages.js";
import { chunk } from "../lib/chunk.js";
import { toGeminiHistory, generateReply } from "../ai/conversation.js";
import { AiUnavailableError, RateLimitError } from "../ai/errors.js";

export interface ChatDeps {
  cooldown: Cooldown;
  store: MessageStore;
  genai: GoogleGenAI;
  botMessages: BotMessageCache;
  logger: Logger;
  model: string;
}

export interface ChatContext {
  channelId: string;
  userId: string;
  displayName: string;
  text: string;
  guildId: string | null;
  sendTyping(): Promise<void>;
  reply(content: string): Promise<{ id: string }>;
  followUp(content: string): Promise<{ id: string }>;
  react(emoji: string): Promise<void>;
}

const ERR_RATE = "hitting my limits — gimme a minute";
const ERR_DOWN = "my brain's offline rn, try again later";
const ERR_BLOCKED = "yeah i'm not touching that one";
const ERR_CRASH = "my brain just blue-screened, say that again?";

export function handleChat(deps: ChatDeps) {
  return async (ctx: ChatContext): Promise<void> => {
    const { logger } = deps;
    try {
      const cd = deps.cooldown.check(ctx.userId, "chat", CHAT_COOLDOWN_MS);
      if (!cd.ok) {
        await ctx.react("🥱").catch(() => {});
        return;
      }

      await ctx.sendTyping().catch(() => {});

      const rows = deps.store.recent(ctx.channelId, CHAT_HISTORY_LOAD);
      const history = toGeminiHistory(rows);
      const userTurn = `${ctx.displayName}: ${ctx.text}`;

      let result;
      try {
        result = await generateReply(deps.genai, {
          history,
          userTurn,
          model: deps.model,
        });
      } catch (err) {
        const line =
          err instanceof RateLimitError
            ? ERR_RATE
            : err instanceof AiUnavailableError
              ? ERR_DOWN
              : ERR_CRASH;
        logger.error("chat generate failed", {
          guildId: ctx.guildId,
          name: err instanceof Error ? err.name : "unknown",
        });
        await sendChunks(ctx, deps, line);
        return;
      }

      if (!result.ok) {
        await sendChunks(ctx, deps, ERR_BLOCKED);
        return;
      }

      deps.store.append(ctx.channelId, "user", userTurn);
      deps.store.append(ctx.channelId, "model", result.text);
      deps.store.trim(ctx.channelId, CHAT_HISTORY_KEEP);
      await sendChunks(ctx, deps, result.text);
    } catch (err) {
      logger.error("chat handler crashed", {
        name: err instanceof Error ? err.name : "unknown",
      });
      await ctx.reply(ERR_CRASH).catch(() => {});
    }
  };
}

async function sendChunks(
  ctx: ChatContext,
  deps: ChatDeps,
  text: string,
): Promise<void> {
  const parts = chunk(text);
  if (parts.length === 0) return;
  try {
    const first = await ctx.reply(parts[0]!);
    deps.botMessages.remember(first.id);
    for (const p of parts.slice(1)) {
      const m = await ctx.followUp(p);
      deps.botMessages.remember(m.id);
    }
  } catch (err) {
    deps.logger.warn("chat send failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/chat/handler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/chat/handler.ts test/chat/handler.test.ts
git commit -m "feat: chat orchestration handler

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 15: `src/commands/roast.ts` + `src/commands/index.ts`

**Files:**
- Create: `src/commands/roast.ts`
- Create: `src/commands/index.ts`
- Test: `test/commands/roast.test.ts`

**Interfaces:**
- Consumes: `ROAST_COOLDOWN_MS` (constants); `Cooldown`, `Logger` (lib); `validateImage`, `fetchImageAsBase64` (lib/image); `pickRoastMode`, `roastImage` (ai/roast); error classes; `GoogleGenAI` type; `discord.js` (`SlashCommandBuilder`, `ChatInputCommandInteraction`).
- Produces:
  - `interface Command { data: { name: string; toJSON(): unknown }; execute(interaction: ChatInputCommandInteraction, ctx: CommandCtx): Promise<void> }`
  - `interface CommandCtx { cooldown: Cooldown; genai: GoogleGenAI; logger: Logger; model: string; rng?: () => number }`
  - `const roastCommand: Command`
  - `runRoast(input: RoastInput, ctx: CommandCtx): Promise<RoastReply>` — the pure-ish core, split out for testing: `RoastInput = { userId: string; attachment: AttachmentLike | null }`, `RoastReply = { kind: "cooldown" | "bad-image" | "blocked" | "rate" | "down" | "ok"; content: string }`.
  - `const commands: Map<string, Command>` (from `commands/index.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { runRoast } from "../../src/commands/roast.js";

vi.mock("../../src/ai/roast.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, roastImage: vi.fn() };
});
vi.mock("../../src/lib/image.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, fetchImageAsBase64: vi.fn(async () => ({ data: "B64", mimeType: "image/png" })) };
});
import { roastImage } from "../../src/ai/roast.js";

const ctx = () => ({
  cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
  genai: {} as never,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  model: "m",
  rng: () => 0.1, // ROAST
});

const png = { contentType: "image/png", size: 100, url: "https://x/y.png" };

describe("runRoast", () => {
  it("blocks on cooldown", async () => {
    const c = ctx();
    c.cooldown.check = vi.fn(() => ({ ok: false, retryAfter: 12 }));
    const r = await runRoast({ userId: "u", attachment: png }, c);
    expect(r.kind).toBe("cooldown");
    expect(r.content).toContain("12");
    expect(roastImage).not.toHaveBeenCalled();
  });

  it("rejects a non-image", async () => {
    const r = await runRoast(
      { userId: "u", attachment: { ...png, contentType: "application/pdf" } },
      ctx(),
    );
    expect(r.kind).toBe("bad-image");
  });

  it("rejects a missing attachment", async () => {
    const r = await runRoast({ userId: "u", attachment: null }, ctx());
    expect(r.kind).toBe("bad-image");
  });

  it("returns the roast text on success", async () => {
    (roastImage as any).mockResolvedValue({ ok: true, text: "gremlin energy" });
    const r = await runRoast({ userId: "u", attachment: png }, ctx());
    expect(r).toEqual({ kind: "ok", content: "gremlin energy" });
  });

  it("maps a blocked result", async () => {
    (roastImage as any).mockResolvedValue({ ok: false, reason: "blocked" });
    const r = await runRoast({ userId: "u", attachment: png }, ctx());
    expect(r.kind).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/commands/roast.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/commands/roast.ts`:

```typescript
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { GoogleGenAI } from "@google/genai";
import { ROAST_COOLDOWN_MS } from "../constants.js";
import type { Cooldown } from "../lib/cooldown.js";
import type { Logger } from "../lib/log.js";
import {
  validateImage,
  fetchImageAsBase64,
  type AttachmentLike,
} from "../lib/image.js";
import { pickRoastMode, roastImage } from "../ai/roast.js";
import { AiUnavailableError, RateLimitError } from "../ai/errors.js";

export interface CommandCtx {
  cooldown: Cooldown;
  genai: GoogleGenAI;
  logger: Logger;
  model: string;
  rng?: () => number;
}

export interface Command {
  data: { name: string; toJSON(): unknown };
  execute(
    interaction: ChatInputCommandInteraction,
    ctx: CommandCtx,
  ): Promise<void>;
}

export interface RoastInput {
  userId: string;
  attachment: AttachmentLike | null;
}

export interface RoastReply {
  kind: "cooldown" | "bad-image" | "blocked" | "rate" | "down" | "ok";
  content: string;
}

export async function runRoast(
  input: RoastInput,
  ctx: CommandCtx,
): Promise<RoastReply> {
  const cd = ctx.cooldown.check(input.userId, "roast", ROAST_COOLDOWN_MS);
  if (!cd.ok) {
    return { kind: "cooldown", content: `chill — ${cd.retryAfter}s left` };
  }

  if (!input.attachment) {
    return { kind: "bad-image", content: "you gotta actually upload a photo" };
  }
  const check = validateImage(input.attachment);
  if (!check.ok) {
    return {
      kind: "bad-image",
      content:
        check.reason === "too-large"
          ? "that image is too chonky (4MB max)"
          : "that's not a photo i can work with",
    };
  }

  let encoded;
  try {
    encoded = await fetchImageAsBase64(input.attachment.url, check.mimeType);
  } catch (err) {
    ctx.logger.warn("roast image fetch failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return { kind: "down", content: "couldn't grab that image, try again" };
  }

  const mode = pickRoastMode(ctx.rng);
  ctx.logger.info("roast", { mode });

  try {
    const res = await roastImage(ctx.genai, {
      data: encoded.data,
      mimeType: encoded.mimeType,
      mode,
      model: ctx.model,
    });
    if (!res.ok) {
      return {
        kind: "blocked",
        content: "my roast circuits tripped a breaker on that one",
      };
    }
    return { kind: "ok", content: res.text };
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { kind: "rate", content: "hitting my limits — gimme a minute" };
    }
    if (err instanceof AiUnavailableError) {
      return { kind: "down", content: "my brain's offline, try again later" };
    }
    ctx.logger.error("roast failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return { kind: "down", content: "something broke, try again" };
  }
}

export const roastCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("roast")
    .setDescription("Upload a photo. I decide: brutal roast or unhinged praise.")
    .addAttachmentOption((o) =>
      o.setName("image").setDescription("the photo").setRequired(true),
    ),
  async execute(interaction, ctx) {
    await interaction.deferReply();
    const attachment = interaction.options.getAttachment("image");
    const reply = await runRoast(
      {
        userId: interaction.user.id,
        attachment: attachment
          ? {
              contentType: attachment.contentType,
              size: attachment.size,
              url: attachment.url,
            }
          : null,
      },
      ctx,
    );
    await interaction.editReply(reply.content.slice(0, 2000));
  },
};
```

`src/commands/index.ts`:

```typescript
import { roastCommand, type Command } from "./roast.js";

export type { Command } from "./roast.js";

export const commands = new Map<string, Command>([
  [roastCommand.data.name, roastCommand],
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/commands/roast.test.ts`
Expected: PASS (5 tests).

Run: `npm run typecheck`
Expected: exits 0 (confirms the `discord.js` `SlashCommandBuilder` / `ChatInputCommandInteraction` / attachment option API matches the installed v14).

- [ ] **Step 5: Commit**

```bash
git add src/commands/roast.ts src/commands/index.ts test/commands/roast.test.ts
git commit -m "feat: /roast slash command

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 16: Client, `ready`, `interactionCreate`, bootstrap — `/roast` live

**Files:**
- Create: `src/client.ts`
- Create: `src/events/ready.ts`
- Create: `src/events/interactionCreate.ts`
- Create: `src/index.ts` (replace the empty file)
- Test: `test/events/interactionCreate.test.ts`

**Interfaces:**
- Consumes: `config` (config); `createLogger` (lib/log); `createCooldown` (lib/cooldown); `createBotMessageCache` (lib/botMessages); `openDatabase` (store/db); `createMessageStore` (store/messages); `createGenAI` (ai/client); `commands` (commands/index); `discord.js`.
- Produces:
  - `function createClient(): Client` — intents `Guilds`, `GuildMessages`, `MessageContent`, `GuildMessageReactions`; partials `Message`, `Channel`.
  - `function routeInteraction(deps: RouteDeps): (interaction: Interaction) => Promise<void>` where `RouteDeps = { commands: Map<string, Command>; ctx: CommandCtx; logger: Logger }` — ignores non-chat-input; unknown command → ephemeral "I don't know that one"; wraps `execute` in try/catch and sends an in-character error via `editReply` (if deferred/replied) or `reply({ ephemeral: true })`.
  - `const botUserId: { current: string }` exported from `src/events/ready.ts` (a mutable holder set on `ready`), plus `registerReady(client, logger)`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { routeInteraction } from "../../src/events/interactionCreate.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function interaction(over: Record<string, unknown> = {}) {
  return {
    isChatInputCommand: () => true,
    commandName: "roast",
    deferred: false,
    replied: false,
    reply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    ...over,
  };
}

describe("routeInteraction", () => {
  it("runs the matching command", async () => {
    const execute = vi.fn(async () => {});
    const commands = new Map([
      ["roast", { data: { name: "roast", toJSON: () => ({}) }, execute }],
    ]);
    await routeInteraction({ commands, ctx: {} as never, logger })(
      interaction() as never,
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("replies ephemerally for an unknown command", async () => {
    const i = interaction({ commandName: "nope" });
    await routeInteraction({ commands: new Map(), ctx: {} as never, logger })(
      i as never,
    );
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
  });

  it("sends an in-character error when execute throws (deferred)", async () => {
    const execute = vi.fn(async () => {
      throw new Error("boom");
    });
    const commands = new Map([
      ["roast", { data: { name: "roast", toJSON: () => ({}) }, execute }],
    ]);
    const i = interaction({ deferred: true });
    await routeInteraction({ commands, ctx: {} as never, logger })(i as never);
    expect(i.editReply).toHaveBeenCalled();
  });

  it("ignores non-chat-input interactions", async () => {
    const i = interaction({ isChatInputCommand: () => false });
    await routeInteraction({ commands: new Map(), ctx: {} as never, logger })(
      i as never,
    );
    expect(i.reply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/events/interactionCreate.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementations**

`src/events/interactionCreate.ts`:

```typescript
import type { Interaction } from "discord.js";
import type { Command, CommandCtx } from "../commands/roast.js";
import type { Logger } from "../lib/log.js";

export interface RouteDeps {
  commands: Map<string, Command>;
  ctx: CommandCtx;
  logger: Logger;
}

const ERR_LINE = "ugh, that broke on my end. try again in a sec";

export function routeInteraction(deps: RouteDeps) {
  return async (interaction: Interaction): Promise<void> => {
    if (!interaction.isChatInputCommand()) return;
    const command = deps.commands.get(interaction.commandName);
    if (!command) {
      deps.logger.warn("unknown command", { name: interaction.commandName });
      await interaction.reply({
        content: "i don't know that one",
        ephemeral: true,
      });
      return;
    }
    try {
      await command.execute(interaction, deps.ctx);
    } catch (err) {
      deps.logger.error("command failed", {
        name: interaction.commandName,
        error: err instanceof Error ? err.name : "unknown",
      });
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(ERR_LINE).catch(() => {});
      } else {
        await interaction
          .reply({ content: ERR_LINE, ephemeral: true })
          .catch(() => {});
      }
    }
  };
}
```

`src/events/ready.ts`:

```typescript
import type { Client } from "discord.js";
import type { Logger } from "../lib/log.js";

export const botUserId = { current: "" };

export function registerReady(client: Client, logger: Logger): void {
  client.once("clientReady", (c) => {
    botUserId.current = c.user.id;
    logger.info("ready", { tag: c.user.tag });
  });
}
```

> If the installed `discord.js` still emits `"ready"` rather than `"clientReady"`, use `"ready"`. Check `npm ls discord.js` and the changelog; v14.16+ renamed it. `npm run typecheck` will flag the wrong name.

`src/client.ts`:

```typescript
import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel],
  });
}
```

`src/index.ts`:

```typescript
import "dotenv/config";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";
import { createLogger } from "./lib/log.js";
import { createCooldown } from "./lib/cooldown.js";
import { createBotMessageCache } from "./lib/botMessages.js";
import { openDatabase } from "./store/db.js";
import { createMessageStore } from "./store/messages.js";
import { createGenAI } from "./ai/client.js";
import { createClient } from "./client.js";
import { commands } from "./commands/index.js";
import { registerReady } from "./events/ready.js";
import { routeInteraction } from "./events/interactionCreate.js";

const logger = createLogger(config.logLevel);

if (config.databasePath !== ":memory:") {
  mkdirSync(dirname(config.databasePath), { recursive: true });
}
const db = openDatabase(config.databasePath);
const store = createMessageStore(db);
const cooldown = createCooldown();
const botMessages = createBotMessageCache();
const genai = createGenAI(config.geminiApiKey);

const client = createClient();
registerReady(client, logger);

const commandCtx = { cooldown, genai, logger, model: config.model };
client.on("interactionCreate", routeInteraction({ commands, ctx: commandCtx, logger }));

client.on("error", (e) => logger.error("client error", { name: e.name }));
client.on("shardError", (e) => logger.error("shard error", { name: e.name }));

process.on("unhandledRejection", (reason) =>
  logger.error("unhandledRejection", {
    name: reason instanceof Error ? reason.name : "unknown",
  }),
);
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { name: err.name, message: err.message });
  process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info("shutting down", { sig });
    void client.destroy();
    db.close();
    process.exit(0);
  });
}

client.login(config.discordToken).catch((err) => {
  logger.error("login failed", { message: err instanceof Error ? err.message : "?" });
  process.exit(1);
});
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/events/interactionCreate.test.ts`
Expected: PASS (4 tests).

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Manual smoke — `/roast` end to end**

1. Fill `.env` with real `DISCORD_TOKEN`, `DISCORD_APP_ID`, `GEMINI_API_KEY`.
2. In the Discord Developer Portal: enable the **Message Content Intent** for the app.
3. Invite the bot to a test guild with `applications.commands` + `bot` scopes and Send Messages permission.
4. `npm run deploy -- --guild <your-test-guild-id>` — **this needs Task 18**; if Task 18 isn't done yet, temporarily register with a scratch REST call or do this smoke after Task 18. (Reviewer: it is acceptable to defer this manual step to after Task 18.)
5. `npm run dev`; in the guild run `/roast` with a photo. Expect a roast or hype reply within ~5s.

- [ ] **Step 6: Commit**

```bash
git add src/client.ts src/events/ready.ts src/events/interactionCreate.ts src/index.ts test/events/interactionCreate.test.ts
git commit -m "feat: bot bootstrap + interaction router (/roast live)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 17: `src/events/messageCreate.ts` — chat live

**Files:**
- Create: `src/events/messageCreate.ts`
- Modify: `src/index.ts` (wire the listener)
- Test: `test/events/messageCreate.test.ts`

**Interfaces:**
- Consumes: `evaluateTrigger` (chat/trigger); `handleChat`, `ChatDeps`, `ChatContext` (chat/handler); `BotMessageCache` (lib/botMessages); `botUserId` holder (events/ready); `discord.js` `Message`.
- Produces:
  - `function onMessageCreate(deps: MessageDeps): (message: Message) => Promise<void>` where `MessageDeps = ChatDeps & { botMessages: BotMessageCache; getBotUserId: () => string }`.
  - `async function isReplyToBot(message: Message, botUserId: string, cache: BotMessageCache): Promise<boolean>` — true when `message.reference?.messageId` is in the cache, or a fetch of that id resolves to an author whose id === `botUserId`; false on any fetch error.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { onMessageCreate } from "../../src/events/messageCreate.js";

vi.mock("../../src/chat/handler.js", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, handleChat: vi.fn(() => vi.fn(async () => {})) };
});
import { handleChat } from "../../src/chat/handler.js";

function baseDeps() {
  return {
    cooldown: { check: vi.fn(() => ({ ok: true, retryAfter: 0 })) },
    store: { recent: vi.fn(() => []), append: vi.fn(), trim: vi.fn(), purgeChannel: vi.fn() },
    genai: {} as never,
    botMessages: { remember: vi.fn(), has: vi.fn(() => false) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    model: "m",
    getBotUserId: () => "BOT",
  };
}

function msg(over: Record<string, unknown> = {}) {
  return {
    author: { bot: false, id: "u1" },
    system: false,
    content: "<@BOT> hey",
    mentions: { users: new Map() },
    reference: null,
    guildId: "g",
    channelId: "c",
    member: { displayName: "Dana" },
    channel: { sendTyping: vi.fn(async () => {}) },
    reply: vi.fn(async () => ({ id: "x" })),
    ...over,
  };
}

describe("onMessageCreate", () => {
  it("invokes the chat handler for a mention", async () => {
    const inner = vi.fn(async () => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({ mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).toHaveBeenCalledOnce();
    const ctx = inner.mock.calls[0][0];
    expect(ctx.text).toBe("hey");
    expect(ctx.displayName).toBe("Dana");
    expect(ctx.channelId).toBe("c");
  });

  it("does nothing for a message that neither mentions nor replies to the bot", async () => {
    const inner = vi.fn(async () => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({ content: "just talking", mentions: { users: new Map() } });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).not.toHaveBeenCalled();
  });

  it("ignores bot authors", async () => {
    const inner = vi.fn(async () => {});
    (handleChat as any).mockReturnValue(inner);
    const m = msg({ author: { bot: true, id: "u1" }, mentions: { users: new Map([["BOT", {}]]) } });
    await onMessageCreate(baseDeps())(m as never);
    expect(inner).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/events/messageCreate.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Message } from "discord.js";
import { evaluateTrigger } from "../chat/trigger.js";
import { handleChat, type ChatContext, type ChatDeps } from "../chat/handler.js";
import type { BotMessageCache } from "../lib/botMessages.js";

export type MessageDeps = ChatDeps & {
  botMessages: BotMessageCache;
  getBotUserId: () => string;
};

export async function isReplyToBot(
  message: Message,
  botUserId: string,
  cache: BotMessageCache,
): Promise<boolean> {
  const refId = message.reference?.messageId;
  if (!refId) return false;
  if (cache.has(refId)) return true;
  try {
    const ref = await message.channel.messages.fetch(refId);
    return ref.author.id === botUserId;
  } catch {
    return false;
  }
}

export function onMessageCreate(deps: MessageDeps) {
  const run = handleChat(deps);
  return async (message: Message): Promise<void> => {
    const botId = deps.getBotUserId();
    if (!botId) return;

    const replyToBot = await isReplyToBot(message, botId, deps.botMessages);
    const outcome = evaluateTrigger(
      {
        authorBot: message.author.bot,
        system: message.system,
        content: message.content,
        mentionsBot: message.mentions.users.has(botId),
      },
      botId,
      replyToBot,
    );
    if (!outcome.respond) return;

    const displayName =
      message.member?.displayName ?? message.author.username;

    const ctx: ChatContext = {
      channelId: message.channelId,
      userId: message.author.id,
      displayName,
      text: outcome.text,
      guildId: message.guildId,
      sendTyping: () => message.channel.sendTyping(),
      reply: async (content) => {
        const sent = await message.reply(content).catch(async (err: unknown) => {
          if (isUnknownMessage(err) && "send" in message.channel) {
            return (message.channel as { send: (c: string) => Promise<{ id: string }> }).send(content);
          }
          throw err;
        });
        return { id: sent.id };
      },
      followUp: async (content) => {
        const sent = await (message.channel as {
          send: (c: string) => Promise<{ id: string }>;
        }).send(content);
        return { id: sent.id };
      },
      react: (emoji) => message.react(emoji).then(() => undefined),
    };

    await run(ctx);
  };
}

function isUnknownMessage(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: number }).code === 10008
  );
}
```

Wire into `src/index.ts` — add after the `interactionCreate` line:

```typescript
import { onMessageCreate } from "./events/messageCreate.js";
import { botUserId } from "./events/ready.js";
// ...
client.on(
  "messageCreate",
  onMessageCreate({
    cooldown,
    store,
    genai,
    botMessages,
    logger,
    model: config.model,
    getBotUserId: () => botUserId.current,
  }),
);
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/events/messageCreate.test.ts`
Expected: PASS (3 tests).

Run: `npm run typecheck`
Expected: exits 0. If discord.js union channel types make `.sendTyping()` / `.send()` not statically available, narrow with `message.channel.isTextBased()` / `message.channel.isSendable()` guards at the top and early-return otherwise.

- [ ] **Step 5: Manual smoke — chat**

`npm run dev`; in the test guild, `@AmIgo what's up` → in-character reply. Reply to that message without pinging → another reply. Send two quick pings → second gets a 🥱 reaction, no text.

- [ ] **Step 6: Commit**

```bash
git add src/events/messageCreate.ts src/index.ts test/events/messageCreate.test.ts
git commit -m "feat: @mention/reply chat wired to gateway

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 18: `src/deploy-commands.ts`

**Files:**
- Create: `src/deploy-commands.ts`
- Test: none (thin script; verified manually)

**Interfaces:**
- Consumes: `config` (config); `commands` (commands/index); `discord.js` `REST`, `Routes`.
- Produces: an executable script. `npm run deploy` registers globally; `npm run deploy -- --guild <id>` registers to that guild.

- [ ] **Step 1: Write the implementation**

```typescript
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";
import { createLogger } from "./lib/log.js";

const logger = createLogger(config.logLevel);

async function main(): Promise<void> {
  const guildFlag = process.argv.indexOf("--guild");
  const guildId = guildFlag !== -1 ? process.argv[guildFlag + 1] : undefined;

  const body = [...commands.values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(config.discordToken);

  const route = guildId
    ? Routes.applicationGuildCommands(config.discordAppId, guildId)
    : Routes.applicationCommands(config.discordAppId);

  await rest.put(route, { body });
  logger.info("commands registered", {
    scope: guildId ? `guild:${guildId}` : "global",
    count: body.length,
  });
}

main().catch((err) => {
  logger.error("deploy failed", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
```

- [ ] **Step 2: Manual verification**

Run: `npm run deploy -- --guild <test-guild-id>`
Expected: logs `commands registered { scope: 'guild:...', count: 1 }`. `/roast` appears immediately in that guild's command picker.

- [ ] **Step 3: Commit**

```bash
git add src/deploy-commands.ts
git commit -m "feat: slash command registration script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 19: `scripts/smoke.ts` + `README.md`

**Files:**
- Create: `scripts/smoke.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `config`, `createGenAI`, `roastImage`, `pickRoastMode`, `generateReply`, `toGeminiHistory`.
- Produces: `npx tsx scripts/smoke.ts <path-to-image>` — prints one real roast/toast for the image and one real chat reply to a hardcoded "Dana: yo what's the plan tonight" turn.

- [ ] **Step 1: Write `scripts/smoke.ts`**

```typescript
import "dotenv/config";
import { readFileSync } from "node:fs";
import { config } from "../src/config.js";
import { createGenAI } from "../src/ai/client.js";
import { pickRoastMode, roastImage } from "../src/ai/roast.js";
import { generateReply, toGeminiHistory } from "../src/ai/conversation.js";

async function main(): Promise<void> {
  const imgPath = process.argv[2];
  if (!imgPath) throw new Error("usage: tsx scripts/smoke.ts <image-path>");

  const genai = createGenAI(config.geminiApiKey);

  const data = readFileSync(imgPath).toString("base64");
  const mode = pickRoastMode();
  console.log(`\n=== ROAST (${mode}) ===`);
  console.log(
    JSON.stringify(
      await roastImage(genai, { data, mimeType: "image/jpeg", mode, model: config.model }),
      null,
      2,
    ),
  );

  console.log(`\n=== CHAT ===`);
  console.log(
    JSON.stringify(
      await generateReply(genai, {
        history: toGeminiHistory([
          { role: "user", content: "Sam: anyone around?" },
          { role: "model", content: "yeah what's up" },
        ]),
        userTurn: "Dana: yo what's the plan tonight",
        model: config.model,
      }),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the smoke script**

Run: `npx tsx scripts/smoke.ts ./some-photo.jpg` (use any local jpeg)
Expected: prints a `{ ok: true, text: ... }` roast and a `{ ok: true, text: ... }` chat reply. If either is `{ ok: false, reason: "blocked" }`, note it — may need `SAFETY_SETTINGS` loosened or persona wording softened.

- [ ] **Step 3: Write `README.md`**

```markdown
# AmIgo

A laid-back, slightly chaotic Discord bot: `/roast` a photo (roast or hype, coin-flip)
and `@mention` it for group-chat banter with per-channel memory.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `DISCORD_TOKEN`, `DISCORD_APP_ID` — from the Discord Developer Portal
   - `GEMINI_API_KEY` — from Google AI Studio
3. In the Developer Portal, enable the **Message Content Intent** for the app.
4. Invite the bot with the `bot` and `applications.commands` scopes and the
   Send Messages / Read Message History / Add Reactions permissions.

## Run

- `npm run deploy -- --guild <guild-id>` — register `/roast` in your test guild (instant)
- `npm run deploy` — register globally (up to ~1h to propagate)
- `npm run dev` — start with reload
- `npm start` — start once

## Test

- `npm test` — unit + store + mocked-AI tests
- `npm run typecheck` — TypeScript, no emit
- `npx tsx scripts/smoke.ts <image>` — one real roast + one real chat reply against live APIs

## Data

Conversation history is stored in SQLite at `DATABASE_PATH` (default `./data/amigo.db`).
Per channel: last 15 turns are sent to the model, last 30 are retained. Game state
(future feature) will be in-memory only.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.ts README.md
git commit -m "docs: README + live smoke script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Task 20: Full-suite green + final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all files pass. Record the count.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Boot the bot for real**

Run: `npm run dev`
Expected: logs `ready { tag: '...' }`, no errors. `/roast` and `@mention` both work in the test guild. `Ctrl-C` → logs `shutting down`, exits clean.

- [ ] **Step 4: Confirm persistence**

`@mention` the bot, restart (`npm run dev` again), `@mention` again referencing the earlier message — the reply should show it remembers. Check `data/amigo.db` exists.

- [ ] **Step 5: Final commit (if anything changed)**

```bash
git add -A
git commit -m "chore: verification pass — full suite green, bot boots

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U5paBXLyjJ6NmnCVf5RLwL"
```

---

## Self-Review Notes (author)

**Spec coverage check:**

| Spec section | Task(s) |
|---|---|
| 2. Stack / new deps / scripts | 1 |
| 3. Project layout / module contracts | all; structure locked in File Structure table |
| 4. Configuration (env + constants) | 1 (constants), 2 (env) |
| 5. Discord client / intents / bootstrap order | 16 |
| 6. `/roast` flow, prompts, no-persistence | 7, 11, 15 |
| 7. Chat trigger, reply resolution, flow, memory model | 13, 14, 17 |
| 8. Persistence (engine, schema, migrations, repo API, retention) | 8, 9 |
| 9. Error handling (boot, commands, chat, AI layer, Discord codes, process) | 2, 11, 12, 14, 15, 16, 17 |
| 10. Slash command registration | 18 |
| 11. Testing strategy | every task's TDD steps; 19 smoke; 20 full pass |
| 12. Build order | task ordering matches |
| 13. Open items | out of scope by design |

**Deviations from spec, with rationale:**
- Spec §6.2/§7.3 say `AbortController` for timeouts; plan uses `config.httpOptions.timeout` (a built-in `@google/genai` option) — simpler, same effect. `classifyAiError` still handles `AbortError`/`TimeoutError` names.
- Spec §5 lists the `ready` event; discord.js renamed it to `clientReady` in v14.16+. Plan uses `clientReady` with a note to fall back to `ready` if typecheck disagrees.
- `ephemeral: true` on interaction replies is shown as-is; if the installed discord.js requires `flags: MessageFlags.Ephemeral`, the executor should switch to that (typecheck will catch it).

**Placeholder scan:** no TBD/TODO; every code step has real content.

**Type consistency:** `RoastResult` / `ChatResult` share the `{ ok, text } | { ok:false, reason }` shape; `Command`/`CommandCtx` defined in Task 15 and consumed unchanged in 16/18; `MessageStore` method names (`append`/`recent`/`trim`/`purgeChannel`) consistent across 9, 14, 17; `botUserId.current` holder consistent between 16 and 17.
