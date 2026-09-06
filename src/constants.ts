import { ThinkingLevel } from "@google/genai";

export const ROAST_COOLDOWN_MS = 30_000;
export const CHAT_COOLDOWN_MS = 5_000;
/** Longer cooldown when only the word "amigo" triggered the reply (not a direct ping). */
export const NAME_TRIGGER_COOLDOWN_MS = 30_000;
export const CHAT_HISTORY_LOAD = 16;
export const CHAT_HISTORY_KEEP = 30;
/** Max curated facts kept per scope (channel or guild); `/remember` refuses beyond this. */
export const MAX_FACTS_PER_SCOPE = 40;
export const MAX_FACT_CHARS = 300;
export const MAX_CHAT_INPUT_CHARS = 1000;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const AI_TIMEOUT_MS = 15_000;

// gemini-3.6-flash defaults to MEDIUM reasoning; AmIgo is a casual group-chat
// bot, so dial it down to trade a little wit for a lot of latency.
export const CHAT_THINKING_LEVEL = ThinkingLevel.LOW;
export const ROAST_THINKING_LEVEL = ThinkingLevel.LOW;

// While a reply is generating: re-arm Discord's ~10s typing indicator, and
// throttle how often the streamed message is edited in place.
export const TYPING_KEEPALIVE_MS = 8_000;
export const STREAM_EDIT_INTERVAL_MS = 900;
export const DISCORD_MSG_LIMIT = 2000;
export const BOT_MESSAGE_CACHE_CAP = 200;
export const DISCORD_UNKNOWN_MESSAGE = 10008;
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
