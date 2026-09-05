import type { Client } from "discord.js";
import type { Logger } from "../lib/log.js";

export const botUserId = { current: "" };

export function registerReady(client: Client, logger: Logger): void {
  client.once("clientReady", (c) => {
    botUserId.current = c.user.id;
    logger.info("ready", { tag: c.user.tag });
  });
}
