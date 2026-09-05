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
