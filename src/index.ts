import "dotenv/config";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";
import { createLogger } from "./lib/log.js";
import { createCooldown } from "./lib/cooldown.js";
import { createBotMessageCache } from "./lib/botMessages.js";
import { openDatabase } from "./store/db.js";
import { createMessageStore } from "./store/messages.js";
import { createGenAI } from "./ai/client.js";
import { createClient } from "./client.js";
import { commands } from "./commands/index.js";
import { registerReady } from "./events/ready.js";
import { routeInteraction } from "./events/interactionCreate.js";

const logger = createLogger(config.logLevel);

if (config.databasePath !== ":memory:") {
  mkdirSync(dirname(config.databasePath), { recursive: true });
}
const db = openDatabase(config.databasePath);
const store = createMessageStore(db);
const cooldown = createCooldown();
const botMessages = createBotMessageCache();
const genai = createGenAI(config.geminiApiKey);

// store + botMessages are wired here for the chat feature (later tasks).
void store;
void botMessages;

const client = createClient();
registerReady(client, logger);

const commandCtx = { cooldown, genai, logger, model: config.model };
client.on(
  "interactionCreate",
  routeInteraction({ commands, ctx: commandCtx, logger }),
);

client.on("error", (e) => logger.error("client error", { name: e.name }));
client.on("shardError", (e) => logger.error("shard error", { name: e.name }));

process.on("unhandledRejection", (reason) =>
  logger.error("unhandledRejection", {
    name: reason instanceof Error ? reason.name : "unknown",
  }),
);
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { name: err.name, message: err.message });
  process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info("shutting down", { sig });
    void client.destroy();
    db.close();
    process.exit(0);
  });
}

client.login(config.discordToken).catch((err) => {
  logger.error("login failed", {
    message: err instanceof Error ? err.message : "?",
  });
  process.exit(1);
});
