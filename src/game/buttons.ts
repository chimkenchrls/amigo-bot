export type GameAction =
  | { verb: "join" }
  | { verb: "leave" }
  | { verb: "start" }
  | { verb: "cancel" }
  | { verb: "role" }
  | { verb: "act" }
  | { verb: "skip" }
  | { verb: "seer"; mode: "player" | "center" }
  | { verb: "rob" }
  | { verb: "tm" }
  | { verb: "vote" };

/** Encode a game action into a Discord component customId. Targets are NEVER
 *  encoded here — they arrive at runtime in the select menu's `values`. */
export function encodeId(a: GameAction): string {
  return a.verb === "seer" ? `wolf:seer:${a.mode}` : `wolf:${a.verb}`;
}

/** Decode a customId, or null if it is not one of ours / is malformed. */
export function decodeId(customId: string): GameAction | null {
  if (!customId.startsWith("wolf:")) return null;
  const parts = customId.split(":");
  const verb = parts[1];

  if (verb === "seer") {
    const mode = parts[2];
    if (parts.length === 3 && (mode === "player" || mode === "center")) {
      return { verb: "seer", mode };
    }
    return null;
  }

  if (parts.length !== 2) return null;
  switch (verb) {
    case "join": return { verb: "join" };
    case "leave": return { verb: "leave" };
    case "start": return { verb: "start" };
    case "cancel": return { verb: "cancel" };
    case "role": return { verb: "role" };
    case "act": return { verb: "act" };
    case "skip": return { verb: "skip" };
    case "rob": return { verb: "rob" };
    case "tm": return { verb: "tm" };
    case "vote": return { verb: "vote" };
    default: return null;
  }
}
