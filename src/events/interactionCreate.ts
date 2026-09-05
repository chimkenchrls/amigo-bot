import { MessageFlags, type Interaction } from "discord.js";
import type { Command, CommandCtx } from "../commands/roast.js";
import type { Logger } from "../lib/log.js";

export interface RouteDeps {
  commands: Map<string, Command>;
  ctx: CommandCtx;
  logger: Logger;
}

const ERR_LINE = "ugh, that broke on my end. try again in a sec";

export function routeInteraction(
  deps: RouteDeps,
): (interaction: Interaction) => Promise<void> {
  return async (interaction: Interaction): Promise<void> => {
    if (!interaction.isChatInputCommand()) return;

    const command = deps.commands.get(interaction.commandName);
    if (!command) {
      deps.logger.warn("unknown command", { name: interaction.commandName });
      await interaction
        .reply({
          content: "i don't know that one",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    try {
      await command.execute(interaction, deps.ctx);
    } catch (err) {
      deps.logger.error("command failed", {
        name: interaction.commandName,
        error: err instanceof Error ? err.name : "unknown",
      });
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(ERR_LINE).catch(() => {});
      } else {
        await interaction
          .reply({ content: ERR_LINE, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  };
}
