import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { ROAST_COOLDOWN_MS, DISCORD_MSG_LIMIT } from "../constants.js";
import {
  validateImage,
  fetchImageAsBase64,
  type AttachmentLike,
} from "../lib/image.js";
import { pickRoastMode, roastImage, type RoastMode } from "../ai/roast.js";
import {
  AiClientError,
  AiUnavailableError,
  RateLimitError,
} from "../ai/errors.js";
import type { Command, CommandCtx } from "./types.js";

export type { Command, CommandCtx } from "./types.js";

export interface RoastInput {
  userId: string;
  attachment: AttachmentLike | null;
}

export interface RoastReply {
  kind: "bad-image" | "blocked" | "rate" | "down" | "ok";
  content: string;
  mode?: RoastMode;
}

export function badImageContent(attachment: AttachmentLike | null): string | null {
  if (!attachment) return "mag-upload ka muna ng actual na photo, boss";
  const check = validateImage(attachment);
  if (check.ok) return null;
  return check.reason === "too-large"
    ? "ang laki ng file na 'yan (4MB lang ang max)"
    : "hindi photo 'yan na kaya kong i-work";
}

export async function runRoast(
  input: RoastInput,
  ctx: CommandCtx,
): Promise<RoastReply> {
  const badImage = badImageContent(input.attachment);
  if (badImage !== null || !input.attachment) {
    return {
      kind: "bad-image",
      content: badImage ?? "mag-upload ka muna ng actual na photo, boss",
    };
  }
  const check = validateImage(input.attachment);
  if (!check.ok) {
    return {
      kind: "bad-image",
      content: "hindi photo 'yan na kaya kong i-work",
    };
  }

  let encoded;
  try {
    encoded = await fetchImageAsBase64(input.attachment.url, check.mimeType);
  } catch (err) {
    ctx.logger.warn("roast image fetch failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return { kind: "down", content: "'di ko ma-fetch 'yang photo, try mo ulit" };
  }

  const mode = pickRoastMode(ctx.rng);

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
        content: "nag-trip ang breaker ng pang-roast ko diyan",
        mode,
      };
    }
    return { kind: "ok", content: res.text, mode };
  } catch (err) {
    if (err instanceof RateLimitError) {
      return {
        kind: "rate",
        content: "puno na ako — chill lang, one minute",
        mode,
      };
    }
    if (err instanceof AiUnavailableError) {
      return {
        kind: "down",
        content: "down ang utak ko, balik ka mamaya",
        mode,
      };
    }
    if (err instanceof AiClientError) {
      ctx.logger.error("roast failed: ai client error", { message: err.message });
      return {
        kind: "down",
        content: "sira ang setup ko — 'di 'to maaayos ng retry, i-check niyo yung config/key",
        mode,
      };
    }
    ctx.logger.error("roast failed", {
      name: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { kind: "down", content: "may nasira, try mo ulit", mode };
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
    const started = Date.now();
    const attachment = interaction.options.getAttachment("image");
    const attachmentLike: AttachmentLike | null = attachment
      ? {
          contentType: attachment.contentType,
          size: attachment.size,
          url: attachment.url,
        }
      : null;

    // Validate the attachment BEFORE consuming the cooldown or deferring, so a
    // rejected upload (e.g. a PDF) doesn't cost the user 30s for a call that
    // never reaches Gemini.
    const badImage = badImageContent(attachmentLike);
    if (badImage !== null) {
      await interaction.reply({
        content: badImage,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cd = ctx.cooldown.check(interaction.user.id, "roast", ROAST_COOLDOWN_MS);
    if (!cd.ok) {
      await interaction.reply({
        content: `chill lang — ${cd.retryAfter}s pa bago ka ulit`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    const reply = await runRoast(
      { userId: interaction.user.id, attachment: attachmentLike },
      ctx,
    );
    await interaction.editReply(reply.content.slice(0, DISCORD_MSG_LIMIT));
    ctx.logger.info("roast invoked", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      mode: reply.mode,
      kind: reply.kind,
      ms: Date.now() - started,
    });
  },
};
