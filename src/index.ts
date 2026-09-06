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
import { createRegistry } from "./game/registry.js";
import { commands } from "./commands/index.js";
import { registerReady, botUserId } from "./events/ready.js";
import { routeInteraction } from "./events/interactionCreate.js";
import { onMessageCreate } from "./events/messageCreate.js";

const logger = createLogger(config.logLevel);

if (config.databasePath !== ":memory:") {
  mkdirSync(dirname(config.databasePath), { recursive: true });
}
const db = openDatabase(config.databasePath);
const store = createMessageStore(db);
const cooldown = createCooldown();
const botMessages = createBotMessageCache();
const genai = createGenAI(config.geminiApiKey);
const registry = createRegistry();

const client = createClient();
registerReady(client, logger);

const commandCtx = { cooldown, genai, logger, model: config.model, registry };
client.on(
  "interactionCreate",
  routeInteraction({ commands, ctx: commandCtx, logger, registry }),
);
client.on(
  "messageCreate",
  onMessageCreate({
    cooldown,
    store,
    genai,
    botMessages,
    logger,
    model: config.model,
    getBotUserId: () => botUserId.current,
    registry,
  }),
);

client.on("error", (e) =>
  logger.error("client error", {
    name: e.name,
    message: e.message,
    stack: e.stack,
  }),
);
client.on("shardError", (e) =>
  logger.error("shard error", {
    name: e.name,
    message: e.message,
    stack: e.stack,
  }),
);

// Give the buffered log write a moment to flush before a fatal exit.
const fatalExit = (): void => {
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100);
};

process.on("unhandledRejection", (reason) =>
  logger.error("unhandledRejection", {
    name: reason instanceof Error ? reason.name : "unknown",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  }),
);
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", {
    name: err instanceof Error ? err.name : "unknown",
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  fatalExit();
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info("shutting down", { sig });
    void registry
      .abortAll("nagre-restart si AmIgo — sorry, tapos na 'to")
      .catch(() => {})
      .finally(() => client.destroy())
      .finally(() => {
        db.close();
        process.exit(0);
      });
  });
}

client.login(config.discordToken).catch((err) => {
  logger.error("login failed", {
    name: err instanceof Error ? err.name : "unknown",
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  fatalExit();
});
