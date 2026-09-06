import type { GoogleGenAI } from "@google/genai";
import {
  CHAT_COOLDOWN_MS,
  NAME_TRIGGER_COOLDOWN_MS,
  CHAT_HISTORY_KEEP,
  CHAT_HISTORY_LOAD,
  DISCORD_MSG_LIMIT,
  MAX_CHAT_INPUT_CHARS,
  STREAM_EDIT_INTERVAL_MS,
  TYPING_KEEPALIVE_MS,
} from "../constants.js";
import type { Cooldown } from "../lib/cooldown.js";
import type { MessageStore } from "../store/messages.js";
import type { Logger } from "../lib/log.js";
import type { BotMessageCache } from "../lib/botMessages.js";
import type { StudyMode } from "../lib/studyMode.js";
import { chunk } from "../lib/chunk.js";
import { toGeminiHistory, generateReplyStream } from "../ai/conversation.js";
import {
  AiClientError,
  AiUnavailableError,
  RateLimitError,
} from "../ai/errors.js";

export interface ChatDeps {
  cooldown: Cooldown;
  store: MessageStore;
  genai: GoogleGenAI;
  botMessages: BotMessageCache;
  logger: Logger;
  model: string;
  studyMode: StudyMode;
}

export interface SentMessage {
  id: string;
  edit(content: string): Promise<void>;
}

export interface ChatContext {
  channelId: string;
  userId: string;
  displayName: string;
  text: string;
  guildId: string | null;
  /** True for an @mention or a reply-to-bot; false when only the name "amigo" triggered it. */
  directPing: boolean;
  sendTyping(): Promise<void>;
  reply(content: string): Promise<SentMessage>;
  followUp(content: string): Promise<SentMessage>;
  react(emoji: string): Promise<void>;
}

const ERR_RATE = "hinihingal na utak ko, sandali — need ko mag-cooldown";
const ERR_DOWN = "down ang utak ko ngayon, balik ka na lang mamaya";
const ERR_BLOCKED = "nah, 'wag mo ako idamay diyan";
const ERR_CRASH = "nag-blue screen bigla ang utak ko, ulitin mo nga?";
const ERR_CONFIG =
  "may sira sa setup ko 😭 hindi 'to kaya ng retry — sabihan mo yung nag-set up sakin";

export function handleChat(deps: ChatDeps) {
  return async (ctx: ChatContext): Promise<void> => {
    const { logger } = deps;
    let typingTimer: ReturnType<typeof setInterval> | undefined;
    const stopTyping = () => {
      if (typingTimer !== undefined) {
        clearInterval(typingTimer);
        typingTimer = undefined;
      }
    };

    try {
      // A bare "amigo" in chatter gets a longer leash so the bot doesn't jump on
      // every message; a direct @mention / reply stays snappy.
      const cd = ctx.directPing
        ? deps.cooldown.check(ctx.userId, "chat", CHAT_COOLDOWN_MS)
        : deps.cooldown.check(ctx.userId, "chat-name", NAME_TRIGGER_COOLDOWN_MS);
      if (!cd.ok) {
        if (ctx.directPing) await ctx.react("🥱").catch(() => {});
        return;
      }

      await ctx.sendTyping().catch(() => {});
      // Discord's typing state lapses after ~10s; re-arm it until the first
      // chunk of the reply is on screen.
      typingTimer = setInterval(() => {
        ctx.sendTyping().catch(() => {});
      }, TYPING_KEEPALIVE_MS);

      const rows = deps.store.recent(ctx.channelId, CHAT_HISTORY_LOAD);
      const history = toGeminiHistory(rows);
      const clampedText = ctx.text.slice(0, MAX_CHAT_INPUT_CHARS);
      const userTurn = `${ctx.displayName}: ${clampedText}`;

      let acc = "";
      let handle: SentMessage | undefined;
      let lastEditAt = 0;
      let interrupted: unknown;

      try {
        for await (const delta of generateReplyStream(deps.genai, {
          history,
          userTurn,
          model: deps.model,
          studyMode: deps.studyMode.has(ctx.channelId),
        })) {
          acc += delta;
          const preview = acc.trim().slice(0, DISCORD_MSG_LIMIT);
          if (!preview) continue;
          const now = Date.now();
          if (handle === undefined) {
            stopTyping();
            handle = await ctx.reply(preview);
            deps.botMessages.remember(handle.id);
            lastEditAt = now;
          } else if (now - lastEditAt >= STREAM_EDIT_INTERVAL_MS) {
            await handle.edit(preview).catch(() => {});
            lastEditAt = now;
          }
        }
      } catch (err) {
        // A failure before the first chunk landed: nothing is on screen, so
        // fall back to a single in-character line.
        if (handle === undefined) {
          const line =
            err instanceof RateLimitError
              ? ERR_RATE
              : err instanceof AiClientError
                ? ERR_CONFIG
                : err instanceof AiUnavailableError
                  ? ERR_DOWN
                  : ERR_CRASH;
          logger.error("chat generate failed", {
            guildId: ctx.guildId,
            name: err instanceof Error ? err.name : "unknown",
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          stopTyping();
          await sendChunks(ctx, deps, line);
          return;
        }
        // The stream broke mid-reply — keep the partial we already showed.
        interrupted = err;
      }

      stopTyping();
      const finalText = acc.trim();

      if (!finalText) {
        await sendChunks(ctx, deps, ERR_BLOCKED);
        return;
      }

      if (interrupted !== undefined) {
        logger.warn("chat stream interrupted; keeping partial reply", {
          guildId: ctx.guildId,
          name:
            interrupted instanceof Error ? interrupted.name : "unknown",
        });
      }

      const parts = chunk(finalText);
      if (handle === undefined) {
        await sendChunks(ctx, deps, finalText);
      } else {
        await handle.edit(parts[0]!).catch(() => {});
        for (const p of parts.slice(1)) {
          const m = await ctx.followUp(p);
          deps.botMessages.remember(m.id);
        }
      }

      deps.store.append(ctx.channelId, "user", userTurn);
      deps.store.append(ctx.channelId, "model", finalText);
      deps.store.trim(ctx.channelId, CHAT_HISTORY_KEEP);
    } catch (err) {
      logger.error("chat handler crashed", {
        name: err instanceof Error ? err.name : "unknown",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      await ctx.reply(ERR_CRASH).catch(() => {});
    } finally {
      stopTyping();
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
