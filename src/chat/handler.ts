import type { GoogleGenAI } from "@google/genai";
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_KEEP,
  CHAT_HISTORY_LOAD,
} from "../constants.js";
import type { Cooldown } from "../lib/cooldown.js";
import type { MessageStore } from "../store/messages.js";
import type { Logger } from "../lib/log.js";
import type { BotMessageCache } from "../lib/botMessages.js";
import { chunk } from "../lib/chunk.js";
import { toGeminiHistory, generateReply } from "../ai/conversation.js";
import { AiUnavailableError, RateLimitError } from "../ai/errors.js";

export interface ChatDeps {
  cooldown: Cooldown;
  store: MessageStore;
  genai: GoogleGenAI;
  botMessages: BotMessageCache;
  logger: Logger;
  model: string;
}

export interface ChatContext {
  channelId: string;
  userId: string;
  displayName: string;
  text: string;
  guildId: string | null;
  sendTyping(): Promise<void>;
  reply(content: string): Promise<{ id: string }>;
  followUp(content: string): Promise<{ id: string }>;
  react(emoji: string): Promise<void>;
}

const ERR_RATE = "hitting my limits — gimme a minute";
const ERR_DOWN = "my brain's offline rn, try again later";
const ERR_BLOCKED = "yeah i'm not touching that one";
const ERR_CRASH = "my brain just blue-screened, say that again?";

export function handleChat(deps: ChatDeps) {
  return async (ctx: ChatContext): Promise<void> => {
    const { logger } = deps;
    try {
      const cd = deps.cooldown.check(ctx.userId, "chat", CHAT_COOLDOWN_MS);
      if (!cd.ok) {
        await ctx.react("🥱").catch(() => {});
        return;
      }

      await ctx.sendTyping().catch(() => {});

      const rows = deps.store.recent(ctx.channelId, CHAT_HISTORY_LOAD);
      const history = toGeminiHistory(rows);
      const userTurn = `${ctx.displayName}: ${ctx.text}`;

      let result;
      try {
        result = await generateReply(deps.genai, {
          history,
          userTurn,
          model: deps.model,
        });
      } catch (err) {
        const line =
          err instanceof RateLimitError
            ? ERR_RATE
            : err instanceof AiUnavailableError
              ? ERR_DOWN
              : ERR_CRASH;
        logger.error("chat generate failed", {
          guildId: ctx.guildId,
          name: err instanceof Error ? err.name : "unknown",
        });
        await sendChunks(ctx, deps, line);
        return;
      }

      if (!result.ok) {
        await sendChunks(ctx, deps, ERR_BLOCKED);
        return;
      }

      deps.store.append(ctx.channelId, "user", userTurn);
      deps.store.append(ctx.channelId, "model", result.text);
      deps.store.trim(ctx.channelId, CHAT_HISTORY_KEEP);
      await sendChunks(ctx, deps, result.text);
    } catch (err) {
      logger.error("chat handler crashed", {
        name: err instanceof Error ? err.name : "unknown",
      });
      await ctx.reply(ERR_CRASH).catch(() => {});
    }
  };
}

async function sendChunks(
  ctx: ChatContext,
  deps: ChatDeps,
  text: string,
): Promise<void> {
  const parts = chunk(text);
  if (parts.length === 0) return;
  try {
    const first = await ctx.reply(parts[0]!);
    deps.botMessages.remember(first.id);
    for (const p of parts.slice(1)) {
      const m = await ctx.followUp(p);
      deps.botMessages.remember(m.id);
    }
  } catch (err) {
    deps.logger.warn("chat send failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
  }
}
