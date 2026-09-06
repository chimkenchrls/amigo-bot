import { DISTILL_TRANSCRIPT_TURNS, MEMORY_TICK_MS } from "../constants.js";
import type { ChannelActivity } from "../lib/activity.js";
import type { Distiller } from "../ai/distill.js";
import type { Logger } from "../lib/log.js";
import type { MessageRow, MessageStore } from "../store/messages.js";
import type { FactStore } from "../store/facts.js";

export type AutoMemoryTimer = unknown;

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
  note(channelId: string): void;
  start(): void;
  stop(): void;
  tick(): Promise<void>;
}

function formatTranscript(rows: MessageRow[]): string {
  return rows
    .map((r) => (r.role === "model" ? `AmIgo: ${r.content}` : r.content))
    .join("\n");
}

export function createAutoMemory(deps: AutoMemoryDeps): AutoMemory {
  const inFlight = new Set<string>();
  let timer: AutoMemoryTimer | undefined;

  async function run(channelId: string): Promise<void> {
    try {
      const rows = deps.store.recent(channelId, DISTILL_TRANSCRIPT_TURNS);
      if (rows.length === 0) return;
      const existing = deps.facts
        .list("channel", channelId)
        .filter((f) => f.source === "auto")
        .map((f) => f.content);
      const res = await deps.distiller.distill({
        existing,
        transcript: formatTranscript(rows),
      });
      if (res.ok) deps.facts.replaceAuto("channel", channelId, res.notes);
    } catch (err) {
      deps.logger.warn("auto-memory distill failed", {
        channelId,
        name: err instanceof Error ? err.name : "unknown",
      });
    } finally {
      inFlight.delete(channelId);
    }
  }

  async function tick(): Promise<void> {
    for (const { channelId } of deps.activity.settled()) {
      if (inFlight.has(channelId)) continue;
      deps.activity.markDistilled(channelId);
      inFlight.add(channelId);
      void run(channelId);
    }
  }

  return {
    note: (channelId) => deps.activity.note(channelId),
    start: () => {
      timer = deps.setInterval(() => void tick(), MEMORY_TICK_MS);
    },
    stop: () => {
      if (timer !== undefined) {
        deps.clearInterval(timer);
        timer = undefined;
      }
    },
    tick,
  };
}
