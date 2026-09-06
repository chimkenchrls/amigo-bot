/**
 * Per-channel "study mode" toggle. In-memory only — a bot restart clears it,
 * which is fine for a mode switch. Mirrors the game registry's shape.
 */
export interface StudyMode {
  has(channelId: string): boolean;
  /** Flip the channel's study mode; returns the new state. */
  toggle(channelId: string): boolean;
  off(channelId: string): void;
}

export function createStudyMode(): StudyMode {
  const on = new Set<string>();
  return {
    has: (id) => on.has(id),
    toggle: (id) => {
      if (on.has(id)) {
        on.delete(id);
        return false;
      }
      on.add(id);
      return true;
    },
    off: (id) => void on.delete(id),
  };
}
