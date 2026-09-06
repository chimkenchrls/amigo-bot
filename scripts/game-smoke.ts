import "dotenv/config";
import { config } from "../src/config.js";
import { createGenAI } from "../src/ai/client.js";
import { createGameMaster } from "../src/ai/gameMaster.js";
import { createGameSession } from "../src/game/session.js";
import type {
  GameChannel,
  SentMessage,
  SessionDeps,
} from "../src/game/session.js";
import type { MessagePayload } from "../src/game/render.js";
import { NIGHT_MS } from "../src/game/constants.js";
import { createLogger } from "../src/lib/log.js";

/**
 * Scripted end-to-end run of One Night Werewolf against live Gemini, for manual
 * verification. Not part of the test suite — run it by hand with a filled `.env`:
 *
 *   npx tsx scripts/game-smoke.ts
 *
 * Drives a 3-player game lobby → night → day → vote → reveal with a fake channel
 * (console.logs every payload) and a synchronous fake scheduler (timers fired by
 * hand). All three narrations hit the real Gemini model. Exits non-zero on any
 * failed assertion; prints `SMOKE OK` and exits 0 on success.
 */

interface FakeTimer {
  ms: number;
  fn: () => void;
}

const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/** Let the async narration + phase chain settle. */
async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await tick();
}

async function main(): Promise<void> {
  let label = "init";
  let lastPayload: MessagePayload = {};

  const record = (p: MessagePayload, kind: "send" | "edit"): void => {
    lastPayload = p;
    const prefix = kind === "edit" ? "  [edit]" : `[${label}]`;
    console.log(prefix, JSON.stringify(p));
  };

  let seq = 0;
  const channel: GameChannel = {
    id: "chan-smoke",
    async send(p: MessagePayload): Promise<SentMessage> {
      record(p, "send");
      const id = `msg-${++seq}`;
      return {
        id,
        async edit(ep: MessagePayload): Promise<void> {
          record(ep, "edit");
        },
      };
    },
  };

  const timers: FakeTimer[] = [];
  const deps: SessionDeps = {
    now: () => Date.now(),
    setTimer(ms: number, fn: () => void): FakeTimer {
      const t: FakeTimer = { ms, fn };
      timers.push(t);
      return t;
    },
    clearTimer: () => {},
    channel,
    gameMaster: createGameMaster(
      createGenAI(config.geminiApiKey),
      config.model,
    ),
    rng: Math.random,
    logger: createLogger(config.logLevel),
    names: { host: "Host" },
    onEnd: () => {},
  };

  label = "lobby";
  const s = await createGameSession("host", deps);

  await s.join("dana", "Dana");
  await s.join("eli", "Eli");

  label = "start/night";
  await s.start("host");
  await settle();

  label = "night→day";
  const nightTimer = timers.find((t) => t.ms === NIGHT_MS);
  if (!nightTimer) throw new Error("night timer was not armed");
  nightTimer.fn();
  await settle();

  label = "day→vote";
  await s.skip("host");
  await settle();

  label = "vote→reveal";
  await s.vote("host", "dana");
  await s.vote("dana", "eli");
  await s.vote("eli", "dana");
  await settle();

  // --- assertions -----------------------------------------------------------
  if (s.phase !== "done") {
    throw new Error("expected phase done, got " + s.phase);
  }

  const json = JSON.stringify(lastPayload);
  for (const name of ["Dana", "Eli", "Host"]) {
    if (!json.includes(name)) {
      throw new Error(`reveal payload missing "${name}": ${json}`);
    }
  }
  if (!/nayon|lobo|Tanner/.test(json)) {
    throw new Error("reveal payload missing outcome summary: " + json);
  }

  console.log("SMOKE OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
