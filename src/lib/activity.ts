import { MEMORY_SETTLE_MS, MIN_MSGS_FOR_DISTILL } from "../constants.js";

/** Drop a channel from the map once it has been idle this long with nothing pending. */
const PRUNE_IDLE_MS = 24 * 60 * 60 * 1000;

export interface ChannelActivity {
  /** Record that a human message landed in this channel. */
  note(channelId: string): void;
  /** Channels whose conversation has wrapped and is worth distilling. */
  settled(): { channelId: string; msgCount: number }[];
  /** Reset the counter and stamp the time so this burst is not re-distilled. */
  markDistilled(channelId: string): void;
}

interface Entry {
  lastMsgAt: number;
  msgsSinceDistill: number;
  lastDistillAt: number;
}

export function createActivityTracker(
  now: () => number = Date.now,
): ChannelActivity {
  const channels = new Map<string, Entry>();

  return {
    note: (channelId) => {
      const e = channels.get(channelId);
      if (e) {
        e.lastMsgAt = now();
        e.msgsSinceDistill += 1;
      } else {
        channels.set(channelId, {
          lastMsgAt: now(),
          msgsSinceDistill: 1,
          lastDistillAt: 0,
        });
      }
    },
    settled: () => {
      const t = now();
      const out: { channelId: string; msgCount: number }[] = [];
      for (const [channelId, e] of channels) {
        if (e.msgsSinceDistill === 0 && t - e.lastMsgAt > PRUNE_IDLE_MS) {
          channels.delete(channelId);
          continue;
        }
        if (
          t - e.lastMsgAt >= MEMORY_SETTLE_MS &&
          e.msgsSinceDistill >= MIN_MSGS_FOR_DISTILL
        ) {
          out.push({ channelId, msgCount: e.msgsSinceDistill });
        }
      }
      return out;
    },
    markDistilled: (channelId) => {
      const e = channels.get(channelId);
      if (!e) return;
      e.msgsSinceDistill = 0;
      e.lastDistillAt = now();
    },
  };
}
