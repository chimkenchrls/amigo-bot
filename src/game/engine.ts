import type { RoleName, SlotId } from "./types.js";
import { selectRoleSet } from "./roles.js";

export function pickRoleSet(playerCount: number): RoleName[] {
  return selectRoleSet(playerCount);
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function deal(
  players: string[],
  roleSet: RoleName[],
  rng: () => number,
): { startingRoles: Record<SlotId, RoleName> } {
  const shuffled = shuffle(roleSet, rng);
  const startingRoles: Record<SlotId, RoleName> = {};
  players.forEach((id, idx) => {
    startingRoles[id] = shuffled[idx]!;
  });
  for (let c = 0; c < 3; c++) {
    startingRoles[`center-${c}`] = shuffled[players.length + c]!;
  }
  return { startingRoles };
}
