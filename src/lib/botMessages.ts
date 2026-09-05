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
