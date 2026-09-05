export const ROAST_COOLDOWN_MS = 30_000;
export const CHAT_COOLDOWN_MS = 5_000;
export const CHAT_HISTORY_LOAD = 15;
export const CHAT_HISTORY_KEEP = 30;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const AI_TIMEOUT_MS = 20_000;
export const DISCORD_MSG_LIMIT = 2000;
export const BOT_MESSAGE_CACHE_CAP = 200;
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
