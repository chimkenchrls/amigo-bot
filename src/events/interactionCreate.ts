import { MessageFlags, type Interaction } from "discord.js";
import type { Command, CommandCtx } from "../commands/types.js";
import type { Logger } from "../lib/log.js";

export interface RouteDeps {
  commands: Map<string, Command>;
  ctx: CommandCtx;
  logger: Logger;
}

const ERR_LINE = "naku, may nag-error sa gilid ko. try mo ulit saglit";

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
          content: "hindi ko alam 'yang utos na 'yan",
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
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
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
