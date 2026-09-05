import { DISCORD_MSG_LIMIT } from "../constants.js";

export function chunk(text: string, max: number = DISCORD_MSG_LIMIT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    const nl = rest.lastIndexOf("\n", max);
    if (nl > cut) cut = nl;
    if (cut <= 0) cut = max;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
