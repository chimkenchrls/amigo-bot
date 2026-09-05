import { roastCommand, type Command } from "./roast.js";

export type { Command } from "./roast.js";

export const commands = new Map<string, Command>([
  [roastCommand.data.name, roastCommand],
]);
