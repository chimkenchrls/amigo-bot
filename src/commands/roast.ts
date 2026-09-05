import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { GoogleGenAI } from "@google/genai";
import { ROAST_COOLDOWN_MS, DISCORD_MSG_LIMIT } from "../constants.js";
import type { Cooldown } from "../lib/cooldown.js";
import type { Logger } from "../lib/log.js";
import {
  validateImage,
  fetchImageAsBase64,
  type AttachmentLike,
} from "../lib/image.js";
import { pickRoastMode, roastImage } from "../ai/roast.js";
import { AiUnavailableError, RateLimitError } from "../ai/errors.js";

export interface CommandCtx {
  cooldown: Cooldown;
  genai: GoogleGenAI;
  logger: Logger;
  model: string;
  rng?: () => number;
}

export interface Command {
  data: { name: string; toJSON(): unknown };
  execute(
    interaction: ChatInputCommandInteraction,
    ctx: CommandCtx,
  ): Promise<void>;
}

export interface RoastInput {
  userId: string;
  attachment: AttachmentLike | null;
}

export interface RoastReply {
  kind: "bad-image" | "blocked" | "rate" | "down" | "ok";
  content: string;
}

export async function runRoast(
  input: RoastInput,
  ctx: CommandCtx,
): Promise<RoastReply> {
  if (!input.attachment) {
    return { kind: "bad-image", content: "you gotta actually upload a photo" };
  }
  const check = validateImage(input.attachment);
  if (!check.ok) {
    return {
      kind: "bad-image",
      content:
        check.reason === "too-large"
          ? "that image is too chonky (4MB max)"
          : "that's not a photo i can work with",
    };
  }

  let encoded;
  try {
    encoded = await fetchImageAsBase64(input.attachment.url, check.mimeType);
  } catch (err) {
    ctx.logger.warn("roast image fetch failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return { kind: "down", content: "couldn't grab that image, try again" };
  }

  const mode = pickRoastMode(ctx.rng);
  ctx.logger.info("roast", { mode });

  try {
    const res = await roastImage(ctx.genai, {
      data: encoded.data,
      mimeType: encoded.mimeType,
      mode,
      model: ctx.model,
    });
    if (!res.ok) {
      return {
        kind: "blocked",
        content: "my roast circuits tripped a breaker on that one",
      };
    }
    return { kind: "ok", content: res.text };
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { kind: "rate", content: "hitting my limits — gimme a minute" };
    }
    if (err instanceof AiUnavailableError) {
      return { kind: "down", content: "my brain's offline, try again later" };
    }
    ctx.logger.error("roast failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return { kind: "down", content: "something broke, try again" };
  }
}

export const roastCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("roast")
    .setDescription("Upload a photo. I decide: brutal roast or unhinged praise.")
    .addAttachmentOption((o) =>
      o.setName("image").setDescription("the photo").setRequired(true),
    ),
  async execute(interaction, ctx) {
    const cd = ctx.cooldown.check(interaction.user.id, "roast", ROAST_COOLDOWN_MS);
    if (!cd.ok) {
      await interaction.reply({
        content: `chill — ${cd.retryAfter}s left`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    const attachment = interaction.options.getAttachment("image");
    const reply = await runRoast(
      {
        userId: interaction.user.id,
        attachment: attachment
          ? {
              contentType: attachment.contentType,
              size: attachment.size,
              url: attachment.url,
            }
          : null,
      },
      ctx,
    );
    await interaction.editReply(reply.content.slice(0, DISCORD_MSG_LIMIT));
  },
};
