import { MessageFlags } from "discord.js";
import type { GameRegistry } from "./registry.js";
import type { GameSession } from "./session.js";
import type { Logger } from "../lib/log.js";

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

/** The center-card pair a seer peeks — the game always reveals the first two. */
const SEER_CENTERS: [number, number] = [0, 1];

const MSG = {
  noGame: "No game here. Run /werewolf first.",
  noPick: "You didn't pick anything.",
  notHost: "Only the host can cancel.",
  generic: "may mali",
} as const;

const CANCEL_REASON = "cancelled by the host";

/** A Discord component interaction, decoded to just what the router needs. */
export interface GameInteraction {
  customId: string;
  channelId: string;
  userId: string;
  displayName: string;
  values?: string[];
  reply(p: unknown): Promise<void>;
  deferUpdate(): Promise<void>;
  followUp(p: unknown): Promise<void>;
}

/** The chosen select-menu values, or null if fewer than `n` were picked. */
function selected(i: GameInteraction, n: number): string[] | null {
  const v = i.values ?? [];
  return v.length >= n ? v : null;
}

const ephemeral = (content: string): { content: string; flags: number } => ({
  content,
  flags: MessageFlags.Ephemeral,
});

/**
 * Route a decoded component interaction to its `GameSession` method. Guard
 * failures thrown by the session surface to the user as an ephemeral message;
 * a foreign or malformed customId is silently ignored.
 */
export async function routeGameInteraction(
  i: GameInteraction,
  registry: GameRegistry,
  logger: Logger,
): Promise<void> {
  const action = decodeId(i.customId);
  if (!action) return;

  const session = registry.get(i.channelId) as GameSession | undefined;
  if (!session) {
    await i.reply(ephemeral(MSG.noGame));
    return;
  }

  // `role` and `act` answer with their own ephemeral reply; every other verb
  // mutates the game and can trigger a slow phase transition (e.g. a Gemini
  // call in `enterReveal`), so ack Discord up front before dispatching.
  const deferred = action.verb !== "role" && action.verb !== "act";
  if (deferred) await i.deferUpdate().catch(() => {});

  try {
    await dispatch(action, i, session);
  } catch (err) {
    logger.debug("game interaction failed", {
      verb: action.verb,
      name: err instanceof Error ? err.name : "unknown",
    });
    await i
      .followUp(ephemeral(err instanceof Error ? err.message : MSG.generic))
      .catch(() => {});
  }
}

async function dispatch(
  action: GameAction,
  i: GameInteraction,
  session: GameSession,
): Promise<void> {
  switch (action.verb) {
    case "join":
      await session.join(i.userId, i.displayName);
      return;
    case "leave":
      await session.leave(i.userId);
      return;
    case "start":
      await session.start(i.userId);
      return;
    case "skip":
      await session.skip(i.userId);
      return;
    case "cancel":
      if (i.userId !== session.hostId) {
        await i.followUp(ephemeral(MSG.notHost));
        return;
      }
      await session.abort(CANCEL_REASON);
      return;
    case "role":
      await i.reply({ ...session.showRole(i.userId), flags: MessageFlags.Ephemeral });
      return;
    case "act": {
      const p = session.actPrompt(i.userId);
      await i.reply("flags" in p ? p : { ...p, flags: MessageFlags.Ephemeral });
      const components = (p as { components?: unknown[] }).components;
      if (!components?.length) {
        await session
          .act(i.userId, { kind: "noop", playerId: i.userId })
          .catch(() => {});
      }
      return;
    }
    case "seer": {
      if (action.mode === "center") {
        await session.act(i.userId, {
          kind: "seer-center",
          playerId: i.userId,
          centers: SEER_CENTERS,
        });
        return;
      }
      const t = selected(i, 1);
      if (!t) {
        await i.followUp(ephemeral(MSG.noPick));
        return;
      }
      await session.act(i.userId, {
        kind: "seer-player",
        playerId: i.userId,
        target: t[0]!,
      });
      return;
    }
    case "rob": {
      const t = selected(i, 1);
      if (!t) {
        await i.followUp(ephemeral(MSG.noPick));
        return;
      }
      await session.act(i.userId, {
        kind: "robber",
        playerId: i.userId,
        target: t[0]!,
      });
      return;
    }
    case "tm": {
      const t = selected(i, 2);
      if (!t) {
        await i.followUp(ephemeral(MSG.noPick));
        return;
      }
      await session.act(i.userId, {
        kind: "troublemaker",
        playerId: i.userId,
        a: t[0]!,
        b: t[1]!,
      });
      return;
    }
    case "vote": {
      const t = selected(i, 1);
      if (!t) {
        await i.followUp(ephemeral(MSG.noPick));
        return;
      }
      await session.vote(i.userId, t[0]!);
      return;
    }
  }
}
