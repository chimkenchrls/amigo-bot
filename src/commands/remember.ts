import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { MAX_FACT_CHARS, MAX_FACTS_PER_SCOPE } from "../constants.js";
import type { Command } from "./types.js";
import type { FactScope } from "../store/facts.js";

export const rememberCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("remember")
    .setDescription("Save a note I'll keep in mind for this channel")
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("text").setDescription("what to remember").setRequired(true),
    )
    .addBooleanOption((o) =>
      o
        .setName("server")
        .setDescription("remember it for the whole server, not just this channel"),
    ),
  async execute(interaction, ctx) {
    const text = (interaction.options.getString("text", true) ?? "").trim();
    const serverWide = interaction.options.getBoolean("server") ?? false;

    if (!text) {
      await interaction.reply({
        content: "wala kang sinabi na tatandaan ah",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (text.length > MAX_FACT_CHARS) {
      await interaction.reply({
        content: `masyadong mahaba — ${MAX_FACT_CHARS} chars max`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const scope: FactScope = serverWide ? "guild" : "channel";
    const scopeId = serverWide ? interaction.guildId : interaction.channelId;
    if (!scopeId) {
      await interaction.reply({
        content: "hindi ko ma-save 'yan dito",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const fact = ctx.facts.add(scope, scopeId, text, interaction.user.id);
    if (!fact) {
      await interaction.reply({
        content: `puno na ang notes ko dito (${MAX_FACTS_PER_SCOPE} max) — burahin mo muna 'yung iba sa \`/facts\``,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    ctx.logger.info("fact remembered", {
      scope,
      scopeId,
      by: interaction.user.id,
    });
    await interaction.reply({
      content: serverWide
        ? "noted para sa buong server 📌"
        : "noted 📌",
    });
  },
};
