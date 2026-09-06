import { vi } from "vitest";
import type { Mock } from "vitest";
import { createGameSession } from "../../src/game/session.js";
import type { GameSession, SessionDeps } from "../../src/game/session.js";
import type { MessagePayload } from "../../src/game/render.js";

interface SentRecord {
  p: MessagePayload;
  m: { id: string; edit: Mock };
}

export interface FakeDeps {
  timers: Array<{ ms: number; fn: () => void }>;
  sent: SentRecord[];
  deps: Omit<
    SessionDeps,
    "clearTimer" | "channel" | "gameMaster" | "logger" | "onEnd"
  > & {
    clearTimer: Mock;
    channel: { id: string; send: Mock };
    gameMaster: { narrateNight: Mock; narrateDay: Mock; narrateReveal: Mock };
    logger: { debug: Mock; info: Mock; warn: Mock; error: Mock };
    onEnd: Mock;
  };
}

/**
 * Shared fake `SessionDeps` for the session test suites (Tasks 10-15).
 * `timers` collects every armed timer as `{ ms, fn }`; `sent` collects every
 * posted message as `{ p, m }` (payload + the returned SentMessage stub).
 */
export function fakeDeps(over = {}): FakeDeps {
  const timers: FakeDeps["timers"] = [];
  const sent: SentRecord[] = [];
  return {
    timers,
    sent,
    deps: {
      now: () => 0,
      setTimer: (ms: number, fn: () => void) => {
        const h = { ms, fn };
        timers.push(h);
        return h;
      },
      clearTimer: vi.fn(),
      channel: {
        id: "c1",
        send: vi.fn(async (p: MessagePayload) => {
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

/**
 * Builds a session with host `"h"`, joins `"a"` and `"b"`, and calls `start("h")`,
 * leaving it at `phase: "night"`. Returns the session plus the fake handles.
 */
export async function startedGame(over: object = {}): Promise<{
  s: GameSession;
  timers: FakeDeps["timers"];
  sent: FakeDeps["sent"];
  deps: FakeDeps["deps"];
}> {
  const { deps, timers, sent } = fakeDeps(over);
  const s = await createGameSession("h", deps);
  await s.join("a", "Ann");
  await s.join("b", "Bee");
  await s.start("h");
  return { s, timers, sent, deps };
}
