import { roastCommand } from "./roast.js";
import { werewolfCommand } from "./werewolf.js";
import { studyCommand } from "./study.js";
import { forgetCommand } from "./forget.js";
import { rememberCommand } from "./remember.js";
import { factsCommand } from "./facts.js";
import type { Command } from "./types.js";

export type { Command } from "./types.js";

export const commands = new Map<string, Command>([
  [roastCommand.data.name, roastCommand],
  [werewolfCommand.data.name, werewolfCommand],
  [studyCommand.data.name, studyCommand],
  [forgetCommand.data.name, forgetCommand],
  [rememberCommand.data.name, rememberCommand],
  [factsCommand.data.name, factsCommand],
]);
