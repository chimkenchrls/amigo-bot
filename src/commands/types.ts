import type { ChatInputCommandInteraction } from "discord.js";
import type { GoogleGenAI } from "@google/genai";
import type { Cooldown } from "../lib/cooldown.js";
import type { Logger } from "../lib/log.js";

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
