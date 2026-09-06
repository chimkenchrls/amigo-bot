import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { Command } from "./types.js";
import type { FactScope } from "../store/facts.js";

const EPH = MessageFlags.Ephemeral;

export const factsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("facts")
    .setDescription("Show the notes I've saved for this channel (or the server)")
    .setDMPermission(false)
    .addBooleanOption((o) =>
      o.setName("server").setDescription("show the server-wide notes instead"),
    )
    .addIntegerOption((o) =>
      o
        .setName("forget")
        .setDescription("delete note #N from the list")
        .setMinValue(1),
    ),
  async execute(interaction, ctx) {
    const serverWide = interaction.options.getBoolean("server") ?? false;
    const scope: FactScope = serverWide ? "guild" : "channel";
    const scopeId = serverWide ? interaction.guildId : interaction.channelId;

    if (!scopeId) {
      await interaction.reply({ content: "wala akong notes dito", flags: EPH });
      return;
    }

    const list = ctx.facts.list(scope, scopeId);
    const forget = interaction.options.getInteger("forget");

    if (forget !== null) {
      const target = list[forget - 1];
      if (!target) {
        await interaction.reply({ content: `walang note #${forget}`, flags: EPH });
        return;
      }
      ctx.facts.remove(target.id);
      ctx.logger.info("fact forgotten", { scope, scopeId, id: target.id });
      await interaction.reply({
        content: `nakalimutan ko na: "${target.content}"`,
        flags: EPH,
      });
      return;
    }

    if (list.length === 0) {
      await interaction.reply({
        content: serverWide
          ? "wala pang server-wide notes. gamitin ang `/remember text:... server:true`"
          : "wala pang notes dito. gamitin ang `/remember text:...`",
        flags: EPH,
      });
      return;
    }

    const body = list.map((f, i) => `${i + 1}. ${f.content}`).join("\n");
    await interaction.reply({
      content:
        `**${serverWide ? "Server-wide notes" : "Notes for this channel"}:**\n${body}\n\n` +
        "burahin ang isa: `/facts forget:<number>`",
      flags: EPH,
    });
  },
};
