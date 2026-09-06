import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { Command } from "./types.js";

const ON =
  "📚 **Study mode on.** Paste your notes or name a topic, then `@mention` me to " +
  "have it explained, or say **quiz me** and I'll drill you on it. `/study` again to stop.";
const OFF = "📕 **Study mode off** — back to normal.";
const BUSY = "kanina pa may laro dito ah — `/study` na lang pag tapos na.";

export const studyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("study")
    .setDescription("Toggle study mode — I become a focused tutor in this channel")
    .setDMPermission(false),
  async execute(interaction, ctx) {
    if (ctx.registry.has(interaction.channelId)) {
      await interaction.reply({ content: BUSY, flags: MessageFlags.Ephemeral });
      return;
    }
    const on = ctx.studyMode.toggle(interaction.channelId);
    ctx.logger.info("study mode toggled", {
      channelId: interaction.channelId,
      on,
    });
    await interaction.reply({ content: on ? ON : OFF });
  },
};
