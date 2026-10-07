export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  discordToken: string;
  discordAppId: string;
  geminiApiKey: string;
  model: string;
  databasePath: string;
  logLevel: LogLevel;
  /** Discord user id of the one person the bot takes orders from. Unset = nobody. */
  ownerId?: string | undefined;
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const required = {
    DISCORD_TOKEN: env.DISCORD_TOKEN,
    DISCORD_APP_ID: env.DISCORD_APP_ID,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v || v.trim() === "")
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const rawLevel = env.LOG_LEVEL as LogLevel | undefined;
  const logLevel: LogLevel =
    rawLevel && LOG_LEVELS.includes(rawLevel) ? rawLevel : "info";

  return {
    discordToken: required.DISCORD_TOKEN!,
    discordAppId: required.DISCORD_APP_ID!,
    geminiApiKey: required.GEMINI_API_KEY!,
    model: env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
    databasePath: env.DATABASE_PATH?.trim() || "./data/amigo.db",
    logLevel,
    ownerId: env.OWNER_ID?.trim() || undefined,
  };
}

export const config: Config = loadConfig(process.env);
