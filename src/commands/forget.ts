import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const forgetCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("forget")
    .setDescription("Wipe my memory of this channel's conversation")
    .setDMPermission(false),
  async execute(interaction, ctx) {
    ctx.store.purgeChannel(interaction.channelId);
    ctx.logger.info("channel memory purged", {
      channelId: interaction.channelId,
      by: interaction.user.id,
    });
    await interaction.reply({
      content: "ayan — wala na akong maalala sa napag-usapan dito. fresh start tayo. 🧠💨",
    });
  },
};
