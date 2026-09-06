import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { WEREWOLF_COOLDOWN_MS } from "../game/constants.js";
import { createGameSession, type SessionDeps } from "../game/session.js";
import { createGameMaster } from "../ai/gameMaster.js";
import type { Command, CommandCtx } from "./types.js";

/** The narrow slice of a discord.js channel the session adapter needs. */
interface SendableChannel {
  id: string;
  send(p: unknown): Promise<{ id: string; edit(q: unknown): Promise<unknown> }>;
}

function sessionDepsFor(
  channel: SendableChannel,
  interaction: ChatInputCommandInteraction,
  ctx: CommandCtx,
): SessionDeps {
  const hostName =
    (interaction.member as { displayName?: string } | null)?.displayName ??
    interaction.user.username ??
    interaction.user.id;
  return {
    now: () => Date.now(),
    setTimer: (ms, fn) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    channel: {
      id: channel.id,
      send: async (p) => {
        const m = await channel.send(p as never);
        return { id: m.id, edit: async (q) => void (await m.edit(q as never)) };
      },
    },
    gameMaster: createGameMaster(ctx.genai, ctx.model),
    rng: ctx.rng ?? Math.random,
    logger: ctx.logger,
    names: { [interaction.user.id]: hostName },
    onEnd: (channelId) => ctx.registry.remove(channelId),
  };
}

export const werewolfCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("werewolf")
    .setDescription("Maglaro ng One Night Werewolf — ako ang game master.")
    .setDMPermission(false),
  async execute(interaction, ctx) {
    const channel = interaction.channel;
    if (!channel || !("send" in channel)) {
      await interaction.reply({
        content: "hindi dito pwede maglaro",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (ctx.registry.has(interaction.channelId)) {
      await interaction.reply({
        content: "may laro na dito — tapusin niyo muna 'yun",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cd = ctx.cooldown.check(
      interaction.user.id,
      "werewolf",
      WEREWOLF_COOLDOWN_MS,
    );
    if (!cd.ok) {
      await interaction.reply({
        content: `chill lang — ${cd.retryAfter}s pa`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deps = sessionDepsFor(
      channel as unknown as SendableChannel,
      interaction,
      ctx,
    );
    const session = await createGameSession(interaction.user.id, deps);
    if (ctx.registry.has(interaction.channelId)) {
      await session.abort("nauna ang ibang laro dito");
      return;
    }
    ctx.registry.set(session);
    await interaction.reply({
      content:
        "Ginawa ko na ang lobby sa taas ⬆️ — pindutin ang **Sali**.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
