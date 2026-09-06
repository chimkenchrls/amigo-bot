import { MessageFlags, type Interaction } from "discord.js";
import type { Command, CommandCtx } from "../commands/types.js";
import type { Logger } from "../lib/log.js";
import { routeGameInteraction } from "../game/buttons.js";
import type { GameRegistry } from "../game/registry.js";

export interface RouteDeps {
  commands: Map<string, Command>;
  ctx: CommandCtx;
  logger: Logger;
  registry: GameRegistry;
}

const ERR_LINE = "naku, may nag-error sa gilid ko. try mo ulit saglit";

export function routeInteraction(
  deps: RouteDeps,
): (interaction: Interaction) => Promise<void> {
  return async (interaction: Interaction): Promise<void> => {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith("wolf:")) return;
      return routeGameInteraction(
        {
          customId: interaction.customId,
          channelId: interaction.channelId ?? "",
          userId: interaction.user.id,
          displayName:
            (interaction.member as { displayName?: string } | null)?.displayName ??
            interaction.user.username ??
            interaction.user.id,
          ...(interaction.isStringSelectMenu() ? { values: interaction.values } : {}),
          reply: (p) => interaction.reply(p as never).then(() => {}),
          deferUpdate: () => interaction.deferUpdate().then(() => {}),
          followUp: (p) => interaction.followUp(p as never).then(() => {}),
        },
        deps.registry,
        deps.logger,
      );
    }

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
