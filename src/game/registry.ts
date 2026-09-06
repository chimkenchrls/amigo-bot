export interface GameSessionHandle {
  channelId: string;
  abort(reason: string): Promise<void>;
}

export interface GameRegistry {
  has(channelId: string): boolean;
  get(channelId: string): GameSessionHandle | undefined;
  set(session: GameSessionHandle): void;
  remove(channelId: string): void;
  abortAll(reason: string): Promise<void>;
  size(): number;
}

export function createRegistry(): GameRegistry {
  const map = new Map<string, GameSessionHandle>();
  return {
    has: (id) => map.has(id),
    get: (id) => map.get(id),
    set: (s) => void map.set(s.channelId, s),
    remove: (id) => void map.delete(id),
    size: () => map.size,
    async abortAll(reason) {
      const sessions = [...map.values()];
      map.clear();
      await Promise.all(
        sessions.map((s) => s.abort(reason).catch(() => {})),
      );
    },
  };
}
