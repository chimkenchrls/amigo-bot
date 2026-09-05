import "dotenv/config";
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";
import { createLogger } from "./lib/log.js";

const logger = createLogger(config.logLevel);

async function main(): Promise<void> {
  const guildFlag = process.argv.indexOf("--guild");
  const guildId = guildFlag !== -1 ? process.argv[guildFlag + 1] : undefined;

  const body = [...commands.values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(config.discordToken);

  const route = guildId
    ? Routes.applicationGuildCommands(config.discordAppId, guildId)
    : Routes.applicationCommands(config.discordAppId);

  await rest.put(route, { body });
  logger.info("commands registered", {
    scope: guildId ? `guild:${guildId}` : "global",
    count: body.length,
  });
}

main().catch((err) => {
  logger.error("deploy failed", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
