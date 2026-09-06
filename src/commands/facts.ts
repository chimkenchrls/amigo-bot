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
    )
    .addBooleanOption((o) =>
      o
        .setName("wipe")
        .setDescription("clear the notes I picked up on my own (keeps your saved ones)"),
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
    const wipe = interaction.options.getBoolean("wipe") ?? false;

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

    if (wipe) {
      const n = ctx.facts.count(scope, scopeId, "auto");
      if (n === 0) {
        await interaction.reply({
          content: "wala naman akong sariling notes dito na bubura-hin",
          flags: EPH,
        });
        return;
      }
      ctx.facts.replaceAuto(scope, scopeId, []);
      ctx.logger.info("auto facts wiped", { scope, scopeId, n });
      await interaction.reply({
        content: `okay, kinalimutan ko na 'yung ${n} note na napulot ko sarili`,
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

    const body = list
      .map(
        (f, i) =>
          `${i + 1}. ${f.content}${f.source === "auto" ? "  ·picked up" : ""}`,
      )
      .join("\n");
    await interaction.reply({
      content:
        `**${serverWide ? "Server-wide notes" : "Notes for this channel"}:**\n${body}\n\n` +
        "burahin ang isa: `/facts forget:<number>`",
      flags: EPH,
    });
  },
};
