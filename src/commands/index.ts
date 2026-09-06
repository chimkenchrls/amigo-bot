import { roastCommand } from "./roast.js";
import { werewolfCommand } from "./werewolf.js";
import type { Command } from "./types.js";

export type { Command } from "./types.js";

export const commands = new Map<string, Command>([
  [roastCommand.data.name, roastCommand],
  [werewolfCommand.data.name, werewolfCommand],
]);
